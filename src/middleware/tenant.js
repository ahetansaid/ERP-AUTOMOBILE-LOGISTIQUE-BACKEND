/**
 * Middleware tenantScope
 *
 * Détermine la société sur laquelle porte la requête. L'application effective
 * du filtre se fait ensuite dans l'extension Prisma (src/lib/prisma.js) : ici on
 * décide seulement *quelle* société, là-bas on garantit qu'on ne peut pas y
 * échapper.
 *
 * À placer APRÈS authMiddleware et AVANT withContext :
 *
 *   app.use(authMiddleware, tenantScope, withContext);
 *
 * Historique — faille corrigée le 2026-08-10 :
 * la version précédente laissait tout utilisateur de rôle ADMIN forcer
 * `?companyId=` sur n'importe quelle société. Or ADMIN est le rôle du *gérant*
 * de chaque société cliente : n'importe lequel pouvait donc lire les données
 * d'un concurrent. Pire, un ADMIN sans société rattachée recevait un filtre
 * vide, donc l'accès à tout.
 *
 * Désormais seul PLATFORM_ADMIN — l'éditeur de la plateforme, pas le client —
 * peut opérer sur une autre société, et chaque accès de ce type est journalisé.
 */

const { prismaRaw } = require('../lib/prisma');

function tenantScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Non authentifié', statusCode: 401 });
  }

  const isPlatform = req.user.role === 'PLATFORM_ADMIN';
  let companyId = req.user.companyId ?? null;

  // Accès inter-sociétés : réservé à l'éditeur, explicite et tracé.
  if (isPlatform && req.query.companyId && /^\d+$/.test(String(req.query.companyId))) {
    companyId = Number(req.query.companyId);
    prismaRaw.auditLog
      .create({
        data: {
          companyId,
          userId: req.user.id ?? null,
          action: 'EXPORT', // accès plateforme à une société cliente
          resource: 'platform_access',
          resourceId: companyId,
          after: { path: req.originalUrl, method: req.method },
          ipAddress:
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.socket?.remoteAddress ||
            null,
          userAgent: req.headers['user-agent']?.slice(0, 500) || null,
        },
      })
      .catch((e) => console.error('[platform-access]', e.message));
  }

  // Aucune société : plus d'échappatoire, même pour un administrateur.
  if (companyId == null) {
    return res.status(403).json({
      message: isPlatform
        ? 'Précisez la société cible (?companyId=).'
        : 'Utilisateur non associé à une société',
      statusCode: 403,
    });
  }

  req.companyId = companyId;

  // Conservé pour compatibilité avec les routes existantes. Le filtre est
  // désormais appliqué par l'extension Prisma : ce helper est redondant, mais
  // inoffensif — il produit la même clause.
  req.tenantWhere = () => ({ companyId });

  next();
}

module.exports = { tenantScope };
