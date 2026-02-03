import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

const STEP_LABELS = {
  ACHETE: 'Achat',
  EN_TRANSIT: 'Transit maritime',
  ARRIVE_PORT: 'Arrivée port',
  EN_DOUANE: 'Dédouanement',
  DEDOUANE: 'Dédouané',
  LIVRE: 'Livraison client',
  VENDU: 'Vendu',
};

function toVehicleRow(row) {
  return {
    id: String(row.id),
    vin: row.vin,
    chassisNumber: row.chassis_number ?? null,
    brand: row.brand,
    model: row.model,
    year: row.year,
    vehicleType: row.vehicle_type ?? null,
    status: row.status,
    clientId: row.client_id != null ? String(row.client_id) : null,
    clientName: row.client_name ?? null,
    purchasePrice: row.purchase_price != null ? Number(row.purchase_price) : null,
    salePrice: row.sale_price != null ? Number(row.sale_price) : null,
    currency: row.currency ?? null,
    createdAt: row.created_at,
    currentStep: STEP_LABELS[row.status] ?? row.status,
  };
}

// GET /transit/steps
router.get('/steps', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT status, COUNT(*) AS count FROM vehicles GROUP BY status'
    );
    const order = ['ACHETE', 'EN_TRANSIT', 'ARRIVE_PORT', 'EN_DOUANE', 'DEDOUANE', 'LIVRE', 'VENDU'];
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    const steps = order.map((status) => ({
      step: STEP_LABELS[status] ?? status,
      count: byStatus[status] ?? 0,
    }));
    res.status(200).json({ steps });
  } catch (err) {
    next(err);
  }
});

// GET /transit/vehicles
router.get('/vehicles', async (req, res, next) => {
  try {
    const { step, page = 1, limit = 20 } = req.query;
    const statusFilter = step && STEP_LABELS[step] !== undefined
      ? Object.entries(STEP_LABELS).find(([, label]) => label === step)?.[0]
      : null;
    const transitStatuses = ['EN_TRANSIT', 'ARRIVE_PORT', 'EN_DOUANE', 'DEDOUANE', 'LIVRE'];
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));

    let where = "v.status IN ('EN_TRANSIT','ARRIVE_PORT','EN_DOUANE','DEDOUANE','LIVRE')";
    const params = [];
    if (statusFilter) {
      where = 'v.status = ?';
      params.push(statusFilter);
    }
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM vehicles v WHERE ${where}`,
      params
    );
    const total = countRows[0]?.total ?? 0;
    const [rows] = await pool.execute(
      `SELECT v.*, c.name AS client_name FROM vehicles v
       LEFT JOIN clients c ON c.id = v.client_id
       WHERE ${where}
       ORDER BY v.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    res.status(200).json({
      data: rows.map(toVehicleRow),
      total,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
