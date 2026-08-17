/**
 * Contexte de requête (AsyncLocalStorage)
 *
 * Porte, pour toute la durée d'une requête HTTP et à travers les `await`,
 * l'identité de l'appelant et la société sur laquelle il opère. C'est ce
 * contexte que l'extension Prisma (src/lib/prisma.js) consulte pour appliquer
 * le filtre société et écrire le journal d'audit.
 *
 * Pourquoi ici plutôt que sur `req` : les routes passent `req` au petit
 * bonheur, et un service appelé en profondeur ne l'a pas. L'AsyncLocalStorage
 * rend le contexte disponible partout sans le faire transiter en paramètre —
 * donc sans possibilité de l'oublier.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const storage = new AsyncLocalStorage();

/** Contexte de la requête courante, ou `undefined` hors requête (script, cron). */
function getContext() {
  return storage.getStore();
}

/**
 * Middleware Express : ouvre le contexte pour toute la suite de la requête.
 * À placer APRÈS authMiddleware et tenantScope.
 */
function withContext(req, res, next) {
  const ctx = {
    companyId: req.companyId ?? req.user?.companyId ?? null,
    userId: req.user?.id ?? null,
    role: req.user?.role ?? null,
    ipAddress:
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      null,
    userAgent: req.headers['user-agent']?.slice(0, 500) || null,
    // Relie entre elles toutes les écritures d'une même opération métier.
    correlationId: crypto.randomUUID(),
    // Écritures déjà tracées automatiquement, pour que req.audit ne double pas.
    audited: new Set(),
    unscoped: false,
  };
  req.correlationId = ctx.correlationId;
  // Conservé sur la requête pour pouvoir REVENIR dans ce contexte si un
  // intergiciel en aval casse la chaîne asynchrone (voir restoreContext).
  req.ctx = ctx;
  res.setHeader('X-Correlation-Id', ctx.correlationId);
  storage.run(ctx, next);
}

/**
 * Rétablit le contexte de la requête.
 *
 * Certains intergiciels rompent la chaîne AsyncLocalStorage : multer 2 le fait
 * en terminant l'analyse du multipart depuis un évènement de flux qui n'hérite
 * plus du contexte ouvert par `withContext`. Tout ce qui suit se retrouve alors
 * SANS société — et comme l'extension Prisma échoue fermé, la route entière
 * tombe en erreur 500 plutôt que de fuir des données. Le garde-fou tient, mais
 * la fonctionnalité meurt.
 *
 * À placer juste après l'intergiciel fautif. Le MÊME objet de contexte est
 * réutilisé : identifiant de corrélation, utilisateur et ensemble des écritures
 * déjà tracées sont préservés, donc l'audit reste cohérent.
 */
function restoreContext(req, res, next) {
  if (!req.ctx) return next();
  return storage.run(req.ctx, next);
}

/**
 * Exécute `fn` hors périmètre société.
 *
 * Réservé aux opérations qui n'appartiennent à aucune société : authentification
 * (on cherche l'utilisateur par e-mail avant de connaître sa société), seed,
 * tâches d'administration plateforme. Tout appel doit être justifié en commentaire.
 */
function runUnscoped(fn) {
  const parent = getContext();
  const ctx = { ...(parent || { audited: new Set() }), unscoped: true };
  return storage.run(ctx, fn);
}

/** Contexte système, hors requête HTTP (scripts, workers). */
function runAsSystem(companyId, fn) {
  return storage.run(
    {
      companyId: companyId ?? null,
      userId: null,
      role: 'SYSTEM',
      ipAddress: null,
      userAgent: 'system',
      correlationId: crypto.randomUUID(),
      audited: new Set(),
      unscoped: companyId == null,
    },
    fn
  );
}

module.exports = {
  getContext,
  withContext,
  restoreContext,
  runUnscoped,
  runAsSystem,
  storage,
};
