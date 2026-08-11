/**
 * Rapports périodiques.
 *
 * Le rapport quotidien est l'héritier direct de la feuille Excel du jour : même
 * information, mais produite sans que personne ait à la fabriquer — et surtout
 * sans solde d'ouverture retapé à la main. C'est ce report manuel qui avait
 * rompu la chaîne six fois, dont une journée entière évaporée.
 *
 * Chaque rapport fige ses données (`payload`). Ce qui est approuvé est cet
 * instantané, pas une requête rejouée plus tard.
 */

const { prisma } = require('./prisma');
const { getContext } = require('./context');
const { allCashBalances, profitAndLoss } = require('./costing');
const { OFF_RESULT_NATURES } = require('./ledger');

const num = (v) => (v == null ? 0 : Number(v));
const iso = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Tout est calculé en UTC.
 *
 * Les colonnes de période sont de type `Date` (sans heure). Construire les
 * bornes en heure locale puis les sérialiser en UTC décale d'un jour dès que le
 * serveur n'est pas sur UTC : un rapport mensuel de juillet devenait
 * « 30/06 → 30/07 ». Le serveur tourne à Cotonou (UTC+1) et la base sur Neon en
 * UTC — le piège est garanti si on ne le neutralise pas ici.
 */
const utcDay = (ref) => {
  const d = new Date(ref);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};

/** Bornes d'une période, à partir d'une date de référence. */
function periodBounds(periodicity, ref = new Date()) {
  const d = utcDay(ref);

  if (periodicity === 'QUOTIDIEN') return { start: new Date(d), end: new Date(d) };

  if (periodicity === 'HEBDOMADAIRE') {
    // Semaine du lundi au dimanche (getUTCDay : 0 = dimanche).
    const offset = (d.getUTCDay() + 6) % 7;
    const start = new Date(d);
    start.setUTCDate(d.getUTCDate() - offset);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { start, end };
  }

  if (periodicity === 'MENSUEL') {
    return {
      start: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
      // Jour 0 du mois suivant = dernier jour du mois courant.
      end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)),
    };
  }

  return { start: new Date(d), end: new Date(d) };
}

/**
 * Solde de trésorerie à la veille d'une date — CALCULÉ, jamais saisi.
 * C'est la différence de fond avec le classeur : il n'y a plus de report à
 * retaper, donc plus de rupture possible.
 */
async function openingBalance(start) {
  const before = new Date(start);
  before.setUTCDate(before.getUTCDate() - 1);
  const agg = await prisma.ledgerEntry.aggregate({
    where: { cashAccountId: { not: null }, entryDate: { lte: before } },
    _sum: { amountFcfa: true },
  });
  return num(agg._sum.amountFcfa);
}

/** Construit le contenu d'un rapport pour une période. */
async function buildPayload(periodicity, start, end) {
  const range = { gte: start, lte: end };

  const [entries, opening, balances, pnl] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { entryDate: range },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
      take: 1000,
    }),
    openingBalance(start),
    allCashBalances(end),
    profitAndLoss(start, end),
  ]);

  const cash = entries.filter((e) => e.cashAccountId != null);
  const entrees = cash.filter((e) => num(e.amountFcfa) > 0);
  const sorties = cash.filter((e) => num(e.amountFcfa) < 0);
  const sum = (list) => list.reduce((s, e) => s + num(e.amountFcfa), 0);

  const totalEntrees = sum(entrees);
  const totalSorties = sum(sorties);

  // Les mouvements hors résultat sont montrés à part : un apport d'associé
  // n'est pas une recette, un emprunt non plus.
  const horsResultat = cash.filter((e) => OFF_RESULT_NATURES.includes(e.nature));

  return {
    periodicite: periodicity,
    debut: iso(start),
    fin: iso(end),
    tresorerie: {
      ouverture: opening,
      entrees: totalEntrees,
      sorties: totalSorties,
      cloture: opening + totalEntrees + totalSorties,
      parCompte: balances.accounts,
    },
    resultat: {
      produits: pnl.revenue,
      coutDesVentes: pnl.costOfSales,
      margeBrute: pnl.grossMargin,
      chargesGenerales: pnl.overheads,
      resultat: pnl.result,
      horsResultat: pnl.horsResultat,
    },
    operations: cash.map((e, i) => ({
      // Référence stable, utilisée pour ancrer une précision sur cette ligne.
      ref: `operations.${i}`,
      id: Number(e.id),
      date: iso(e.entryDate),
      libelle: e.label,
      nature: e.nature,
      montant: num(e.amountFcfa),
      horsResultat: OFF_RESULT_NATURES.includes(e.nature),
    })),
    synthese: {
      nbOperations: cash.length,
      nbEntrees: entrees.length,
      nbSorties: sorties.length,
      montantHorsResultat: sum(horsResultat),
    },
  };
}

