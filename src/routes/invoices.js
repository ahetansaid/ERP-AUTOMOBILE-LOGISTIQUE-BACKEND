import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';
import { UPLOAD_DIR } from '../config.js';

const router = Router();
router.use(authMiddleware);

const invoiceDir = path.join(process.cwd(), UPLOAD_DIR, 'invoices');
try {
  fs.mkdirSync(invoiceDir, { recursive: true });
} catch (_) {}

function toInvoiceRow(row, extra = {}) {
  return {
    id: String(row.id),
    vehicleId: String(row.vehicle_id),
    status: row.status ?? 'FACTURE',
    typeFacture: row.type_facture ?? 'COMPLETE',
    clientId: row.client_id != null ? String(row.client_id) : null,
    tvaRate: row.tva_rate != null ? Number(row.tva_rate) : null,
    lines: row.lines ?? null,
    invoiceNumber: row.invoice_number ?? null,
    mecefCode: row.mecef_code ?? null,
    qrCodePath: row.qr_code_path ?? null,
    pdfPath: row.pdf_path ?? null,
    amount: row.amount != null ? Number(row.amount) : null,
    sentAt: row.sent_at ?? null,
    createdAt: row.created_at,
    ...extra,
  };
}

// GET /invoices — liste avec filtres (vehicleId, status pour devis/facture)
router.get('/', async (req, res, next) => {
  try {
    const { vehicleId, status, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const where = [];
    const params = [];
    if (vehicleId) { where.push('i.vehicle_id = ?'); params.push(vehicleId); }
    if (status && ['DEVIS', 'FACTURE'].includes(status)) { where.push('i.status = ?'); params.push(status); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM invoices i ${whereClause}`,
      params
    );
    const total = countRows[0]?.total ?? 0;
    const [rows] = await pool.execute(
      `SELECT i.*, v.vin, v.brand, v.model, v.year, c.name AS client_name
       FROM invoices i
       JOIN vehicles v ON v.id = i.vehicle_id
       LEFT JOIN clients c ON c.id = i.client_id
       ${whereClause}
       ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    res.status(200).json({
      data: rows.map((r) => ({
        ...toInvoiceRow(r),
        vehicleVin: r.vin,
        vehicleLabel: `${r.year} ${r.brand} ${r.model}`,
        clientName: r.client_name ?? null,
      })),
      total,
    });
  } catch (err) {
    next(err);
  }
});

// GET /invoices/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const [rows] = await pool.execute(
      `SELECT i.*, v.vin, v.brand, v.model, v.year,
              c.name AS client_name, c.address AS client_address
       FROM invoices i JOIN vehicles v ON v.id = i.vehicle_id
       LEFT JOIN clients c ON c.id = COALESCE(i.client_id, v.client_id)
       WHERE i.id = ?`,
      [id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ message: 'Facture non trouvée', statusCode: 404 });
    const inv = toInvoiceRow(row, {
      vehicleVin: row.vin,
      vehicleLabel: `${row.year} ${row.brand} ${row.model}`,
      clientName: row.client_name,
      clientAddress: row.client_address,
    });
    res.status(200).json(inv);
  } catch (err) {
    next(err);
  }
});

