const express = require('express');
const { getPool } = require('../config/database');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    try {
      const [rows] = await pool.execute('SELECT id, type, title, message, read, created_at FROM notifications ORDER BY created_at DESC LIMIT 100');
      return res.status(200).json({ notifications: rows, pagination: {} });
    } catch (e) {
      return res.status(200).json({ notifications: [], pagination: {} });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
