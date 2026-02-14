import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();

function toCompanyRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    logoPath: row.logo_path ?? null,
    raisonSociale: row.raison_sociale ?? null,
    adresse: row.adresse ?? null,
    ifu: row.ifu ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    siteWeb: row.site_web ?? null,
    updatedAt: row.updated_at,
  };
}

// GET /company-info — public (pour PDF avec logo et infos)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM company_info WHERE id = 1');
    res.status(200).json(toCompanyRow(rows[0]) || {});
  } catch (err) {
    next(err);
  }
});

// PATCH /company-info — protégé
router.patch('/', authMiddleware, async (req, res, next) => {
  try {
    const { logoPath, raisonSociale, adresse, ifu, phone, email, siteWeb } = req.body;
    const updates = [];
    const params = [];
    if (logoPath !== undefined) { updates.push('logo_path = ?'); params.push(logoPath); }
    if (raisonSociale !== undefined) { updates.push('raison_sociale = ?'); params.push(raisonSociale); }
    if (adresse !== undefined) { updates.push('adresse = ?'); params.push(adresse); }
    if (ifu !== undefined) { updates.push('ifu = ?'); params.push(ifu); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (siteWeb !== undefined) { updates.push('site_web = ?'); params.push(siteWeb); }
    if (updates.length === 0) {
      const [rows] = await pool.execute('SELECT * FROM company_info WHERE id = 1');
      return res.status(200).json(toCompanyRow(rows[0]) || {});
    }
    await pool.execute(`UPDATE company_info SET ${updates.join(', ')} WHERE id = 1`, params);
    const [rows] = await pool.execute('SELECT * FROM company_info WHERE id = 1');
    res.status(200).json(toCompanyRow(rows[0]) || {});
  } catch (err) {
    next(err);
  }
});

export default router;
