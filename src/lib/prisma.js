/**
 * Client Prisma — point d'interception unique
 *
 * Toute écriture et toute lecture passent ici. L'extension applique, sans que
 * les routes aient à y penser :
 *   1. le filtre société (isolation multi-entreprises)
 *   2. le journal d'audit (100 % des écritures)
 *
 * L'objectif est de rendre l'oubli impossible. Avant, l'isolation reposait sur
 * `req.tenantWhere()` appelé à la main dans ~150 requêtes réparties sur 18
 * fichiers : une seule omission exposait les données d'une autre société.
 *
 * Deux clients sont exportés :
 *   - `prisma`    : étendu, à utiliser partout dans les routes métier
 *   - `prismaRaw` : brut, réservé à l'authentification et aux scripts système
 *
 * Pour une opération volontairement hors périmètre, utiliser `runUnscoped()`
 * de src/lib/context.js — et justifier pourquoi en commentaire.
 */

const { PrismaClient, Prisma } = require('@prisma/client');
const { getContext } = require('./context');
const { logger } = require('./logger');

const log = logger('prisma');

const logLevels =
  process.env.NODE_ENV === 'development'
    ? ['query', 'warn', 'error']
    : ['warn', 'error'];

const globalForPrisma = globalThis;

const base =
  globalForPrisma.__prismaBase ?? new PrismaClient({ log: logLevels });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prismaBase = base;
}

// ---------------------------------------------------------------------------
// Modèles concernés par le filtre société — déduits du schéma, pas d'une liste
// à maintenir. Un modèle qui gagne un `companyId` est protégé automatiquement.
// ---------------------------------------------------------------------------
const TENANT_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'companyId'))
    .map((m) => m.name)
);

/**
 * Modèles dont la clé de société est leur PROPRE identifiant, pas une colonne
 * `companyId`. `Company` est le seul cas — et il échappait donc à la détection
 * automatique, laissant `prisma.company.findFirst()` renvoyer la première
 * société de la base, toutes entreprises confondues.
 *
 * On les filtre sur `id` au lieu de `companyId`.
 */
const TENANT_BY_ID_MODELS = new Set(['Company']);
const ALL_TENANT_MODELS = new Set([...TENANT_MODELS, ...TENANT_BY_ID_MODELS]);

/** Champ portant la société pour ce modèle. */
const tenantField = (model) => (TENANT_BY_ID_MODELS.has(model) ? 'id' : 'companyId');

// Modèles exclus de l'audit : le journal lui-même (récursion) et les tables
// techniques dont le volume noierait l'information utile.
const AUDIT_EXCLUDED = new Set([
  'AuditLog', 'Session', 'EmailEvent', 'Notification',
  // L'index est dérivé : le tracer reviendrait à journaliser deux fois chaque
  // écriture, et à faire boucler l'indexation sur elle-même.
  'SearchIndex',
]);

const READ_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
]);
const UNIQUE_READ_OPS = new Set(['findUnique', 'findUniqueOrThrow']);
const WRITE_WHERE_OPS = new Set(['update', 'delete', 'updateMany', 'deleteMany']);
const CREATE_OPS = new Set(['create', 'createMany']);

/**
 * Tables en écriture seule. Le grand livre ne se corrige pas : on contre-passe
 * (voir src/lib/ledger.js). Interdire ici plutôt que de compter sur la
 * discipline des routes, c'est ce qui rend l'engagement E3 tenable — « rien ne
 * s'efface, tout se contre-passe ».
 */
const APPEND_ONLY_MODELS = new Set(['LedgerEntry', 'AuditLog']);
const MUTATING_OPS = new Set([
  'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
]);

const ACTION_BY_OP = {
  create: 'CREATE', createMany: 'CREATE',
  update: 'UPDATE', updateMany: 'UPDATE', upsert: 'UPDATE',
  delete: 'DELETE', deleteMany: 'DELETE',
};

/** Retire les valeurs sensibles avant de les figer dans le journal. */
const SENSITIVE = new Set([
  'password', 'passwordHash', 'password_hash', 'token', 'refreshToken',
  'refresh_token', 'twoFaSecret', 'two_fa_secret', 'jwt',
]);

function sanitize(value, depth = 0) {
  if (value == null || depth > 6) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;
  if (typeof value.toFixed === 'function') return Number(value); // Prisma.Decimal
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.has(k) ? '[REDACTED]' : sanitize(v, depth + 1);
  }
  return out;
}

/** Écrit le journal sans bloquer la réponse, et via le client brut (pas de récursion). */
function writeAudit(entry) {
  base.auditLog
    .create({ data: entry })
    .catch((err) =>
      // Un audit perdu est une trace perdue : jamais silencieux.
      log.error("écriture du journal d'audit impossible", {
        err,
        resource: entry.resource,
        resourceId: entry.resourceId,
      })
    );
}

