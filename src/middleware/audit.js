/**
 * Middleware `attachAudit` + helper `req.audit(...)`
 *
 * Attache à chaque requête un helper asynchrone non bloquant pour tracer
 * les actions métier dans la table `audit_logs`.
 *
 * Usage dans un handler :
 *
 *   const before = await prisma.client.findUnique({ where: { id } });
 *   const after  = await prisma.client.update({ where: { id }, data });
 *   req.audit({ action: 'UPDATE', resource: 'clients', resourceId: id, before, after });
 *
 * Fire-and-forget : n'attend PAS l'écriture DB pour répondre (perf).
 * Les erreurs sont loggées mais jamais propagées au client.
 */

const { prisma } = require('../lib/prisma');

// Redaction basique : supprime les champs sensibles avant persistance.
const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'refresh_token',
  'two_fa_secret',
  'jwt',
]);

function sanitize(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = sanitize(v);
    } else if (typeof v === 'bigint') {
      out[k] = v.toString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Les créations, mises à jour et suppressions sont désormais tracées
// automatiquement par l'extension Prisma (src/lib/prisma.js), avec before/after.
// On ignore donc ici les appels CRUD des routes pour ne pas doubler chaque
// écriture. `req.audit` reste utile pour les événements non-CRUD, que la couche
// base de données ne peut pas deviner : connexion, export, changement de droits.
const COVERED_BY_EXTENSION = new Set(['CREATE', 'UPDATE', 'DELETE']);

function attachAudit(req, res, next) {
  req.audit = function audit({ action, resource, resourceId, before, after }) {
    if (COVERED_BY_EXTENSION.has(action)) return;

    const payload = {
      action,
      resource,
      resourceId: resourceId != null ? Number(resourceId) : null,
      before: before ? sanitize(before) : null,
      after: after ? sanitize(after) : null,
      companyId: req.companyId ?? req.user?.companyId ?? null,
      userId: req.user?.id ?? null,
      ipAddress:
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        null,
      userAgent: req.headers['user-agent']?.slice(0, 500) || null,
    };

    // Fire-and-forget : on ne bloque pas la réponse HTTP sur l'écriture DB.
    prisma.auditLog
      .create({ data: payload })
      .catch((err) => {
        console.error('[audit]', err.message, { action, resource, resourceId });
      });
  };

  next();
}

module.exports = { attachAudit };
