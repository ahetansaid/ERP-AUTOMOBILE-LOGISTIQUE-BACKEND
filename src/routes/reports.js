const express = require('express');
const { getPool } = require('../config/database');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const companyId = req.query.companyId || req.user?.companyId;
    const pool = getPool();
    let rows = [];
    try {
      let sql = 'SELECT id, name, type, period_start, period_end, created_at FROM generated_reports';
      const params = [];
      if (companyId) {
        sql += ' WHERE company_id = ?';
        params.push(companyId);
      }
      sql += ' ORDER BY created_at DESC';
      const [r] = await pool.execute(sql, params);
      rows = r || [];
    } catch (_) {}
    const reports = rows;
    return res.status(200).json({ reports, data: reports });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
