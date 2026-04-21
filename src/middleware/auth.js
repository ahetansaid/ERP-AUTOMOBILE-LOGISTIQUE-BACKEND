const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-change-me';

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (typeof req.query.token === 'string' && req.query.token.length > 10) {
    // Fallback pour les URLs de téléchargement (PDF inline, exports) ouvertes via window.open
    // où les en-têtes Authorization ne peuvent pas être transmis.
    token = req.query.token;
  }
  if (!token) {
    return res.status(401).json({ message: 'Token manquant ou invalide', statusCode: 401 });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId ?? decoded.company_id,
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token expiré ou invalide', statusCode: 401 });
  }
}

module.exports = { authMiddleware, JWT_SECRET, JWT_REFRESH_SECRET };
