/**
 * Répartition des frais de conteneur.
 *
 * Un frais est engagé globalement — fret, dépotage, IMV — puis ventilé sur les
 * véhicules du conteneur. Dans les classeurs, cette ventilation était une
 * formule tapée à la main : d'où des clés qui variaient d'une ligne à l'autre et
 * des taux mélangés au sein d'un même conteneur.
 *
 * Ici la règle est un objet stocké. Elle est rejouable : si un véhicule est
 * ajouté ou retiré, on contre-passe les écritures précédentes et on refait la
 * ventilation. La correction reste visible, conformément à l'immuabilité du
 * grand livre.
 */

const { prisma } = require('./prisma');
const { postEntry, reverseEntry } = require('./ledger');

/** Chaque type de frais porte la nature d'écriture qui le fera entrer au coût. */
const NATURE_BY_TYPE = {
  FRET: 'LOGISTIQUE',
  TRANSPORT_INTERNE: 'LOGISTIQUE',
  COMMISSION: 'LOGISTIQUE',
  DEPOTAGE: 'MANUTENTION',
  MAIN_OEUVRE: 'MANUTENTION',
  FRAIS_CONNEXE: 'MANUTENTION',
  IMV: 'TAXE',
  DOUANE: 'TAXE',
  AUTRE: 'LOGISTIQUE',
};

const LABELS = {
  FRET: 'Fret maritime',
  TRANSPORT_INTERNE: 'Transport interne',
  COMMISSION: 'Commission',
  DEPOTAGE: 'Dépotage',
  MAIN_OEUVRE: "Main d'œuvre",
  FRAIS_CONNEXE: 'Frais connexes',
  IMV: 'IMV',
  DOUANE: 'Droits de douane',
  AUTRE: 'Autre frais',
};

const num = (v) => (v == null ? 0 : Number(v));

/**
 * Calcule les parts.
 *
 * Le reste de division est attribué à la plus grosse part plutôt que d'être
 * perdu : la somme des parts égale EXACTEMENT le montant réparti, au franc près.
 * Sans cette précaution, un fret de 1 000 000 sur 3 véhicules laisserait
 * 1 FCFA dans la nature, et le total du conteneur ne se réconcilierait jamais.
 *
 * @returns {{vehicleId:number, part:number}[]}
 */
function computeShares(total, vehicles, mode, detail) {
  if (!vehicles.length) return [];
  const cible = Math.round(num(total));

  let poids;
  if (mode === 'MONTANT_FIXE') {
    const d = detail || {};
    return vehicles
      .map((v) => ({ vehicleId: v.id, part: Math.round(num(d[String(v.id)])) }))
      .filter((s) => s.part !== 0);
  }

  if (mode === 'PRORATA_VALEUR') {
    poids = vehicles.map((v) => num(v.purchasePriceFcfa) || num(v.purchasePrice) || 0);
  } else if (mode === 'PRORATA_POIDS') {
    poids = vehicles.map((v) => num(v.weightKg) || 0);
  } else {
    poids = vehicles.map(() => 1);
  }

  const somme = poids.reduce((s, p) => s + p, 0);
  // Clé de répartition inexploitable (poids ou valeurs manquants) : on retombe
  // sur des parts égales plutôt que de tout imputer au premier véhicule.
  if (somme <= 0) poids = vehicles.map(() => 1);
  const total2 = poids.reduce((s, p) => s + p, 0);

  const parts = vehicles.map((v, i) => ({
    vehicleId: v.id,
    part: Math.floor((cible * poids[i]) / total2),
  }));

  const reste = cible - parts.reduce((s, p) => s + p.part, 0);
  if (reste !== 0) {
    let idx = 0;
    for (let i = 1; i < poids.length; i++) if (poids[i] > poids[idx]) idx = i;
    parts[idx].part += reste;
  }

  return parts.filter((p) => p.part !== 0);
}

