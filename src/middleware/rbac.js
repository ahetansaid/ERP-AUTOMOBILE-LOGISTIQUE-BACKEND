/**
 * Middleware RBAC
 *
 * Deux approches combinées :
 *   1. Rôles "macro" (UserRole enum) → permissions par défaut via ROLE_PERMISSIONS
 *   2. Permissions fines → table `user_permissions` (override au-delà du rôle)
 *
 * Usage :
 *   const { authorize } = require('../middleware/rbac');
 *   router.get('/', authorize('clients', 'read'), handler);
 *   router.post('/', authorize('clients', 'create'), handler);
 *
 * ADMIN passe toujours (wildcard).
 */

const { prisma } = require('../lib/prisma');

// Permissions par défaut attribuées à chaque rôle.
// Format : { role: { module: [actions] | '*' } } ; '*' = toutes actions.
const ROLE_PERMISSIONS = {
  ADMIN: '*', // accès total
  MANAGER: {
    clients: '*',
    suppliers: '*',
    vehicles: '*',
    purchases: '*',
    invoices: '*',
    receipts: '*',
    charges: '*',
    workshop_quotes: '*',
    proformas: '*',
    transit: '*',
    treasury: ['read', 'export'],
    reports: ['read', 'export'],
    dashboard: ['read'],
    notifications: ['read', 'update'],
    users: ['read'],
    settings: ['read'],
  },
  SALES: {
    clients: '*',
    vehicles: ['read', 'update'],
    invoices: ['create', 'read', 'update'],
    receipts: ['create', 'read'],
    proformas: '*',
    dashboard: ['read'],
    notifications: ['read', 'update'],
  },
  ACCOUNTING: {
    invoices: '*',
    receipts: '*',
    charges: '*',
    treasury: '*',
    reports: '*',
    dashboard: ['read'],
    clients: ['read'],
    vehicles: ['read'],
    notifications: ['read', 'update'],
  },
  WORKSHOP: {
    workshop_quotes: '*',
    vehicles: ['read', 'update'],
    dashboard: ['read'],
    notifications: ['read', 'update'],
  },
  LOGISTICS: {
    purchases: '*',
    transit: '*',
    vehicles: ['read', 'update'],
    suppliers: '*',
    dashboard: ['read'],
    notifications: ['read', 'update'],
  },
  USER: {
    dashboard: ['read'],
    notifications: ['read', 'update'],
  },
  READ_ONLY: {
    // lecture seule partout (pas de create/update/delete)
    clients: ['read'],
    suppliers: ['read'],
    vehicles: ['read'],
    purchases: ['read'],
    invoices: ['read'],
    receipts: ['read'],
    charges: ['read'],
    workshop_quotes: ['read'],
    proformas: ['read'],
    transit: ['read'],
    treasury: ['read'],
    reports: ['read'],
    dashboard: ['read'],
    notifications: ['read'],
  },
};

function roleHasPermission(role, module, action) {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  if (perms === '*') return true;
  const moduleActions = perms[module];
  if (!moduleActions) return false;
  if (moduleActions === '*') return true;
  return moduleActions.includes(action);
}

/**
 * Cache en mémoire des permissions fines (user_permissions) pour éviter
 * un round-trip DB à chaque requête. TTL 60 s.
 */
const userPermCache = new Map(); // userId -> { expiresAt, codes: Set<string> }
const CACHE_TTL_MS = 60_000;

async function getUserCustomPermissions(userId) {
  const cached = userPermCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.codes;

  const rows = await prisma.userPermission.findMany({
    where: { userId },
    include: { permission: { select: { code: true } } },
  });
  const codes = new Set(rows.map((r) => r.permission.code));
  userPermCache.set(userId, { expiresAt: now + CACHE_TTL_MS, codes });
  return codes;
}

function invalidateUserPermissions(userId) {
  userPermCache.delete(userId);
}

/**
 * authorize(module, action) → middleware Express
 */
function authorize(module, action) {
  return async (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ message: 'Non authentifié', statusCode: 401 });
    }

    // 1. Rôle couvre-t-il cette action ?
    if (roleHasPermission(req.user.role, module, action)) return next();

    // 2. Permission fine accordée ?
    try {
      const codes = await getUserCustomPermissions(req.user.id);
      if (codes.has(`${module}.${action}`) || codes.has(`${module}.*`)) {
        return next();
      }
    } catch (err) {
      // Si la lecture échoue (ex: DB down), on refuse par défaut.
      return res
        .status(500)
        .json({
          message: 'Erreur vérification des permissions',
          statusCode: 500,
        });
    }

    return res.status(403).json({
      message: `Action non autorisée : ${module}.${action}`,
      statusCode: 403,
    });
  };
}

module.exports = {
  authorize,
  roleHasPermission,
  invalidateUserPermissions,
  ROLE_PERMISSIONS,
};
