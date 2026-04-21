const express = require('express');
const { getPool } = require('../config/database');
const router = express.Router();

router.get('/rates', async (req, res) => {
  try {
    const companyId = req.query.companyId || req.user?.companyId;
    const pool = getPool();
    try {
      const [rows] = await pool.execute(
        'SELECT currency, rate_fcfa FROM exchange_rates WHERE is_active = 1' + (companyId ? ' AND company_id = ?' : ''),
        companyId ? [companyId] : []
      );
      const rates = {};
      rows.forEach(function (r) {
        rates[r.currency] = Number(r.rate_fcfa);
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
    const pool = getPool();
    try {
      if (USD != null) {
        await pool.execute('UPDATE exchange_rates SET rate_fcfa = ?, is_active = 1 WHERE currency = ?' + (companyId ? ' AND company_id = ?' : ''), companyId ? [USD, 'USD', companyId] : [USD, 'USD']);
      }
      if (EUR != null) {
        await pool.execute('UPDATE exchange_rates SET rate_fcfa = ?, is_active = 1 WHERE currency = ?' + (companyId ? ' AND company_id = ?' : ''), companyId ? [EUR, 'EUR', companyId] : [EUR, 'EUR']);
      }
    } catch (e) {}
    const [rows] = await pool.execute('SELECT currency, rate_fcfa FROM exchange_rates WHERE is_active = 1').catch(function () { return [[]]; });
    const rates = {};
    (rows || []).forEach(function (r) { rates[r.currency] = Number(r.rate_fcfa); });
    if (Object.keys(rates).length === 0) return res.status(200).json({ rates: { USD: USD ?? 600, EUR: EUR ?? 655 } });
    return res.status(200).json({ rates });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
