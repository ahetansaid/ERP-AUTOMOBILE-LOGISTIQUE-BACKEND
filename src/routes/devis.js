import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

function toDevisRow(row, extra = {}) {
  return {
    id: String(row.id),
    vehicleId: String(row.vehicle_id),
    vehicleVin: row.vehicle_vin ?? extra.vehicleVin ?? null,
    prestataireName: row.prestataire_name,
    amount: Number(row.amount),
    currency: row.currency ?? 'FCFA',
    service: row.service ?? null,
    devisDate: row.devis_date ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

// GET /devis — liste avec filtres (vehicleId, page, limit)
router.get('/', async (req, res, next) => {
  try {
    const { vehicleId, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    let where = '';
    const params = [];
    if (vehicleId) { where = 'WHERE d.vehicle_id = ?'; params.push(vehicleId); }
    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM devis d ${where}`, params);
    const total = countRows[0]?.total ?? 0;
    const [rows] = await pool.execute(
      `SELECT d.*, v.vin AS vehicle_vin
       FROM devis d
       JOIN vehicles v ON v.id = d.vehicle_id
       ${where}
       ORDER BY d.devis_date DESC, d.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    const data = await Promise.all(
      rows.map(async (r) => {
        const [sumRows] = await pool.execute(
          'SELECT COALESCE(SUM(amount), 0) AS total FROM receipts WHERE devis_id = ?',
          [r.id]
        );
        const totalReceipts = Number(sumRows[0]?.total ?? 0);
        const restant = Math.max(0, Number(r.amount) - totalReceipts);
        return {
          ...toDevisRow(r),
          totalReceipts,
          restant,
          soldé: restant <= 0,
        };
      })
    );
    res.status(200).json({ data, total });
  } catch (err) {
    next(err);
  }
});

// GET /devis/:id/situation — situation du devis : montant, total reçus, restant, liste des reçus liés (avant /:id)
router.get('/:id/situation', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const [rows] = await pool.execute(
      `SELECT d.*, v.vin AS vehicle_vin FROM devis d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = ?`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Devis non trouvé', statusCode: 404 });
    const devis = toDevisRow(rows[0]);
    const [sumRows] = await pool.execute(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM receipts WHERE devis_id = ?',
      [id]
    );
    const totalReceipts = Number(sumRows[0]?.total ?? 0);
    const restant = Math.max(0, Number(rows[0].amount) - totalReceipts);
    const [receiptRows] = await pool.execute(
      'SELECT id, prestataire_name, amount, operation_reference, received_at, created_at FROM receipts WHERE devis_id = ? ORDER BY received_at DESC, created_at DESC',
      [id]
    );
    const receipts = receiptRows.map((rec) => ({
      id: String(rec.id),
      prestataireName: rec.prestataire_name,
      amount: Number(rec.amount),
      operationReference: rec.operation_reference ?? null,
      receivedAt: rec.received_at,
      createdAt: rec.created_at,
    }));
    res.status(200).json({
      devis,
      totalReceipts,
      restant,
      soldé: restant <= 0,
      receipts,
    });
  } catch (err) {
    next(err);
  }
});

// GET /devis/:id — détail
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const [rows] = await pool.execute(
      `SELECT d.*, v.vin AS vehicle_vin FROM devis d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = ?`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Devis non trouvé', statusCode: 404 });
    const r = rows[0];
    const [sumRows] = await pool.execute(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM receipts WHERE devis_id = ?',
      [id]
    );
    const totalReceipts = Number(sumRows[0]?.total ?? 0);
    const restant = Math.max(0, Number(r.amount) - totalReceipts);
    res.status(200).json({
      ...toDevisRow(r),
      totalReceipts,
      restant,
      soldé: restant <= 0,
    });
  } catch (err) {
    next(err);
  }
});

// POST /devis — création (vehicleId, prestataireName, amount, currency, service, devisDate)
router.post('/', async (req, res, next) => {
  try {
    const { vehicleId, prestataireName, amount, currency, service, devisDate } = req.body;
    if (!vehicleId) return res.status(400).json({ message: 'vehicleId requis', statusCode: 400 });
    if (!prestataireName || !String(prestataireName).trim()) return res.status(400).json({ message: 'prestataireName requis', statusCode: 400 });
    if (amount == null) return res.status(400).json({ message: 'amount requis', statusCode: 400 });
    const vid = parseInt(vehicleId, 10);
    if (Number.isNaN(vid)) return res.status(400).json({ message: 'vehicleId invalide', statusCode: 400 });
    let dateVal = devisDate ?? null;
    if (dateVal && typeof dateVal === 'string') {
      const d = new Date(dateVal);
      dateVal = Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    const [result] = await pool.execute(
      `INSERT INTO devis (vehicle_id, prestataire_name, amount, currency, service, devis_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        vid,
        String(prestataireName).trim(),
        Number(amount),
        currency ?? 'FCFA',
        service != null ? String(service).trim() : null,
        dateVal,
      ]
    );
    const [rows] = await pool.execute(
      'SELECT d.*, v.vin AS vehicle_vin FROM devis d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = ?',
      [result.insertId]
    );
    res.status(201).json(toDevisRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// PATCH /devis/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const { vehicleId, prestataireName, amount, currency, service, devisDate } = req.body;
    const updates = [];
    const params = [];
    if (vehicleId !== undefined) {
      const vid = vehicleId == null ? null : parseInt(vehicleId, 10);
      if (vid !== null && Number.isNaN(vid)) return res.status(400).json({ message: 'vehicleId invalide', statusCode: 400 });
      updates.push('vehicle_id = ?');
      params.push(vid);
    }
    if (prestataireName !== undefined) { updates.push('prestataire_name = ?'); params.push(String(prestataireName).trim()); }
    if (amount !== undefined) { updates.push('amount = ?'); params.push(Number(amount)); }
    if (currency !== undefined) { updates.push('currency = ?'); params.push(currency ?? 'FCFA'); }
    if (service !== undefined) { updates.push('service = ?'); params.push(service == null ? null : String(service).trim()); }
    if (devisDate !== undefined) {
      let v = devisDate;
      if (v && typeof v === 'string') {
        const d = new Date(v);
        v = Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      }
      updates.push('devis_date = ?');
      params.push(v ?? null);
    }
    if (updates.length === 0) {
      const [rows] = await pool.execute(
        'SELECT d.*, v.vin AS vehicle_vin FROM devis d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = ?',
        [id]
      );
      if (!rows[0]) return res.status(404).json({ message: 'Devis non trouvé', statusCode: 404 });
      return res.status(200).json(toDevisRow(rows[0]));
    }
    params.push(id);
    await pool.execute(`UPDATE devis SET ${updates.join(', ')} WHERE id = ?`, params);
    const [rows] = await pool.execute(
      'SELECT d.*, v.vin AS vehicle_vin FROM devis d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = ?',
      [id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Devis non trouvé', statusCode: 404 });
    res.status(200).json(toDevisRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// DELETE /devis/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const [result] = await pool.execute('DELETE FROM devis WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Devis non trouvé', statusCode: 404 });
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
