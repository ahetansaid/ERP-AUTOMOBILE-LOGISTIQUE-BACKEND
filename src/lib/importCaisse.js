/**
 * Import des dépenses et encaissements de caisse, en masse.
 *
 * C'EST LE SEUL IMPORT QUI ÉCRIT AU GRAND LIVRE
 *
 * Donc le seul qu'on ne peut pas défaire. Une ligne fausse ne se corrige pas :
 * elle se contre-passe, ce qui laisse deux écritures au lieu d'une. Le tour à
 * blanc n'est pas une commodité, c'est la seule occasion de se tromper sans
 * conséquence.
 *
 * LE SENS EST DÉCLARÉ, JAMAIS DEVINÉ
 *
 * Le fichier porte des montants POSITIFS — c'est ainsi qu'un humain écrit une
 * dépense — et une colonne `sens` qui vaut `sortie` ou `entree`. Le signe du
 * grand livre en découle.
 *
 * Déduire le sens de la nature serait tentant et faux : un REGLEMENT peut être
 * un encaissement de créance comme un règlement de fournisseur, un TRANSFERT
 * part ou arrive. Le classeur de caisse ne le dit pas non plus — c'est
 * précisément ce qui a produit six lignes de « retour sur avance » enregistrées
 * comme des sorties alors que l'argent revenait.
 *
 * LA NATURE EST PROPOSÉE, PAS IMPOSÉE
 *
 * Laissée vide, elle est déduite du libellé par les mêmes règles que la feuille
 * de qualification — et le tour à blanc l'affiche pour qu'on la corrige avant
 * d'écrire. Renseignée, elle prime : c'est l'utilisateur qui sait.
 */

const { prisma } = require('./prisma');
const { postEntry, COST_NATURES } = require('./ledger');
const { findOrCreatePartner } = require('./partners');
const { classer } = require('./qualification');

/** Colonnes du fichier. L'export produit exactement celles-ci, dans cet ordre. */
const COLONNES = [
  'date',
  'beneficiaire',
  'description',
  'montant',
  'sens',
  'nature',
  'chassis',
  'compte',
];

const NATURES = [
  'ACHAT', 'LOGISTIQUE', 'TAXE', 'MANUTENTION', 'PREPARATION',
  'VENTE', 'REGLEMENT', 'CHARGE', 'FINANCEMENT', 'COMPTE_ASSOCIE',
  'TRANSFERT', 'AUTRE',
];

const SENS = { SORTIE: -1, ENTREE: 1 };

