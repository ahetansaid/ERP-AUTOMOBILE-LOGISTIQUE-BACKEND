const express = require('express');
const { getPool } = require('../config/database');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const companyId = req.query.companyId || req.user?.companyId;
    const pool = getPool();
    let sql = 'SELECT pf.*, c.name AS client_name, v.vin, v.brand, v.model FROM proformas pf LEFT JOIN clients c ON c.id = pf.client_id LEFT JOIN vehicles v ON v.id = pf.vehicle_id WHERE 1=1';
    const params = [];
    try {
      const [cols] = await pool.execute('SHOW COLUMNS FROM proformas LIKE ?', ['company_id']);
      if (cols.length && companyId) {
        sql += ' AND pf.company_id = ?';
        params.push(companyId);
      }
    } catch (_) {}
    sql += ' ORDER BY pf.id DESC';
    const [rows] = await pool.execute(sql, params);
    return res.status(200).json({ proformas: rows, pagination: {} });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
