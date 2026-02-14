import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';
import { VEHICLE_STATUSES } from '../config.js';

const router = Router();
router.use(authMiddleware);

function toVehicleRow(row, clientName = null) {
  return {
    id: String(row.id),
    vin: row.vin,
    chassisNumber: row.chassis_number ?? null,
    brand: row.brand,
    model: row.model,
    year: row.year,
    color: row.color ?? null,
    vehicleType: row.vehicle_type ?? null,
    status: row.status,
    clientId: row.client_id != null ? String(row.client_id) : null,
    clientName: clientName ?? row.client_name ?? null,
    purchasePrice: row.purchase_price != null ? Number(row.purchase_price) : null,
    salePrice: row.sale_price != null ? Number(row.sale_price) : null,
    currency: row.currency ?? null,
    purchaseId: row.purchase_id != null ? String(row.purchase_id) : null,
    dateEntreePort: row.date_entree_port ?? null,
    dateEntreeParc: row.date_entree_parc ?? null,
    numeroBl: row.numero_bl ?? null,
    natureStock: row.nature_stock ?? null,
    regularise: row.regularise != null ? Boolean(row.regularise) : false,
    inMaintenance: row.in_maintenance != null ? Boolean(row.in_maintenance) : false,
    maintenancePrestataire: row.maintenance_prestataire ?? null,
    maintenanceDevis: row.maintenance_devis ?? null,
    accidente: row.accidente != null ? Boolean(row.accidente) : false,
    createdAt: row.created_at,
  };
}

// GET /vehicles — liste avec filtres search, status, inMaintenance, page, limit
router.get('/', async (req, res, next) => {
  try {
    const { search, status, inMaintenance, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));

    let where = [];
    let params = [];
    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      where.push('(v.vin LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR c.name LIKE ?)');
      params.push(term, term, term, term);
    }
    if (status && VEHICLE_STATUSES.includes(status)) {
      where.push('v.status = ?');
      params.push(status);
    }
    if (inMaintenance === '1' || inMaintenance === 'true') {
      where.push('v.in_maintenance = 1');
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM vehicles v
       LEFT JOIN clients c ON c.id = v.client_id ${whereClause}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    const [rows] = await pool.execute(
      `SELECT v.*, c.name AS client_name
       FROM vehicles v
       LEFT JOIN clients c ON c.id = v.client_id
       ${whereClause}
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.status(200).json({
      data: rows.map((r) => toVehicleRow(r)),
      total,
    });
  } catch (err) {
    next(err);
  }
});

// GET /vehicles/vin/:vin — détail par VIN (VIN 360° : transitSteps, documents, charges, history)
router.get('/vin/:vin', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT v.*, c.name AS client_name FROM vehicles v
       LEFT JOIN clients c ON c.id = v.client_id WHERE v.vin = ?`,
      [req.params.vin]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    }
    const vehicle = toVehicleRow(row);

    const [transitRows] = await pool.execute(
      'SELECT id, step_name, step_order, bl_reference, port_loading, port_unloading, date_arrival, vessel, consignee, shipper, metadata, created_at FROM transit_steps WHERE vehicle_id = ? ORDER BY step_order, created_at',
      [row.id]
    );
    vehicle.transitSteps = transitRows.map((t) => ({
      id: String(t.id),
      stepName: t.step_name,
      stepOrder: t.step_order,
      blReference: t.bl_reference,
      portLoading: t.port_loading,
      portUnloading: t.port_unloading,
      dateArrival: t.date_arrival,
      vessel: t.vessel,
      consignee: t.consignee,
      shipper: t.shipper,
      metadata: t.metadata,
      createdAt: t.created_at,
    }));

    const [docRows] = await pool.execute(
      'SELECT id, type, file_storage_path, ocr_payload, generated_from_template, operation_id, created_at FROM documents WHERE vehicle_id = ? ORDER BY created_at DESC',
      [row.id]
    );
    vehicle.documents = docRows.map((d) => ({
      id: String(d.id),
      type: d.type,
      fileStoragePath: d.file_storage_path,
      ocrPayload: d.ocr_payload,
      generatedFromTemplate: Boolean(d.generated_from_template),
      operationId: d.operation_id != null ? String(d.operation_id) : null,
      createdAt: d.created_at,
    }));

    const [chargeRows] = await pool.execute(
      'SELECT id, label, amount, currency, charge_type, created_at FROM charges WHERE vehicle_id = ? ORDER BY created_at',
      [row.id]
    );
    vehicle.charges = chargeRows.map((c) => ({
      id: String(c.id),
      label: c.label,
      amount: Number(c.amount),
      currency: c.currency,
      chargeType: c.charge_type,
      createdAt: c.created_at,
    }));
    const totalCost = chargeRows.reduce((sum, c) => sum + Number(c.amount), 0);
    vehicle.totalCost = totalCost;
    if (row.sale_price != null && totalCost > 0) {
      vehicle.margin = Number(row.sale_price) - totalCost;
      vehicle.marginRate = ((vehicle.margin / Number(row.sale_price)) * 100).toFixed(2);
    } else {
      vehicle.margin = null;
      vehicle.marginRate = null;
    }

    const [historyRows] = await pool.execute(
      'SELECT id, action, details, created_at FROM vehicle_history WHERE vehicle_id = ? ORDER BY created_at DESC',
      [row.id]
    );
    vehicle.history = historyRows.map((h) => ({
      id: String(h.id),
      action: h.action,
      details: h.details,
      createdAt: h.created_at,
    }));

    res.status(200).json(vehicle);
  } catch (err) {
    next(err);
  }
});

