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

  /*
   * Le coût des ventes ne porte QUE sur les véhicules effectivement vendus.
   *
   * Additionner toutes les natures de coût de la période revenait à passer en
   * charge le stock non vendu : sur les données réelles, 198 617 718 F de coûts
   * s'opposaient à 54 680 000 F de ventes, et la « marge brute » affichait
   * −143 937 718 F. Ce n'était pas une marge, c'était 45 véhicules en stock
   * comptés comme perdus.
   *
   * Le coût suit la vente, pas le calendrier : un véhicule acheté l'an dernier
   * et vendu ce mois-ci apporte la TOTALITÉ de son coût en face de son produit.
   * La borne de période s'applique donc à la vente, jamais au coût.
   */
  const ventes = await prisma.ledgerEntry.findMany({
    where: { ...where, nature: 'VENTE', vehicleId: { not: null } },
    select: { vehicleId: true },
    distinct: ['vehicleId'],
  });
  const vendus = ventes.map((v) => v.vehicleId);

  const coutVendus = vendus.length
    ? await prisma.ledgerEntry.aggregate({
        where: { vehicleId: { in: vendus }, nature: { in: COST_NATURES } },
        _sum: { amountFcfa: true },
      })
    : null;
  const costOfSales = Math.abs(num(coutVendus?._sum.amountFcfa));

  // Le coût du stock restant : ce n'est pas une charge, c'est un actif. Le
  // montrer à part évite qu'il se retrouve dans le résultat par défaut.
  const coutTotalVehicules = COST_NATURES.reduce(
    (s, n) => s + Math.abs(byNature[n] ?? 0),
    0
  );
  const stockValue = Math.max(0, coutTotalVehicules - costOfSales);

  // Produit sans véhicule rattaché : sa marge est incalculable, et le taire
  // ferait passer une vente non rapprochée pour une marge pleine.
  const revenueNonRapproche = await prisma.ledgerEntry.aggregate({
    where: { ...where, nature: 'VENTE', vehicleId: null },
    _sum: { amountFcfa: true },
  });

  const overheads = Math.abs(byNature.CHARGE ?? 0);
  const excluded = OFF_RESULT_NATURES.reduce((s, n) => s + (byNature[n] ?? 0), 0);

  /*
   * La marge oppose ce qui est comparable.
   *
   * Sur les données réelles, 34 850 000 F de ventes portent sur des véhicules
   * qu'aucun classeur ne chiffre. Les compter au numérateur en face du seul
   * coût des véhicules rapprochés donnerait une marge de 38 100 072 F là où
   * elle est de 3 250 072 F. La marge brute ne retient donc que les ventes
   * dont le coût est connu ; le reste est exposé à part, non caché.
   */
  const nonRapproche = num(revenueNonRapproche._sum.amountFcfa);
  const revenueRapproche = revenue - nonRapproche;

  return {
    revenue,
    /** Ventes rattachées à un véhicule dont le coût est connu. */
    revenueRapproche,
    costOfSales,
    grossMargin: revenueRapproche - costOfSales,
    overheads,
    // Le résultat, lui, prend tout l'argent entré face à tout l'argent sorti.
    result: revenue - costOfSales - overheads,
    /** Coût des véhicules encore en stock — un actif, jamais une charge. */
    stockValue,
    /** Nombre de véhicules vendus sur la période, rattachés à un coût. */
    vehiculesVendus: vendus.length,
    /** Produit dont aucun véhicule n'est identifié : marge incalculable. */
    revenueNonRapproche: nonRapproche,
    // Montré à part, jamais additionné au résultat.
    horsResultat: excluded,
    byNature,
  };
}

module.exports = { vehicleCost, cashBalance, allCashBalances, profitAndLoss };
