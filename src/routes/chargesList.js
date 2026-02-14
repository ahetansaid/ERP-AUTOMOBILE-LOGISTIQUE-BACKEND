import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

/**
 * GET /charges — Liste globale des charges (page Comptabilité).
 * Query: vehicleId (optionnel), page, limit, currency
 */
router.get('/', async (req, res, next) => {
  try {
    const { vehicleId, page = 1, limit = 50, currency } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const where = [];
    const params = [];
    if (vehicleId) {
      where.push('c.vehicle_id = ?');
      params.push(vehicleId);
    }
    if (currency) {
      where.push('c.currency = ?');
      params.push(currency);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM charges c ${whereClause}`,
      params
    );
    const total = countRows[0]?.total ?? 0;
    const [rows] = await pool.execute(
      `SELECT c.id, c.vehicle_id, c.label, c.amount, c.currency, c.charge_type, c.created_at,
              v.vin, v.brand, v.model, v.year
       FROM charges c
       LEFT JOIN vehicles v ON v.id = c.vehicle_id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    const data = rows.map((r) => ({
      id: String(r.id),
      vehicleId: r.vehicle_id != null ? String(r.vehicle_id) : null,
      label: r.label,
      amount: Number(r.amount),
      currency: r.currency ?? 'FCFA',
      chargeType: r.charge_type ?? null,
      createdAt: r.created_at,
      vehicleVin: r.vin ?? null,
      vehicleLabel: r.vin ? `${r.year} ${r.brand} ${r.model}` : null,
    }));
    res.status(200).json({ data, total });
  } catch (err) {
    next(err);
  }
});

export default router;
