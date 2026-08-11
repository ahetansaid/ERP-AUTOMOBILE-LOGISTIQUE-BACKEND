/**
 * Modèles métier.
 *
 * Le piège des plateformes configurables : tout paramétrer avant de pouvoir
 * s'en servir. Trois semaines de réglages, et personne ne va au bout.
 *
 * La réponse est un preset : l'entreprise choisit son profil et reçoit un
 * environnement déjà opérationnel — catégories, comptes, règles d'alerte,
 * modèle de document. Elle est productive en quelques minutes, puis adapte.
 *
 * Le profil « Import automobile » est dérivé du processus réel observé chez un
 * importateur : double filière d'approvisionnement, transit maritime,
 * dédouanement, reconditionnement, vente échelonnée.
 */

const { prisma } = require('./prisma');
const { DEFAULT_CATEGORIES, DEFAULT_ACCOUNTS } = require('./defaults');
const { RULES, RULE_CODES } = require('./alertRules');

/** Catégories communes à tout profil : sans elles, aucun calcul ne tient. */
const CORE_CATEGORIES = DEFAULT_CATEGORIES.filter((c) =>
  ['VENTE', 'CHARGE', 'FINANCEMENT', 'COMPTE_ASSOCIE', 'TRANSFERT'].includes(c.nature)
);

const PRESETS = {
  IMPORT_AUTO: {
    label: 'Import automobile',
    description:
      "Achat à l'étranger, transit maritime, dédouanement, reconditionnement, vente.",
    categories: DEFAULT_CATEGORIES,
    accounts: DEFAULT_ACCOUNTS,
    rules: RULE_CODES,
    documentTemplate: 'classic',
    currency: 'FCFA',
  },

  CONCESSION: {
    label: 'Concession',
    description: 'Achat local ou national, préparation légère, vente au détail.',
    categories: [
      ...CORE_CATEGORIES,
      { label: "Prix d'achat véhicule", nature: 'ACHAT', sortOrder: 10 },
      { label: 'Transport véhicule', nature: 'LOGISTIQUE', sortOrder: 20 },
      { label: 'Taxes et vignettes', nature: 'TAXE', sortOrder: 30 },
      { label: 'Préparation esthétique', nature: 'PREPARATION', sortOrder: 50 },
      { label: 'Mécanique', nature: 'PREPARATION', sortOrder: 51 },
      { label: 'Pièces détachées', nature: 'PREPARATION', sortOrder: 52 },
    ],
    accounts: DEFAULT_ACCOUNTS,
    // Sans conteneur ni devise étrangère, ces deux règles ne se déclencheraient
    // jamais : les proposer serait du bruit.
    rules: RULE_CODES.filter((c) => !['TAUX_INCOHERENT'].includes(c)),
    documentTemplate: 'minimal',
    currency: 'FCFA',
  },

  TRANSIT: {
    label: 'Transit et logistique',
    description: 'Dédouanement et acheminement pour compte de tiers.',
    categories: [
      ...CORE_CATEGORIES,
      { label: 'Fret maritime', nature: 'LOGISTIQUE', sortOrder: 20 },
      { label: 'Transport terrestre', nature: 'LOGISTIQUE', sortOrder: 21 },
      { label: 'Droits de douane', nature: 'TAXE', sortOrder: 30 },
      { label: 'Magasinage portuaire', nature: 'MANUTENTION', sortOrder: 40 },
      { label: 'Manutention', nature: 'MANUTENTION', sortOrder: 41 },
    ],
    accounts: DEFAULT_ACCOUNTS,
    // Pas de stock détenu : les règles de coût de revient et de dormance ne
    // s'appliquent pas.
    rules: RULE_CODES.filter(
      (c) => !['VEHICULE_DORMANT', 'COUT_INCOMPLET', 'VEHICULE_SANS_PRIX'].includes(c)
    ),
    documentTemplate: 'classic',
    currency: 'FCFA',
  },
};

/**
 * Étapes d'installation, et leur état.
 *
 * Chaque étape est vérifiée sur les données réelles, pas sur un drapeau : une
 * société qui a déjà tout configuré voit son installation complète sans avoir
 * rien à cocher.
 */
