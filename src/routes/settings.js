const express = require('express');
const { prisma } = require('../lib/prisma');
const router = express.Router();

router.get('/rates', async (req, res) => {
  try {
    const companyId = req.query.companyId || req.user?.companyId;
    try {
      const rows = await prisma.exchangeRate.findMany({
        where: {
          isActive: true,
          ...(companyId ? { companyId: Number(companyId) } : {}),
        },
        select: { currency: true, rateFcfa: true },
      });
      const rates = {};
      rows.forEach((r) => {
        rates[r.currency] = Number(r.rateFcfa);
      });
      return res.status(200).json({ rates });
    } catch (e) {
      return res.status(200).json({ rates: { USD: 600, EUR: 655 } });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.put('/rates', async (req, res) => {
  try {
    const { USD, EUR } = req.body || {};
    const companyId = req.body.companyId || req.user?.companyId;
    const companyWhere = companyId ? { companyId: Number(companyId) } : {};
    try {
      if (USD != null) {
        await prisma.exchangeRate.updateMany({
          where: { currency: 'USD', ...companyWhere },
          data: { rateFcfa: USD, isActive: true },
        });
      }
      if (EUR != null) {
        await prisma.exchangeRate.updateMany({
          where: { currency: 'EUR', ...companyWhere },
          data: { rateFcfa: EUR, isActive: true },
        });
      }
    } catch (e) {}

    let rows = [];
    try {
      rows = await prisma.exchangeRate.findMany({
        where: { isActive: true },
        select: { currency: true, rateFcfa: true },
      });
    } catch (e) {
      rows = [];
    }
    const rates = {};
    rows.forEach((r) => { rates[r.currency] = Number(r.rateFcfa); });
    if (Object.keys(rates).length === 0) return res.status(200).json({ rates: { USD: USD ?? 600, EUR: EUR ?? 655 } });
    return res.status(200).json({ rates });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
