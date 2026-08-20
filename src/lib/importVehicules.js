/**
 * Import de véhicules en masse.
 *
 * LA MÊME DISCIPLINE QUE LA REPRISE DE L'HISTORIQUE
 *
 * On lit, on juge, on annonce, et on n'écrit qu'ensuite. Le tour à blanc est le
 * mode PAR DÉFAUT, pas une option : un châssis créé en double, ou rattaché au
 * mauvais conteneur, se répare à la main ligne par ligne — et si des coûts ont
 * déjà été ventilés dessus, ils sont au grand livre, donc définitifs.
 *
 * LE FICHIER D'EXPORT EST LE MODÈLE D'IMPORT
 *
 * Mêmes colonnes, même ordre. On exporte, on modifie dans Excel, on réimporte.
 * L'utilisateur n'a aucun format à apprendre, et il n'y a aucune documentation
 * à tenir à jour — c'est le code qui la porte.
 *
 * CE QUI EST REFUSÉ PLUTÔT QUE DEVINÉ
 *
 * Un châssis vide, trop court, ou déjà présent. Une année absurde. Un montant
 * illisible. Un statut inconnu. Chaque refus NOMME la ligne du fichier telle
 * qu'Excel l'affiche, sans quoi l'utilisateur cherche à l'aveugle dans deux
 * cents lignes.
 */

const { prisma } = require('./prisma');

/** Colonnes du fichier. L'export produit exactement celles-ci, dans cet ordre. */
const COLONNES = [
  'chassis',
  'marque',
  'modele',
  'annee',
  'couleur',
  'statut',
  'prix_achat_devise',
  'prix_achat_fcfa',
  'prix_vente',
  'kilometrage',
  'immatriculation',
  'pays_origine',
  'poids_kg',
  'conteneur',
];

const STATUTS = [
  'DISPONIBLE',
  'EN_VENTE',
  'VENDU',
  'EN_MAINTENANCE',
  'EN_TRANSIT',
  'LIVRE',
  'RESERVE',
];

const ANNEE_MIN = 1950;
const ANNEE_MAX = new Date().getUTCFullYear() + 2;

/**
 * Nombre depuis une saisie humaine.
 *
 * Excel écrit « 1 234,56 » en français : espace insécable comme séparateur de
 * milliers, virgule comme décimale. Un `Number()` direct donne NaN, et la ligne
 * serait refusée alors qu'elle est parfaitement lisible.
 */
