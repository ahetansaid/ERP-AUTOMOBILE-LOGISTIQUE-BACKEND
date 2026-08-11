/**
 * Réconciliation — ancien registre contre grand livre
 *
 * Pendant la double écriture, chaque flux alimente `transactions_tresorerie` ET
 * `ledger_entries`. Ce module compare les deux et répond à la seule question qui
 * décide de la coupure : **les deux registres disent-ils la même chose ?**
 *
 * Deux précautions de comparaison :
 *
 * 1. On ne compare que les mouvements de TRÉSORERIE. Le grand livre contient en
 *    plus les factures émises (nature VENTE, sans compte de caisse), qui n'ont
 *    pas d'équivalent dans l'ancienne table : les inclure créerait un écart
 *    permanent et trompeur.
 *
 * 2. Les conventions de signe diffèrent. L'ancienne table stocke un montant
 *    toujours positif avec un `type` ; le grand livre stocke un montant signé.
 *    On ramène l'ancien à la convention du nouveau avant de comparer.
 */

const { prisma } = require('./prisma');

const num = (v) => (v == null ? 0 : Number(v));
const day = (d) => new Date(d).toISOString().slice(0, 10);

/** Ramène un mouvement de l'ancienne table à la convention signée du grand livre. */
const signedLegacy = (t) => num(t.montant) * (t.type === 'ENCAISSEMENT' ? 1 : -1);

/**
 * Clé d'appariement : le document source. C'est ce qui permet de dire non
 * seulement « il y a un écart de X » mais « ce reçu-là manque d'un côté ».
 */
function sourceKey(row) {
  if (row.receiptId != null) return `receipt:${row.receiptId}`;
  if (row.workshopQuoteId != null) return `devis:${row.workshopQuoteId}`;
  if (row.purchaseId != null) return `achat:${row.purchaseId}`;
  if (row.chargeId != null) return `charge:${row.chargeId}`;
  return null; // saisie manuelle : sans source, non appariable
}

/**
 * @param {string|Date} [from]
 * @param {string|Date} [to]
 */
async function reconcile(from, to) {
  const legacyWhere = {};
  const ledgerWhere = { cashAccountId: { not: null } };
  if (from || to) {
    const range = {};
    if (from) range.gte = new Date(from);
    if (to) range.lte = new Date(to);
    legacyWhere.transactionDate = range;
    ledgerWhere.entryDate = range;
  }

  const [legacy, entries] = await Promise.all([
    prisma.treasuryTransaction.findMany({
      where: legacyWhere,
      select: {
        id: true, type: true, montant: true, transactionDate: true, categorie: true,
        receiptId: true, purchaseId: true, workshopQuoteId: true, chargeId: true,
      },
    }),
    prisma.ledgerEntry.findMany({
      where: ledgerWhere,
      select: {
        id: true, nature: true, label: true, amountFcfa: true, entryDate: true,
        receiptId: true, purchaseId: true, workshopQuoteId: true, chargeId: true,
      },
    }),
  ]);

  const legacyTotal = legacy.reduce((s, t) => s + signedLegacy(t), 0);
  const ledgerTotal = entries.reduce((s, e) => s + num(e.amountFcfa), 0);

  // ── Comparaison jour par jour ────────────────────────────────────────────
  const days = new Map();
  const bump = (d, field, value) => {
    const k = day(d);
    if (!days.has(k)) days.set(k, { date: k, legacy: 0, ledger: 0 });
    days.get(k)[field] += value;
  };
  legacy.forEach((t) => bump(t.transactionDate, 'legacy', signedLegacy(t)));
  entries.forEach((e) => bump(e.entryDate, 'ledger', num(e.amountFcfa)));

  const daily = [...days.values()]
    .map((d) => ({ ...d, ecart: Math.round((d.ledger - d.legacy) * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Appariement par document source ──────────────────────────────────────
  const legacyBySource = new Map();
  legacy.forEach((t) => {
    const k = sourceKey(t);
    if (k) legacyBySource.set(k, (legacyBySource.get(k) ?? 0) + signedLegacy(t));
  });

  const ledgerBySource = new Map();
  entries.forEach((e) => {
    const k = sourceKey(e);
    if (k) ledgerBySource.set(k, (ledgerBySource.get(k) ?? 0) + num(e.amountFcfa));
  });

  const allKeys = new Set([...legacyBySource.keys(), ...ledgerBySource.keys()]);
  const divergences = [];
  for (const k of allKeys) {
    const l = legacyBySource.get(k);
    const n = ledgerBySource.get(k);
    if (l == null) {
      divergences.push({ source: k, type: 'absent_ancien', legacy: null, ledger: n });
    } else if (n == null) {
      divergences.push({ source: k, type: 'absent_livre', legacy: l, ledger: null });
    } else if (Math.abs(l - n) > 0.01) {
      divergences.push({ source: k, type: 'montant', legacy: l, ledger: n, ecart: n - l });
    }
  }

  // Écritures manuelles du grand livre : sans source, elles ne sont pas
  // appariables. Ce n'est pas une anomalie — mais il faut le dire, sinon on
  // conclurait à tort à un écart inexpliqué.
  const manuelles = entries.filter((e) => sourceKey(e) === null);
  const totalManuelles = manuelles.reduce((s, e) => s + num(e.amountFcfa), 0);

  const ecart = Math.round((ledgerTotal - legacyTotal - totalManuelles) * 100) / 100;

  return {
    periode: { from: from ?? null, to: to ?? null },
    ancien: { total: Math.round(legacyTotal * 100) / 100, lignes: legacy.length },
    livre: { total: Math.round(ledgerTotal * 100) / 100, lignes: entries.length },
    saisiesManuelles: {
      total: Math.round(totalManuelles * 100) / 100,
      lignes: manuelles.length,
    },
    ecart,
    // Le verdict qui autorise (ou non) la coupure.
    concordant: ecart === 0 && divergences.length === 0,
    divergences: divergences.slice(0, 200),
    divergencesTotal: divergences.length,
    quotidien: daily,
  };
}

module.exports = { reconcile };
