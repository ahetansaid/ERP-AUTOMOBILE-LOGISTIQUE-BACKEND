/**
 * Socle comptable SYSCOHADA — plan de comptes, mapping, projection, balance.
 *
 * LE GRAND LIVRE N'EST PAS REMPLACÉ, IL EST PROJETÉ
 *
 * `LedgerEntry` porte un montant SIGNÉ sur deux axes analytiques — véhicule et
 * trésorerie. Une opération = une ligne. SYSCOHADA exige l'inverse : une
 * opération = au moins deux lignes qui s'équilibrent, chacune sur un compte du
 * plan, rangée dans un journal.
 *
 * On ne refond pas le grand livre pour autant. On le PROJETTE :
 *
 *     LedgerEntry (immuable, analytique)
 *           │   règles de mapping nature → comptes
 *           ▼
 *     écritures en partie double  →  balance  →  états financiers
 *
 * Trois raisons, et la troisième est la vraie :
 *
 *   1. le coût de revient par véhicule, les portes de sortie et les
 *      répartitions de conteneur continuent de fonctionner sans être touchés ;
 *   2. la projection est REJOUABLE — un mapping corrigé se rejoue sur tout
 *      l'historique, là où une saisie comptable fausse se contre-passe à la
 *      main, ligne par ligne ;
 *   3. il n'y a toujours qu'UNE source de vérité. La comptabilité générale
 *      devient une VUE, pas une seconde saisie qui divergerait — et la
 *      divergence entre registres est précisément le défaut qui a coûté
 *      7,6 M à ce client.
 *
 * CE MODULE NE CERTIFIE AUCUN BILAN
 *
 * Il produit une balance à partir d'un mapping déclaré. Si le mapping est faux,
 * la balance est fausse — et elle le sera silencieusement, parce qu'une balance
 * équilibrée n'est pas une balance juste. C'est pourquoi `verifier()` existe et
 * pourquoi la balance expose ce qui n'a PAS pu être mappé plutôt que de le
 * ranger dans un compte d'attente.
 */

const { prisma } = require('./prisma');

/* ══════════════════════════════════════════════════════════════════════════
 * PLAN DE COMPTES
 *
 * Extrait du SYSCOHADA révisé, limité à ce que ce métier produit réellement.
 * Ce n'est pas le plan complet et ça n'a pas à l'être : un plan exhaustif que
 * personne n'utilise rend le paramétrage illisible. Le client ajoute ce qui
 * lui manque.
 * ══════════════════════════════════════════════════════════════════════════ */

const PLAN = [
  // Classe 1 — ressources durables
  { numero: '101', libelle: 'Capital social', classe: 1, sens: 'CREDIT' },
  { numero: '162', libelle: 'Emprunts et dettes auprès des établissements de crédit', classe: 1, sens: 'CREDIT' },
  { numero: '462', libelle: 'Associés, comptes courants', classe: 4, sens: 'CREDIT' },

  // Classe 3 — stocks
  { numero: '311', libelle: 'Marchandises — véhicules', classe: 3, sens: 'DEBIT' },

  // Classe 4 — tiers
  { numero: '401', libelle: 'Fournisseurs', classe: 4, sens: 'CREDIT' },
  { numero: '411', libelle: 'Clients', classe: 4, sens: 'DEBIT' },
  { numero: '443', libelle: 'État, TVA facturée', classe: 4, sens: 'CREDIT' },
  { numero: '445', libelle: 'État, TVA récupérable', classe: 4, sens: 'DEBIT' },
  { numero: '447', libelle: 'État, impôts et taxes recouvrables', classe: 4, sens: 'CREDIT' },

  // Classe 5 — trésorerie
  { numero: '521', libelle: 'Banques', classe: 5, sens: 'DEBIT' },
  { numero: '531', libelle: 'Chèques postaux et mobile money', classe: 5, sens: 'DEBIT' },
  { numero: '571', libelle: 'Caisse', classe: 5, sens: 'DEBIT' },
  { numero: '585', libelle: 'Virements de fonds', classe: 5, sens: 'DEBIT' },

  // Classe 6 — charges
  { numero: '601', libelle: 'Achats de marchandises', classe: 6, sens: 'DEBIT' },
  { numero: '608', libelle: 'Achats d’emballages et frais accessoires', classe: 6, sens: 'DEBIT' },
  { numero: '611', libelle: 'Transports sur achats', classe: 6, sens: 'DEBIT' },
  { numero: '624', libelle: 'Entretien, réparations et maintenance', classe: 6, sens: 'DEBIT' },
  { numero: '632', libelle: 'Rémunérations d’intermédiaires et honoraires', classe: 6, sens: 'DEBIT' },
  { numero: '646', libelle: 'Droits d’enregistrement, douanes et taxes', classe: 6, sens: 'DEBIT' },
  { numero: '658', libelle: 'Charges diverses', classe: 6, sens: 'DEBIT' },

  // Classe 7 — produits
  { numero: '701', libelle: 'Ventes de marchandises', classe: 7, sens: 'CREDIT' },
  { numero: '758', libelle: 'Produits divers', classe: 7, sens: 'CREDIT' },
];