/** Véhicules d'un conteneur, avec les données servant de clé de répartition. */
async function purchaseVehicles(purchaseId) {
  const links = await prisma.purchaseVehicle.findMany({
    where: { purchaseId: Number(purchaseId) },
    include: {
      vehicle: {
        select: {
          id: true, vin: true, brand: true, model: true,
          purchasePrice: true, purchasePriceFcfa: true, weightKg: true,
        },
      },
    },
  });
  return links.map((l) => l.vehicle);
}

/**
 * Applique (ou réapplique) la répartition d'un frais.
 *
 * Les écritures déjà générées par ce frais sont d'abord contre-passées : le
 * grand livre étant en écriture seule, on n'efface pas, on annule puis on
 * repose. L'historique de la correction reste lisible.
 */
async function allocate(purchaseCostId) {
  const id = Number(purchaseCostId);
  const cost = await prisma.purchaseCost.findFirst({ where: { id } });
  if (!cost) throw new Error('[allocation] frais introuvable');

  // 1. Annuler la ventilation précédente.
  const anciennes = await prisma.ledgerEntry.findMany({
    where: { purchaseCostId: id, reversesId: null },
  });
  let annulees = 0;
  for (const e of anciennes) {
    const deja = await prisma.ledgerEntry.findFirst({
      where: { reversesId: e.id },
      select: { id: true },
    });
    if (!deja) {
      await reverseEntry(e.id, 'Répartition recalculée');
      annulees++;
    }
  }

  // 2. Recalculer.
  const vehicles = await purchaseVehicles(cost.purchaseId);
  if (!vehicles.length) {
    throw new Error(
      "[allocation] ce dossier n'a aucun véhicule : la répartition n'a pas de sens."
    );
  }

  const parts = computeShares(
    num(cost.amountFcfa),
    vehicles,
    cost.allocation,
    cost.allocationDetail
  );

  const nature = NATURE_BY_TYPE[cost.type] || 'LOGISTIQUE';
  const libelle = cost.label || LABELS[cost.type] || 'Frais de conteneur';

  const creees = [];
  for (const { vehicleId, part } of parts) {
    const entry = await postEntry({
      nature,
      label: `${libelle} — répartition`,
      // Un frais est une sortie : négatif.
      amount: -Math.abs(part),
      currency: 'FCFA',
      rateApplied: 1,
      entryDate: cost.costDate,
      vehicleId,
      source: { purchaseId: cost.purchaseId },
    });
    // postEntry n'expose pas purchaseCostId : on le pose ici pour garder le
    // lien qui rend la répartition rejouable.
    await prisma.$executeRaw`
      UPDATE ledger_entries SET purchase_cost_id = ${id} WHERE id = ${entry.id}
    `;
    creees.push({ vehicleId, montant: part });
  }

  await prisma.purchaseCost.update({
    where: { id },
    data: { allocatedAt: new Date() },
  });

  return {
    purchaseCostId: id,
    mode: cost.allocation,
    nature,
    annulees,
    reparti: creees.reduce((s, c) => s + c.montant, 0),
    parts: creees,
  };
}

/** Contre-passe toute la ventilation d'un frais, sans en reposer. */
async function unallocate(purchaseCostId) {
  const id = Number(purchaseCostId);
  const entries = await prisma.ledgerEntry.findMany({
    where: { purchaseCostId: id, reversesId: null },
  });
  let annulees = 0;
  for (const e of entries) {
    const deja = await prisma.ledgerEntry.findFirst({
      where: { reversesId: e.id },
      select: { id: true },
    });
    if (!deja) {
      await reverseEntry(e.id, 'Frais annulé');
      annulees++;
    }
  }
  await prisma.purchaseCost.update({ where: { id }, data: { allocatedAt: null } });
  return { purchaseCostId: id, annulees };
}

/** Réapplique tous les frais d'un conteneur — après ajout ou retrait d'un véhicule. */
async function reallocatePurchase(purchaseId) {
  const costs = await prisma.purchaseCost.findMany({
    where: { purchaseId: Number(purchaseId) },
    select: { id: true },
  });
  const resultats = [];
  for (const c of costs) resultats.push(await allocate(c.id));
  return resultats;
}

module.exports = {
  allocate,
  unallocate,
  reallocatePurchase,
  computeShares,
  NATURE_BY_TYPE,
  LABELS,
};
