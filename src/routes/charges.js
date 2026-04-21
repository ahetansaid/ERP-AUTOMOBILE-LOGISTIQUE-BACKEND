const express = require('express');
const { getPool } = require('../config/database');
const { onChargeCreated } = require('../services/treasuryTransactions');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute('SELECT * FROM charges ORDER BY charge_date DESC');
    return res.status(200).json({ charges: rows, pagination: {} });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/', async (req, res) => {
  try {
    const { label, category, amount, chargeDate, charge_date } = req.body || {};
    if (!label || amount == null) return res.status(400).json({ message: 'label et amount requis', statusCode: 400 });
    const pool = getPool();
    const companyId = req.query.companyId || req.user?.companyId || null;
    const d = chargeDate || charge_date || new Date();
    const dateStr = typeof d === 'string' && d.match(/^\d{4}-\d{2}-\d{2}/) ? d.slice(0, 10) : (d instanceof Date ? d.toISOString().slice(0, 10) : null) || null;
    const [ins] = await pool.execute(
      'INSERT INTO charges (company_id, label, category, amount, charge_date) VALUES (?, ?, ?, ?, ?)',
      [companyId, label, category || null, amount, dateStr || d]
    );
    const chargeId = ins.insertId;
    const amt = Number(amount);
    if (chargeId && amt > 0) await onChargeCreated(companyId, chargeId, amt, dateStr || d, category, label);
    const [created] = await pool.execute('SELECT * FROM charges WHERE id = ?', [chargeId]);
    return res.status(201).json(created[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const [rows] = await pool.execute('SELECT id FROM charges WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Charge introuvable', statusCode: 404 });
    await pool.execute('DELETE FROM charges WHERE id = ?', [id]);
    return res.status(204).send();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
