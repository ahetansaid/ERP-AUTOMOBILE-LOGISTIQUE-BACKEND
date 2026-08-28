/**
 * Les deux portes de sortie d'un véhicule.
 *
 * LE MÊME GESTE, DANS DEUX SENS
 *
 *   atelier    devis approuvé → reçus PAYÉS au prestataire → sortie d'atelier
 *   livraison  facture émise  → reçus ENCAISSÉS du client  → livraison
 *
 * Une enveloppe, des reçus qui la vident, une porte qui s'ouvre ensuite. Coder
 * deux mécaniques différentes aurait donné deux bugs différents ; il n'y en a
 * donc qu'une, paramétrée par la porte.
 *
 * LA PORTE S'OUVRE TOUJOURS — ELLE NE SE TAIT JAMAIS
 *
 * Un client règle 60 % et repart avec le véhicule : cela arrive toutes les
 * semaines. Un logiciel qui refuse est contourné, et la livraison n'est alors
 * enregistrée nulle part — on perd l'événement en plus de l'argent. La porte
 * s'ouvre donc dans tous les cas, mais toute réserve exige un motif écrit, et
 * le solde du moment est FIGÉ.
 *
 * POURQUOI FIGER LE SOLDE
 *
 * Recalculé trois mois plus tard, il vaut zéro : tout a fini par être payé, et
 * plus rien ne montre qu'on a laissé partir un véhicule réglé à 40 %. C'est la
 * seule donnée de la sortie qui se perd si on ne l'écrit pas au moment même.
 *
 * OÙ ÇA VIT
 *
 * Dans `TransitStep`, pas dans une entité nouvelle. La table porte déjà une
 * chronologie datée par véhicule que le dossier 360° affiche : deux jalons de
 * plus, et l'import et la vente se lisent dans la même colonne. Une entité de
 * plus aurait été un écran de plus, tenu par personne.
 */

const { prisma } = require('./prisma');
const { soldeFacture, soldeDevis } = require('./soldes');

const SORTIE_ATELIER = 'SORTIE_ATELIER';
const LIVRAISON_CLIENT = 'LIVRAISON_CLIENT';
const JALONS = [SORTIE_ATELIER, LIVRAISON_CLIENT];

/** Devis qu'on considère encore ouverts — le travail n'est pas soldé. */
const DEVIS_CLOS = ['TERMINE', 'CLOTURE', 'REFUSE'];

