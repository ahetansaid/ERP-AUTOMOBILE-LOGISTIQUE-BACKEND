import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';
import { UPLOAD_DIR } from '../config.js';

const router = Router();
router.use(authMiddleware);

const proformaDir = path.join(process.cwd(), UPLOAD_DIR, 'proformas');
try {
  fs.mkdirSync(proformaDir, { recursive: true });
} catch (_) {}

function toProformaRow(row) {
  return {
    id: String(row.id),
    vehicleId: String(row.vehicle_id),
    estimatedCosts: row.estimated_costs,
    schedule: row.schedule,
    pdfPath: row.pdf_path,
    createdAt: row.created_at,
  };
}

async function ensureVehicleExists(vehicleId) {
  const [rows] = await pool.execute('SELECT id, vin, brand, model, year, purchase_price, sale_price, currency FROM vehicles WHERE id = ?', [vehicleId]);
  return rows[0] || null;
}

// GET /vehicles/:vehicleId/proformas
router.get('/:vehicleId/proformas', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ message: 'ID véhicule invalide', statusCode: 400 });
    const [rows] = await pool.execute(
      'SELECT id, vehicle_id, estimated_costs, schedule, pdf_path, created_at FROM proformas WHERE vehicle_id = ? ORDER BY created_at DESC',
      [vehicleId]
    );
    res.status(200).json({ data: rows.map(toProformaRow) });
  } catch (err) {
    next(err);
  }
});

// POST /vehicles/:vehicleId/proformas — création proforma (estimatedCosts, schedule) + génération PDF optionnelle
router.post('/:vehicleId/proformas', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ message: 'ID véhicule invalide', statusCode: 400 });
    const vehicle = await ensureVehicleExists(vehicleId);
    if (!vehicle) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    const { estimatedCosts, schedule, generatePdf } = req.body;
    const estimatedCostsJson = estimatedCosts != null
      ? (typeof estimatedCosts === 'string' ? JSON.parse(estimatedCosts) : estimatedCosts)
      : null;
    const scheduleJson = schedule != null
      ? (typeof schedule === 'string' ? JSON.parse(schedule) : schedule)
      : null;
    let pdfPath = null;
    const [result] = await pool.execute(
      'INSERT INTO proformas (vehicle_id, estimated_costs, schedule, pdf_path) VALUES (?, ?, ?, ?)',
      [vehicleId, estimatedCostsJson ? JSON.stringify(estimatedCostsJson) : null, scheduleJson ? JSON.stringify(scheduleJson) : null, null]
    );
    const proformaId = result.insertId;
    if (generatePdf) {
      const dir = path.join(proformaDir, String(vehicleId));
      fs.mkdirSync(dir, { recursive: true });
      const filename = `proforma-${proformaId}-${Date.now()}.pdf`;
      pdfPath = path.join(dir, filename);
      const relativePath = path.relative(process.cwd(), pdfPath).replace(/\\/g, '/');
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);
      doc.fontSize(18).text('PROFORMA INTERNE', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Véhicule: ${vehicle.year} ${vehicle.brand} ${vehicle.model}`, { align: 'left' });
      doc.text(`VIN: ${vehicle.vin}`, { align: 'left' });
      doc.moveDown();
      if (estimatedCostsJson && Array.isArray(estimatedCostsJson)) {
        doc.text('Coûts estimés:', { underline: true });
        estimatedCostsJson.forEach((line) => {
          doc.text(`  - ${line.label || line.name || ''}: ${line.amount ?? ''} ${line.currency ?? 'FCFA'}`);
        });
        doc.moveDown();
      }
      if (scheduleJson && Array.isArray(scheduleJson)) {
        doc.text('Échéancier:', { underline: true });
        scheduleJson.forEach((e) => {
          doc.text(`  - ${e.date || ''}: ${e.amount ?? ''} ${e.currency ?? 'FCFA'} ${e.label || ''}`);
        });
      }
      doc.end();
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
      await pool.execute('UPDATE proformas SET pdf_path = ? WHERE id = ?', [relativePath, proformaId]);
    }
    const [rows] = await pool.execute(
      'SELECT id, vehicle_id, estimated_costs, schedule, pdf_path, created_at FROM proformas WHERE id = ?',
      [proformaId]
    );
    const out = toProformaRow(rows[0]);
    if (pdfPath) out.pdfPath = path.relative(process.cwd(), pdfPath).replace(/\\/g, '/');
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

// GET /vehicles/:vehicleId/proformas/:proformaId
router.get('/:vehicleId/proformas/:proformaId', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    const proformaId = parseInt(req.params.proformaId, 10);
    if (Number.isNaN(vehicleId) || Number.isNaN(proformaId)) return res.status(400).json({ message: 'IDs invalides', statusCode: 400 });
    const [rows] = await pool.execute(
      'SELECT id, vehicle_id, estimated_costs, schedule, pdf_path, created_at FROM proformas WHERE id = ? AND vehicle_id = ?',
      [proformaId, vehicleId]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Proforma non trouvée', statusCode: 404 });
    res.status(200).json(toProformaRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

export default router;
