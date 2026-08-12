/**
 * Grand livre — service d'écriture
 *
 * Seul point par lequel le grand livre s'alimente. Toute dépense, toute
 * recette passe par `postEntry`, et l'écriture produite porte simultanément
 * ses deux axes : le véhicule (analytique) et le compte de trésorerie
 * (financier).
 *
 * Conséquence directe : le coût de revient d'un véhicule et le solde d'un
 * compte sont des SOMMES, jamais des valeurs saisies. Le cas « réparation
 * détaillée en bas de feuille mais jamais reportée dans le coût » — 61 % du
 * parc dans les classeurs analysés — devient structurellement impossible.
 *
 * La table est en écriture seule (garanti par l'extension Prisma) : corriger
 * se fait par contre-passation, jamais par modification.
 */

const { prisma } = require('./prisma');
const { getContext } = require('./context');

/** Natures qui composent le coût de revient d'un véhicule. */
const COST_NATURES = ['ACHAT', 'LOGISTIQUE', 'TAXE', 'MANUTENTION', 'PREPARATION'];

/**
 * Natures exclues du résultat : mouvements de bilan, pas d'exploitation.
 * REGLEMENT en fait partie — la vente est reconnue à la facture ; l'encaissement
 * qui suit déplace de la trésorerie sans créer de produit supplémentaire.
 */
const OFF_RESULT_NATURES = ['REGLEMENT', 'FINANCEMENT', 'COMPTE_ASSOCIE', 'TRANSFERT'];

/** Parités fixes, non négociables — jamais saisies par l'utilisateur. */
const FIXED_RATES = { FCFA: 1, XOF: 1, EUR: 655.957 };

/**
 * Taux à appliquer pour convertir `currency` en FCFA.
 * L'EUR est arrimé au FCFA par une parité fixe : la laisser saisir libremement
 * ouvrirait la porte aux écarts constatés dans les classeurs (un transfert
 * converti à 705 au lieu de 655,957).
 */
async function resolveRate(currency, explicitRate, atDate) {
  const code = (currency || 'FCFA').toUpperCase();
  if (FIXED_RATES[code] != null) return FIXED_RATES[code];
  if (explicitRate != null && Number(explicitRate) > 0) return Number(explicitRate);

  // Le taux retenu est celui EN VIGUEUR à la date de l'écriture, pas le dernier
  // connu. C'est ce qui évite qu'un changement de taux recalcule rétroactivement
  // des conteneurs déjà costés — le défaut même des classeurs, où le taux vivait
  // dans la formule et suivait donc toute modification.
  const date = atDate ? new Date(atDate) : new Date();
  const row = await prisma.exchangeRate.findFirst({
    where: { currency: code, isActive: true, effectiveDate: { lte: date } },
    orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
  });
  if (!row) {
    throw new Error(
      `[ledger] aucun taux ${code} en vigueur au ${date.toISOString().slice(0, 10)}. ` +
        'Renseignez-le dans les paramètres ou passez rateApplied explicitement.'
    );
  }
  return Number(row.rateFcfa);
}

/**
 * Écrit une ligne au grand livre.
 *
 * @param {object} p
 * @param {'ACHAT'|'LOGISTIQUE'|'TAXE'|'MANUTENTION'|'PREPARATION'|'VENTE'|'CHARGE'|'FINANCEMENT'|'COMPTE_ASSOCIE'|'TRANSFERT'|'AUTRE'} p.nature
 * @param {string} p.label            libellé lisible
 * @param {number} p.amount           SIGNÉ : négatif = sortie, positif = entrée
 * @param {string} [p.currency]       défaut FCFA
 * @param {number} [p.rateApplied]    figé sur l'écriture ; sinon résolu
 * @param {Date|string} [p.entryDate] défaut aujourd'hui
 * @param {number} [p.vehicleId]      axe analytique
 * @param {number} [p.cashAccountId]  axe financier
 * @param {number} [p.categoryId]     catégorie propre à la société
 * @param {object} [p.source]         { purchaseId, invoiceId, receiptId, workshopQuoteId, chargeId }
 */
