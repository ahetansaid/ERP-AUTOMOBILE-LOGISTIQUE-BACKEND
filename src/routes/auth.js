const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getPool } = require('../config/database');
const { JWT_SECRET, JWT_REFRESH_SECRET } = require('../middleware/auth');

const router = express.Router();
const EXPIRES_IN = '30m';
const REFRESH_EXPIRES = '7d';

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis', statusCode: 400 });
    }
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, email, first_name, last_name, role, company_id, password FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
      [email]
    );
    if (!rows.length) {
      return res.status(401).json({ message: 'Identifiants incorrects', statusCode: 401 });
    }
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Identifiants incorrects', statusCode: 401 });
    }
    const payload = { id: user.id, email: user.email, role: user.role, companyId: user.company_id };
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
    const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    const expiresInSeconds = 30 * 60;
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        companyId: user.company_id,
      },
      accessToken,
      refreshToken,
      expiresIn: expiresInSeconds,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ message: 'refreshToken requis', statusCode: 400 });
    }
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ message: 'Token invalide', statusCode: 401 });
    }
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, email, role, company_id FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
      [decoded.id]
    );
    if (!rows.length) {
      return res.status(401).json({ message: 'Utilisateur introuvable', statusCode: 401 });
    }
    const user = rows[0];
    const payload = { id: user.id, email: user.email, role: user.role, companyId: user.company_id };
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
    const expiresInSeconds = 30 * 60;
    return res.status(200).json({ accessToken, expiresIn: expiresInSeconds });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expiré ou invalide', statusCode: 401 });
    }
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/logout', (req, res) => {
  res.status(200).json({ message: 'Déconnexion réussie' });
});

module.exports = router;
