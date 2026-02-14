import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

function toReceiptRow(row, extra = {}) {
  return {
    id: String(row.id),
    prestataireName: row.prestataire_name,
    amount: Number(row.amount),
    currency: row.currency ?? 'FCFA',
    documentPath: row.document_path ?? null,
    operationReference: row.operation_reference ?? null,
    vehicleId: row.vehicle_id != null ? String(row.vehicle_id) : null,
    devisId: row.devis_id != null ? String(row.devis_id) : null,
    notes: row.notes ?? null,
    receivedAt: row.received_at ?? null,
    createdAt: row.created_at,
    ...extra,
  };
}

// GET /receipts — filtre optionnel devisId (reçus liés à un devis), vehicleId
router.get('/', async (req, res, next) => {
  try {
    const { vehicleId, devisId, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const where = [];
    const params = [];
    if (vehicleId) { where.push('r.vehicle_id = ?'); params.push(vehicleId); }
    if (devisId) { where.push('r.devis_id = ?'); params.push(devisId); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM receipts r ${whereClause}`, params);
    const total = countRows[0]?.total ?? 0;
    const [rows] = await pool.execute(
      `SELECT r.*, d.devis_date AS devis_date, d.service AS devis_service
       FROM receipts r
       LEFT JOIN devis d ON d.id = r.devis_id
       ${whereClause}
       ORDER BY r.received_at DESC, r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    const data = rows.map((r) => {
      const extra = r.devis_date != null || r.devis_service != null
        ? { devisDate: r.devis_date, devisService: r.devis_service }
        : {};
      return toReceiptRow(r, extra);
    });
    res.status(200).json({ data, total });
  } catch (err) {
    next(err);
  }
});

// GET /receipts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const [rows] = await pool.execute('SELECT * FROM receipts WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Reçu non trouvé', statusCode: 404 });
    res.status(200).json(toReceiptRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

function toMySQLDateTime(val) {
  if (val == null || val === '') return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}

// POST /receipts — optionnel : devisId (lien reçu ↔ devis)
router.post('/', async (req, res, next) => {
  try {
    const { prestataireName, amount, currency, documentPath, operationReference, vehicleId, devisId, notes, receivedAt } = req.body;
    if (!prestataireName || amount == null) return res.status(400).json({ message: 'prestataireName et amount requis', statusCode: 400 });
    const receivedAtVal = toMySQLDateTime(receivedAt) ?? toMySQLDateTime(new Date());
    const [result] = await pool.execute(
      `INSERT INTO receipts (prestataire_name, amount, currency, document_path, operation_reference, vehicle_id, devis_id, notes, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(prestataireName).trim(), Number(amount), currency ?? 'FCFA', documentPath ?? null,
        operationReference ?? null, vehicleId ? parseInt(vehicleId, 10) : null,
        devisId != null && devisId !== '' ? parseInt(devisId, 10) : null,
        notes ?? null, receivedAtVal,
      ]
    );
    const [rows] = await pool.execute('SELECT * FROM receipts WHERE id = ?', [result.insertId]);
    res.status(201).json(toReceiptRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// PATCH /receipts/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const allowed = ['prestataireName', 'amount', 'currency', 'documentPath', 'operationReference', 'vehicleId', 'devisId', 'notes', 'receivedAt'];
    const dbMap = { prestataireName: 'prestataire_name', documentPath: 'document_path', operationReference: 'operation_reference', vehicleId: 'vehicle_id', devisId: 'devis_id', receivedAt: 'received_at' };
    const updates = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      const col = dbMap[key] ?? key;
      updates.push(`${col} = ?`);
      if (key === 'amount') params.push(Number(req.body[key]));
      else if (key === 'vehicleId' || key === 'devisId') params.push(req.body[key] == null || req.body[key] === '' ? null : parseInt(req.body[key], 10));
      else if (key === 'receivedAt') params.push(toMySQLDateTime(req.body[key]));
      else params.push(req.body[key]);
    }
    if (updates.length === 0) {
      const [rows] = await pool.execute('SELECT * FROM receipts WHERE id = ?', [id]);
      if (!rows[0]) return res.status(404).json({ message: 'Reçu non trouvé', statusCode: 404 });
      return res.status(200).json(toReceiptRow(rows[0]));
    }
    params.push(id);
    await pool.execute(`UPDATE receipts SET ${updates.join(', ')} WHERE id = ?`, params);
    const [rows] = await pool.execute('SELECT * FROM receipts WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Reçu non trouvé', statusCode: 404 });
    res.status(200).json(toReceiptRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// DELETE /receipts/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const [result] = await pool.execute('DELETE FROM receipts WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Reçu non trouvé', statusCode: 404 });
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