function nombre(valeur) {
  if (valeur === null || valeur === undefined || String(valeur).trim() === '') return null;
  const nettoye = String(valeur)
    .replace(/ /g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const n = Number(nettoye);
  return Number.isFinite(n) ? n : NaN;
}

const texte = (v, max) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Analyse et juge les lignes. N'écrit rien.
 *
 * @returns {{valides: object[], refus: object[], conteneurs: Map}}
 */
async function preparer(lignes, tenantWhere) {
  const refus = [];
  const valides = [];

  // Châssis déjà en base — une seule requête, pas une par ligne.
  const chassisFichier = lignes
    .map((l) => String(l.chassis || '').trim().toUpperCase())
    .filter(Boolean);
  const existants = new Set(
    (
      await prisma.vehicle.findMany({
        where: { ...tenantWhere, vin: { in: chassisFichier } },
        select: { vin: true },
      })
    ).map((v) => String(v.vin).toUpperCase())
  );

  // Conteneurs cités, résolus par référence.
  const refsConteneur = [
    ...new Set(lignes.map((l) => String(l.conteneur || '').trim()).filter(Boolean)),
  ];
  const conteneurs = new Map(
    (
      await prisma.purchase.findMany({
        where: { ...tenantWhere, containerReference: { in: refsConteneur } },
        select: { id: true, containerReference: true },
      })
    ).map((p) => [p.containerReference, p.id])
  );

  // Doublons À L'INTÉRIEUR du fichier : deux lignes peuvent porter le même
  // châssis sans qu'aucune ne soit encore en base.
  const vusDansFichier = new Map();

  for (const l of lignes) {
    const erreurs = [];
    const chassis = String(l.chassis || '').trim().toUpperCase();

    if (!chassis) {
      erreurs.push('châssis absent');
    } else if (chassis.length < 11) {
      erreurs.push(`châssis trop court (${chassis.length} caractères, 11 minimum)`);
    } else if (existants.has(chassis)) {
      erreurs.push('châssis déjà présent dans le parc');
    } else if (vusDansFichier.has(chassis)) {
      erreurs.push(`châssis déjà présent ligne ${vusDansFichier.get(chassis)} du fichier`);
    }

    const annee = nombre(l.annee);
    if (Number.isNaN(annee)) erreurs.push(`année illisible : « ${l.annee} »`);
    else if (annee !== null && (annee < ANNEE_MIN || annee > ANNEE_MAX)) {
      erreurs.push(`année hors bornes : ${annee} (attendu ${ANNEE_MIN}–${ANNEE_MAX})`);
    }

    const statut = texte(l.statut, 30);
    if (statut && !STATUTS.includes(statut.toUpperCase())) {
      erreurs.push(`statut inconnu : « ${statut} ». Valeurs : ${STATUTS.join(', ')}`);
    }

    const montants = {
      purchasePrice: nombre(l.prix_achat_devise),
      purchasePriceFcfa: nombre(l.prix_achat_fcfa),
      priceSale: nombre(l.prix_vente),
      mileage: nombre(l.kilometrage),
      weightKg: nombre(l.poids_kg),
    };
    for (const [cle, v] of Object.entries(montants)) {
      if (Number.isNaN(v)) erreurs.push(`${cle} illisible`);
      else if (v !== null && v < 0) erreurs.push(`${cle} négatif`);
    }

    const refConteneur = String(l.conteneur || '').trim();
    let purchaseId = null;
    if (refConteneur) {
      purchaseId = conteneurs.get(refConteneur) ?? null;
      if (!purchaseId) {
        erreurs.push(`conteneur « ${refConteneur} » introuvable — créez-le d'abord`);
      }
    }

    if (erreurs.length) {
      refus.push({ ligne: l.__ligne, chassis: chassis || null, erreurs });
      continue;
    }

    if (chassis) vusDansFichier.set(chassis, l.__ligne);

    valides.push({
      ligne: l.__ligne,
      purchaseId,
      refConteneur: refConteneur || null,
      data: {
        vin: chassis,
        brand: texte(l.marque, 100),
        model: texte(l.modele, 100),
        year: annee !== null ? Math.trunc(annee) : null,
        color: texte(l.couleur, 50),
        status: statut ? statut.toUpperCase() : 'DISPONIBLE',
        purchasePrice: montants.purchasePrice ?? 0,
        purchasePriceFcfa: montants.purchasePriceFcfa,
        priceSale: montants.priceSale,
        mileage: montants.mileage !== null ? Math.trunc(montants.mileage) : null,
        registration: texte(l.immatriculation, 50),
        countryOrigin: texte(l.pays_origine, 100),
        weightKg: montants.weightKg !== null ? Math.trunc(montants.weightKg) : null,
      },
    });
  }

  return { valides, refus };
}

/** Écrit les lignes valides. À n'appeler qu'après `preparer`. */
async function ecrire(valides, audit) {
  const crees = [];
  for (const v of valides) {
    const vehicule = await prisma.vehicle.create({ data: v.data });
    if (v.purchaseId) {
      await prisma.purchaseVehicle.create({
        data: { purchaseId: v.purchaseId, vehicleId: vehicule.id },
      });
    }
    if (audit) {
      audit({
        action: 'CREATE',
        resource: 'vehicles',
        resourceId: vehicule.id,
        before: null,
        after: vehicule,
      });
    }
    crees.push({ ligne: v.ligne, id: vehicule.id, chassis: v.data.vin });
  }
  return crees;
}

module.exports = { COLONNES, STATUTS, nombre, preparer, ecrire };
