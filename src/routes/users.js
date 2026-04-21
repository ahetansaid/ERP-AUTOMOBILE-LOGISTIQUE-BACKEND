const express = require('express');
const bcrypt = require('bcrypt');
const { getPool } = require('../config/database');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute('SELECT id, email, first_name, last_name, role, is_active, created_at FROM users ORDER BY id DESC');
    return res.status(200).json({ users: rows, pagination: {} });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.email || !b.password) return res.status(400).json({ message: 'email et password requis', statusCode: 400 });
    const pool = getPool();
    const hash = await bcrypt.hash(b.password, 12);
    await pool.execute('INSERT INTO users (email, password, first_name, last_name, role, company_id) VALUES (?, ?, ?, ?, ?, ?)', [b.email, hash, b.firstName || null, b.lastName || null, b.role || 'USER', b.companyId || null]);
    const [created] = await pool.execute('SELECT id, email, first_name, last_name, role, created_at FROM users ORDER BY id DESC LIMIT 1');
    return res.status(201).json(created[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
