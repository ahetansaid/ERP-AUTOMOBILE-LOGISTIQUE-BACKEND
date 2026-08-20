/**
 * Qualification des écritures de caisse.
 *
 * Les règles vivent ICI et non dans le script qui les a fait naître : `src/` ne
 * doit pas dépendre de `scripts/`. Le script d'analyse et l'import de caisse les
 * partagent, ce qui garantit qu'une ligne jugée « prélèvement personnel » par la
 * feuille de qualification le sera aussi à l'import.
 *
 * Chaque motif a été lu dans les libellés réels du registre de caisse avant
 * d'être écrit. L'ordre compte : la première règle qui correspond gagne, donc
 * les cas les plus spécifiques viennent d'abord.
 */

const sansAccent = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * Table de règles, ordonnée. Première correspondance gagnante.
 *
 * `nature` est la proposition ; `arbitrage: true` signale qu'elle ne peut pas
 * être déduite du libellé seul et attend une décision humaine.
 */
const REGLES = [
  {
    code: 'TRANSFERT_ETRANGER',
    motif: /TRANSFERT VERS|TRANSFERT D.ARGENT|TRANSFERT DU CONTENEUR|VIREMENT VERS/,
    nature: 'TRANSFERT',
    arbitrage: true,
    note:
      'Sorties vers le Liban, la Suède, un paiement de fret. Règlement de fournisseur, mouvement entre comptes, ou prélèvement ? La réponse change le résultat.',
  },
  {
    code: 'PRELEVEMENT_DIRIGEANT',
    motif: /BESOIN PERSONNEL|USAGE PERSONNEL|AIDE PORTE|\bLOYER\b|MAISON|DOMESTIQUE|PROVISION|ALIMENTATION DE|RECEPTION|CAJOU|VETEMENT/,
    nature: 'COMPTE_ASSOCIE',
    note:
      "Loyer, factures du domicile, personnel de maison, dépenses privées. Hors résultat par nature : ce n'est pas l'entreprise qui consomme.",
  },
  {
    code: 'DEPOTAGE_TRANSIT',
    motif: /DEPOTAGE|LIGNE PARC|TRANSITAIRE/,
    nature: 'MANUTENTION',
    note:
      'Frais portuaires sur un conteneur. Devraient être rattachés au conteneur et ventilés, pas laissés en frais généraux.',
  },
  {
    code: 'SALAIRES',
    motif: /SALAIRE|REMUNERATION|\bPAIE\b/,
    nature: 'CHARGE',
    note: "Charge d'exploitation, correctement classée.",
  },
  {
    code: 'UTILITES_TELECOM',
    motif: /ELECTRICITE|\bSBEE\b|\bEAU\b|INTERNET|CONNEXION|MOMO|CREDIT MTN|CREDIT MOOV|RECHARGE|\bSIM\b/,
    nature: 'CHARGE',
    note: "Électricité, eau, internet, téléphonie. Charge d'exploitation.",
  },
  {
    code: 'DOUANE_BL',
    motif: /\bBL\b|IMPOT|DOUANE|QUITTANCE|CNSS/,
    nature: 'TAXE',
    note: 'Droits, connaissements et impôts. Devraient porter le véhicule ou le conteneur.',
  },
  {
    code: 'RETOUR_AVANCE',
    motif: /RETOUR SUR AVANCE|RECUPERATION DE|REMBOURSEMENT/,
    nature: 'REGLEMENT',
    arbitrage: true,
    note:
      'Argent qui REVIENT, enregistré en charge donc compté comme une sortie. Le signe est à vérifier ligne par ligne.',
  },
  {
    code: 'AVANCE_PRESTATAIRE',
    motif: /\bAVANCE\b/,
    nature: 'CHARGE',
    arbitrage: true,
    note: "Avance à un prestataire : charge à la sortie, ou créance à régulariser ?",
  },
  {
    code: 'ATELIER_SUR_VEHICULE',
    motif: /ESSENCE|PEINTRE|SOUDEUR|MECANI|ELECTRICIEN|PIECE|RADIATEUR|PNEU|VULGANISATEUR|CLEMAREUR/,
    nature: 'PREPARATION',
    arbitrage: true,
    note:
      "Dépense d'atelier citant un véhicule. LAISSÉE EN CHARGE par votre arbitrage du chargement, pour ne pas doubler les réparations déjà reprises du costing. À revoir seulement si vous voulez trancher autrement.",
  },
];

function classer(label) {
  const l = sansAccent(label);
  return REGLES.find((r) => r.motif.test(l)) || null;
}

/** Natures exclues du résultat par conception. */
const HORS_RESULTAT = ['TRANSFERT', 'COMPTE_ASSOCIE', 'REGLEMENT', 'FINANCEMENT'];

function classer(label) {
  const l = sansAccent(label);
  return REGLES.find((r) => r.motif.test(l)) || null;
}

module.exports = { REGLES, classer, HORS_RESULTAT, sansAccent };
