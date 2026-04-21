const express = require('express');
const { getPool } = require('../config/database');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute('SELECT wq.*, v.vin, v.brand, v.model FROM workshop_quotes wq LEFT JOIN vehicles v ON v.id = wq.vehicle_id ORDER BY wq.id DESC');
    const workshopQuotes = [];
    for (const q of rows || []) {
      const amt = q.amount != null ? Number(q.amount) : 0;
      let paid = 0;
      try {
        const [sumRow] = await pool.execute('SELECT COALESCE(SUM(amount), 0) AS total FROM receipts WHERE workshop_quote_id = ?', [q.id]);
        paid = Number(sumRow[0] && sumRow[0].total) || 0;
      } catch (_) {}
      const remaining = Math.max(0, amt - paid);
      workshopQuotes.push({
        ...q,
        total_amount: amt,
        amount: amt,
        paid_amount: paid,
        paidAmount: paid,
        remaining_amount: remaining,
        remainingAmount: remaining,
        solde_restant: remaining,
        closed_at: q.closed_at || null,
        date_cloture: q.closed_at || null,
      });
    }
    return res.status(200).json({ workshopQuotes, pagination: {} });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.vehicleId || !b.prestataire || b.amount == null) return res.status(400).json({ message: 'vehicleId, prestataire et amount requis', statusCode: 400 });
    const pool = getPool();
    const [ex] = await pool.execute('SELECT id FROM workshop_quotes WHERE vehicle_id = ? AND status != ?', [b.vehicleId, 'TERMINE']);
    if (ex.length) return res.status(409).json({ message: 'Devis actif existant', statusCode: 409 });
    const [ins] = await pool.execute('INSERT INTO workshop_quotes (vehicle_id, prestataire, amount, currency, description, valid_until, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [b.vehicleId, b.prestataire, b.amount, b.currency || 'FCFA', b.description || null, b.validUntil || null, 'EN_ATTENTE']);
    const [created] = await pool.execute('SELECT * FROM workshop_quotes WHERE id = ?', [ins.insertId]);
    return res.status(201).json(created[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
