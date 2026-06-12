const express = require('express');
const { prisma } = require('../lib/prisma');
const router = express.Router();

// Borne basse de période (équivalent des filtres MySQL DATE_SUB / DATE_FORMAT).
function periodSince(period) {
  const p = (period || '').toLowerCase();
  const now = new Date();
  if (p === 'week' || p === 'hebdo') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (p === 'month' || p === 'mensuel') {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (p === 'year' || p === 'annuel') {
    return new Date(now.getFullYear(), 0, 1);
  }
  return null;
}

function ym(date) {
  const d = new Date(date);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

router.get('/', async (req, res) => {
  try {
    const companyId = req.query.companyId ? Number(req.query.companyId) : req.user?.companyId;
    const period = req.query.period || req.query.periode || '';
    const since = periodSince(period);

    const baseWhere = {
      ...(companyId ? { companyId } : {}),
      ...(since ? { transactionDate: { gte: since } } : {}),
    };

    const [encAgg, decAgg, catRows, txnRows] = await Promise.all([
      prisma.treasuryTransaction.aggregate({
        _sum: { montant: true },
        where: { ...baseWhere, type: 'ENCAISSEMENT' },
      }),
      prisma.treasuryTransaction.aggregate({
        _sum: { montant: true },
        where: { ...baseWhere, type: 'DECAISSEMENT' },
      }),
      prisma.treasuryTransaction.groupBy({
        by: ['categorie'],
        _sum: { montant: true },
        where: { ...baseWhere, type: 'DECAISSEMENT' },
      }),
      prisma.treasuryTransaction.findMany({
        where: baseWhere,
        orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
    ]);

    const total_entrees = Number(encAgg._sum.montant ?? 0);
    const total_sorties = Number(decAgg._sum.montant ?? 0);
    const solde = total_entrees - total_sorties;

    const byCategory = {};
    for (const row of catRows) {
      byCategory[row.categorie || 'Autres'] = Number(row._sum.montant ?? 0);
    }

    const transactions = txnRows.map((row) => ({
      id: row.id,
      type: row.type === 'ENCAISSEMENT' ? 'encaissement' : 'decaissement',
      categorie: row.categorie,
      reference: row.reference,
      amount: row.type === 'ENCAISSEMENT' ? Number(row.montant) : -Number(row.montant),
      date: row.transactionDate,
      vehicle_id: row.vehicleId,
      description: row.description,
      receipt_id: row.receiptId,
      purchase_id: row.purchaseId,
      workshop_quote_id: row.workshopQuoteId,
      charge_id: row.chargeId,
    }));

    let by_month = [];
    if (!period || period === '') {
      const since12 = new Date();
      since12.setHours(0, 0, 0, 0);
      since12.setMonth(since12.getMonth() - 12);
      const monthRows = await prisma.treasuryTransaction.findMany({
        where: {
          ...(companyId ? { companyId } : {}),
          transactionDate: { gte: since12 },
        },
        select: { montant: true, type: true, transactionDate: true },
      });
      const acc = {};
      for (const r of monthRows) {
        const mois = ym(r.transactionDate);
        acc[mois] ||= { encaissements: 0, decaissements: 0 };
        if (r.type === 'ENCAISSEMENT') acc[mois].encaissements += Number(r.montant) || 0;
        else acc[mois].decaissements += Number(r.montant) || 0;
      }
      by_month = Object.entries(acc)
        .map(([mois, v]) => ({
          mois,
          encaissements: v.encaissements,
          decaissements: v.decaissements,
          resultat: v.encaissements - v.decaissements,
        }))
        .sort((a, b) => (a.mois < b.mois ? 1 : a.mois > b.mois ? -1 : 0))
        .slice(0, 12);
    }

    return res.status(200).json({
      total_entrees,
      total_sorties,
      solde,
      benefice: solde,
      by_category: byCategory,
      transactions,
      by_month,
      pagination: {},
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