// GET /vehicles/:id — détail par ID (même structure enrichie que par VIN)
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const [rows] = await pool.execute(
      `SELECT v.*, c.name AS client_name FROM vehicles v
       LEFT JOIN clients c ON c.id = v.client_id WHERE v.id = ?`,
      [id]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    }
    const vehicle = toVehicleRow(row);

    const [transitRows] = await pool.execute(
      'SELECT id, step_name, step_order, bl_reference, port_loading, port_unloading, date_arrival, vessel, consignee, shipper, metadata, created_at FROM transit_steps WHERE vehicle_id = ? ORDER BY step_order, created_at',
      [row.id]
    );
    vehicle.transitSteps = transitRows.map((t) => ({
      id: String(t.id),
      stepName: t.step_name,
      stepOrder: t.step_order,
      blReference: t.bl_reference,
      portLoading: t.port_loading,
      portUnloading: t.port_unloading,
      dateArrival: t.date_arrival,
      vessel: t.vessel,
      consignee: t.consignee,
      shipper: t.shipper,
      metadata: t.metadata,
      createdAt: t.created_at,
    }));

    const [docRows] = await pool.execute(
      'SELECT id, type, file_storage_path, ocr_payload, generated_from_template, operation_id, created_at FROM documents WHERE vehicle_id = ? ORDER BY created_at DESC',
      [row.id]
    );
    vehicle.documents = docRows.map((d) => ({
      id: String(d.id),
      type: d.type,
      fileStoragePath: d.file_storage_path,
      ocrPayload: d.ocr_payload,
      generatedFromTemplate: Boolean(d.generated_from_template),
      operationId: d.operation_id != null ? String(d.operation_id) : null,
      createdAt: d.created_at,
    }));

    const [chargeRows] = await pool.execute(
      'SELECT id, label, amount, currency, charge_type, created_at FROM charges WHERE vehicle_id = ? ORDER BY created_at',
      [row.id]
    );
    vehicle.charges = chargeRows.map((c) => ({
      id: String(c.id),
      label: c.label,
      amount: Number(c.amount),
      currency: c.currency,
      chargeType: c.charge_type,
      createdAt: c.created_at,
    }));
    const totalCost = chargeRows.reduce((sum, c) => sum + Number(c.amount), 0);
    vehicle.totalCost = totalCost;
    if (row.sale_price != null && totalCost > 0) {
      vehicle.margin = Number(row.sale_price) - totalCost;
      vehicle.marginRate = ((vehicle.margin / Number(row.sale_price)) * 100).toFixed(2);
    } else {
      vehicle.margin = null;
      vehicle.marginRate = null;
    }

    const [historyRows] = await pool.execute(
      'SELECT id, action, details, created_at FROM vehicle_history WHERE vehicle_id = ? ORDER BY created_at DESC',
      [row.id]
    );
    vehicle.history = historyRows.map((h) => ({
      id: String(h.id),
      action: h.action,
      details: h.details,
      createdAt: h.created_at,
    }));

    res.status(200).json(vehicle);
  } catch (err) {
    next(err);
  }
});

