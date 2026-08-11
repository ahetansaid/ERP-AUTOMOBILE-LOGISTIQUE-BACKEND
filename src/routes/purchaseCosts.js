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

module.exports = router;
