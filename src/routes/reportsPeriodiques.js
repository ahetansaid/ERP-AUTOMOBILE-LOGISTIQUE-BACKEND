/**
 * Rapports périodiques — génération, revue, approbation, diffusion.
 *
 * Monté sur /rapports pour ne pas empiéter sur /reports, qui sert les rapports
 * analytiques existants (P&L, aging, valeur du stock).
 */

const express = require('express');
const { prisma } = require('../lib/prisma');
const { generateReport, setStatus } = require('../lib/reports');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const PERIODICITIES = ['QUOTIDIEN', 'HEBDOMADAIRE', 'MENSUEL', 'PONCTUEL'];

const serialize = (r) => ({
  id: r.id,
  nom: r.name,
  type: r.type,
  periodicite: r.periodicity,
  debut: r.periodStart,
  fin: r.periodEnd,
  statut: r.status,
  payload: r.payload,
  approuvePar: r.approvedBy,
  approuveLe: r.approvedAt,
  motif: r.reviewNote,
  diffuseLe: r.distributedAt,
  creeLe: r.createdAt,
});

// GET /rapports — historique
router.get('/', authorize('reports', 'read'), async (req, res) => {
  try {
    const where = {};
    if (req.query.statut) where.status = String(req.query.statut).toUpperCase();
    if (req.query.type) where.type = String(req.query.type).toUpperCase();

    const rows = await prisma.generatedReport.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      take: 100,
      // Le payload est volumineux : on ne le renvoie que sur la fiche.
      select: {
        id: true, name: true, type: true, periodicity: true, periodStart: true,
        periodEnd: true, status: true, approvedBy: true, approvedAt: true,
        reviewNote: true, distributedAt: true, createdAt: true,
        _count: { select: { comments: true } },
      },
    });

    return res.status(200).json({
      rapports: rows.map((r) => ({ ...serialize(r), precisions: r._count.comments })),
    });
  } catch (err) {
    console.error('[rapports.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /rapports/generer { periodicite, date }
router.post('/generer', authorize('reports', 'export'), async (req, res) => {
  try {
    const p = String(req.body?.periodicite || 'QUOTIDIEN').toUpperCase();
    if (!PERIODICITIES.includes(p)) {
      return res.status(400).json({
        message: `Périodicité inconnue : ${p}. Valeurs : ${PERIODICITIES.join(', ')}`,
        statusCode: 400,
      });
    }
    const ref = req.body?.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(ref.getTime())) {
      return res.status(400).json({ message: 'Date invalide', statusCode: 400 });
    }
    return res.status(201).json(serialize(await generateReport(p, ref)));
  } catch (err) {
    if (String(err.message || '').startsWith('[reports]')) {
      return res.status(409).json({ message: err.message, statusCode: 409 });
    }
    console.error('[rapports.generer]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /rapports/:id — fiche complète avec instantané et précisions
router.get('/:id', authorize('reports', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const report = await prisma.generatedReport.findFirst({ where: { id } });
    if (!report) {
      return res.status(404).json({ message: 'Rapport introuvable', statusCode: 404 });
    }
    const comments = await prisma.reportComment.findMany({
      where: { reportId: id },
      orderBy: { id: 'asc' },
    });

    // Le nom de l'auteur est résolu à part : ReportComment ne porte pas de
    // relation vers User, pour rester lisible même si le compte est supprimé.
    const userIds = [...new Set(comments.map((c) => c.userId).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return res.status(200).json({
      ...serialize(report),
      precisions: comments.map((c) => {
        const u = byId.get(c.userId);
        return {
          id: c.id,
          texte: c.body,
          ancre: c.anchor,
          auteur: u
            ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
            : 'Utilisateur supprimé',
          date: c.createdAt,
        };
      }),
    });
  } catch (err) {
    console.error('[rapports.detail]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /rapports/:id/approuver
router.post('/:id/approuver', authorize('reports', 'update'), async (req, res) => {
  try {
    return res.status(200).json(serialize(await setStatus(req.params.id, 'APPROUVE')));
  } catch (err) {
    if (String(err.message || '').startsWith('[reports]')) {
      return res.status(409).json({ message: err.message, statusCode: 409 });
    }
    console.error('[rapports.approuver]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /rapports/:id/corriger { motif }
router.post('/:id/corriger', authorize('reports', 'update'), async (req, res) => {
  try {
    const motif = req.body?.motif;
    if (!motif || !String(motif).trim()) {
      return res.status(400).json({
        message: 'Un motif est requis : renvoyer en correction sans dire pourquoi est inexploitable.',
        statusCode: 400,
      });
    }
    return res
      .status(200)
      .json(serialize(await setStatus(req.params.id, 'A_CORRIGER', motif)));
  } catch (err) {
    if (String(err.message || '').startsWith('[reports]')) {
      return res.status(409).json({ message: err.message, statusCode: 409 });
    }
    console.error('[rapports.corriger]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /rapports/:id/diffuser — possible seulement après approbation
router.post('/:id/diffuser', authorize('reports', 'export'), async (req, res) => {
  try {
    return res.status(200).json(serialize(await setStatus(req.params.id, 'DIFFUSE')));
  } catch (err) {
    if (String(err.message || '').startsWith('[reports]')) {
      return res.status(409).json({ message: err.message, statusCode: 409 });
    }
    console.error('[rapports.diffuser]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /rapports/:id/precisions { texte, ancre }
router.post('/:id/precisions', authorize('reports', 'read'), async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    const texte = req.body?.texte;
    if (!texte || !String(texte).trim()) {
      return res.status(400).json({ message: 'Texte requis', statusCode: 400 });
    }
    const report = await prisma.generatedReport.findFirst({ where: { id: reportId } });
    if (!report) {
      return res.status(404).json({ message: 'Rapport introuvable', statusCode: 404 });
    }

    const created = await prisma.reportComment.create({
      data: {
        reportId,
        userId: req.user?.id ?? null,
        body: String(texte).slice(0, 4000),
        anchor: req.body?.ancre ? String(req.body.ancre).slice(0, 120) : null,
      },
    });
    return res.status(201).json({
      id: created.id,
      texte: created.body,
      ancre: created.anchor,
      date: created.createdAt,
    });
  } catch (err) {
    console.error('[rapports.precisions]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
