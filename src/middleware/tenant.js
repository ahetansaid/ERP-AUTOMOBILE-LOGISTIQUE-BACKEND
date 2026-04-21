/**
 * Middleware tenantScope
 *
 * Garantit que chaque requête authentifiée porte un `companyId` et expose
 * un helper `req.tenantWhere()` qui retourne la clause Prisma à injecter
 * dans toutes les requêtes (findMany, count, aggregate, etc.).
 *
 * À placer APRÈS authMiddleware.
 *
 *   app.use(authMiddleware);
 *   app.use(tenantScope);
 *
 * Exemple d'usage dans une route :
 *
 *   const clients = await prisma.client.findMany({
 *     where: { ...req.tenantWhere(), status: 'ACTIF' },
 *   });
 *
 * Les utilisateurs avec rôle ADMIN peuvent passer `?companyId=123` en query
 * string pour scoper manuellement (utile pour les opérations cross-tenant).
 */

function tenantScope(req, res, next) {
  if (!req.user) {
    return res
      .status(401)
      .json({ message: 'Non authentifié', statusCode: 401 });
  }

  let companyId = req.user.companyId ?? null;

  // Super-admin override (optionnel, seulement si rôle ADMIN et paramètre explicite)
  if (
    req.user.role === 'ADMIN' &&
    req.query.companyId &&
    /^\d+$/.test(String(req.query.companyId))
  ) {
    companyId = Number(req.query.companyId);
  }

  if (!companyId && req.user.role !== 'ADMIN') {
    return res
      .status(403)
      .json({
        message: 'Utilisateur non associé à une société',
        statusCode: 403,
      });
  }

  req.companyId = companyId;

  // Helper à utiliser partout : where: { ...req.tenantWhere(), ... }
  req.tenantWhere = () =>
    companyId !== null ? { companyId } : {};

  next();
}

module.exports = { tenantScope };
