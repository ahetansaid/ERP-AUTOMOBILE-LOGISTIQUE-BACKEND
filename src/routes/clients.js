import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

function toClientRow(row) {
  return {
    id: String(row.id),
    name: row.name,
    email: row.email ?? null,
    phone: row.phone ?? null,
    address: row.address ?? null,
    createdAt: row.created_at,
  };
}

// GET /clients
router.get('/', async (req, res, next) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));

    let where = '';
    const params = [];
    if (search && String(search).trim()) {
      where = 'WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?';
      const term = `%${String(search).trim()}%`;
      params.push(term, term, term);
    }
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM clients ${where}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    const [rows] = await pool.execute(
      `SELECT * FROM clients ${where} ORDER BY name ASC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    res.status(200).json({ data: rows.map(toClientRow), total });
  } catch (err) {
    next(err);
  }
});

// GET /clients/export — liste complète pour export PDF/Excel (format=json par défaut)
router.get('/export', async (req, res, next) => {
  try {
    const { format } = req.query;
    const [rows] = await pool.execute('SELECT * FROM clients ORDER BY name ASC');
    const data = rows.map(toClientRow);
    if (format === 'csv') {
      const header = 'id;name;email;phone;address;createdAt\n';
      const lines = data.map((c) => `${c.id};${(c.name || '').replace(/;/g, ',')};${c.email || ''};${c.phone || ''};${(c.address || '').replace(/;/g, ',')};${c.createdAt || ''}`).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=clients.csv');
      return res.send('\uFEFF' + header + lines);
    }
    res.status(200).json({ data, total: data.length });
  } catch (err) {
    next(err);
  }
});

// GET /clients/:id — détail + opérations liées (véhicules, factures, paiements, opérations transit)
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const [rows] = await pool.execute('SELECT * FROM clients WHERE id = ?', [id]);
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ message: 'Client non trouvé', statusCode: 404 });
    }
    const client = toClientRow(row);
    const [vehiclesRows] = await pool.execute(
      'SELECT id, vin, brand, model, year, status FROM vehicles WHERE client_id = ? ORDER BY created_at DESC',
      [id]
    );
    client.vehicles = vehiclesRows.map((v) => ({
      id: String(v.id),
      vin: v.vin,
      brand: v.brand,
      model: v.model,
      year: v.year,
      status: v.status,
    }));
    const vehicleIds = vehiclesRows.map((v) => v.id);
    if (vehicleIds.length > 0) {
      const placeholders = vehicleIds.map(() => '?').join(',');
      const [invRows] = await pool.execute(
        `SELECT id, vehicle_id, amount, status, created_at FROM invoices WHERE vehicle_id IN (${placeholders}) ORDER BY created_at DESC`,
        vehicleIds
      );
      client.invoices = invRows.map((i) => ({
        id: String(i.id),
        vehicleId: String(i.vehicle_id),
        amount: i.amount != null ? Number(i.amount) : null,
        status: i.status,
        createdAt: i.created_at,
      }));
      const [payRows] = await pool.execute(
        `SELECT p.id, p.amount, p.payment_type, p.paid_at, p.invoice_id, p.vehicle_id FROM payments p
         WHERE p.vehicle_id IN (${placeholders}) OR p.invoice_id IN (SELECT id FROM invoices WHERE vehicle_id IN (${placeholders})) ORDER BY p.paid_at DESC`,
        [...vehicleIds, ...vehicleIds]
      );
      client.payments = payRows.map((p) => ({
        id: String(p.id),
        amount: Number(p.amount),
        paymentType: p.payment_type,
        paidAt: p.paid_at,
        invoiceId: p.invoice_id != null ? String(p.invoice_id) : null,
        vehicleId: p.vehicle_id != null ? String(p.vehicle_id) : null,
      }));
    } else {
      client.invoices = [];
      client.payments = [];
    }
    const [transitRows] = await pool.execute(
      'SELECT id, operation_type, reference, bl_number, date_arrivee_port, created_at FROM transit_operations WHERE client_id = ? ORDER BY created_at DESC',
      [id]
    );
    client.transitOperations = transitRows.map((t) => ({
      id: String(t.id),
      operationType: t.operation_type,
      reference: t.reference,
      blNumber: t.bl_number,
      dateArriveePort: t.date_arrivee_port,
      createdAt: t.created_at,
    }));
    res.status(200).json(client);
  } catch (err) {
    next(err);
  }
});

// POST /clients
router.post('/', async (req, res, next) => {
  try {
    const { name, email, phone, address } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Le nom est requis', statusCode: 400 });
    }
    const [result] = await pool.execute(
      'INSERT INTO clients (name, email, phone, address) VALUES (?, ?, ?, ?)',
      [
        String(name).trim(),
        email ? String(email).trim() : null,
        phone ? String(phone).trim() : null,
        address ? String(address).trim() : null,
      ]
    );
    const [rows] = await pool.execute('SELECT * FROM clients WHERE id = ?', [result.insertId]);
    res.status(201).json(toClientRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// PATCH /clients/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const allowed = ['name', 'email', 'phone', 'address'];
    const updates = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      updates.push(`${key} = ?`);
      params.push(req.body[key] == null ? null : String(req.body[key]).trim());
    }
    if (updates.length === 0) {
      const [rows] = await pool.execute('SELECT * FROM clients WHERE id = ?', [id]);
      if (!rows[0]) return res.status(404).json({ message: 'Client non trouvé', statusCode: 404 });
      return res.status(200).json(toClientRow(rows[0]));
    }
    params.push(id);
    await pool.execute(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`, params);
    const [rows] = await pool.execute('SELECT * FROM clients WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Client non trouvé', statusCode: 404 });
    res.status(200).json(toClientRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

export default router;