const jourUTC = (d) => {
  const s = String(d || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [a, m, j] = s.split('-').map(Number);
  const date = new Date(Date.UTC(a, m - 1, j));
  // Le 31/02 donnerait le 3 mars sans ce contrôle.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== j) return null;
  return date;
};

const aujourdhui = () => jourUTC(new Date().toISOString());

/** Le jalon déjà posé pour cette porte, ou null. */
function jalonPose(vehicleId, jalon) {
  return prisma.transitStep.findFirst({
    where: { vehicleId: Number(vehicleId), stepName: jalon },
    select: { id: true, dateArrival: true, docRef: true, soldeGele: true, motif: true },
  });
}

/**
 * État de la porte atelier.
 *
 * Le solde est celui de TOUS les devis du véhicule, pas d'un seul. Un véhicule
 * passe chez le mécanicien, le tôlier et l'électricien : un devis soldé ne dit
 * rien de l'atelier. La sortie est un fait du VÉHICULE.
 */
async function etatAtelier(vehicleId) {
  const id = Number(vehicleId);
  const vehicule = await prisma.vehicle.findFirst({
    where: { id },
    select: { id: true, vin: true, brand: true, model: true, status: true },
  });
  if (!vehicule) return null;

  const devisBruts = await prisma.workshopQuote.findMany({
    where: { vehicleId: id, status: { not: 'REFUSE' } },
    select: { id: true, prestataire: true, amount: true, status: true, description: true },
    orderBy: { id: 'asc' },
  });

  const devis = [];
  for (const d of devisBruts) {
    const { total, paye, restant } = await soldeDevis(d);
    devis.push({
      id: d.id,
      prestataire: d.prestataire,
      statut: d.status,
      description: d.description,
      montant: total,
      paye,
      restant,
      solde: restant <= 0,
    });
  }

  // Un devis EN_ATTENTE n'est pas une dette : personne n'a encore dit oui. Il
  // n'entre donc pas dans le solde — mais il est signalé à part, car laisser
  // partir un véhicule sur un devis jamais tranché est précisément ce qu'on
  // veut voir avant d'ouvrir la porte, pas trois semaines après.
  const enAttente = devis.filter((d) => d.statut === 'EN_ATTENTE');
  const engages = devis.filter((d) => d.statut !== 'EN_ATTENTE');

  const engage = engages.reduce((s, d) => s + d.montant, 0);
  const paye = engages.reduce((s, d) => s + d.paye, 0);
  const restant = Math.max(0, engage - paye);
  const ouverts = engages.filter((d) => !d.solde || !DEVIS_CLOS.includes(d.statut));
  const dejaSorti = await jalonPose(id, SORTIE_ATELIER);

  const reserves = [];
  if (!devis.length) reserves.push("Aucun devis d'atelier sur ce véhicule");
  if (restant > 0) {
    reserves.push(
      `${engages.filter((d) => !d.solde).length} devis non soldé(s), ` +
        `${Math.round(restant).toLocaleString('fr-FR')} FCFA restant dus aux prestataires`
    );
  }
  if (enAttente.length) {
    reserves.push(
      `${enAttente.length} devis en attente de décision — ni approuvé, ni refusé`
    );
  }

  return {
    porte: SORTIE_ATELIER,
    vehicule,
    devis,
    engage,
    paye,
    restant,
    enAttente: enAttente.length,
    devisOuverts: ouverts.length,
    pret: reserves.length === 0,
    reserves,
    dejaFranchie: dejaSorti,
  };
}

/**
 * État de la porte livraison.
 *
 * Un devis d'atelier encore ouvert est une RÉSERVE, pas un refus : le véhicule
 * peut être vendu puis renvoyé à l'atelier à la demande du client avant qu'il
 * n'en prenne livraison. Mais le livrer alors qu'il est encore chez le tôlier
 * mérite d'être écrit noir sur blanc.
 */
async function etatLivraison(vehicleId) {
  const id = Number(vehicleId);
  const vehicule = await prisma.vehicle.findFirst({
    where: { id },
    select: { id: true, vin: true, brand: true, model: true, status: true },
  });
  if (!vehicule) return null;

  const facture = await prisma.invoice.findFirst({
    where: { vehicleId: id },
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      status: true,
      client: { select: { id: true, name: true } },
    },
  });

  const reserves = [];
  let total = 0;
  let paye = 0;
  let restant = 0;

  if (!facture) {
    reserves.push("Aucune facture de vente — le véhicule sortirait sans être vendu");
  } else if (facture.status === 'ANNULEE') {
    reserves.push('La facture de ce véhicule est annulée');
  } else {
    ({ total, paye, restant } = await soldeFacture(facture));
    if (restant > 0) {
      reserves.push(
        `Facture non soldée : ${Math.round(restant).toLocaleString('fr-FR')} FCFA restant dus ` +
          `sur ${Math.round(total).toLocaleString('fr-FR')} FCFA`
      );
    }
  }

  const atelier = await etatAtelier(id);
  if (atelier && atelier.devisOuverts > 0) {
    reserves.push(`${atelier.devisOuverts} devis d'atelier encore ouvert(s)`);
  }

  return {
    porte: LIVRAISON_CLIENT,
    vehicule,
    facture: facture
      ? {
          id: facture.id,
          numero: facture.invoiceNumber,
          statut: facture.status,
          client: facture.client?.name ?? null,
          montant: total,
          paye,
          restant,
        }
      : null,
    restant,
    pret: reserves.length === 0,
    reserves,
    dejaFranchie: await jalonPose(id, LIVRAISON_CLIENT),
  };
}

