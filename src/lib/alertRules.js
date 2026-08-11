/**
 * Bibliothèque de règles d'alerte.
 *
 * Chaque règle répond à une défaillance réellement mesurée sur les classeurs :
 * coûts de revient incomplets, écarts entre registres, journées non saisies,
 * taux de change incohérents, véhicules dormants. Le moteur rejoue cet audit en
 * continu — c'est ce que personne ne peut faire en feuilletant un tableur.
 *
 * Un évaluateur reçoit ses paramètres et rend une liste de constats :
 *
 *   { entityType, entityId, title, detail, value }
 *
 * Il ne décide ni de la sévérité, ni des destinataires, ni de la diffusion :
 * tout cela appartient à la règle configurée par le client.
 */

const { prisma } = require('./prisma');
const { COST_NATURES } = require('./ledger');

const num = (v) => (v == null ? 0 : Number(v));
const daysBetween = (a, b) => Math.floor((a - b) / 86400000);

/* ── Stock ────────────────────────────────────────────────────────────────── */

async function vehiculeDormant({ jours = 60 } = {}) {
  const limite = new Date();
  limite.setDate(limite.getDate() - jours);

  const vehicules = await prisma.vehicle.findMany({
    where: { status: { in: ['DISPONIBLE', 'EN_VENTE'] }, createdAt: { lt: limite } },
    select: { id: true, vin: true, brand: true, model: true, year: true, createdAt: true },
    take: 200,
  });

  const now = new Date();
  return vehicules.map((v) => {
    const age = daysBetween(now, v.createdAt);
    return {
      entityType: 'Vehicle',
      entityId: v.id,
      title: `${[v.brand, v.model, v.year].filter(Boolean).join(' ')} immobilisé depuis ${age} jours`,
      detail: `VIN ${v.vin ?? '—'}. Capital bloqué au-delà du seuil de ${jours} jours.`,
      value: age,
    };
  });
}

async function vehiculeSansPrixVente() {
  const vehicules = await prisma.vehicle.findMany({
    where: { status: 'VENDU', OR: [{ priceSale: null }, { priceSale: 0 }] },
    select: { id: true, vin: true, brand: true, model: true },
    take: 200,
  });
  return vehicules.map((v) => ({
    entityType: 'Vehicle',
    entityId: v.id,
    title: `${[v.brand, v.model].filter(Boolean).join(' ')} vendu sans prix de vente`,
    detail: `VIN ${v.vin ?? '—'}. La marge de ce véhicule est incalculable.`,
    value: null,
  }));
}

/**
 * Véhicule dont le coût de revient ne contient aucune dépense d'atelier.
 * C'est le défaut le plus coûteux mesuré : 35 véhicules sur 57.
 */
async function coutDeRevientIncomplet() {
  const vehicules = await prisma.vehicle.findMany({
    where: { status: { not: 'EN_TRANSIT' } },
    select: { id: true, vin: true, brand: true, model: true },
    take: 300,
  });
  if (!vehicules.length) return [];

  const parNature = await prisma.ledgerEntry.groupBy({
    by: ['vehicleId', 'nature'],
    where: { vehicleId: { in: vehicules.map((v) => v.id) }, nature: { in: COST_NATURES } },
    _sum: { amountFcfa: true },
  });

  const natures = new Map();
  for (const row of parNature) {
    if (!natures.has(row.vehicleId)) natures.set(row.vehicleId, new Set());
    natures.get(row.vehicleId).add(row.nature);
  }

  return vehicules
    .filter((v) => {
      const n = natures.get(v.id);
      // Aucune écriture du tout, ou un achat sans aucune préparation.
      return !n || (!n.has('PREPARATION') && n.has('ACHAT'));
    })
    .map((v) => ({
      entityType: 'Vehicle',
      entityId: v.id,
      title: `Coût de revient incomplet — ${[v.brand, v.model].filter(Boolean).join(' ')}`,
      detail: `VIN ${v.vin ?? '—'}. Aucune dépense d'atelier rattachée : la marge est surévaluée.`,
      value: null,
    }));
}

/* ── Trésorerie ───────────────────────────────────────────────────────────── */

