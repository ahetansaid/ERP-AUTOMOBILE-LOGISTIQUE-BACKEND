import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';
import { DOCUMENT_TYPES, UPLOAD_DIR } from '../config.js';

const router = Router();
router.use(authMiddleware);

const docDir = path.join(process.cwd(), UPLOAD_DIR, 'documents');
try {
  fs.mkdirSync(docDir, { recursive: true });
} catch (_) {}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const vehicleId = req.params.vehicleId;
    const dir = path.join(docDir, String(vehicleId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20 Mo

function toDocRow(row) {
  return {
    id: String(row.id),
    type: row.type,
    fileStoragePath: row.file_storage_path,
    ocrPayload: row.ocr_payload,
    generatedFromTemplate: Boolean(row.generated_from_template),
    operationId: row.operation_id != null ? String(row.operation_id) : null,
    createdAt: row.created_at,
  };
}

async function ensureVehicleExists(vehicleId) {
  const [rows] = await pool.execute('SELECT id FROM vehicles WHERE id = ?', [vehicleId]);
  if (!rows.length) return false;
  return true;
}

// GET /vehicles/:vehicleId/documents
router.get('/:vehicleId/documents', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ message: 'ID véhicule invalide', statusCode: 400 });
    if (!(await ensureVehicleExists(vehicleId))) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    const [rows] = await pool.execute(
      'SELECT id, type, file_storage_path, ocr_payload, generated_from_template, operation_id, created_at FROM documents WHERE vehicle_id = ? ORDER BY created_at DESC',
      [vehicleId]
    );
    res.status(200).json({ data: rows.map(toDocRow) });
  } catch (err) {
    next(err);
  }
});

// POST /vehicles/:vehicleId/documents — upload fichier + type, optionnel ocrPayload, operationId
router.post('/:vehicleId/documents', upload.single('file'), async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ message: 'ID véhicule invalide', statusCode: 400 });
    if (!(await ensureVehicleExists(vehicleId))) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    const type = req.body.type || req.body.documentType;
    if (!type || !DOCUMENT_TYPES.includes(type)) {
      return res.status(400).json({ message: 'type requis (BL, FACTURE_ACHAT, QUITTANCE, FACTURE_MECEF, PROFORMA, PHOTO, AUTRE)', statusCode: 400 });
    }
    let fileStoragePath = null;
    if (req.file) fileStoragePath = path.relative(process.cwd(), req.file.path).replace(/\\/g, '/');
    let ocrPayload = null;
    if (req.body.ocrPayload) {
      try {
        ocrPayload = typeof req.body.ocrPayload === 'string' ? JSON.parse(req.body.ocrPayload) : req.body.ocrPayload;
      } catch (_) {}
    }
    const operationId = req.body.operationId ? parseInt(req.body.operationId, 10) : null;
    const [result] = await pool.execute(
      'INSERT INTO documents (vehicle_id, type, file_storage_path, ocr_payload, generated_from_template, operation_id) VALUES (?, ?, ?, ?, 0, ?)',
      [vehicleId, type, fileStoragePath, ocrPayload ? JSON.stringify(ocrPayload) : null, operationId]
    );
    const [rows] = await pool.execute(
      'SELECT id, type, file_storage_path, ocr_payload, generated_from_template, operation_id, created_at FROM documents WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(toDocRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// POST /vehicles/:vehicleId/documents/generate-bl — génération BL (template) à partir des données transit + véhicule
router.post('/:vehicleId/documents/generate-bl', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ message: 'ID véhicule invalide', statusCode: 400 });
    const [vehRows] = await pool.execute(
      'SELECT v.*, c.name AS client_name, c.address AS client_address FROM vehicles v LEFT JOIN clients c ON c.id = v.client_id WHERE v.id = ?',
      [vehicleId]
    );
    const vehicle = vehRows[0];
    if (!vehicle) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    const [stepRows] = await pool.execute(
      'SELECT * FROM transit_steps WHERE vehicle_id = ? ORDER BY step_order, created_at LIMIT 1',
      [vehicleId]
    );
    const step = stepRows[0] || {};
    const blData = {
      office: req.body.office ?? 'BJB01',
      portOperation: req.body.portOperation ?? 'COTONOU-PORT (RP)',
      manifest: step.metadata?.manifest ?? req.body.manifest ?? null,
      dateArrival: step.date_arrival ?? req.body.dateArrival ?? null,
      voyage: step.metadata?.voyage ?? req.body.voyage ?? null,
      blType: step.metadata?.blType ?? req.body.blType ?? 'CMD',
      blReference: step.bl_reference ?? req.body.blReference ?? null,
      nature: step.metadata?.nature ?? req.body.nature ?? null,
      prevDoc: step.metadata?.prevDoc ?? req.body.prevDoc ?? null,
      shipper: step.shipper ?? req.body.shipper ?? null,
      consignee: step.consignee ?? (vehicle.client_name ? `${vehicle.client_name} ${vehicle.client_address || ''}`.trim() : null) ?? req.body.consignee ?? null,
      notifier: req.body.notifier ?? 'SAME AS CONSIGNEE',
      placeOfLoading: step.port_loading ?? req.body.placeOfLoading ?? null,
      placeOfUnloading: step.port_unloading ?? req.body.placeOfUnloading ?? 'BJCOO COTONOU',
      transportMode: 'Maritime',
      vessel: step.vessel ?? req.body.vessel ?? null,
      carrier: step.metadata?.carrier ?? req.body.carrier ?? null,
      marksAndNumbers: `${vehicle.year} ${vehicle.brand} ${vehicle.model} VIN: ${vehicle.vin}`,
      packageType: req.body.packageType ?? 'VN',
      packageDetail: req.body.packageDetail ?? 'Véhicule nu',
      packagesCount: 1,
      grossWeight: req.body.grossWeight ?? null,
      volumeCbm: req.body.volumeCbm ?? null,
      description: `${vehicle.year} ${vehicle.brand} ${vehicle.model} VIN: ${vehicle.vin}`,
      freight: req.body.freight ?? null,
      customsValue: req.body.customsValue ?? null,
    };
    const [result] = await pool.execute(
      'INSERT INTO documents (vehicle_id, type, file_storage_path, ocr_payload, generated_from_template, operation_id) VALUES (?, ?, NULL, ?, 1, NULL)',
      [vehicleId, 'BL', JSON.stringify(blData)]
    );
    const [rows] = await pool.execute(
      'SELECT id, type, file_storage_path, ocr_payload, generated_from_template, operation_id, created_at FROM documents WHERE id = ?',
      [result.insertId]
    );
    const doc = toDocRow(rows[0]);
    doc.generatedBlData = blData;
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

export default router;