async function postEntry(p) {
  const ctx = getContext();
  if (!ctx || ctx.companyId == null) {
    throw new Error('[ledger] écriture hors contexte société');
  }
  if (!p || !p.nature) throw new Error('[ledger] nature requise');
  if (!p.label || !String(p.label).trim()) throw new Error('[ledger] libellé requis');

  const amount = Number(p.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error('[ledger] montant requis et non nul');
  }

  // Une dépense imputable à un véhicule DOIT porter son axe analytique :
  // sans lui, le coût de revient serait à nouveau incomplet.
  if (COST_NATURES.includes(p.nature) && p.vehicleId == null) {
    throw new Error(
      `[ledger] la nature ${p.nature} exige un vehicleId — c'est ce qui garantit ` +
        'que la dépense entre dans le coût de revient.'
    );
  }

  const entryDate = p.entryDate ? new Date(p.entryDate) : new Date();
  const currency = (p.currency || 'FCFA').toUpperCase();
  // Le taux est résolu à la date de l'écriture, puis FIGÉ dessus.
  const rateApplied = await resolveRate(currency, p.rateApplied, entryDate);
  const amountFcfa = amount * rateApplied;

  const src = p.source || {};
  return prisma.ledgerEntry.create({
    data: {
      entryDate,
      nature: p.nature,
      label: String(p.label).slice(0, 255),
      amount,
      currency,
      rateApplied,
      amountFcfa,
      vehicleId: p.vehicleId ?? null,
      cashAccountId: p.cashAccountId ?? null,
      partnerId: p.partnerId ?? null,
      categoryId: p.categoryId ?? null,
      // Posé à l'INSERT et jamais après : la table est en écriture seule, un
      // UPDATE ultérieur serait refusé par le déclencheur PostgreSQL.
      purchaseCostId: p.purchaseCostId ?? null,
      purchaseId: src.purchaseId ?? null,
      invoiceId: src.invoiceId ?? null,
      receiptId: src.receiptId ?? null,
      workshopQuoteId: src.workshopQuoteId ?? null,
      chargeId: src.chargeId ?? null,
      correlationId: ctx.correlationId ?? null,
      createdBy: ctx.userId ?? null,
    },
  });
}

/**
 * Contre-passe une écriture : produit son exact inverse et lie les deux.
 * L'originale reste en place — c'est tout l'intérêt.
 */
async function reverseEntry(entryId, note) {
  const id = BigInt(entryId);
  const original = await prisma.ledgerEntry.findFirst({ where: { id } });
  if (!original) throw new Error('[ledger] écriture introuvable');

  const already = await prisma.ledgerEntry.findFirst({ where: { reversesId: id } });
  if (already) throw new Error('[ledger] écriture déjà contre-passée');

  const ctx = getContext();
  return prisma.ledgerEntry.create({
    data: {
      entryDate: new Date(),
      nature: original.nature,
      label: `Contre-passation — ${original.label}`.slice(0, 255),
      amount: Number(original.amount) * -1,
      currency: original.currency,
      // Le taux d'origine est repris : la contre-passation doit annuler
      // exactement, pas au taux du jour.
      rateApplied: original.rateApplied,
      amountFcfa: Number(original.amountFcfa) * -1,
      vehicleId: original.vehicleId,
      cashAccountId: original.cashAccountId,
      partnerId: original.partnerId,
      categoryId: original.categoryId,
      purchaseId: original.purchaseId,
      invoiceId: original.invoiceId,
      receiptId: original.receiptId,
      workshopQuoteId: original.workshopQuoteId,
      chargeId: original.chargeId,
      reversesId: id,
      reversalNote: note ? String(note).slice(0, 2000) : null,
      correlationId: ctx?.correlationId ?? null,
      createdBy: ctx?.userId ?? null,
    },
  });
}

module.exports = {
  postEntry,
  reverseEntry,
  resolveRate,
  COST_NATURES,
  OFF_RESULT_NATURES,
  FIXED_RATES,
};
