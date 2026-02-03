import jwt from 'jsonwebtoken';
import { JWT_ACCESS_SECRET } from '../config.js';

/**
 * Vérifie le token JWT et attache req.user (id, email, role, etc.)
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token manquant ou invalide', statusCode: 401 });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token expiré ou invalide', statusCode: 401 });
  }
}
