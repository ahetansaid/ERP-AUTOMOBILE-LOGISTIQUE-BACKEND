const express = require('express');
const { prisma } = require('../lib/prisma');
const { authorize } = require('../middleware/rbac');
const { NON_ARCHIVES } = require('../lib/archive');

const router = express.Router();

function parseRange(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 30 * 24 * 3600_000);
  return { from, to };
}

// GET /reports — index historique (table generated_reports)
router.get('/', authorize('reports', 'read'), async (req, res) => {
  try {
    const rows = await prisma.generatedReport.findMany({
      where: req.tenantWhere(),
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.status(200).json({ reports: rows, data: rows });
  } catch (err) {
    console.error('[reports.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * GET /reports/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Compte de résultat simplifié : recettes (factures payées via receipts) − charges + décaissements d'achats.
 */
router.get('/pnl', authorize('reports', 'read'), async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const where = req.tenantWhere();

    const [receipts, charges, purchases] = await Promise.all([
      prisma.receipt.findMany({
        where: {
          ...where,
          paymentDate: { gte: from, lte: to },
        },
        select: { amount: true, paymentDate: true, invoiceId: true, workshopQuoteId: true },
      }),
      prisma.charge.findMany({
        where: {
          ...where,
          chargeDate: { gte: from, lte: to },
          deletedAt: null,
        },
        select: { amount: true, category: true, chargeDate: true },
      }),
      prisma.purchase.findMany({
        where: {
          ...where,
          purchaseDate: { gte: from, lte: to },
        },
        select: {
          id: true,
          purchaseDate: true,
          purchaseVehicles: {
            include: {
              vehicle: {
                select: { purchasePriceFcfa: true, purchasePrice: true, transportFees: true },
              },
            },
          },
        },
      }),
    ]);

    // Revenus : somme des paiements reçus (ENCAISSEMENT)
    let revenueInvoices = 0;
    let revenueWorkshop = 0;
    for (const r of receipts) {
      const amt = Number(r.amount) || 0;
      if (r.workshopQuoteId) revenueWorkshop += amt;
      else revenueInvoices += amt;
    }
    const revenue = revenueInvoices + revenueWorkshop;

    // Charges (administratives, réparation, transport, carburant, etc.)
    const byCategory = {};
    let totalCharges = 0;
    for (const c of charges) {
      const amt = Number(c.amount) || 0;
      const cat = c.category || 'AUTRES';
      byCategory[cat] = (byCategory[cat] || 0) + amt;
      totalCharges += amt;
    }

    // COGS estimé : somme des prix d'achat FCFA + transport des véhicules achetés dans la période
    let cogs = 0;
    for (const p of purchases) {
      for (const pv of p.purchaseVehicles) {
        const v = pv.vehicle;
        if (!v) continue;
        const ppf = v.purchasePriceFcfa != null ? Number(v.purchasePriceFcfa) : Number(v.purchasePrice) || 0;
        const tf = Number(v.transportFees) || 0;
        cogs += ppf + tf;
      }
    }

    const grossMargin = revenue - cogs;
    const netResult = grossMargin - totalCharges;

    return res.status(200).json({
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      revenue: {
        total: revenue,
        invoices: revenueInvoices,
        workshop: revenueWorkshop,
      },
      cogs: { total: cogs, count: purchases.length },
      charges: { total: totalCharges, byCategory },
      grossMargin,
      netResult,
      currency: 'FCFA',
    });
  } catch (err) {
    console.error('[reports.pnl]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * GET /reports/aging
 * Balance âgée clients : factures non soldées groupées par tranche d'antériorité.
 * Buckets : à venir, 0-30, 31-60, 61-90, >90
 */
router.get('/aging', authorize('reports', 'read'), async (req, res) => {
  try {
    const where = req.tenantWhere();
    const invoices = await prisma.invoice.findMany({
      where: {
        ...where,
        status: { notIn: ['PAYEE', 'ANNULEE'] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        dueDate: true,
        createdAt: true,
        client: { select: { id: true, name: true } },
        receipts: { select: { amount: true } },
      },
      take: 1000,
    });

    const now = new Date();
    const buckets = { upcoming: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 };
    const byClient = {};
    const rows = [];

    for (const inv of invoices) {
      const paid = inv.receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
      const balance = Math.max(0, Number(inv.totalAmount || 0) - paid);
      if (balance <= 0) continue;

      const ref = inv.dueDate || inv.createdAt;
      const daysLate = Math.floor((now - new Date(ref)) / (24 * 3600_000));

      let bucket;
      if (daysLate < 0) bucket = 'upcoming';
      else if (daysLate <= 30) bucket = 'b0_30';
      else if (daysLate <= 60) bucket = 'b31_60';
      else if (daysLate <= 90) bucket = 'b61_90';
      else bucket = 'b90plus';

      buckets[bucket] += balance;

      const clientId = inv.client?.id ?? 0;
      if (!byClient[clientId]) {
        byClient[clientId] = {
          clientId,
          clientName: inv.client?.name ?? '—',
          total: 0,
          upcoming: 0,
          b0_30: 0,
          b31_60: 0,
          b61_90: 0,
          b90plus: 0,
        };
      }
      byClient[clientId].total += balance;
      byClient[clientId][bucket] += balance;

      rows.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.client?.name ?? '—',
        dueDate: inv.dueDate,
        daysLate,
        bucket,
        balance,
      });
    }

    const clients = Object.values(byClient).sort((a, b) => b.total - a.total);

    return res.status(200).json({
      buckets,
      total: Object.values(buckets).reduce((s, n) => s + n, 0),
      clients,
      rows: rows.sort((a, b) => b.daysLate - a.daysLate),
      currency: 'FCFA',
    });
  } catch (err) {
    console.error('[reports.aging]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * GET /reports/stock-value
 * Valeur du stock par statut (DISPONIBLE, EN_MAINTENANCE, EN_TRANSIT, EN_VENTE).
 */
router.get('/stock-value', authorize('reports', 'read'), async (req, res) => {
  try {
    const where = req.tenantWhere();
    const vehicles = await prisma.vehicle.findMany({
      where: {
        ...where,
        ...NON_ARCHIVES,
        status: { in: ['DISPONIBLE', 'EN_MAINTENANCE', 'EN_TRANSIT', 'EN_VENTE', 'RESERVE'] },
      },
      select: {
        id: true,
        status: true,
        purchasePriceFcfa: true,
        purchasePrice: true,
        transportFees: true,
        priceSale: true,
      },
    });

    const byStatus = {};
    let totalCost = 0;
    let totalSale = 0;

    for (const v of vehicles) {
      const cost =
        (v.purchasePriceFcfa != null ? Number(v.purchasePriceFcfa) : Number(v.purchasePrice) || 0) +
        (Number(v.transportFees) || 0);
      const sale = Number(v.priceSale) || 0;
      const s = v.status;
      if (!byStatus[s]) byStatus[s] = { count: 0, cost: 0, sale: 0 };
      byStatus[s].count += 1;
      byStatus[s].cost += cost;
      byStatus[s].sale += sale;
      totalCost += cost;
      totalSale += sale;
    }

    return res.status(200).json({
      total: vehicles.length,
      totalCost,
      totalSale,
      unrealizedMargin: totalSale - totalCost,
      byStatus,
      currency: 'FCFA',
    });
  } catch (err) {
    console.error('[reports.stockValue]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
