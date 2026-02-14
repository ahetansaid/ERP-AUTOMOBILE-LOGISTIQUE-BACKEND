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

// GET /reporting/compta — synthèse compta + notes (report_notes type compta)
router.get('/compta', async (req, res, next) => {
  try {
    const [invRows] = await pool.execute(
      `SELECT status, COUNT(*) AS cnt FROM invoices GROUP BY status`
    );
    const byStatus = {};
    invRows.forEach((r) => { byStatus[r.status] = r.cnt; });
    const [sumInv] = await pool.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM invoices WHERE status = 'FACTURE'`
    );
    const [sumPay] = await pool.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM payments`
    );
    const [notesRows] = await pool.execute(
      `SELECT id, report_type, content, extra_data, created_at, updated_at FROM report_notes WHERE report_type = 'compta' ORDER BY updated_at DESC`
    );
    const notes = notesRows.map((n) => ({
      id: String(n.id),
      reportType: n.report_type,
      content: n.content,
      extraData: n.extra_data,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    }));
    res.status(200).json({
      summary: {
        invoicesByStatus: byStatus,
        totalInvoiced: Number(sumInv[0]?.total ?? 0),
        totalPayments: Number(sumPay[0]?.total ?? 0),
      },
      notes,
    });
  } catch (err) {
    next(err);
  }
});

// POST /reporting/compta/notes — créer une note compta
router.post('/compta/notes', async (req, res, next) => {
  try {
    const { content, extraData } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO report_notes (report_type, content, extra_data) VALUES (?, ?, ?)',
      ['compta', content != null ? String(content) : null, extraData != null ? JSON.stringify(extraData) : null]
    );
    const [rows] = await pool.execute('SELECT * FROM report_notes WHERE id = ?', [result.insertId]);
    const n = rows[0];
    res.status(201).json({
      id: String(n.id),
      reportType: n.report_type,
      content: n.content,
      extraData: n.extra_data,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /reporting/compta/notes/:id
router.patch('/compta/notes/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const { content, extraData } = req.body;
    const updates = [];
    const params = [];
    if (content !== undefined) { updates.push('content = ?'); params.push(content == null ? null : String(content)); }
    if (extraData !== undefined) { updates.push('extra_data = ?'); params.push(extraData == null ? null : JSON.stringify(extraData)); }
    if (updates.length === 0) {
      const [rows] = await pool.execute('SELECT * FROM report_notes WHERE id = ? AND report_type = ?', [id, 'compta']);
      if (!rows[0]) return res.status(404).json({ message: 'Note non trouvée', statusCode: 404 });
      const n = rows[0];
      return res.status(200).json({ id: String(n.id), reportType: n.report_type, content: n.content, extraData: n.extra_data, createdAt: n.created_at, updatedAt: n.updated_at });
    }
    params.push(id);
    await pool.execute(`UPDATE report_notes SET ${updates.join(', ')} WHERE id = ? AND report_type = ?`, [...params, id, 'compta']);
    const [rows] = await pool.execute('SELECT * FROM report_notes WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Note non trouvée', statusCode: 404 });
    const n = rows[0];
    res.status(200).json({ id: String(n.id), reportType: n.report_type, content: n.content, extraData: n.extra_data, createdAt: n.created_at, updatedAt: n.updated_at });
  } catch (err) {
    next(err);
  }
});

export default router;