const etatPorte = (jalon, vehicleId) =>
  jalon === SORTIE_ATELIER ? etatAtelier(vehicleId) : etatLivraison(vehicleId);

/**
 * Franchit une porte.
 *
 * Refuse dans deux cas seulement, et aucun n'est un jugement sur l'argent :
 * la porte a déjà été franchie (un doublon fausserait le solde figé), ou une
 * réserve existe sans motif écrit.
 *
 * @returns {{ok: true, etape: object}|{ok: false, code: string, message: string, etat: object}}
 */
async function franchir({ vehicleId, jalon, date, docRef, motif, companyId }) {
  if (!JALONS.includes(jalon)) {
    return { ok: false, code: 'JALON_INCONNU', message: `Porte inconnue : ${jalon}` };
  }

  const etat = await etatPorte(jalon, vehicleId);
  if (!etat) {
    return { ok: false, code: 'VEHICULE_INTROUVABLE', message: 'Véhicule introuvable' };
  }

  if (etat.dejaFranchie) {
    return {
      ok: false,
      code: 'DEJA_FRANCHIE',
      message:
        jalon === SORTIE_ATELIER
          ? `Ce véhicule est déjà sorti d'atelier le ${String(etat.dejaFranchie.dateArrival).slice(0, 10)}.`
          : `Ce véhicule a déjà été livré le ${String(etat.dejaFranchie.dateArrival).slice(0, 10)}.`,
      etat,
    };
  }

  const motifPropre = String(motif ?? '').trim();
  if (etat.reserves.length && motifPropre.length < 10) {
    return {
      ok: false,
      code: 'MOTIF_REQUIS',
      message:
        'Cette sortie comporte des réserves : un motif écrit est obligatoire (10 caractères minimum). ' +
        'Il sera conservé avec le solde du jour.',
      etat,
    };
  }

  const jour = jourUTC(date) ?? aujourdhui();

  const etape = await prisma.transitStep.create({
    data: {
      companyId: companyId ?? null,
      vehicleId: Number(vehicleId),
      stepName: jalon,
      dateArrival: jour,
      docRef: String(docRef ?? '').trim() || null,
      // Figé maintenant, jamais recalculé.
      soldeGele: etat.restant,
      motif: motifPropre || null,
    },
  });

  // Le statut commercial suit la porte franchie. « En atelier » ne s'y écrit
  // pas : c'est un état déduit des devis ouverts, sans quoi un véhicule vendu
  // puis renvoyé en réparation devrait porter deux statuts à la fois.
  const statutVoulu = jalon === LIVRAISON_CLIENT ? 'LIVRE' : null;
  if (statutVoulu) {
    await prisma.vehicle.update({ where: { id: Number(vehicleId) }, data: { status: statutVoulu } });
  } else if (etat.vehicule.status === 'EN_MAINTENANCE') {
    // Données antérieures : le véhicule portait encore l'ancien statut d'atelier.
    await prisma.vehicle.update({ where: { id: Number(vehicleId) }, data: { status: 'DISPONIBLE' } });
  }

  // Pas d'appel a req.audit ici : l'extension Prisma trace deja tout CREATE
  // avec son before/after, et req.audit ignore precisement ces actions-la pour
  // ne pas doubler la ligne. Un appel explicite ne serait pas faux, il serait
  // mort — et un jour quelqu'un croirait que c'est lui qui trace.
  return { ok: true, etape, etat };
}

module.exports = {
  SORTIE_ATELIER,
  LIVRAISON_CLIENT,
  JALONS,
  DEVIS_CLOS,
  jourUTC,
  etatAtelier,
  etatLivraison,
  etatPorte,
  franchir,
};