// POST /vehicles — optionnel : purchaseId (lien achat), purchasePrice, currency (préremplis depuis un achat)
router.post('/', async (req, res, next) => {
  try {
    const { vin, chassisNumber, brand, model, year, color, vehicleType, purchaseId, purchasePrice, currency } = req.body;
    if (!vin || !brand || !model || year == null) {
      return res.status(400).json({ message: 'vin, brand, model et year sont requis', statusCode: 400 });
    }
    const pid = purchaseId != null && purchaseId !== '' ? parseInt(purchaseId, 10) : null;
    const [result] = await pool.execute(
      `INSERT INTO vehicles (vin, chassis_number, brand, model, year, color, vehicle_type, purchase_id, purchase_price, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(vin).trim(),
        chassisNumber ? String(chassisNumber).trim() : null,
        String(brand).trim(),
        String(model).trim(),
        parseInt(year, 10),
        color ? String(color).trim() : null,
        vehicleType ? String(vehicleType).trim() : null,
        pid && !Number.isNaN(pid) ? pid : null,
        purchasePrice != null ? Number(purchasePrice) : null,
        currency ? String(currency).trim() : null,
      ]
    );
    const [rows] = await pool.execute(
      'SELECT v.*, c.name AS client_name FROM vehicles v LEFT JOIN clients c ON c.id = v.client_id WHERE v.id = ?',
      [result.insertId]
    );
    const vehicle = toVehicleRow(rows[0]);
    await pool.execute(
      'INSERT INTO vehicle_history (vehicle_id, action, details) VALUES (?, ?, ?)',
      [result.insertId, 'CREATION', JSON.stringify({ vin: vehicle.vin })]
    );
    res.status(201).json(vehicle);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Un véhicule avec ce VIN existe déjà', statusCode: 400 });
    }
    next(err);
  }
});

// PATCH /vehicles/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const allowed = [
      'chassisNumber', 'brand', 'model', 'year', 'color', 'vehicleType', 'status', 'clientId',
      'purchasePrice', 'salePrice', 'currency', 'purchaseId',
      'dateEntreePort', 'dateEntreeParc', 'numeroBl', 'natureStock', 'regularise',
      'inMaintenance', 'maintenancePrestataire', 'maintenanceDevis', 'accidente',
    ];
    const dbMap = {
      chassisNumber: 'chassis_number',
      vehicleType: 'vehicle_type',
      clientId: 'client_id',
      purchasePrice: 'purchase_price',
      salePrice: 'sale_price',
      purchaseId: 'purchase_id',
      dateEntreePort: 'date_entree_port',
      dateEntreeParc: 'date_entree_parc',
      numeroBl: 'numero_bl',
      natureStock: 'nature_stock',
      maintenancePrestataire: 'maintenance_prestataire',
      maintenanceDevis: 'maintenance_devis',
    };
    const NATURE_STOCK_VALUES = ['DEPOT', 'TRANSIT', 'CONSOMMATION', 'AUTRES'];
    const updates = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      const col = dbMap[key] ?? key;
      if (key === 'clientId') {
        const raw = req.body[key];
        const num = raw === null || raw === '' ? null : parseInt(req.body[key], 10);
        if (num !== null && Number.isNaN(num)) continue; // valeur invalide, on ignore
        updates.push(`${col} = ?`);
        params.push(num);
      } else if (key === 'year' || key === 'purchasePrice' || key === 'salePrice') {
        const raw = req.body[key];
        const num = raw == null ? null : Number(raw);
        if (num !== null && Number.isNaN(num)) continue; // éviter d'envoyer NaN à MySQL
        updates.push(`${col} = ?`);
        params.push(num);
      } else if (key === 'status' && VEHICLE_STATUSES.includes(req.body[key])) {
        updates.push(`${col} = ?`);
        params.push(req.body[key]);
      } else if (key === 'regularise') {
        updates.push('regularise = ?');
        params.push(req.body[key] ? 1 : 0);
      } else if (key === 'inMaintenance') {
        updates.push('in_maintenance = ?');
        params.push(req.body[key] ? 1 : 0);
      } else if (key === 'accidente') {
        updates.push('accidente = ?');
        params.push(req.body[key] ? 1 : 0);
      } else if (key === 'purchaseId') {
        updates.push('purchase_id = ?');
        params.push(req.body[key] == null || req.body[key] === '' ? null : parseInt(req.body[key], 10));
      } else if (key === 'natureStock' && (req.body[key] == null || NATURE_STOCK_VALUES.includes(req.body[key]))) {
        updates.push(`${col} = ?`);
        params.push(req.body[key] == null ? null : String(req.body[key]).trim());
      } else if (key === 'dateEntreePort' || key === 'dateEntreeParc') {
        updates.push(`${col} = ?`);
        const raw = req.body[key];
        if (raw == null || raw === '') {
          params.push(null);
        } else {
          const d = new Date(raw);
          params.push(Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' '));
        }
      } else if (key !== 'status' && key !== 'natureStock') {
        updates.push(`${col} = ?`);
        params.push(req.body[key] == null ? null : String(req.body[key]).trim());
      }
    }
    if (updates.length === 0) {
      const [rows] = await pool.execute(
        'SELECT v.*, c.name AS client_name FROM vehicles v LEFT JOIN clients c ON c.id = v.client_id WHERE v.id = ?',
        [id]
      );
      if (!rows[0]) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
      return res.status(200).json(toVehicleRow(rows[0]));
    }
    params.push(id);
    await pool.execute(`UPDATE vehicles SET ${updates.join(', ')} WHERE id = ?`, params);
    const [rows] = await pool.execute(
      'SELECT v.*, c.name AS client_name FROM vehicles v LEFT JOIN clients c ON c.id = v.client_id WHERE v.id = ?',
      [id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    await pool.execute(
      'INSERT INTO vehicle_history (vehicle_id, action, details) VALUES (?, ?, ?)',
      [id, 'MODIFICATION', JSON.stringify(req.body)]
    );
    res.status(200).json(toVehicleRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

export default router;