const TITLES = {
  QUOTIDIEN: (s) => `Rapport journalier · ${new Date(s).toLocaleDateString('fr-FR')}`,
  HEBDOMADAIRE: (s, e) =>
    `Rapport hebdomadaire · ${new Date(s).toLocaleDateString('fr-FR')} → ${new Date(e).toLocaleDateString('fr-FR')}`,
  MENSUEL: (s) =>
    `Rapport mensuel · ${new Date(s).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`,
  PONCTUEL: (s, e) =>
    `Rapport · ${new Date(s).toLocaleDateString('fr-FR')} → ${new Date(e).toLocaleDateString('fr-FR')}`,
};

/**
 * Génère (ou régénère) le rapport d'une période.
 *
 * Un rapport déjà APPROUVÉ n'est jamais écrasé : ce qui a été validé reste tel
 * quel. Régénérer exige de le renvoyer d'abord en correction.
 */
async function generateReport(periodicity, refDate) {
  const ctx = getContext();
  if (!ctx?.companyId) throw new Error('[reports] hors contexte société');

  const { start, end } = periodBounds(periodicity, refDate);
  const existing = await prisma.generatedReport.findFirst({
    where: { type: periodicity, periodStart: start, periodEnd: end },
  });

  if (existing && ['APPROUVE', 'DIFFUSE'].includes(existing.status)) {
    throw new Error(
      '[reports] ce rapport est approuvé : renvoyez-le en correction avant de le régénérer.'
    );
  }

  const payload = await buildPayload(periodicity, start, end);
  const data = {
    name: TITLES[periodicity](start, end),
    type: periodicity,
    periodicity,
    periodStart: start,
    periodEnd: end,
    payload,
    status: 'EN_REVUE',
    reviewNote: null,
  };

  if (existing) {
    return prisma.generatedReport.update({ where: { id: existing.id }, data });
  }
  return prisma.generatedReport.create({ data });
}

/** Transitions autorisées du cycle de vie. */
const TRANSITIONS = {
  GENERE: ['EN_REVUE'],
  EN_REVUE: ['APPROUVE', 'A_CORRIGER'],
  A_CORRIGER: ['EN_REVUE'],
  APPROUVE: ['DIFFUSE', 'A_CORRIGER'],
  DIFFUSE: [],
};

async function setStatus(reportId, next, note) {
  const ctx = getContext();
  const id = Number(reportId);
  const report = await prisma.generatedReport.findFirst({ where: { id } });
  if (!report) throw new Error('[reports] rapport introuvable');

  const allowed = TRANSITIONS[report.status] || [];
  if (!allowed.includes(next)) {
    throw new Error(
      `[reports] transition impossible : ${report.status} → ${next}. ` +
        `Depuis ${report.status}, seul ${allowed.join(' ou ') || 'rien'} est permis.`
    );
  }

  const data = { status: next, reviewNote: note ? String(note).slice(0, 2000) : null };
  if (next === 'APPROUVE') {
    data.approvedBy = ctx?.userId ?? null;
    data.approvedAt = new Date();
  }
  if (next === 'DIFFUSE') data.distributedAt = new Date();

  return prisma.generatedReport.update({ where: { id }, data });
}

module.exports = { generateReport, buildPayload, periodBounds, setStatus, TRANSITIONS };
