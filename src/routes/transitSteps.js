import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

function toStepRow(row) {
  return {
    id: String(row.id),
    stepName: row.step_name,
    stepOrder: row.step_order,
    blReference: row.bl_reference,
    portLoading: row.port_loading,
    portUnloading: row.port_unloading,
    dateArrival: row.date_arrival,
    vessel: row.vessel,
    consignee: row.consignee,
    shipper: row.shipper,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

async function ensureVehicleExists(vehicleId) {
  const [rows] = await pool.execute('SELECT id FROM vehicles WHERE id = ?', [vehicleId]);
  return rows.length > 0;
}

// GET /vehicles/:vehicleId/transit-steps
router.get('/:vehicleId/transit-steps', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ message: 'ID véhicule invalide', statusCode: 400 });
    if (!(await ensureVehicleExists(vehicleId))) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    const [rows] = await pool.execute(
      'SELECT id, step_name, step_order, bl_reference, port_loading, port_unloading, date_arrival, vessel, consignee, shipper, metadata, created_at FROM transit_steps WHERE vehicle_id = ? ORDER BY step_order, created_at',
      [vehicleId]
    );
    res.status(200).json({ data: rows.map(toStepRow) });
  } catch (err) {
    next(err);
  }
});

// POST /vehicles/:vehicleId/transit-steps
router.post('/:vehicleId/transit-steps', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ message: 'ID véhicule invalide', statusCode: 400 });
    if (!(await ensureVehicleExists(vehicleId))) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    const {
      stepName, stepOrder, blReference, portLoading, portUnloading, dateArrival,
      vessel, consignee, shipper, metadata,
    } = req.body;
    if (!stepName) return res.status(400).json({ message: 'stepName requis', statusCode: 400 });
    const metaJson = metadata != null ? (typeof metadata === 'string' ? JSON.parse(metadata) : metadata) : null;
    const [result] = await pool.execute(
      `INSERT INTO transit_steps (vehicle_id, step_name, step_order, bl_reference, port_loading, port_unloading, date_arrival, vessel, consignee, shipper, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vehicleId, String(stepName).trim(), stepOrder ?? 0, blReference ?? null, portLoading ?? null, portUnloading ?? null,
        dateArrival ?? null, vessel ?? null, consignee ?? null, shipper ?? null,
        metaJson ? JSON.stringify(metaJson) : null,
      ]
    );
    const [rows] = await pool.execute(
      'SELECT id, step_name, step_order, bl_reference, port_loading, port_unloading, date_arrival, vessel, consignee, shipper, metadata, created_at FROM transit_steps WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(toStepRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// PATCH /vehicles/:vehicleId/transit-steps/:stepId
router.patch('/:vehicleId/transit-steps/:stepId', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    const stepId = parseInt(req.params.stepId, 10);
    if (Number.isNaN(vehicleId) || Number.isNaN(stepId)) return res.status(400).json({ message: 'IDs invalides', statusCode: 400 });
    const dbFields = {
      stepName: 'step_name', stepOrder: 'step_order', blReference: 'bl_reference',
      portLoading: 'port_loading', portUnloading: 'port_unloading', dateArrival: 'date_arrival',
      vessel: 'vessel', consignee: 'consignee', shipper: 'shipper', metadata: 'metadata',
    };
    const updates = [];
    const params = [];
    for (const [key, col] of Object.entries(dbFields)) {
      if (req.body[key] === undefined) continue;
      updates.push(`${col} = ?`);
      params.push(key === 'metadata' && req.body[key] != null
        ? (typeof req.body[key] === 'string' ? req.body[key] : JSON.stringify(req.body[key]))
        : req.body[key]);
    }
    if (updates.length === 0) {
      const [rows] = await pool.execute('SELECT id, step_name, step_order, bl_reference, port_loading, port_unloading, date_arrival, vessel, consignee, shipper, metadata, created_at FROM transit_steps WHERE id = ? AND vehicle_id = ?', [stepId, vehicleId]);
      if (!rows[0]) return res.status(404).json({ message: 'Étape non trouvée', statusCode: 404 });
      return res.status(200).json(toStepRow(rows[0]));
    }
    params.push(stepId, vehicleId);
    const [result] = await pool.execute(`UPDATE transit_steps SET ${updates.join(', ')} WHERE id = ? AND vehicle_id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Étape non trouvée', statusCode: 404 });
    const [rows] = await pool.execute('SELECT id, step_name, step_order, bl_reference, port_loading, port_unloading, date_arrival, vessel, consignee, shipper, metadata, created_at FROM transit_steps WHERE id = ?', [stepId]);
    res.status(200).json(toStepRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// DELETE /vehicles/:vehicleId/transit-steps/:stepId
router.delete('/:vehicleId/transit-steps/:stepId', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    const stepId = parseInt(req.params.stepId, 10);
    if (Number.isNaN(vehicleId) || Number.isNaN(stepId)) return res.status(400).json({ message: 'IDs invalides', statusCode: 400 });
    const [result] = await pool.execute('DELETE FROM transit_steps WHERE id = ? AND vehicle_id = ?', [stepId, vehicleId]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Étape non trouvée', statusCode: 404 });
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