const PAR_NUMERO = new Map(PLAN.map((c) => [c.numero, c]));

/* ══════════════════════════════════════════════════════════════════════════
 * MAPPING PAR DÉFAUT
 *
 * Chaque nature système se traduit par un couple débit / crédit. La CONTREPARTIE
 * de trésorerie est résolue dynamiquement depuis le compte de caisse de
 * l'écriture : une dépense payée en espèces crédite 571, la même payée en
 * banque crédite 521. Figer la contrepartie serait faux dès le premier virement.
 *
 * `null` signifie « pas de projection » : les natures hors résultat qui sont de
 * purs mouvements de trésorerie, comme TRANSFERT, sont traitées à part.
 * ══════════════════════════════════════════════════════════════════════════ */

const MAPPING_DEFAUT = {
  // Le prix d'achat entre en stock, pas en charge : un véhicule invendu reste
  // un actif. C'est l'erreur qui faisait afficher −143 937 718 F de résultat.
  ACHAT: { compte: '311', sens: 'DEBIT' },
  LOGISTIQUE: { compte: '611', sens: 'DEBIT' },
  TAXE: { compte: '646', sens: 'DEBIT' },
  MANUTENTION: { compte: '608', sens: 'DEBIT' },
  PREPARATION: { compte: '624', sens: 'DEBIT' },
  VENTE: { compte: '701', sens: 'CREDIT' },
  CHARGE: { compte: '658', sens: 'DEBIT' },
  AUTRE: { compte: '758', sens: 'CREDIT' },
  FINANCEMENT: { compte: '162', sens: 'CREDIT' },
  COMPTE_ASSOCIE: { compte: '462', sens: 'CREDIT' },
  // REGLEMENT n'est pas un produit : c'est l'encaissement d'une créance déjà
  // reconnue en VENTE. Il solde le compte client, il ne crée pas de revenu —
  // sans quoi le chiffre d'affaires serait compté deux fois.
  REGLEMENT: { compte: '411', sens: 'CREDIT' },
  // TRANSFERT ne touche que la classe 5 : la contrepartie est l'autre compte
  // de trésorerie, qu'une écriture unique ne porte pas. Traité à part.
  TRANSFERT: { compte: '585', sens: 'DEBIT' },
};

/** Compte de trésorerie SYSCOHADA selon la nature du compte de caisse. */
const COMPTE_TRESORERIE = {
  CAISSE: '571',
  BANQUE: '521',
  MOBILE_MONEY: '531',
  AUTRE: '585',
};

/**
 * Vérifie un mapping avant de s'en servir.
 *
 * Une balance équilibrée n'est pas une balance juste : si une nature pointe un
 * compte inexistant, la projection la jetterait silencieusement et la balance
 * tomberait quand même à zéro. On refuse donc en amont.
 */
function verifier(mapping = MAPPING_DEFAUT) {
  const problemes = [];
  for (const [nature, regle] of Object.entries(mapping)) {
    if (!regle) continue;
    if (!PAR_NUMERO.has(regle.compte)) {
      problemes.push(`${nature} pointe le compte ${regle.compte}, absent du plan.`);
    }
    if (regle.sens !== 'DEBIT' && regle.sens !== 'CREDIT') {
      problemes.push(`${nature} a un sens invalide : « ${regle.sens} ».`);
    }
  }
  for (const n of Object.keys(MAPPING_DEFAUT)) {
    if (!(n in mapping)) problemes.push(`Nature ${n} absente du mapping — ses écritures seraient perdues.`);
  }
  return problemes;
}

/* ══════════════════════════════════════════════════════════════════════════
 * PROJECTION
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Projette UNE écriture analytique en lignes de partie double.
 *
 * FONCTION PURE — c'est ce qui rend la comptabilité générale vérifiable sans
 * base de données, et rejouable sans risque.
 *
 * Le signe du grand livre porte le sens : négatif = sortie d'argent, positif =
 * entrée. La contrepartie est toujours le compte de trésorerie de l'écriture,
 * parce que ce produit tient une comptabilité de caisse — l'argent bouge
 * vraiment à chaque ligne.
 *
 * @returns {{compte: string, libelle: string, debit: number, credit: number}[]}
 */
