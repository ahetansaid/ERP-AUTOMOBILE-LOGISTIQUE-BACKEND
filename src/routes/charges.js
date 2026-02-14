import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

function toChargeRow(row) {
  return {
    id: String(row.id),
    label: row.label,
    amount: Number(row.amount),
    currency: row.currency ?? 'FCFA',
    chargeType: row.charge_type ?? null,
    createdAt: row.created_at,
  };
}

async function ensureVehicleExists(vehicleId) {
  const [rows] = await pool.execute('SELECT id FROM vehicles WHERE id = ?', [vehicleId]);
  return rows.length > 0;
}

// GET /vehicles/:vehicleId/charges
router.get('/:vehicleId/charges', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ message: 'ID véhicule invalide', statusCode: 400 });
    if (!(await ensureVehicleExists(vehicleId))) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    const [rows] = await pool.execute(
      'SELECT id, label, amount, currency, charge_type, created_at FROM charges WHERE vehicle_id = ? ORDER BY created_at',
      [vehicleId]
    );
    const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    res.status(200).json({ data: rows.map(toChargeRow), total });
  } catch (err) {
    next(err);
  }
});

// POST /vehicles/:vehicleId/charges
router.post('/:vehicleId/charges', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ message: 'ID véhicule invalide', statusCode: 400 });
    if (!(await ensureVehicleExists(vehicleId))) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    const { label, amount, currency, chargeType } = req.body;
    if (!label || amount == null) return res.status(400).json({ message: 'label et amount requis', statusCode: 400 });
    const [result] = await pool.execute(
      'INSERT INTO charges (vehicle_id, label, amount, currency, charge_type) VALUES (?, ?, ?, ?, ?)',
      [vehicleId, String(label).trim(), Number(amount), currency ?? 'FCFA', chargeType ?? null]
    );
    const [rows] = await pool.execute(
      'SELECT id, label, amount, currency, charge_type, created_at FROM charges WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(toChargeRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// PATCH /vehicles/:vehicleId/charges/:chargeId
router.patch('/:vehicleId/charges/:chargeId', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    const chargeId = parseInt(req.params.chargeId, 10);
    if (Number.isNaN(vehicleId) || Number.isNaN(chargeId)) return res.status(400).json({ message: 'IDs invalides', statusCode: 400 });
    const { label, amount, currency, chargeType } = req.body;
    const updates = [];
    const params = [];
    if (label !== undefined) { updates.push('label = ?'); params.push(String(label).trim()); }
    if (amount !== undefined) { updates.push('amount = ?'); params.push(Number(amount)); }
    if (currency !== undefined) { updates.push('currency = ?'); params.push(currency); }
    if (chargeType !== undefined) { updates.push('charge_type = ?'); params.push(chargeType); }
    if (updates.length === 0) {
      const [rows] = await pool.execute('SELECT id, label, amount, currency, charge_type, created_at FROM charges WHERE id = ? AND vehicle_id = ?', [chargeId, vehicleId]);
      if (!rows[0]) return res.status(404).json({ message: 'Charge non trouvée', statusCode: 404 });
      return res.status(200).json(toChargeRow(rows[0]));
    }
    params.push(chargeId, vehicleId);
    const [result] = await pool.execute(`UPDATE charges SET ${updates.join(', ')} WHERE id = ? AND vehicle_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Charge non trouvée', statusCode: 404 });
    const [rows] = await pool.execute('SELECT id, label, amount, currency, charge_type, created_at FROM charges WHERE id = ?', [chargeId]);
    res.status(200).json(toChargeRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// DELETE /vehicles/:vehicleId/charges/:chargeId
router.delete('/:vehicleId/charges/:chargeId', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    const chargeId = parseInt(req.params.chargeId, 10);
    if (Number.isNaN(vehicleId) || Number.isNaN(chargeId)) return res.status(400).json({ message: 'IDs invalides', statusCode: 400 });
    const [result] = await pool.execute('DELETE FROM charges WHERE id = ? AND vehicle_id = ?', [chargeId, vehicleId]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Charge non trouvée', statusCode: 404 });
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
