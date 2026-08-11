/**
 * Alertes — règles et occurrences.
 *
 * Le client active, désactive et ajuste les seuils. Il ne programme pas :
 * c'est ce qui rend le moteur utilisable par un gérant.
 */

const express = require('express');
const { prisma } = require('../lib/prisma');
const { runAll, ensureRules } = require('../lib/alerts');
const { RULES } = require('../lib/alertRules');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const serializeEvent = (e) => ({
  id: Number(e.id),
  severite: e.severity,
  statut: e.status,
  titre: e.title,
  detail: e.detail,
  valeur: e.value != null ? Number(e.value) : null,
  entite: e.entityType,
  entiteId: e.entityId,
  vuePremiereFois: e.firstSeenAt,
  vueDerniereFois: e.lastSeenAt,
  resolueLe: e.resolvedAt,
  regle: e.rule ? { code: e.rule.code, label: e.rule.label } : undefined,
});

// GET /alertes — occurrences, ouvertes par défaut
router.get('/', authorize('notifications', 'read'), async (req, res) => {
  try {
    const statut = String(req.query.statut || 'OUVERTE').toUpperCase();
    const where = statut === 'TOUTES' ? {} : { status: statut };
    if (req.query.severite) where.severity = String(req.query.severite).toUpperCase();

    const events = await prisma.alertEvent.findMany({
      where,
      orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
      take: 300,
      include: { rule: { select: { code: true, label: true } } },
    });

    const parSeverite = await prisma.alertEvent.groupBy({
      by: ['severity'],
      where: { status: 'OUVERTE' },
      _count: { _all: true },
    });

    return res.status(200).json({
      alertes: events.map(serializeEvent),
      resume: Object.fromEntries(parSeverite.map((s) => [s.severity, s._count._all])),
    });
  } catch (err) {
    console.error('[alertes.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /alertes/evaluer — relance le moteur
router.post('/evaluer', authorize('notifications', 'update'), async (req, res) => {
  try {
    return res.status(200).json(await runAll());
  } catch (err) {
    if (String(err.message || '').startsWith('[alerts]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[alertes.evaluer]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /alertes/:id/ignorer — décision humaine : l'occurrence ne se rouvrira pas
router.post('/:id/ignorer', authorize('notifications', 'update'), async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const event = await prisma.alertEvent.findFirst({ where: { id } });
    if (!event) {
      return res.status(404).json({ message: 'Alerte introuvable', statusCode: 404 });
    }
    const updated = await prisma.alertEvent.update({
      where: { id },
      data: { status: 'IGNOREE' },
    });
    return res.status(200).json(serializeEvent(updated));
  } catch (err) {
    console.error('[alertes.ignorer]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /alertes/regles
router.get('/regles', authorize('settings', 'read'), async (req, res) => {
  try {
    await ensureRules();
    const rules = await prisma.alertRule.findMany({ orderBy: { code: 'asc' } });
    const ouvertes = await prisma.alertEvent.groupBy({
      by: ['ruleId'],
      where: { status: 'OUVERTE' },
      _count: { _all: true },
    });
    const parRegle = new Map(ouvertes.map((o) => [o.ruleId, o._count._all]));

    return res.status(200).json({
      regles: rules.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        severite: r.severity,
        active: r.enabled,
        params: r.params,
        canaux: r.channels,
        rappelJours: r.reminderDays,
        derniereExecution: r.lastRunAt,
        ouvertes: parRegle.get(r.id) ?? 0,
        // Les valeurs par défaut aident l'utilisateur à situer son réglage.
        defauts: RULES[r.code]?.params ?? {},
      })),
    });
  } catch (err) {
    console.error('[alertes.regles]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// PATCH /alertes/regles/:id — activation et seuils
router.patch('/regles/:id', authorize('settings', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const data = {};
    if (b.active !== undefined) data.enabled = !!b.active;
    if (b.severite) data.severity = String(b.severite).toUpperCase();
    if (b.rappelJours !== undefined) data.reminderDays = Math.max(0, Number(b.rappelJours) || 0);
    if (Array.isArray(b.canaux)) data.channels = b.canaux;
    if (b.params && typeof b.params === 'object') {
      // Les seuils sont numériques : on refuse ce qui ne l'est pas plutôt que
      // de laisser une règle silencieusement inopérante.
      const params = {};
      for (const [k, v] of Object.entries(b.params)) {
        const n = Number(v);
        if (Number.isNaN(n)) {
          return res.status(400).json({
            message: `Le seuil « ${k} » doit être un nombre.`,
            statusCode: 400,
          });
        }
        params[k] = n;
      }
      data.params = params;
    }

    const updated = await prisma.alertRule.update({ where: { id }, data });
    return res.status(200).json({
      id: updated.id,
      code: updated.code,
      active: updated.enabled,
      params: updated.params,
      severite: updated.severity,
      rappelJours: updated.reminderDays,
    });
  } catch (err) {
    console.error('[alertes.regles.update]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
