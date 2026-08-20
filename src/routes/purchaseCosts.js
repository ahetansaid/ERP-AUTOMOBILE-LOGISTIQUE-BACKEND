/**
 * Frais de conteneur et leur répartition.
 *
 * Monté sur /frais-conteneur. La saisie du frais et sa ventilation sont deux
 * gestes distincts : on enregistre ce qui a été engagé, puis on décide comment
 * il se répartit. La règle choisie est conservée et rejouable.
 */

const express = require('express');
const { prisma } = require('../lib/prisma');
const { resolveRate } = require('../lib/ledger');
const {
  allocate, unallocate, reallocatePurchase, computeShares, LABELS,
} = require('../lib/allocation');
const { authorize } = require('../middleware/rbac');
const { monterImportExport } = require('../lib/importExport');
const { montant: lireMontant, date: lireDate } = require('../lib/importCaisse');

const router = express.Router();

const TYPES = [
  'FRET', 'TRANSPORT_INTERNE', 'COMMISSION', 'DEPOTAGE',
  'MAIN_OEUVRE', 'FRAIS_CONNEXE', 'IMV', 'DOUANE', 'AUTRE',
];
const MODES = ['PAR_VEHICULE', 'PRORATA_VALEUR', 'PRORATA_POIDS', 'MONTANT_FIXE'];

const serialize = (c) => ({
  id: c.id,
  purchase_id: c.purchaseId,
  type: c.type,
  libelle: c.label || LABELS[c.type],
  montant: Number(c.amount),
  devise: c.currency,
  taux: c.rateApplied != null ? Number(c.rateApplied) : null,
  montant_fcfa: Number(c.amountFcfa),
  repartition: c.allocation,
  detail: c.allocationDetail,
  date: c.costDate,
  ventile_le: c.allocatedAt,
});

