import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /reporting/evolution — CA et marge dans le temps
router.get('/evolution', async (req, res, next) => {
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
      const [caRows] = await pool.execute(
        `SELECT COALESCE(SUM(sale_price), 0) AS total FROM vehicles WHERE status = 'VENDU' AND updated_at BETWEEN ? AND ?`,
        [start, end]
      );
      const [costRows] = await pool.execute(
        `SELECT v.id FROM vehicles v WHERE v.status = 'VENDU' AND v.updated_at BETWEEN ? AND ?`,
        [start, end]
      );
      let marge = 0;
      const ca = Number(caRows[0]?.total ?? 0);
      for (const v of costRows) {
        const [charges] = await pool.execute(
          'SELECT COALESCE(SUM(amount), 0) AS total FROM charges WHERE vehicle_id = ?',
          [v.id]
        );
        const [veh] = await pool.execute('SELECT purchase_price, sale_price FROM vehicles WHERE id = ?', [v.id]);
        const cost = Number(charges[0]?.total ?? 0) + Number(veh[0]?.purchase_price ?? 0);
        const sale = Number(veh[0]?.sale_price ?? 0);
        marge += sale - cost;
      }
      data.push({
        month: monthsFr[monthIndex],
        ca: Math.round(ca / 1_000_000 * 10) / 10,
        marge: Math.round(marge / 1_000_000 * 10) / 10,
      });
    }
    data.reverse();
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
});

export default router;
