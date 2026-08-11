/**
 * Coût de revient et trésorerie — lecture du grand livre
 *
 * Rien n'est stocké ici : tout est recalculé depuis les écritures. C'est ce qui
 * garantit qu'un coût affiché correspond toujours à la somme réelle des
 * dépenses, sans dépendre d'un report manuel.
 *
 * Règles de calcul :
 *   coût de revient = −Σ (écritures ACHAT|LOGISTIQUE|TAXE|MANUTENTION|PREPARATION)
 *   produit         =  Σ (écritures VENTE)
 *   marge           =  produit − coût
 *   solde de compte =  Σ (montants du compte) — jamais une valeur saisie
 *
 * Les natures FINANCEMENT, COMPTE_ASSOCIE et TRANSFERT sont exclues du
 * résultat : un emprunt n'est pas une recette, un retrait d'associé n'est pas
 * une charge. C'est l'erreur qui rendait le « résultat » des classeurs faux.
 */

const { prisma } = require('./prisma');
const { COST_NATURES, OFF_RESULT_NATURES } = require('./ledger');

const num = (v) => (v == null ? 0 : Number(v));

/**
 * Coût de revient décomposé d'un véhicule.
 * @returns {Promise<{vehicleId:number, decomposition:object[], cost:number,
 *                    revenue:number, margin:number, marginRate:number|null,
 *                    floorPrice:number, entryCount:number}>}
 */
async function vehicleCost(vehicleId, { marginTarget = 0.15 } = {}) {
  const id = Number(vehicleId);
  const rows = await prisma.ledgerEntry.groupBy({
    by: ['nature'],
    where: { vehicleId: id },
    _sum: { amountFcfa: true },
    _count: { _all: true },
  });

  const byNature = new Map(rows.map((r) => [r.nature, num(r._sum.amountFcfa)]));
  const entryCount = rows.reduce((s, r) => s + r._count._all, 0);

  // Les dépenses sont négatives au grand livre : on les repasse en positif
  // pour présenter un coût.
  const decomposition = COST_NATURES.map((nature) => ({
    nature,
    amount: Math.abs(byNature.get(nature) ?? 0),
  })).filter((d) => d.amount > 0);

  const cost = decomposition.reduce((s, d) => s + d.amount, 0);
  const revenue = byNature.get('VENTE') ?? 0;
  const margin = revenue - cost;

  return {
    vehicleId: id,
    decomposition,
    cost,
    revenue,
    margin: revenue > 0 ? margin : null,
    marginRate: revenue > 0 && cost > 0 ? (margin / cost) * 100 : null,
    // Prix en dessous duquel la vente détruit de la valeur.
    floorPrice: cost > 0 ? Math.round(cost * (1 + marginTarget)) : 0,
    entryCount,
  };
}

/** Solde d'un compte de trésorerie à une date donnée (incluse). */
async function cashBalance(cashAccountId, asOf) {
  const where = { cashAccountId: Number(cashAccountId) };
  if (asOf) where.entryDate = { lte: new Date(asOf) };

  const agg = await prisma.ledgerEntry.aggregate({
    where,
    _sum: { amountFcfa: true },
    _count: { _all: true },
  });
  return { balance: num(agg._sum.amountFcfa), entryCount: agg._count._all };
}

/** Soldes de tous les comptes actifs, avec le total consolidé. */
async function allCashBalances(asOf) {
  const accounts = await prisma.cashAccount.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const balances = await Promise.all(
    accounts.map(async (a) => ({
      id: a.id,
      label: a.label,
      nature: a.nature,
      currency: a.currency,
      ...(await cashBalance(a.id, asOf)),
    }))
  );
  return { accounts: balances, total: balances.reduce((s, b) => s + b.balance, 0) };
}

/**
 * Compte de résultat sur une période.
 * Exclut explicitement les mouvements de bilan (emprunts, comptes d'associés,
 * transferts internes).
 */
async function profitAndLoss(from, to) {
  const where = {};
  if (from || to) {
    where.entryDate = {};
    if (from) where.entryDate.gte = new Date(from);
    if (to) where.entryDate.lte = new Date(to);
  }

  const rows = await prisma.ledgerEntry.groupBy({
    by: ['nature'],
    where,
    _sum: { amountFcfa: true },
  });

  const byNature = Object.fromEntries(
    rows.map((r) => [r.nature, num(r._sum.amountFcfa)])
  );

  const revenue = byNature.VENTE ?? 0;
  const costOfSales = COST_NATURES.reduce((s, n) => s + Math.abs(byNature[n] ?? 0), 0);
  const overheads = Math.abs(byNature.CHARGE ?? 0);
  const excluded = OFF_RESULT_NATURES.reduce((s, n) => s + (byNature[n] ?? 0), 0);

  return {
    revenue,
    costOfSales,
    grossMargin: revenue - costOfSales,
    overheads,
    result: revenue - costOfSales - overheads,
    // Montré à part, jamais additionné au résultat.
    horsResultat: excluded,
    byNature,
  };
}

module.exports = { vehicleCost, cashBalance, allCashBalances, profitAndLoss };
