import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

const NATURE_STOCK = ['DEPOT', 'TRANSIT', 'CONSOMMATION', 'AUTRES'];

function joursSurParc(dateEntreeParc) {
  if (!dateEntreeParc) return null;
  const entree = new Date(dateEntreeParc);
  const now = new Date();
  return Math.max(0, Math.floor((now - entree) / (24 * 60 * 60 * 1000)));
}

function toVehicleStockRow(row) {
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
    dateEntreePort: row.date_entree_port ?? null,
    dateEntreeParc: row.date_entree_parc ?? null,
    numeroBl: row.numero_bl ?? null,
    natureStock: row.nature_stock ?? null,
    regularise: Boolean(row.regularise),
    joursSurParc: joursSurParc(row.date_entree_parc),
  };
}

// GET /vehicles/stock/disponible — stock régularisé (client a payé selon compta)
router.get('/stock/disponible', async (req, res, next) => {
  try {
    const { nature, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    let where = 'v.regularise = 1';
    const params = [];
    if (nature && NATURE_STOCK.includes(nature)) {
      where += ' AND v.nature_stock = ?';
      params.push(nature);
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
       ORDER BY v.date_entree_parc DESC, v.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    res.status(200).json({ data: rows.map(toVehicleStockRow), total });
  } catch (err) {
    next(err);
  }
});

// GET /vehicles/stock/non-regularise — stock non régularisé (paiement partiel ou à enclencher)
router.get('/stock/non-regularise', async (req, res, next) => {
  try {
    const { nature, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    let where = '(v.regularise = 0 OR v.regularise IS NULL)';
    const params = [];
    if (nature && NATURE_STOCK.includes(nature)) {
      where += ' AND v.nature_stock = ?';
      params.push(nature);
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
       ORDER BY v.date_entree_parc DESC, v.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    res.status(200).json({ data: rows.map(toVehicleStockRow), total });
  } catch (err) {
    next(err);
  }
});

export default router;