const prisma = base.$extends({
  name: 'tenant-guard',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = getContext();
        const scoped = ALL_TENANT_MODELS.has(model) && ctx && !ctx.unscoped;

        // ── 0. Écriture seule ───────────────────────────────────────────────
        if (APPEND_ONLY_MODELS.has(model) && MUTATING_OPS.has(operation)) {
          throw new Error(
            `[append-only] ${model} n'accepte ni modification ni suppression. ` +
              'Pour corriger une écriture, contre-passez-la : reverseEntry(id, motif).'
          );
        }

        // ── 1. Isolation société ────────────────────────────────────────────
        if (ALL_TENANT_MODELS.has(model) && !ctx) {
          // Hors contexte : on refuse plutôt que d'exposer toutes les sociétés.
          // Les scripts doivent passer par runAsSystem() ou prismaRaw.
          throw new Error(
            `[tenant] ${model}.${operation} hors contexte de requête. ` +
              'Utilisez runAsSystem(companyId, fn) ou prismaRaw pour les opérations système.'
          );
        }

        if (scoped) {
          const cid = ctx.companyId;
          if (cid == null) {
            throw new Error(
              `[tenant] ${model}.${operation} sans société associée. Accès refusé.`
            );
          }
          const champ = tenantField(model);

          if (
            READ_OPS.has(operation) ||
            WRITE_WHERE_OPS.has(operation) ||
            // `findUnique` accepte des champs non uniques dans son `where`
            // depuis Prisma 5, dès lors qu'un critère unique y figure aussi.
            // Inutile donc de le convertir en `findFirst` — et impossible :
            // une extension ne peut pas changer l'opération exécutée.
            UNIQUE_READ_OPS.has(operation)
          ) {
            args.where = { ...(args.where || {}), [champ]: cid };
          } else if (CREATE_OPS.has(operation)) {
            // La création d'une société n'est pas une opération de tenant :
            // elle appartient à l'éditeur et passe par prismaRaw.
            if (TENANT_BY_ID_MODELS.has(model)) {
              throw new Error(
                `[tenant] ${model}.${operation} interdit dans un contexte société.`
              );
            }
            if (operation === 'createMany') {
              const rows = Array.isArray(args.data) ? args.data : [args.data];
              args.data = rows.map((d) => ({ companyId: cid, ...d }));
            } else {
              args.data = { companyId: cid, ...args.data };
            }
          } else if (operation === 'upsert') {
            args.where = { ...(args.where || {}), [champ]: cid };
            args.create = { [champ]: cid, ...args.create };
          }
        }

        // ── 2. Journal d'audit ──────────────────────────────────────────────
        const action = ACTION_BY_OP[operation];
        const audited = action && ctx && !AUDIT_EXCLUDED.has(model);

        // `before` n'a de sens que sur une mise à jour ou une suppression ciblée.
        let before = null;
        if (audited && (operation === 'update' || operation === 'delete')) {
          try {
            before = await base[model[0].toLowerCase() + model.slice(1)].findFirst({
              where: args.where,
            });
          } catch {
            /* la lecture préalable ne doit jamais faire échouer l'écriture */
          }
        }

        // `query` n'attend QUE les arguments : lui passer l'opération corrompt
        // son contexte interne et produit une erreur Prisma opaque.
        const result = await query(args);

        // ── 3. Index de recherche ───────────────────────────────────────────
        // Chargé paresseusement : search.js importe ce module, un require en
        // tête de fichier créerait un cycle.
        if (action && ctx?.companyId != null) {
          try {
            const { INDEXED_MODELS, reindex, unindex } = require('./search');
            if (INDEXED_MODELS.has(model)) {
              const targetId =
                (result && typeof result.id === 'number' && result.id) ||
                (before && before.id) ||
                (typeof args.where?.id === 'number' ? args.where.id : null);
              if (targetId != null) {
                // Fire-and-forget : l'indexation ne doit jamais retarder ni
                // faire échouer l'écriture métier.
                if (action === 'DELETE') unindex(model, targetId, ctx.companyId);
                else reindex(model, targetId, ctx.companyId);
              }
            }
          } catch (err) {
            log.warn('indexation ignorée', { err, model });
          }
        }

        if (audited) {
          const single = !operation.endsWith('Many');
          const resourceId =
            (single && result && typeof result.id === 'number' && result.id) ||
            (before && before.id) ||
            (typeof args.where?.id === 'number' ? args.where.id : null);

          writeAudit({
            companyId: ctx.companyId ?? null,
            userId: ctx.userId ?? null,
            action,
            resource: model,
            resourceId,
            before: before ? sanitize(before) : null,
            after: single && result ? sanitize(result) : sanitize({ where: args.where, count: result?.count }),
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
          });

          if (resourceId != null && ctx.audited) {
            ctx.audited.add(`${action}:${model}:${resourceId}`);
          }
        }

        return result;
      },
    },
  },
});

async function disconnect() {
  await base.$disconnect();
}

module.exports = {
  prisma,
  prismaRaw: base,
  disconnect,
  TENANT_MODELS: ALL_TENANT_MODELS,
  TENANT_BY_ID_MODELS,
};
