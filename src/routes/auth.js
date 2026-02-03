import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';
import {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN,
} from '../config.js';

const router = Router();

function toUserRow(row) {
  return {
    id: String(row.id),
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
  };
}

function getAccessExpiresInSeconds() {
  const match = JWT_ACCESS_EXPIRES_IN.match(/^(\d+)([smhd])$/);
  if (!match) return 900;
  const [, n, u] = match;
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(n) * (multipliers[u] ?? 60);
}

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis', statusCode: 400 });
    }
    const [rows] = await pool.execute(
      'SELECT id, email, password_hash, first_name, last_name, role FROM users WHERE email = ?',
      [email]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Identifiants incorrects', statusCode: 401 });
    }
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_ACCESS_SECRET,
      { expiresIn: JWT_ACCESS_EXPIRES_IN }
    );
    const refreshToken = jwt.sign(
      { sub: user.id, type: 'refresh' },
      JWT_REFRESH_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.execute(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, refreshToken, expiresAt]
    );
    res.status(200).json({
      accessToken,
      refreshToken,
      expiresIn: getAccessExpiresInSeconds(),
      user: toUserRow(user),
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'refreshToken requis', statusCode: 400 });
    }
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ message: 'Refresh token invalide ou expiré', statusCode: 401 });
    }
    const [tokens] = await pool.execute(
      'SELECT id, user_id FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
      [refreshToken]
    );
    if (!tokens.length) {
      return res.status(401).json({ message: 'Refresh token invalide ou expiré', statusCode: 401 });
    }
    const [users] = await pool.execute(
      'SELECT id, email, first_name, last_name, role FROM users WHERE id = ?',
      [tokens[0].user_id]
    );
    const user = users[0];
    if (!user) {
      return res.status(401).json({ message: 'Utilisateur introuvable', statusCode: 401 });
    }
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_ACCESS_SECRET,
      { expiresIn: JWT_ACCESS_EXPIRES_IN }
    );
    const newRefreshToken = jwt.sign(
      { sub: user.id, type: 'refresh' },
      JWT_REFRESH_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
    await pool.execute('DELETE FROM refresh_tokens WHERE id = ?', [tokens[0].id]);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.execute(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, newRefreshToken, expiresAt]
    );
    res.status(200).json({
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: getAccessExpiresInSeconds(),
      user: toUserRow(user),
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout
router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await pool.execute('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    }
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /auth/me
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, email, first_name, last_name, role FROM users WHERE id = ?',
      [req.user.sub]
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé', statusCode: 404 });
    }
    res.status(200).json(toUserRow(user));
  } catch (err) {
    next(err);
  }
});

export default router;
