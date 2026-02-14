import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

const OPERATION_TYPES = ['MARITIME', 'VEHICULE', 'DEDOUANEMENT', 'ACHAT', 'IMPORT', 'EXPORT'];

function toOpRow(row) {
  return {
    id: String(row.id),
    vehicleId: row.vehicle_id != null ? String(row.vehicle_id) : null,
    clientId: row.client_id != null ? String(row.client_id) : null,
    operationType: row.operation_type,
    reference: row.reference ?? null,
    lieuExpedition: row.lieu_expedition ?? null,
    portLoading: row.port_loading ?? null,
    portUnloading: row.port_unloading ?? null,
    dateEmbarquement: row.date_embarquement ?? null,
    dateArriveePort: row.date_arrivee_port ?? null,
    vesselName: row.vessel_name ?? null,
    vesselFlag: row.vessel_flag ?? null,
    containerNumber: row.container_number ?? null,
    blNumber: row.bl_number ?? null,
    declarantName: row.declarant_name ?? null,
    customsReference: row.customs_reference ?? null,
    details: row.details ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /transit/operations — liste (filtres: vehicleId, clientId, operationType)
router.get('/operations', async (req, res, next) => {
  try {
    const { vehicleId, clientId, operationType, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const where = [];
    const params = [];
    if (vehicleId) { where.push('vehicle_id = ?'); params.push(vehicleId); }
    if (clientId) { where.push('client_id = ?'); params.push(clientId); }
    if (operationType && OPERATION_TYPES.includes(operationType)) { where.push('operation_type = ?'); params.push(operationType); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM transit_operations ${whereClause}`, params);
    const total = countRows[0]?.total ?? 0;
    const [rows] = await pool.execute(
      `SELECT * FROM transit_operations ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    res.status(200).json({ data: rows.map(toOpRow), total });
  } catch (err) {
    next(err);
  }
});

// GET /transit/operations/:id
router.get('/operations/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const [rows] = await pool.execute('SELECT * FROM transit_operations WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Opération non trouvée', statusCode: 404 });
    res.status(200).json(toOpRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// POST /transit/operations
router.post('/operations', async (req, res, next) => {
  try {
    const {
      vehicleId, clientId, operationType, reference, lieuExpedition, portLoading, portUnloading,
      dateEmbarquement, dateArriveePort, vesselName, vesselFlag, containerNumber, blNumber,
      declarantName, customsReference, details,
    } = req.body;
    if (!operationType || !OPERATION_TYPES.includes(operationType)) {
      return res.status(400).json({ message: 'operationType requis (MARITIME, VEHICULE, DEDOUANEMENT, ACHAT, IMPORT, EXPORT)', statusCode: 400 });
    }
    const detailsJson = details != null ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;
    const [result] = await pool.execute(
      `INSERT INTO transit_operations (
        vehicle_id, client_id, operation_type, reference, lieu_expedition, port_loading, port_unloading,
        date_embarquement, date_arrivee_port, vessel_name, vessel_flag, container_number, bl_number,
        declarant_name, customs_reference, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vehicleId ? parseInt(vehicleId, 10) : null, clientId ? parseInt(clientId, 10) : null, operationType,
        reference ?? null, lieuExpedition ?? null, portLoading ?? null, portUnloading ?? null,
        dateEmbarquement ?? null, dateArriveePort ?? null, vesselName ?? null, vesselFlag ?? null,
        containerNumber ?? null, blNumber ?? null, declarantName ?? null, customsReference ?? null, detailsJson,
      ]
    );
    const [rows] = await pool.execute('SELECT * FROM transit_operations WHERE id = ?', [result.insertId]);
    res.status(201).json(toOpRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// PATCH /transit/operations/:id
router.patch('/operations/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const dbMap = {
      vehicleId: 'vehicle_id', clientId: 'client_id', operationType: 'operation_type', reference: 'reference',
      lieuExpedition: 'lieu_expedition', portLoading: 'port_loading', portUnloading: 'port_unloading',
      dateEmbarquement: 'date_embarquement', dateArriveePort: 'date_arrivee_port', vesselName: 'vessel_name',
      vesselFlag: 'vessel_flag', containerNumber: 'container_number', blNumber: 'bl_number',
      declarantName: 'declarant_name', customsReference: 'customs_reference', details: 'details',
    };
    const updates = [];
    const params = [];
    for (const [key, col] of Object.entries(dbMap)) {
      if (req.body[key] === undefined) continue;
      if (key === 'operationType' && req.body[key] && !OPERATION_TYPES.includes(req.body[key])) continue;
      updates.push(`${col} = ?`);
      params.push(key === 'details' && req.body[key] != null
        ? (typeof req.body[key] === 'string' ? req.body[key] : JSON.stringify(req.body[key]))
        : req.body[key]);
    }
    if (updates.length === 0) {
      const [rows] = await pool.execute('SELECT * FROM transit_operations WHERE id = ?', [id]);
      if (!rows[0]) return res.status(404).json({ message: 'Opération non trouvée', statusCode: 404 });
      return res.status(200).json(toOpRow(rows[0]));
    }
    params.push(id);
    await pool.execute(`UPDATE transit_operations SET ${updates.join(', ')} WHERE id = ?`, params);
    const [rows] = await pool.execute('SELECT * FROM transit_operations WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Opération non trouvée', statusCode: 404 });
    res.status(200).json(toOpRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// DELETE /transit/operations/:id
router.delete('/operations/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const [result] = await pool.execute('DELETE FROM transit_operations WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Opération non trouvée', statusCode: 404 });
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
