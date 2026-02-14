import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

function toPaymentRow(row, extra = {}) {
  return {
    id: String(row.id),
    vehicleId: row.vehicle_id != null ? String(row.vehicle_id) : null,
    invoiceId: row.invoice_id != null ? String(row.invoice_id) : null,
    amount: Number(row.amount),
    currency: row.currency ?? 'FCFA',
    paymentType: row.payment_type ?? null,
    paidAt: row.paid_at ?? null,
    reference: row.reference ?? null,
    createdAt: row.created_at,
    ...extra,
  };
}

// GET /payments — liste avec filtres
router.get('/', async (req, res, next) => {
  try {
    const { vehicleId, invoiceId, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const where = [];
    const params = [];
    if (vehicleId) { where.push('p.vehicle_id = ?'); params.push(vehicleId); }
    if (invoiceId) { where.push('p.invoice_id = ?'); params.push(invoiceId); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM payments p ${whereClause}`, params);
    const total = countRows[0]?.total ?? 0;
    const [rows] = await pool.execute(
      `SELECT p.* FROM payments p ${whereClause} ORDER BY p.paid_at DESC, p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    res.status(200).json({ data: rows.map(toPaymentRow), total });
  } catch (err) {
    next(err);
  }
});

// POST /payments — enregistre un paiement ; si facture complète soldée, met à jour vehicles.regularise
router.post('/', async (req, res, next) => {
  try {
    const { vehicleId, invoiceId, amount, currency, paymentType, paidAt, reference } = req.body;
    if (amount == null) return res.status(400).json({ message: 'amount requis', statusCode: 400 });
    const [result] = await pool.execute(
      'INSERT INTO payments (vehicle_id, invoice_id, amount, currency, payment_type, paid_at, reference) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        vehicleId ? parseInt(vehicleId, 10) : null,
        invoiceId ? parseInt(invoiceId, 10) : null,
        Number(amount),
        currency ?? 'FCFA',
        paymentType ?? null,
        paidAt ?? new Date(),
        reference ?? null,
      ]
    );
    const paymentId = result.insertId;
    let vid = vehicleId ? parseInt(vehicleId, 10) : null;
    if (invoiceId && Number.isNaN(parseInt(invoiceId, 10)) === false) {
      const [invRows] = await pool.execute(
        'SELECT vehicle_id, amount, type_facture FROM invoices WHERE id = ?',
        [parseInt(invoiceId, 10)]
      );
      if (invRows[0]) {
        vid = vid ?? invRows[0].vehicle_id;
        if (invRows[0].type_facture === 'COMPLETE' && invRows[0].vehicle_id) {
          const [sumRows] = await pool.execute(
            'SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE invoice_id = ?',
            [parseInt(invoiceId, 10)]
          );
          const totalPaid = Number(sumRows[0]?.total ?? 0);
          const invoiceAmount = Number(invRows[0].amount ?? 0);
          if (invoiceAmount > 0 && totalPaid >= invoiceAmount) {
            await pool.execute(
              'UPDATE vehicles SET regularise = 1 WHERE id = ?',
              [invRows[0].vehicle_id]
            );
          }
        }
      }
    }
    const [rows] = await pool.execute(
      'SELECT id, vehicle_id, invoice_id, amount, currency, payment_type, paid_at, reference, created_at FROM payments WHERE id = ?',
      [paymentId]
    );
    res.status(201).json(toPaymentRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

export default router;