const sansAccent = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/** Montant écrit à la française : « 1 234,56 » → 1234.56. */
function montant(valeur) {
  if (valeur === null || valeur === undefined || String(valeur).trim() === '') return null;
  const n = Number(String(valeur).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Date depuis une saisie humaine.
 *
 * Excel écrit `JJ/MM/AAAA` en français ; un export ISO donne `AAAA-MM-JJ`. Les
 * deux sont acceptés. Tout est ramené à MINUIT UTC, comme les bornes de période
 * des rapports — sans quoi une écriture saisie le soir bascule au lendemain
 * selon le fuseau de la machine.
 */
function date(valeur) {
  const s = String(valeur || '').trim();
  if (!s) return null;

  let a;
  let m;
  let j;
  const fr = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (fr) {
    [, j, m, a] = fr;
  } else if (iso) {
    [, a, m, j] = iso;
  } else {
    return NaN;
  }

  const d = new Date(Date.UTC(Number(a), Number(m) - 1, Number(j)));
  if (Number.isNaN(d.getTime())) return NaN;
  // Contrôle de cohérence : le 31/02 donnerait le 3 mars sans lever.
  if (d.getUTCMonth() !== Number(m) - 1 || d.getUTCDate() !== Number(j)) return NaN;
  return d;
}

/**
 * Analyse et juge. N'écrit rien.
 *
 * Les résolutions coûteuses — comptes, véhicules — sont faites en une requête
 * chacune plutôt qu'une par ligne : un fichier de trois cents lignes ferait
 * autant d'allers-retours.
 */
async function preparer(lignes, tenantWhere) {
  const refus = [];
  const valides = [];

  const comptes = await prisma.cashAccount.findMany({
    where: { ...tenantWhere, isActive: true },
    select: { id: true, label: true, nature: true },
  });
  const parLibelle = new Map(comptes.map((c) => [sansAccent(c.label), c.id]));
  const caisseParDefaut =
    comptes.find((c) => c.nature === 'CAISSE')?.id ?? comptes[0]?.id ?? null;

  const chassisCites = [
    ...new Set(lignes.map((l) => String(l.chassis || '').trim().toUpperCase()).filter(Boolean)),
  ];
  const vehicules = new Map(
    (
      await prisma.vehicle.findMany({
        where: { ...tenantWhere, vin: { in: chassisCites } },
        select: { id: true, vin: true },
      })
    ).map((v) => [String(v.vin).toUpperCase(), v.id])
  );

  for (const l of lignes) {
    const erreurs = [];

    const d = date(l.date);
    if (d === null) erreurs.push('date absente');
    else if (Number.isNaN(d)) erreurs.push(`date illisible : « ${l.date} » (JJ/MM/AAAA attendu)`);

    const m = montant(l.montant);
    if (m === null) erreurs.push('montant absent');
    else if (Number.isNaN(m)) erreurs.push(`montant illisible : « ${l.montant} »`);
    else if (m === 0) erreurs.push('montant nul — une écriture à zéro ne dit rien');
    else if (m < 0) {
      erreurs.push(
        'montant négatif — écrivez un montant positif et indiquez le sens dans la colonne « sens »'
      );
    }

    const sensBrut = sansAccent(l.sens) || 'SORTIE';
    const signe = SENS[sensBrut];
    if (!signe) {
      erreurs.push(`sens inconnu : « ${l.sens} ». Valeurs : sortie, entree`);
    }

    const description = String(l.description || '').trim();
    const beneficiaire = String(l.beneficiaire || '').trim();
    const libelle = [beneficiaire, description].filter(Boolean).join(' — ');
    if (!libelle) erreurs.push('ni bénéficiaire ni description — l’écriture serait illisible');

    // Nature : celle du fichier prime ; sinon proposée depuis le libellé.
    let nature = sansAccent(l.nature);
    let natureProposee = false;
    if (!nature) {
      const regle = classer(libelle);
      nature = regle ? regle.nature : 'CHARGE';
      natureProposee = true;
    }
    if (!NATURES.includes(nature)) {
      erreurs.push(`nature inconnue : « ${l.nature} ». Valeurs : ${NATURES.join(', ')}`);
    }

    const chassis = String(l.chassis || '').trim().toUpperCase();
    let vehicleId = null;
    if (chassis) {
      vehicleId = vehicules.get(chassis) ?? null;
      if (!vehicleId) erreurs.push(`châssis « ${chassis} » introuvable dans le parc`);
    }
    // Le grand livre l'exige, et pour une bonne raison : sans axe véhicule, la
    // dépense n'entre dans aucun coût de revient. Autant le dire ici, avec le
    // numéro de ligne, plutôt que de laisser postEntry échouer à l'écriture.
    if (COST_NATURES.includes(nature) && !vehicleId) {
      erreurs.push(
        `la nature ${nature} exige un châssis — sans lui, la dépense n’entre dans aucun coût de revient`
      );
    }

    const compteBrut = sansAccent(l.compte);
    let cashAccountId = caisseParDefaut;
    if (compteBrut) {
      cashAccountId = parLibelle.get(compteBrut) ?? null;
      if (!cashAccountId) {
        erreurs.push(
          `compte « ${l.compte} » introuvable. Comptes : ${comptes.map((c) => c.label).join(', ')}`
        );
      }
    } else if (!cashAccountId) {
      erreurs.push('aucun compte de trésorerie configuré');
    }

    if (erreurs.length) {
      refus.push({ ligne: l.__ligne, libelle: libelle || null, erreurs });
      continue;
    }

    valides.push({
      ligne: l.__ligne,
      natureProposee,
      apercu: {
        date: d.toISOString().slice(0, 10),
        libelle,
        montant: signe * m,
        nature,
        chassis: chassis || null,
      },
      ecriture: {
        nature,
        label: libelle,
        amount: signe * m,
        currency: 'FCFA',
        rateApplied: 1,
        entryDate: d,
        vehicleId,
        cashAccountId,
      },
      beneficiaire: beneficiaire || null,
    });
  }

  return { valides, refus };
}

/** Écrit les écritures. À n'appeler qu'après `preparer`. */
async function ecrire(valides) {
  const partenaires = new Map();
  const ecrites = [];

  for (const v of valides) {
    let partnerId = null;
    if (v.beneficiaire) {
      if (!partenaires.has(v.beneficiaire)) {
        const p = await findOrCreatePartner(v.beneficiaire, 'PRESTATAIRE');
        partenaires.set(v.beneficiaire, p.id);
      }
      partnerId = partenaires.get(v.beneficiaire);
    }
    const e = await postEntry({ ...v.ecriture, partnerId });
    ecrites.push({ ligne: v.ligne, id: Number(e.id), montant: Number(e.amountFcfa) });
  }

  return { ecrites, tiers: partenaires.size };
}

module.exports = { COLONNES, NATURES, SENS, montant, date, preparer, ecrire };