async function installationStatus() {
  const [company, categories, accounts, rules, vehicles, entries, users] =
    await Promise.all([
      prisma.company.findFirst(),
      prisma.costCategory.count(),
      prisma.cashAccount.count(),
      prisma.alertRule.count(),
      prisma.vehicle.count(),
      prisma.ledgerEntry.count(),
      prisma.user.count(),
    ]);

  const etapes = [
    {
      cle: 'societe',
      titre: 'Identité de la société',
      detail: "Nom, adresse, IFU et RCCM — repris sur chaque document émis.",
      fait: !!(company?.name && company?.legalNumber),
      action: '/parametres',
    },
    {
      cle: 'referentiels',
      titre: 'Catégories et comptes',
      detail: `${categories} catégories, ${accounts} comptes de trésorerie.`,
      fait: categories > 0 && accounts > 0,
      action: null,
    },
    {
      cle: 'alertes',
      titre: "Règles d'alerte",
      detail: `${rules} règles installées.`,
      fait: rules > 0,
      action: '/alertes',
    },
    {
      cle: 'utilisateurs',
      titre: 'Utilisateurs',
      detail: `${users} compte${users > 1 ? 's' : ''}.`,
      fait: users > 1,
      action: '/utilisateurs',
    },
    {
      cle: 'vehicules',
      titre: 'Premier véhicule',
      detail: `${vehicles} véhicule${vehicles > 1 ? 's' : ''} enregistré${vehicles > 1 ? 's' : ''}.`,
      fait: vehicles > 0,
      action: '/supply-chain/achats',
    },
    {
      cle: 'ecritures',
      titre: 'Premières écritures',
      detail: `${entries} écriture${entries > 1 ? 's' : ''} au grand livre.`,
      fait: entries > 0,
      action: '/comptabilite/tresorerie',
    },
  ];

  const faites = etapes.filter((e) => e.fait).length;
  return {
    etapes,
    faites,
    total: etapes.length,
    // L'installation est « opérationnelle » dès que les référentiels sont là :
    // le reste vient avec l'usage.
    operationnel: categories > 0 && accounts > 0 && rules > 0,
  };
}

/**
 * Applique un modèle métier. Idempotent : relançable sans créer de doublon,
 * et n'écrase jamais ce que le client a déjà personnalisé.
 */
async function applyPreset(code) {
  const preset = PRESETS[code];
  if (!preset) {
    throw new Error(
      `[presets] modèle inconnu : ${code}. Disponibles : ${Object.keys(PRESETS).join(', ')}`
    );
  }

  const [catsExistantes, comptesExistants, reglesExistantes] = await Promise.all([
    prisma.costCategory.findMany({ select: { label: true } }),
    prisma.cashAccount.findMany({ select: { label: true } }),
    prisma.alertRule.findMany({ select: { code: true } }),
  ]);

  const aCat = new Set(catsExistantes.map((c) => c.label));
  const aCompte = new Set(comptesExistants.map((a) => a.label));
  const aRegle = new Set(reglesExistantes.map((r) => r.code));

  const categories = preset.categories.filter((c) => !aCat.has(c.label));
  const accounts = preset.accounts.filter((a) => !aCompte.has(a.label));
  const rules = preset.rules
    .filter((c) => !aRegle.has(c) && RULES[c])
    .map((code) => ({
      code,
      label: RULES[code].label,
      severity: RULES[code].severity,
      params: RULES[code].params ?? {},
      enabled: true,
    }));

  if (categories.length) await prisma.costCategory.createMany({ data: categories });
  if (accounts.length) await prisma.cashAccount.createMany({ data: accounts });
  if (rules.length) await prisma.alertRule.createMany({ data: rules });

  // Le modèle de document n'est posé que s'il n'a jamais été choisi : un client
  // qui a sélectionné le sien ne doit pas le voir changer sous ses pieds.
  const company = await prisma.company.findFirst();
  if (company && !company.invoiceTemplate) {
    await prisma.company.update({
      where: { id: company.id },
      data: {
        invoiceTemplate: preset.documentTemplate,
        defaultCurrency: company.defaultCurrency ?? preset.currency,
      },
    });
  }

  return {
    modele: code,
    label: preset.label,
    categoriesCreees: categories.length,
    comptesCrees: accounts.length,
    reglesCreees: rules.length,
  };
}

/** Liste des modèles disponibles, pour l'écran de choix. */
function listPresets() {
  return Object.entries(PRESETS).map(([code, p]) => ({
    code,
    label: p.label,
    description: p.description,
    categories: p.categories.length,
    comptes: p.accounts.length,
    regles: p.rules.length,
    modeleDocument: p.documentTemplate,
  }));
}

module.exports = { PRESETS, applyPreset, listPresets, installationStatus };