function projeter(ecriture, { mapping = MAPPING_DEFAUT } = {}) {
  const regle = mapping[ecriture.nature];
  if (!regle) return [];

  const montant = Math.abs(Number(ecriture.amountFcfa ?? ecriture.amount ?? 0));
  if (!montant) return [];

  const tresorerie = COMPTE_TRESORERIE[ecriture.cashAccountNature] ?? null;
  if (!tresorerie) {
    // Sans compte de trésorerie, il n'y a pas de contrepartie. On ne devine
    // pas : la ligne remonte en anomalie plutôt que d'aller dans un compte
    // d'attente que personne ne soldera jamais.
    return [];
  }

  const sortie = Number(ecriture.amountFcfa ?? ecriture.amount ?? 0) < 0;
  const libelle = String(ecriture.label ?? '').slice(0, 255);

  // Sortie d'argent : le compte de destination est débité, la trésorerie créditée.
  // Entrée : l'inverse. Le sens déclaré dans le mapping sert de contrôle.
  return sortie
    ? [
        { compte: regle.compte, libelle, debit: montant, credit: 0 },
        { compte: tresorerie, libelle, debit: 0, credit: montant },
      ]
    : [
        { compte: tresorerie, libelle, debit: montant, credit: 0 },
        { compte: regle.compte, libelle, debit: 0, credit: montant },
      ];
}

/**
 * Balance générale sur une période.
 *
 * CE QU'ELLE EXPOSE EXPRÈS
 *
 * `nonProjetees` : les écritures qu'aucune règle n'a su traduire. Les ranger
 * dans un compte d'attente ferait tomber la balance à zéro et masquerait le
 * problème — c'est exactement ce qu'on cherche à éviter. Une balance
 * équilibrée dont 45 % des lignes sont fausses reste une balance fausse.
 */
async function balance({ du, au, mapping = MAPPING_DEFAUT } = {}) {
  const problemes = verifier(mapping);
  if (problemes.length) {
    const e = new Error(`Mapping comptable invalide : ${problemes.join(' ')}`);
    e.code = 'MAPPING_INVALIDE';
    e.problemes = problemes;
    throw e;
  }

  const where = {};
  if (du || au) {
    where.entryDate = {};
    if (du) where.entryDate.gte = new Date(du);
    if (au) where.entryDate.lte = new Date(au);
  }

  const ecritures = await prisma.ledgerEntry.findMany({
    where,
    select: {
      id: true,
      nature: true,
      label: true,
      amountFcfa: true,
      entryDate: true,
      cashAccount: { select: { nature: true } },
    },
    orderBy: { entryDate: 'asc' },
  });

  const comptes = new Map();
  const nonProjetees = [];

  for (const e of ecritures) {
    const lignes = projeter(
      { ...e, cashAccountNature: e.cashAccount?.nature ?? null },
      { mapping }
    );
    if (!lignes.length) {
      nonProjetees.push({
        id: Number(e.id),
        nature: e.nature,
        label: e.label,
        montant: Number(e.amountFcfa),
        raison: e.cashAccount ? 'nature sans règle de mapping' : 'aucun compte de trésorerie',
      });
      continue;
    }
    for (const l of lignes) {
      if (!comptes.has(l.compte)) {
        const c = PAR_NUMERO.get(l.compte);
        comptes.set(l.compte, { numero: l.compte, libelle: c?.libelle ?? l.compte, classe: c?.classe ?? 0, debit: 0, credit: 0 });
      }
      const c = comptes.get(l.compte);
      c.debit += l.debit;
      c.credit += l.credit;
    }
  }

  const lignes = [...comptes.values()]
    .map((c) => ({ ...c, solde: c.debit - c.credit }))
    .sort((a, b) => a.numero.localeCompare(b.numero));

  const totalDebit = lignes.reduce((s, c) => s + c.debit, 0);
  const totalCredit = lignes.reduce((s, c) => s + c.credit, 0);

  return {
    periode: { du: du ?? null, au: au ?? null },
    lignes,
    totaux: {
      debit: totalDebit,
      credit: totalCredit,
      // Doit valoir 0 au franc près. Un écart signale un défaut de projection,
      // jamais une erreur de saisie — la partie double est produite, pas tapée.
      ecart: Math.round((totalDebit - totalCredit) * 100) / 100,
      equilibree: Math.abs(totalDebit - totalCredit) < 0.5,
    },
    lues: ecritures.length,
    projetees: ecritures.length - nonProjetees.length,
    nonProjetees: nonProjetees.slice(0, 200),
    nonProjeteesTotal: nonProjetees.length,
    montantNonProjete: nonProjetees.reduce((s, x) => s + Math.abs(x.montant), 0),
  };
}

module.exports = {
  PLAN,
  PAR_NUMERO,
  MAPPING_DEFAUT,
  COMPTE_TRESORERIE,
  verifier,
  projeter,
  balance,
};
