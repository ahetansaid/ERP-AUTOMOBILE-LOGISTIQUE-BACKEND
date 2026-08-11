/**
 * Routes du grand livre.
 *
 * Le journal est en écriture seule : pas de PUT, pas de DELETE. La seule façon
 * de corriger est POST /ledger/:id/reverse, qui produit l'écriture inverse et
 * conserve l'originale.
 */

const express = require('express');
const { prisma } = require('../lib/prisma');
const { postEntry, reverseEntry } = require('../lib/ledger');
const {
  vehicleCost, allCashBalances, profitAndLoss,
} = require('../lib/costing');
const { reconcile } = require('../lib/reconciliation');
const { ensureDefaults } = require('../lib/defaults');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const serialize = (e) => ({
  id: Number(e.id),
  entry_date: e.entryDate,
  nature: e.nature,
  label: e.label,
  amount: Number(e.amount),
  currency: e.currency,
  rate_applied: e.rateApplied != null ? Number(e.rateApplied) : null,
  amount_fcfa: Number(e.amountFcfa),
  vehicle_id: e.vehicleId,
  cash_account_id: e.cashAccountId,
  category_id: e.categoryId,
  reverses_id: e.reversesId != null ? Number(e.reversesId) : null,
  reversal_note: e.reversalNote ?? null,
  correlation_id: e.correlationId ?? null,
  created_at: e.createdAt,
});

// GET /ledger — journal filtrable
router.get('/', authorize('treasury', 'read'), async (req, res) => {
  try {
    const where = {};
    if (req.query.vehicleId) where.vehicleId = Number(req.query.vehicleId);
    if (req.query.cashAccountId) where.cashAccountId = Number(req.query.cashAccountId);
    if (req.query.nature) where.nature = String(req.query.nature).toUpperCase();
    if (req.query.from || req.query.to) {
      where.entryDate = {};
      if (req.query.from) where.entryDate.gte = new Date(String(req.query.from));
      if (req.query.to) where.entryDate.lte = new Date(String(req.query.to));
    }

    const take = Math.min(Number(req.query.limit) || 200, 1000);
    const entries = await prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      take,
    });
    const agg = await prisma.ledgerEntry.aggregate({
      where,
      _sum: { amountFcfa: true },
      _count: { _all: true },
    });

    return res.status(200).json({
      entries: entries.map(serialize),
      total: agg._count._all,
      sum_fcfa: agg._sum.amountFcfa != null ? Number(agg._sum.amountFcfa) : 0,
    });
  } catch (err) {
    console.error('[ledger.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /ledger — saisie manuelle
router.post('/', authorize('treasury', 'create'), async (req, res) => {
  try {
    const created = await postEntry(req.body || {});
    return res.status(201).json(serialize(created));
  } catch (err) {
    // Les garde-fous du service (nature sans véhicule, montant nul, taux
    // manquant) sont des erreurs de saisie : 400, pas 500.
    if (String(err.message || '').startsWith('[ledger]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[ledger.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /ledger/:id/reverse — contre-passation
router.post('/:id/reverse', authorize('treasury', 'update'), async (req, res) => {
  try {
    const created = await reverseEntry(req.params.id, req.body?.note);
    return res.status(201).json(serialize(created));
  } catch (err) {
    if (String(err.message || '').startsWith('[ledger]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[ledger.reverse]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /ledger/vehicle/:id/cost — coût de revient décomposé
router.get('/vehicle/:id/cost', authorize('vehicles', 'read'), async (req, res) => {
  try {
    return res.status(200).json(await vehicleCost(req.params.id));
  } catch (err) {
    console.error('[ledger.vehicleCost]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /ledger/balances — soldes de trésorerie, calculés
router.get('/balances', authorize('treasury', 'read'), async (req, res) => {
  try {
    return res.status(200).json(await allCashBalances(req.query.asOf));
  } catch (err) {
    console.error('[ledger.balances]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * GET /ledger/reconciliation — ancien registre contre grand livre
 *
 * Rapport de la période de double écriture. Tant que `concordant` est faux,
 * l'ancienne table reste la référence et la coupure n'est pas autorisée.
 */
router.get('/reconciliation', authorize('reports', 'read'), async (req, res) => {
  try {
    return res.status(200).json(await reconcile(req.query.from, req.query.to));
  } catch (err) {
    console.error('[ledger.reconciliation]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /ledger/resultat — compte de résultat, hors mouvements de bilan
router.get('/resultat', authorize('reports', 'read'), async (req, res) => {
  try {
    return res.status(200).json(await profitAndLoss(req.query.from, req.query.to));
  } catch (err) {
    console.error('[ledger.pnl]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// --------------------------------------------------------------------------
// Référentiels : comptes de trésorerie et catégories
// --------------------------------------------------------------------------

router.get('/cash-accounts', authorize('treasury', 'read'), async (req, res) => {
  try {
    const rows = await prisma.cashAccount.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return res.status(200).json({ accounts: rows });
  } catch (err) {
    console.error('[ledger.accounts]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/cash-accounts', authorize('settings', 'update'), async (req, res) => {
  try {
    const { label, nature, currency } = req.body || {};
    if (!label || !String(label).trim()) {
      return res.status(400).json({ message: 'Libellé requis', statusCode: 400 });
    }
    const created = await prisma.cashAccount.create({
      data: {
        label: String(label).trim().slice(0, 120),
        nature: nature || 'CAISSE',
        currency: (currency || 'FCFA').toUpperCase().slice(0, 10),
      },
    });
    return res.status(201).json(created);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Ce compte existe déjà', statusCode: 409 });
    }
    console.error('[ledger.accounts.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /ledger/defaults — installe le preset métier pour la société courante
router.post('/defaults', authorize('settings', 'update'), async (req, res) => {
  try {
    return res.status(200).json(await ensureDefaults());
  } catch (err) {
    console.error('[ledger.defaults]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.get('/categories', authorize('settings', 'read'), async (req, res) => {
  try {
    const rows = await prisma.costCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return res.status(200).json({ categories: rows });
  } catch (err) {
    console.error('[ledger.categories]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/categories', authorize('settings', 'update'), async (req, res) => {
  try {
    const { label, nature } = req.body || {};
    if (!label || !nature) {
      return res
        .status(400)
        .json({ message: 'Libellé et nature requis', statusCode: 400 });
    }
    // La nature est validée par l'enum Prisma : un libellé libre ne peut pas
    // introduire une catégorie que le calcul ne saurait pas classer.
    const created = await prisma.costCategory.create({
      data: { label: String(label).trim().slice(0, 120), nature },
    });
    return res.status(201).json(created);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Cette catégorie existe déjà', statusCode: 409 });
    }
    if (err.code === 'P2003' || String(err.message).includes('Invalid value')) {
      return res.status(400).json({ message: 'Nature invalide', statusCode: 400 });
    }
    console.error('[ledger.categories.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