// GET /frais-conteneur?purchaseId=8
router.get('/', authorize('purchases', 'read'), async (req, res) => {
  try {
    const where = {};
    if (req.query.purchaseId) where.purchaseId = Number(req.query.purchaseId);

    const costs = await prisma.purchaseCost.findMany({
      where,
      orderBy: [{ purchaseId: 'desc' }, { id: 'asc' }],
      take: 300,
    });
    const total = costs.reduce((s, c) => s + Number(c.amountFcfa), 0);
    return res.status(200).json({ frais: costs.map(serialize), total_fcfa: total });
  } catch (err) {
    console.error('[frais.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * GET /frais-conteneur/simulation — prévisualise une répartition.
 * Aucune écriture n'est produite : c'est ce qui permet de comparer deux clés
 * avant de trancher.
 */
router.get('/simulation', authorize('purchases', 'read'), async (req, res) => {
  try {
    const purchaseId = Number(req.query.purchaseId);
    const montant = Number(req.query.montant);
    const mode = String(req.query.mode || 'PAR_VEHICULE').toUpperCase();
    if (!Number.isInteger(purchaseId) || !Number.isFinite(montant)) {
      return res.status(400).json({ message: 'purchaseId et montant requis', statusCode: 400 });
    }
    if (!MODES.includes(mode)) {
      return res.status(400).json({ message: `Mode inconnu : ${mode}`, statusCode: 400 });
    }

    const links = await prisma.purchaseVehicle.findMany({
      where: { purchaseId },
      include: {
        vehicle: {
          select: {
            id: true, vin: true, brand: true, model: true,
            purchasePrice: true, purchasePriceFcfa: true, weightKg: true,
          },
        },
      },
    });
    const vehicles = links.map((l) => l.vehicle);
    const parts = computeShares(montant, vehicles, mode, null);
    const parId = new Map(parts.map((p) => [p.vehicleId, p.part]));

    return res.status(200).json({
      mode,
      montant,
      // On expose la clé utilisée : sans elle, l'utilisateur ne peut pas juger
      // si la répartition est légitime.
      lignes: vehicles.map((v) => ({
        vehicle_id: v.id,
        vin: v.vin,
        vehicule: [v.brand, v.model].filter(Boolean).join(' '),
        poids_kg: v.weightKg,
        valeur: v.purchasePriceFcfa != null ? Number(v.purchasePriceFcfa) : null,
        part: parId.get(v.id) ?? 0,
      })),
      total_reparti: parts.reduce((s, p) => s + p.part, 0),
    });
  } catch (err) {
    console.error('[frais.simulation]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /frais-conteneur
router.post('/', authorize('purchases', 'create'), async (req, res) => {
  try {
    const b = req.body || {};
    const type = String(b.type || '').toUpperCase();
    if (!TYPES.includes(type)) {
      return res.status(400).json({
        message: `Type inconnu : ${type}. Valeurs : ${TYPES.join(', ')}`,
        statusCode: 400,
      });
    }
    const mode = String(b.repartition || 'PAR_VEHICULE').toUpperCase();
    if (!MODES.includes(mode)) {
      return res.status(400).json({ message: `Mode inconnu : ${mode}`, statusCode: 400 });
    }
    const purchaseId = Number(b.purchaseId);
    const montant = Number(b.montant);
    if (!Number.isInteger(purchaseId) || !Number.isFinite(montant) || montant <= 0) {
      return res.status(400).json({
        message: 'purchaseId et montant (> 0) requis',
        statusCode: 400,
      });
    }

    const purchase = await prisma.purchase.findFirst({ where: { id: purchaseId } });
    if (!purchase) {
      return res.status(404).json({ message: 'Dossier introuvable', statusCode: 404 });
    }

    const costDate = b.date ? new Date(b.date) : new Date();
    if (Number.isNaN(costDate.getTime())) {
      return res.status(400).json({ message: 'Date invalide', statusCode: 400 });
    }

    const currency = String(b.devise || 'FCFA').toUpperCase();
    const rate = await resolveRate(currency, b.taux, costDate);

    const created = await prisma.purchaseCost.create({
      data: {
        purchaseId,
        type,
        label: b.libelle ? String(b.libelle).slice(0, 255) : null,
        amount: montant,
        currency,
        rateApplied: rate,
        amountFcfa: montant * rate,
        allocation: mode,
        allocationDetail: b.detail ?? null,
        costDate,
      },
    });

    // Ventilation immédiate : un frais saisi mais non réparti n'entrerait pas
    // dans le coût de revient — exactement le défaut qu'on corrige.
    const repartition = await allocate(created.id);
    return res.status(201).json({ ...serialize(created), repartition });
  } catch (err) {
    if (/^\[(ledger|allocation)\]/.test(String(err.message || ''))) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[frais.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /frais-conteneur/:id/repartir — rejoue la ventilation
router.post('/:id/repartir', authorize('purchases', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const mode = req.body?.repartition
      ? String(req.body.repartition).toUpperCase()
      : null;

    if (mode) {
      if (!MODES.includes(mode)) {
        return res.status(400).json({ message: `Mode inconnu : ${mode}`, statusCode: 400 });
      }
      await prisma.purchaseCost.update({
        where: { id },
        data: { allocation: mode, allocationDetail: req.body?.detail ?? null },
      });
    }
    return res.status(200).json(await allocate(id));
  } catch (err) {
    if (/^\[(ledger|allocation)\]/.test(String(err.message || ''))) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[frais.repartir]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /frais-conteneur/:id/annuler — contre-passe sans reposer
router.post('/:id/annuler', authorize('purchases', 'update'), async (req, res) => {
  try {
    return res.status(200).json(await unallocate(req.params.id));
  } catch (err) {
    console.error('[frais.annuler]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * POST /frais-conteneur/dossier/:purchaseId/rejouer
 * À lancer après ajout ou retrait d'un véhicule : toutes les clés changent.
 */
router.post('/dossier/:purchaseId/rejouer', authorize('purchases', 'update'), async (req, res) => {
  try {
    return res.status(200).json({ resultats: await reallocatePurchase(req.params.purchaseId) });
  } catch (err) {
    if (/^\[(ledger|allocation)\]/.test(String(err.message || ''))) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[frais.rejouer]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/* ── Export et import en masse ─────────────────────────────────────────────
 *
 * Un conteneur arrive avec ses frais : fret, dépotage, main d'œuvre, commission.
 * Les saisir un par un pour quinze conteneurs est le genre de tâche qu'on
 * repousse — et des frais non saisis sont un coût de revient faux.
 *
 * Le frais est créé NON VENTILÉ. La répartition reste un geste explicite
 * (POST /:id/repartir) : elle écrit au grand livre, et ce qui écrit au grand
 * livre ne se déclenche pas par effet de bord d'un import.
 */

const COLONNES_FRAIS = ['conteneur', 'type', 'libelle', 'montant', 'devise', 'taux', 'date', 'repartition'];

async function preparerFrais(lignes, tenantWhere) {
  const refus = [];
  const valides = [];

  const refs = [...new Set(lignes.map((l) => String(l.conteneur || '').trim()).filter(Boolean))];
  const conteneurs = new Map(
    (
      await prisma.purchase.findMany({
        where: { ...tenantWhere, containerReference: { in: refs } },
        select: { id: true, containerReference: true },
      })
    ).map((p) => [p.containerReference, p.id])
  );

  for (const l of lignes) {
    const erreurs = [];

    const ref = String(l.conteneur || '').trim();
    const purchaseId = ref ? conteneurs.get(ref) ?? null : null;
    if (!ref) erreurs.push('conteneur absent');
    else if (!purchaseId) erreurs.push(`conteneur « ${ref} » introuvable — créez-le d'abord`);

    const type = String(l.type || '').trim().toUpperCase();
    if (!type) erreurs.push('type absent');
    else if (!TYPES.includes(type)) {
      erreurs.push(`type inconnu : « ${l.type} ». Valeurs : ${TYPES.join(', ')}`);
    }

    const mode = String(l.repartition || 'PAR_VEHICULE').trim().toUpperCase();
    if (!MODES.includes(mode)) {
      erreurs.push(`répartition inconnue : « ${l.repartition} ». Valeurs : ${MODES.join(', ')}`);
    }

    const m = lireMontant(l.montant);
    if (m === null) erreurs.push('montant absent');
    else if (Number.isNaN(m)) erreurs.push(`montant illisible : « ${l.montant} »`);
    else if (m <= 0) erreurs.push('montant nul ou négatif — un frais est une dépense positive');

    const devise = (String(l.devise || 'FCFA').trim().toUpperCase()) || 'FCFA';
    const taux = lireMontant(l.taux);
    if (Number.isNaN(taux)) erreurs.push(`taux illisible : « ${l.taux} »`);
    // Une devise étrangère sans taux ne peut pas être convertie, et deviner
    // reviendrait à inventer un coût de revient.
    if (devise !== 'FCFA' && devise !== 'XOF' && devise !== 'EUR' && !taux) {
      erreurs.push(`taux requis pour la devise ${devise}`);
    }

    const d = lireDate(l.date);
    if (d !== null && Number.isNaN(d)) {
      erreurs.push(`date illisible : « ${l.date} » (JJ/MM/AAAA attendu)`);
    }

    if (erreurs.length) {
      refus.push({ ligne: l.__ligne, conteneur: ref || null, erreurs });
      continue;
    }

    valides.push({
      ligne: l.__ligne,
      apercu: { conteneur: ref, type, montant: m, devise, repartition: mode },
      corps: {
        purchaseId,
        type,
        libelle: String(l.libelle || '').trim() || null,
        montant: m,
        devise,
        taux: taux || null,
        date: d || undefined,
        repartition: mode,
      },
    });
  }

  return { valides, refus };
}

async function ecrireFrais(valides, req) {
  const crees = [];
  for (const v of valides) {
    const c = v.corps;
    const cout = await prisma.purchaseCost.create({
      data: {
        purchaseId: c.purchaseId,
        type: c.type,
        label: c.libelle,
        amount: c.montant,
        currency: c.devise,
        rateApplied: c.taux,
        amountFcfa: c.devise === 'FCFA' || c.devise === 'XOF'
          ? c.montant
          : c.montant * (c.taux || 1),
        allocation: c.repartition,
        costDate: c.date ?? new Date(),
      },
    });
    if (req?.audit) {
      req.audit({ action: 'CREATE', resource: 'purchase_costs', resourceId: cout.id, before: null, after: cout });
    }
    crees.push({ ligne: v.ligne, id: cout.id, conteneur: v.apercu.conteneur });
  }
  return crees;
}

async function exporterFrais(req) {
  const rows = await prisma.purchaseCost.findMany({
    where: { ...req.tenantWhere() },
    include: { purchase: true },
    orderBy: { id: 'asc' },
    take: 10000,
  });
  return rows.map((c) => ({
    conteneur: c.purchase?.containerReference ?? '',
    type: c.type,
    libelle: c.label ?? '',
    montant: Number(c.amount),
    devise: c.currency,
    taux: c.rateApplied != null ? Number(c.rateApplied) : '',
    date: c.costDate ? c.costDate.toISOString().slice(0, 10) : '',
    repartition: c.allocation,
  }));
}

monterImportExport(router, {
  authorize,
  module: 'purchases',
  nom: 'frais-conteneur',
  colonnes: COLONNES_FRAIS,
  obligatoires: ['conteneur', 'type', 'montant'],
  exporter: exporterFrais,
  preparer: preparerFrais,
  ecrire: ecrireFrais,
});

module.exports = router;