// POST /invoices — création devis ou facture (vehicleId, amount, status, clientId, lines, tvaRate, typeFacture, generatePdf)
router.post('/', async (req, res, next) => {
  try {
    const { vehicleId, amount, status, clientId, lines, tvaRate, typeFacture, invoiceNumber, generatePdf } = req.body;
    if (!vehicleId) return res.status(400).json({ message: 'vehicleId requis', statusCode: 400 });
    const vid = parseInt(vehicleId, 10);
    if (Number.isNaN(vid)) return res.status(400).json({ message: 'vehicleId invalide', statusCode: 400 });
    const [vehRows] = await pool.execute(
      'SELECT v.*, c.name AS client_name, c.address AS client_address FROM vehicles v LEFT JOIN clients c ON c.id = v.client_id WHERE v.id = ?',
      [vid]
    );
    const vehicle = vehRows[0];
    if (!vehicle) return res.status(404).json({ message: 'Véhicule non trouvé', statusCode: 404 });
    const invAmount = amount != null ? Number(amount) : (vehicle.sale_price != null ? Number(vehicle.sale_price) : null);
    const invStatus = status === 'DEVIS' ? 'DEVIS' : 'FACTURE';
    const invType = typeFacture === 'TEMPORAIRE' ? 'TEMPORAIRE' : 'COMPLETE';
    const cid = clientId != null ? parseInt(clientId, 10) : vehicle.client_id;
    const linesJson = lines != null ? (typeof lines === 'string' ? lines : JSON.stringify(lines)) : null;
    const [result] = await pool.execute(
      `INSERT INTO invoices (vehicle_id, amount, status, type_facture, client_id, tva_rate, lines, invoice_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [vid, invAmount, invStatus, invType, cid, tvaRate != null ? Number(tvaRate) : null, linesJson, invoiceNumber ?? null]
    );
    const invoiceId = result.insertId;
    let pdfPath = null;
    let mecefCode = null;
    if (generatePdf) {
      const dir = path.join(invoiceDir, String(vid));
      fs.mkdirSync(dir, { recursive: true });
      const filename = `facture-mecef-${invoiceId}-${Date.now()}.pdf`;
      const fullPath = path.join(dir, filename);
      pdfPath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(fullPath);
      doc.pipe(stream);
      doc.fontSize(16).text('FACTURE NORMALISÉE (Modèle MECeF)', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`Facture n° ${invoiceId}`, { align: 'right' });
      doc.text(`Date: ${new Date().toLocaleDateString('fr-FR')}`, { align: 'right' });
      doc.moveDown();
      doc.text(`Client: ${vehicle.client_name || '-'}`, { align: 'left' });
      doc.text(`Adresse: ${vehicle.client_address || '-'}`, { align: 'left' });
      doc.moveDown();
      doc.text(`Véhicule: ${vehicle.year} ${vehicle.brand} ${vehicle.model} - VIN: ${vehicle.vin}`, { align: 'left' });
      doc.text(`Montant: ${invAmount ?? 0} FCFA`, { align: 'left' });
      doc.moveDown();
      doc.fontSize(9).text('Code MECeF / QR: à renseigner après transmission DGI (agrément SFE)', { align: 'center' });
      doc.end();
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
      mecefCode = `MECEF-PLACEHOLDER-${invoiceId}`;
      await pool.execute('UPDATE invoices SET pdf_path = ?, mecef_code = ? WHERE id = ?', [pdfPath, mecefCode, invoiceId]);
    }
    const [rows] = await pool.execute(
      'SELECT id, vehicle_id, mecef_code, qr_code_path, pdf_path, amount, sent_at, created_at FROM invoices WHERE id = ?',
      [invoiceId]
    );
    const out = toInvoiceRow(rows[0]);
    if (pdfPath) out.pdfPath = pdfPath;
    if (mecefCode) out.mecefCode = mecefCode;
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

// PATCH /invoices/:id — mise à jour (status, typeFacture, clientId, lines, tvaRate, mecefCode, sentAt, etc.)
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const { status, typeFacture, clientId, lines, tvaRate, invoiceNumber, mecefCode, qrCodePath, pdfPath, sentAt } = req.body;
    const updates = [];
    const params = [];
    if (status !== undefined && ['DEVIS', 'FACTURE'].includes(status)) { updates.push('status = ?'); params.push(status); }
    if (typeFacture !== undefined && ['TEMPORAIRE', 'COMPLETE'].includes(typeFacture)) { updates.push('type_facture = ?'); params.push(typeFacture); }
    if (clientId !== undefined) { updates.push('client_id = ?'); params.push(clientId == null ? null : parseInt(clientId, 10)); }
    if (lines !== undefined) { updates.push('lines = ?'); params.push(typeof lines === 'string' ? lines : JSON.stringify(lines)); }
    if (tvaRate !== undefined) { updates.push('tva_rate = ?'); params.push(tvaRate == null ? null : Number(tvaRate)); }
    if (invoiceNumber !== undefined) { updates.push('invoice_number = ?'); params.push(invoiceNumber); }
    if (mecefCode !== undefined) { updates.push('mecef_code = ?'); params.push(mecefCode); }
    if (qrCodePath !== undefined) { updates.push('qr_code_path = ?'); params.push(qrCodePath); }
    if (pdfPath !== undefined) { updates.push('pdf_path = ?'); params.push(pdfPath); }
    if (sentAt !== undefined) { updates.push('sent_at = ?'); params.push(sentAt); }
    if (updates.length === 0) {
      const [rows] = await pool.execute('SELECT * FROM invoices WHERE id = ?', [id]);
      if (!rows[0]) return res.status(404).json({ message: 'Facture non trouvée', statusCode: 404 });
      return res.status(200).json(toInvoiceRow(rows[0]));
    }
    params.push(id);
    await pool.execute(`UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`, params);
    const [rows] = await pool.execute('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Facture non trouvée', statusCode: 404 });
    res.status(200).json(toInvoiceRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

export default router;
