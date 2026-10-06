/**
 * Âge du stock — le capital immobilisé, par tranche d'ancienneté.
 *
 * POURQUOI CECI PLUTÔT QU'UN CRM
 *
 * Les outils de gestion généralistes proposent un entonnoir commercial : leads,
 * opportunités, pipeline pondéré, taux de conversion. C'est le bon outil pour
 * vendre des abonnements. Un importateur de véhicules n'a pas d'entonnoir : il
 * a un PARC. Sa question n'est pas « où en est cette opportunité » mais
 * « cette voiture dort depuis combien de jours, et combien me coûte-t-elle
 * pendant ce temps ».
 *
 * Un véhicule immobilisé ne coûte pas que son prix d'achat : il consomme du
 * gardiennage, il se déprécie, et surtout il retient un capital qui aurait
 * acheté le suivant. C'est la métrique qui manquait.
 *
 * LA DATE DE RÉFÉRENCE EST CHOISIE, PAS SUBIE
 *
 * « Depuis quand ce véhicule est-il en stock » n'a pas de réponse unique. On
 * prend, dans l'ordre : l'arrivée du conteneur si elle est connue, sinon la
 * création de la fiche. La différence peut valoir des semaines, donc chaque
 * ligne DIT laquelle a servi. Un indicateur dont on ignore la base se discute
 * au lieu d'être utilisé.
 */

const { prisma } = require('./prisma');
const { COST_NATURES } = require('./ledger');
const { NON_ARCHIVES } = require('./archive');

/** Statuts qui comptent comme « en stock » : le véhicule est là, invendu. */
const EN_STOCK = ['DISPONIBLE', 'EN_VENTE', 'RESERVE', 'EN_MAINTENANCE'];

/**
 * Tranches d'ancienneté.
 *
 * Les bornes ne sont pas rondes par hasard : 30 jours est le délai normal de
 * mise en vente après dépotage, 90 jours le seuil au-delà duquel la marge
 * prévue est généralement mangée, et 180 jours le point où l'on parle d'une
 * erreur d'achat plutôt que d'un délai de vente.
 */
const TRANCHES = [
  { cle: '0-30', libelle: '0 à 30 jours', min: 0, max: 30 },
  { cle: '31-60', libelle: '31 à 60 jours', min: 31, max: 60 },
  { cle: '61-90', libelle: '61 à 90 jours', min: 61, max: 90 },
  { cle: '91-180', libelle: '91 à 180 jours', min: 91, max: 180 },
  { cle: '180+', libelle: 'plus de 180 jours', min: 181, max: Infinity },
];

const JOUR = 86400000;
const jours = (a, b) => Math.max(0, Math.floor((a - b) / JOUR));
const trancheDe = (j) => TRANCHES.find((t) => j >= t.min && j <= t.max) ?? TRANCHES[TRANCHES.length - 1];

/**
 * État du stock à une date donnée.
 *
 * @param {{maintenant?: Date}} options
 */
async function ageDuStock({ maintenant = new Date() } = {}) {
  const vehicules = await prisma.vehicle.findMany({
    where: { ...NON_ARCHIVES, status: { in: EN_STOCK } },
    select: {
      id: true,
      vin: true,
      brand: true,
      model: true,
      year: true,
      status: true,
      priceSale: true,
      createdAt: true,
      purchaseVehicles: {
        select: { purchase: { select: { arrivalDate: true, containerReference: true } } },
        take: 1,
      },
    },
  });

  if (!vehicules.length) {
    return {
      arreteAu: maintenant.toISOString().slice(0, 10),
      vehicules: [],
      tranches: TRANCHES.map((t) => ({ ...t, nombre: 0, capital: 0 })),
      total: { nombre: 0, capital: 0, ageMoyen: 0, plusVieux: null },
    };
  }

  // Coûts en une seule requête : un groupBy plutôt qu'un appel par véhicule.
  // Sur 57 véhicules la différence est invisible ; sur 500 elle ne l'est plus.
  const couts = await prisma.ledgerEntry.groupBy({
    by: ['vehicleId'],
    where: { vehicleId: { in: vehicules.map((v) => v.id) }, nature: { in: COST_NATURES } },
    _sum: { amountFcfa: true },
  });
  const coutPar = new Map(couts.map((c) => [c.vehicleId, Math.abs(Number(c._sum.amountFcfa ?? 0))]));

  const lignes = vehicules.map((v) => {
    const arrivee = v.purchaseVehicles?.[0]?.purchase?.arrivalDate ?? null;
    const reference = arrivee ?? v.createdAt;
    const age = jours(maintenant, new Date(reference));
    const capital = coutPar.get(v.id) ?? 0;
    const prix = v.priceSale != null ? Number(v.priceSale) : null;

    return {
      id: v.id,
      vin: v.vin,
      designation: [v.brand, v.model, v.year].filter(Boolean).join(' ') || `Véhicule #${v.id}`,
      statut: v.status,
      conteneur: v.purchaseVehicles?.[0]?.purchase?.containerReference ?? null,
      age,
      tranche: trancheDe(age).cle,
      // Dire d'où vient la date : sans ça, l'indicateur se discute.
      baseAge: arrivee ? 'arrivee_conteneur' : 'creation_fiche',
      depuis: new Date(reference).toISOString().slice(0, 10),
      capital,
      prixVente: prix,
      // Marge encore possible AU PRIX AFFICHÉ. Négative = on vend à perte, et
      // c'est une information qu'on veut voir avant la vente, pas après.
      margePotentielle: prix != null && capital > 0 ? prix - capital : null,
    };
  });

  lignes.sort((a, b) => b.age - a.age);

  const tranches = TRANCHES.map((t) => {
    const dedans = lignes.filter((l) => l.tranche === t.cle);
    return {
      cle: t.cle,
      libelle: t.libelle,
      nombre: dedans.length,
      capital: dedans.reduce((s, l) => s + l.capital, 0),
    };
  });

  const capitalTotal = lignes.reduce((s, l) => s + l.capital, 0);
  const ageMoyen = Math.round(lignes.reduce((s, l) => s + l.age, 0) / lignes.length);

  return {
    arreteAu: maintenant.toISOString().slice(0, 10),
    vehicules: lignes,
    tranches,
    total: {
      nombre: lignes.length,
      capital: capitalTotal,
      ageMoyen,
      plusVieux: lignes[0] ? { id: lignes[0].id, designation: lignes[0].designation, age: lignes[0].age } : null,
      // Part du capital bloquée au-delà de 90 jours : le chiffre qui décide
      // s'il faut brader ou patienter.
      capitalAuDela90: tranches
        .filter((t) => t.cle === '91-180' || t.cle === '180+')
        .reduce((s, t) => s + t.capital, 0),
      sansCout: lignes.filter((l) => l.capital === 0).length,
      sansPrixVente: lignes.filter((l) => l.prixVente == null).length,
    },
  };
}

module.exports = { EN_STOCK, TRANCHES, trancheDe, jours, ageDuStock };