async function tresorerieBasse({ seuil = 500000 } = {}) {
  const comptes = await prisma.cashAccount.findMany({ where: { isActive: true } });
  const constats = [];

  for (const compte of comptes) {
    const agg = await prisma.ledgerEntry.aggregate({
      where: { cashAccountId: compte.id },
      _sum: { amountFcfa: true },
    });
    const solde = num(agg._sum.amountFcfa);
    if (solde < seuil) {
      constats.push({
        entityType: 'CashAccount',
        entityId: compte.id,
        title: `${compte.label} sous le seuil : ${Math.round(solde).toLocaleString('fr-FR')} FCFA`,
        detail: `Seuil d'alerte fixé à ${Math.round(seuil).toLocaleString('fr-FR')} FCFA.`,
        value: solde,
      });
    }
  }
  return constats;
}

/** Journée ouvrée sans aucun mouvement — le trou du 11 juin, détecté à temps. */
async function journeeNonSaisie({ jours = 7 } = {}) {
  const debut = new Date();
  debut.setUTCHours(0, 0, 0, 0);
  debut.setUTCDate(debut.getUTCDate() - jours);

  const entries = await prisma.ledgerEntry.findMany({
    where: { entryDate: { gte: debut }, cashAccountId: { not: null } },
    select: { entryDate: true },
  });
  const saisies = new Set(entries.map((e) => e.entryDate.toISOString().slice(0, 10)));

  const constats = [];
  for (let i = 1; i <= jours; i++) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    // Samedi et dimanche exclus : le journal observé ne couvre que l'ouvré.
    const jour = d.getUTCDay();
    if (jour === 0 || jour === 6) continue;

    const cle = d.toISOString().slice(0, 10);
    if (!saisies.has(cle)) {
      constats.push({
        entityType: 'Journee',
        entityId: Number(cle.replace(/-/g, '')),
        title: `Aucun mouvement saisi le ${d.toLocaleDateString('fr-FR')}`,
        detail: "Journée ouvrée sans écriture : oubli de saisie, ou journée réellement vide ?",
        value: null,
      });
    }
  }
  return constats;
}

/* ── Créances ─────────────────────────────────────────────────────────────── */

async function factureEchue({ jours = 15 } = {}) {
  const limite = new Date();
  limite.setDate(limite.getDate() - jours);

  const factures = await prisma.invoice.findMany({
    where: { dueDate: { lt: limite }, status: { notIn: ['PAYEE', 'ANNULEE'] } },
    select: {
      id: true, invoiceNumber: true, totalAmount: true, dueDate: true,
      client: { select: { name: true } },
      receipts: { select: { amount: true } },
    },
    take: 200,
  });

  const now = new Date();
  return factures
    .map((f) => {
      const paye = f.receipts.reduce((s, r) => s + num(r.amount), 0);
      const restant = num(f.totalAmount) - paye;
      if (restant <= 0) return null;
      const retard = daysBetween(now, f.dueDate);
      return {
        entityType: 'Invoice',
        entityId: f.id,
        title: `${f.invoiceNumber ?? `Facture ${f.id}`} échue depuis ${retard} jours`,
        detail: `${f.client?.name ?? 'Client inconnu'} — reste ${Math.round(restant).toLocaleString('fr-FR')} FCFA.`,
        value: restant,
      };
    })
    .filter(Boolean);
}

/* ── Cohérence ────────────────────────────────────────────────────────────── */

/** Dépense d'atelier sans véhicule : elle échappe au coût de revient. */
async function depenseNonRattachee() {
  const entries = await prisma.ledgerEntry.findMany({
    where: { nature: 'CHARGE', vehicleId: null, amountFcfa: { lt: -200000 } },
    orderBy: { id: 'desc' },
    take: 100,
  });
  return entries.map((e) => ({
    entityType: 'LedgerEntry',
    entityId: Number(e.id),
    title: `Dépense importante non imputée : ${e.label}`,
    detail: `${Math.abs(num(e.amountFcfa)).toLocaleString('fr-FR')} FCFA classés en charge générale, sans véhicule.`,
    value: Math.abs(num(e.amountFcfa)),
  }));
}

