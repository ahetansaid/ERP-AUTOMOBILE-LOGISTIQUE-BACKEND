/**
 * Référentiels par défaut d'une société.
 *
 * Le produit doit être utilisable sans configuration : une société qui
 * s'inscrit reçoit des catégories et des comptes déjà cohérents avec le métier
 * de l'import automobile, puis les adapte. C'est le « modèle métier » décrit
 * dans le contrat de projet — un preset, pas une contrainte.
 *
 * Les libellés sont modifiables ; la nature, non.
 */

const { prisma } = require('./prisma');

/** Preset « Import automobile », dérivé du processus réel observé. */
const DEFAULT_CATEGORIES = [
  { label: "Prix d'achat véhicule", nature: 'ACHAT', sortOrder: 10 },
  { label: 'Transport interne (origine)', nature: 'LOGISTIQUE', sortOrder: 20 },
  { label: 'Fret maritime', nature: 'LOGISTIQUE', sortOrder: 21 },
  { label: 'Commission', nature: 'LOGISTIQUE', sortOrder: 22 },
  { label: 'Droits de douane', nature: 'TAXE', sortOrder: 30 },
  { label: 'IMV', nature: 'TAXE', sortOrder: 31 },
  { label: 'Dépotage', nature: 'MANUTENTION', sortOrder: 40 },
  { label: "Main d'œuvre portuaire", nature: 'MANUTENTION', sortOrder: 41 },
  { label: 'Frais connexes', nature: 'MANUTENTION', sortOrder: 42 },
  { label: 'Pièces détachées', nature: 'PREPARATION', sortOrder: 50 },
  { label: 'Peinture', nature: 'PREPARATION', sortOrder: 51 },
  { label: 'Soudure', nature: 'PREPARATION', sortOrder: 52 },
  { label: 'Mécanique', nature: 'PREPARATION', sortOrder: 53 },
  { label: 'Électricité', nature: 'PREPARATION', sortOrder: 54 },
  { label: 'Matelasserie', nature: 'PREPARATION', sortOrder: 55 },
  { label: 'Vente de véhicule', nature: 'VENTE', sortOrder: 60 },
  { label: 'Loyer et charges', nature: 'CHARGE', sortOrder: 70 },
  { label: 'Carburant', nature: 'CHARGE', sortOrder: 71 },
  { label: 'Télécommunications', nature: 'CHARGE', sortOrder: 72 },
  // Les deux suivantes sont ce qui empêche de compter un emprunt en recette
  // ou un retrait d'associé en charge — l'erreur relevée dans les classeurs.
  { label: 'Emprunt', nature: 'FINANCEMENT', sortOrder: 80 },
  { label: "Remboursement d'emprunt", nature: 'FINANCEMENT', sortOrder: 81 },
  { label: 'Apport en compte associé', nature: 'COMPTE_ASSOCIE', sortOrder: 90 },
  { label: 'Retrait en compte associé', nature: 'COMPTE_ASSOCIE', sortOrder: 91 },
  { label: 'Transfert entre comptes', nature: 'TRANSFERT', sortOrder: 100 },
];

const DEFAULT_ACCOUNTS = [
  { label: 'Caisse', nature: 'CAISSE', sortOrder: 10 },
  { label: 'Banque', nature: 'BANQUE', sortOrder: 20 },
  { label: 'Mobile money', nature: 'MOBILE_MONEY', sortOrder: 30 },
];

/**
 * Crée les référentiels manquants pour la société du contexte courant.
 * Idempotent : relançable sans créer de doublon.
 */
async function ensureDefaults() {
  const [existingCats, existingAccs] = await Promise.all([
    prisma.costCategory.findMany({ select: { label: true } }),
    prisma.cashAccount.findMany({ select: { label: true } }),
  ]);

  const haveCat = new Set(existingCats.map((c) => c.label));
  const haveAcc = new Set(existingAccs.map((a) => a.label));

  const cats = DEFAULT_CATEGORIES.filter((c) => !haveCat.has(c.label));
  const accs = DEFAULT_ACCOUNTS.filter((a) => !haveAcc.has(a.label));

  if (cats.length) await prisma.costCategory.createMany({ data: cats });
  if (accs.length) await prisma.cashAccount.createMany({ data: accs });

  return { categoriesCreated: cats.length, accountsCreated: accs.length };
}

module.exports = { ensureDefaults, DEFAULT_CATEGORIES, DEFAULT_ACCOUNTS };
