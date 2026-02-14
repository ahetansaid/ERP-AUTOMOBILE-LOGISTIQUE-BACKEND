import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

const TYPE_ACHAT = ['VRAC', 'CONTENEUR'];

function toPurchaseRow(row) {
  return {
    id: String(row.id),
    purchasePrice: row.purchase_price != null ? Number(row.purchase_price) : null,
    currency: row.currency ?? null,
    typeAchat: row.type_achat ?? null,
    containerReference: row.container_reference ?? null,
    vessel: row.vessel ?? null,
    conversionRate: row.conversion_rate != null ? Number(row.conversion_rate) : null,
    amountFcfa: row.amount_fcfa != null ? Number(row.amount_fcfa) : null,
    purchaseDate: row.purchase_date ?? null,
    notes: row.notes ?? null,
    vin: row.vin ?? null,
    brand: row.brand ?? null,
    model: row.model ?? null,
    color: row.color ?? null,
    year: row.year != null ? Number(row.year) : null,
    vehicleType: row.vehicle_type ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /purchases — liste avec filtres (type, page, limit)
router.get('/', async (req, res, next) => {
  try {
    const { typeAchat, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, Math.min(100, parseInt(limit, 10)));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const where = [];
    const params = [];
    if (typeAchat && TYPE_ACHAT.includes(typeAchat)) {
      where.push('type_achat = ?');
      params.push(typeAchat);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM purchases ${whereClause}`, params);
    const total = countRows[0]?.total ?? 0;
    const [rows] = await pool.execute(
      `SELECT * FROM purchases ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    res.status(200).json({ data: rows.map(toPurchaseRow), total });
  } catch (err) {
    next(err);
  }
});

// GET /purchases/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const [rows] = await pool.execute('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Achat non trouvé', statusCode: 404 });
    res.status(200).json(toPurchaseRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// POST /purchases — nouvel achat (bloc véhicule: vin, brand, model, color, year, vehicleType ; prix ; type vrac/conteneur ; conteneur ; navire si vrac)
router.post('/', async (req, res, next) => {
  try {
    const {
      purchasePrice,
      currency,
      typeAchat,
      containerReference,
      vessel,
      conversionRate,
      amountFcfa,
      purchaseDate,
      notes,
      vin,
      brand,
      model,
      color,
      year,
      vehicleType,
    } = req.body;
    if (purchasePrice == null) return res.status(400).json({ message: 'purchasePrice requis', statusCode: 400 });
    if (!typeAchat || !TYPE_ACHAT.includes(typeAchat)) {
      return res.status(400).json({ message: 'typeAchat requis (VRAC | CONTENEUR)', statusCode: 400 });
    }
    if (typeAchat === 'VRAC') {
      if (!containerReference || !String(containerReference).trim()) {
        return res.status(400).json({ message: 'En achat vrac, conteneur et navire sont obligatoires', statusCode: 400 });
      }
      if (!vessel || !String(vessel).trim()) {
        return res.status(400).json({ message: 'En achat vrac, conteneur et navire sont obligatoires', statusCode: 400 });
      }
    }
    if (typeAchat === 'CONTENEUR') {
      if (!containerReference || !String(containerReference).trim()) {
        return res.status(400).json({ message: 'En achat conteneur, le conteneur est obligatoire', statusCode: 400 });
      }
    }
    const price = Number(purchasePrice);
    if (Number.isNaN(price)) return res.status(400).json({ message: 'purchasePrice invalide', statusCode: 400 });
    const rate = conversionRate != null ? Number(conversionRate) : null;
    const fcfa = amountFcfa != null ? Number(amountFcfa) : (rate != null && !Number.isNaN(rate) ? price * rate : null);
    let purchaseDateVal = purchaseDate ?? null;
    if (purchaseDateVal && typeof purchaseDateVal === 'string') {
      const d = new Date(purchaseDateVal);
      purchaseDateVal = Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
    }
    const yearVal = year != null && year !== '' ? parseInt(year, 10) : null;
    const [result] = await pool.execute(
      `INSERT INTO purchases (purchase_price, currency, type_achat, container_reference, vessel, conversion_rate, amount_fcfa, purchase_date, notes, vin, brand, model, color, year, vehicle_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        price,
        currency ?? 'USD',
        typeAchat,
        containerReference ?? null,
        vessel ? String(vessel).trim() : null,
        rate,
        fcfa,
        purchaseDateVal,
        notes ?? null,
        vin ? String(vin).trim() : null,
        brand ? String(brand).trim() : null,
        model ? String(model).trim() : null,
        color ? String(color).trim() : null,
        yearVal && !Number.isNaN(yearVal) ? yearVal : null,
        vehicleType != null && vehicleType !== '' ? String(vehicleType).trim() : null,
      ]
    );
    const [rows] = await pool.execute('SELECT * FROM purchases WHERE id = ?', [result.insertId]);
    res.status(201).json(toPurchaseRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

// PATCH /purchases/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    const {
      purchasePrice,
      currency,
      typeAchat,
      containerReference,
      vessel,
      conversionRate,
      amountFcfa,
      purchaseDate,
      notes,
      vin,
      brand,
      model,
      color,
      year,
      vehicleType,
    } = req.body;
    const updates = [];
    const params = [];
    if (purchasePrice !== undefined) { updates.push('purchase_price = ?'); params.push(Number(purchasePrice)); }
    if (currency !== undefined) { updates.push('currency = ?'); params.push(currency); }
    if (typeAchat !== undefined && TYPE_ACHAT.includes(typeAchat)) { updates.push('type_achat = ?'); params.push(typeAchat); }
    if (containerReference !== undefined) { updates.push('container_reference = ?'); params.push(containerReference ?? null); }
    if (vessel !== undefined) { updates.push('vessel = ?'); params.push(vessel == null || vessel === '' ? null : String(vessel).trim()); }
    if (conversionRate !== undefined) { updates.push('conversion_rate = ?'); params.push(conversionRate == null ? null : Number(conversionRate)); }
    if (amountFcfa !== undefined) { updates.push('amount_fcfa = ?'); params.push(amountFcfa == null ? null : Number(amountFcfa)); }
    if (purchaseDate !== undefined) {
      let v = purchaseDate;
      if (v && typeof v === 'string') {
        const d = new Date(v);
        v = Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
      }
      updates.push('purchase_date = ?');
      params.push(v ?? null);
    }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes ?? null); }
    if (vin !== undefined) { updates.push('vin = ?'); params.push(vin == null || vin === '' ? null : String(vin).trim()); }
    if (brand !== undefined) { updates.push('brand = ?'); params.push(brand == null || brand === '' ? null : String(brand).trim()); }
    if (model !== undefined) { updates.push('model = ?'); params.push(model == null || model === '' ? null : String(model).trim()); }
    if (color !== undefined) { updates.push('color = ?'); params.push(color == null || color === '' ? null : String(color).trim()); }
    if (year !== undefined) { updates.push('year = ?'); params.push(year == null || year === '' ? null : (Number.isNaN(parseInt(year, 10)) ? null : parseInt(year, 10))); }
    if (vehicleType !== undefined) { updates.push('vehicle_type = ?'); params.push(vehicleType == null || vehicleType === '' ? null : String(vehicleType).trim()); }
    if (updates.length === 0) {
      const [rows] = await pool.execute('SELECT * FROM purchases WHERE id = ?', [id]);
      if (!rows[0]) return res.status(404).json({ message: 'Achat non trouvé', statusCode: 404 });
      return res.status(200).json(toPurchaseRow(rows[0]));
    }
    params.push(id);
    await pool.execute(`UPDATE purchases SET ${updates.join(', ')} WHERE id = ?`, params);
    const [rows] = await pool.execute('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Achat non trouvé', statusCode: 404 });
    res.status(200).json(toPurchaseRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

export default router;