/** Facture émise sans pièce fiscale rattachée. */
async function pieceFiscaleManquante() {
  const [factures, pieces] = await Promise.all([
    prisma.invoice.findMany({
      select: { id: true, invoiceNumber: true, totalAmount: true },
      orderBy: { id: 'desc' },
      take: 300,
    }),
    prisma.upload.findMany({
      where: { kind: 'FACTURE_NORMALISEE', resource: 'invoices' },
      select: { resourceId: true },
    }),
  ]);
  const avec = new Set(pieces.map((p) => p.resourceId));
  return factures
    .filter((f) => !avec.has(f.id))
    .map((f) => ({
      entityType: 'Invoice',
      entityId: f.id,
      title: `${f.invoiceNumber ?? `Facture ${f.id}`} sans pièce fiscale`,
      detail: `${Math.round(num(f.totalAmount)).toLocaleString('fr-FR')} FCFA facturés, aucune facture normalisée déposée.`,
      value: num(f.totalAmount),
    }));
}

/** Écritures d'un même conteneur converties à des taux différents. */
async function tauxIncoherent() {
  const entries = await prisma.ledgerEntry.findMany({
    where: { purchaseId: { not: null }, currency: { not: 'FCFA' } },
    select: { purchaseId: true, rateApplied: true, currency: true },
  });

  const parAchat = new Map();
  for (const e of entries) {
    const cle = `${e.purchaseId}:${e.currency}`;
    if (!parAchat.has(cle)) parAchat.set(cle, new Set());
    parAchat.get(cle).add(num(e.rateApplied));
  }

  return [...parAchat.entries()]
    .filter(([, taux]) => taux.size > 1)
    .map(([cle, taux]) => {
      const [purchaseId, devise] = cle.split(':');
      return {
        entityType: 'Purchase',
        entityId: Number(purchaseId),
        title: `Taux ${devise} multiples sur un même dossier`,
        detail: `Taux appliqués : ${[...taux].join(', ')}. Le total du conteneur et la somme des véhicules ne se réconcilient pas.`,
        value: taux.size,
      };
    });
}

/* ── Registre ─────────────────────────────────────────────────────────────── */

const RULES = {
  VEHICULE_DORMANT: {
    label: 'Véhicule immobilisé trop longtemps',
    severity: 'ALERTE',
    params: { jours: 60 },
    run: vehiculeDormant,
  },
  VEHICULE_SANS_PRIX: {
    label: 'Véhicule vendu sans prix de vente',
    severity: 'CRITIQUE',
    params: {},
    run: vehiculeSansPrixVente,
  },
  COUT_INCOMPLET: {
    label: 'Coût de revient incomplet',
    severity: 'CRITIQUE',
    params: {},
    run: coutDeRevientIncomplet,
  },
  TRESORERIE_BASSE: {
    label: 'Solde de trésorerie sous le seuil',
    severity: 'CRITIQUE',
    params: { seuil: 500000 },
    run: tresorerieBasse,
  },
  JOURNEE_NON_SAISIE: {
    label: 'Journée ouvrée sans écriture',
    severity: 'ALERTE',
    params: { jours: 7 },
    run: journeeNonSaisie,
  },
  FACTURE_ECHUE: {
    label: 'Facture échue non réglée',
    severity: 'ALERTE',
    params: { jours: 15 },
    run: factureEchue,
  },
  DEPENSE_NON_RATTACHEE: {
    label: 'Dépense importante non imputée à un véhicule',
    severity: 'ALERTE',
    params: {},
    run: depenseNonRattachee,
  },
  PIECE_FISCALE_MANQUANTE: {
    label: 'Facture sans pièce fiscale rattachée',
    severity: 'ALERTE',
    params: {},
    run: pieceFiscaleManquante,
  },
  TAUX_INCOHERENT: {
    label: 'Taux de change multiples sur un même dossier',
    severity: 'CRITIQUE',
    params: {},
    run: tauxIncoherent,
  },
};

module.exports = { RULES, RULE_CODES: Object.keys(RULES) };
