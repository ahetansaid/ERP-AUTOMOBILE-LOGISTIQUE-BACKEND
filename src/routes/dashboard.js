import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /dashboard/stats
router.get('/stats', async (req, res, next) => {
  try {
    const [stock] = await pool.execute(
      `SELECT COUNT(*) AS c FROM vehicles WHERE status IN ('ACHETE','ARRIVE_PORT','EN_DOUANE','DEDOUANE','LIVRE')`
    );
    const [transit] = await pool.execute(
      `SELECT COUNT(*) AS c FROM vehicles WHERE status = 'EN_TRANSIT'`
    );
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const [sold] = await pool.execute(
      `SELECT COUNT(*) AS c FROM vehicles WHERE status = 'VENDU' AND updated_at >= ?`,
      [startOfMonth]
    );
    const [revenue] = await pool.execute(
      `SELECT COALESCE(SUM(sale_price), 0) AS total FROM vehicles WHERE status = 'VENDU' AND updated_at >= ?`,
      [startOfMonth]
    );
    res.status(200).json({
      vehiclesInStock: stock[0]?.c ?? 0,
      vehiclesInTransit: transit[0]?.c ?? 0,
      vehiclesSoldThisMonth: sold[0]?.c ?? 0,
      revenueThisMonth: Number(revenue[0]?.total ?? 0),
      currency: 'FCFA',
    });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/charts/status
router.get('/charts/status', async (req, res, next) => {
  try {
    const labels = {
      ACHETE: 'Achetés',
      EN_TRANSIT: 'En transit',
      ARRIVE_PORT: 'Arrivés port',
      EN_DOUANE: 'En douane',
      DEDOUANE: 'Dédouanés',
      LIVRE: 'Livrés',
      VENDU: 'Vendus',
    };
    const [rows] = await pool.execute(
      'SELECT status, COUNT(*) AS count FROM vehicles GROUP BY status'
    );
    const data = rows.map((r) => ({
      name: labels[r.status] ?? r.status,
      count: r.count,
    }));
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/charts/monthly
router.get('/charts/monthly', async (req, res, next) => {
  try {
    const monthsCount = Math.min(12, Math.max(1, parseInt(req.query.months, 10) || 6));
    const monthsFr = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
    const data = [];
    for (let m = 0; m < monthsCount; m++) {
      const d = new Date();
      d.setMonth(d.getMonth() - m);
      const monthIndex = d.getMonth();
      const start = new Date(d.getFullYear(), monthIndex, 1);
      const end = new Date(d.getFullYear(), monthIndex + 1, 0, 23, 59, 59, 999);
      const [achats] = await pool.execute(
        `SELECT COUNT(*) AS c FROM vehicles WHERE created_at BETWEEN ? AND ?`,
        [start, end]
      );
      const [ventes] = await pool.execute(
        `SELECT COUNT(*) AS c FROM vehicles WHERE status = 'VENDU' AND updated_at BETWEEN ? AND ?`,
        [start, end]
      );
      data.push({
        month: monthsFr[monthIndex],
        achats: achats[0]?.c ?? 0,
        ventes: ventes[0]?.c ?? 0,
      });
    }
    data.reverse();
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
});

export default router;
