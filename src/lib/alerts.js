/**
 * Moteur d'alertes.
 *
 * Propriété centrale : l'évaluation est IDEMPOTENTE. Une même anomalie détectée
 * à chaque passage met à jour son occurrence existante au lieu d'en créer une
 * nouvelle. Sans cela, une exécution horaire produirait des centaines de
 * doublons par semaine et le panneau d'alertes deviendrait illisible — donc
 * ignoré, donc inutile.
 *
 * Trois transitions automatiques :
 *   condition vraie, jamais vue      → occurrence OUVERTE + notification
 *   condition toujours vraie         → lastSeenAt mis à jour, rappel si dû
 *   condition redevenue fausse       → occurrence RESOLUE
 *
 * Une occurrence IGNOREE par un humain ne se rouvre pas : c'est une décision,
 * pas un oubli.
 */

const { prisma } = require('./prisma');
const { getContext } = require('./context');
const { RULES, RULE_CODES } = require('./alertRules');
const { notify } = require('../services/notifications');
const { logger } = require('./logger');

const log = logger('alerts');

/** Installe les règles par défaut pour la société courante. Idempotent. */
async function ensureRules() {
  const existantes = await prisma.alertRule.findMany({ select: { code: true } });
  const deja = new Set(existantes.map((r) => r.code));

  const aCreer = RULE_CODES.filter((c) => !deja.has(c)).map((code) => ({
    code,
    label: RULES[code].label,
    severity: RULES[code].severity,
    params: RULES[code].params ?? {},
    enabled: true,
  }));

  if (aCreer.length) await prisma.alertRule.createMany({ data: aCreer });
  return { creees: aCreer.length, total: RULE_CODES.length };
}

/** Faut-il renotifier une occurrence déjà ouverte ? */
function rappelDu(event, reminderDays) {
  if (!reminderDays || reminderDays <= 0) return false;
  const base = event.notifiedAt ?? event.firstSeenAt;
  if (!base) return true;
  return (Date.now() - new Date(base).getTime()) / 86400000 >= reminderDays;
}

/**
 * Évalue une règle et réconcilie ses occurrences.
 * @returns {Promise<{ouvertes:number, maintenues:number, resolues:number}>}
 */
async function runRule(rule) {
  const spec = RULES[rule.code];
  if (!spec) {
    log.warn('règle inconnue, ignorée', { code: rule.code });
    return { ouvertes: 0, maintenues: 0, resolues: 0 };
  }

  let constats = [];
  try {
    constats = (await spec.run(rule.params || {})) || [];
  } catch (err) {
    // Une règle qui échoue ne doit pas empêcher les autres de tourner.
    log.error("évaluation d'une règle échouée", { err, code: rule.code });
    return { ouvertes: 0, maintenues: 0, resolues: 0 };
  }

  const existantes = await prisma.alertEvent.findMany({
    where: { ruleId: rule.id, status: { in: ['OUVERTE', 'IGNOREE'] } },
  });
  const parCle = new Map(
    existantes.map((e) => [`${e.entityType}:${e.entityId}`, e])
  );

  const now = new Date();
  const vues = new Set();
  let ouvertes = 0;
  let maintenues = 0;

  for (const c of constats) {
    const cle = `${c.entityType ?? null}:${c.entityId ?? null}`;
    vues.add(cle);
    const existante = parCle.get(cle);

    if (!existante) {
      const created = await prisma.alertEvent.create({
        data: {
          ruleId: rule.id,
          severity: rule.severity,
          entityType: c.entityType ?? null,
          entityId: c.entityId ?? null,
          title: String(c.title).slice(0, 255),
          detail: c.detail ?? null,
          value: c.value ?? null,
          notifiedAt: now,
        },
      });
      ouvertes++;
      await diffuser(rule, created);
      continue;
    }

    // Déjà connue : on rafraîchit sans renotifier, sauf rappel dû.
    if (existante.status === 'OUVERTE') {
      const renotifier = rappelDu(existante, rule.reminderDays);
      await prisma.alertEvent.update({
        where: { id: existante.id },
        data: {
          lastSeenAt: now,
          value: c.value ?? null,
          title: String(c.title).slice(0, 255),
          detail: c.detail ?? null,
          ...(renotifier ? { notifiedAt: now } : {}),
        },
      });
      if (renotifier) await diffuser(rule, existante);
      maintenues++;
    }
  }

  // Ce qui n'apparaît plus est résolu — mais on ne touche pas aux IGNOREE.
  const aResoudre = existantes.filter(
    (e) => e.status === 'OUVERTE' && !vues.has(`${e.entityType}:${e.entityId}`)
  );
  if (aResoudre.length) {
    await prisma.alertEvent.updateMany({
      where: { id: { in: aResoudre.map((e) => e.id) } },
      data: { status: 'RESOLUE', resolvedAt: now },
    });
  }

  await prisma.alertRule.update({
    where: { id: rule.id },
    data: { lastRunAt: now },
  });

  return { ouvertes, maintenues, resolues: aResoudre.length };
}

/** Diffuse une alerte sur les canaux configurés. Jamais bloquant. */
async function diffuser(rule, event) {
  if (!(rule.channels || []).includes('inapp')) return;
  try {
    await notify({
      companyId: getContext()?.companyId ?? null,
      type: rule.severity === 'CRITIQUE' ? 'ERROR' : 'WARNING',
      title: rule.label,
      message: event.title,
      link: event.entityType && event.entityId
        ? `/dossier/${event.entityType}/${event.entityId}`
        : '/alertes',
      audience: (rule.targetRoles || []).length ? 'admins' : undefined,
    });
  } catch (err) {
    log.warn("diffusion de l'alerte impossible", { err, code: rule.code });
  }
}

/** Exécute toutes les règles activées de la société courante. */
async function runAll() {
  const ctx = getContext();
  if (!ctx?.companyId) throw new Error('[alerts] hors contexte société');

  await ensureRules();
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } });

  const bilan = { regles: rules.length, ouvertes: 0, maintenues: 0, resolues: 0 };
  for (const rule of rules) {
    const r = await runRule(rule);
    bilan.ouvertes += r.ouvertes;
    bilan.maintenues += r.maintenues;
    bilan.resolues += r.resolues;
  }
  return bilan;
}

module.exports = { runAll, runRule, ensureRules };
