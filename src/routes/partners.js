/**
 * Référentiel des tiers.
 *
 * Un tiers existe indépendamment de tout accès : « Jean · Peintre EURO » est
 * mesurable sans jamais se connecter. Les statistiques viennent du grand livre,
 * ce qui répond enfin à « combien m'a coûté ce prestataire cette année ? ».
 */

const express = require('express');
const { prisma } = require('../lib/prisma');
const {
  slugify, findOrCreatePartner, suggestMerges, mergePartners,
} = require('../lib/partners');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const KINDS = [
  'CLIENT', 'FOURNISSEUR', 'PRESTATAIRE', 'TRANSITAIRE',
  'TRANSPORTEUR', 'ADMINISTRATION', 'AUTRE',
];

// GET /partners — liste, filtrable par rôle et par recherche
router.get('/', authorize('clients', 'read'), async (req, res) => {
  try {
    const where = {};
    if (req.query.kind) where.kinds = { has: String(req.query.kind).toUpperCase() };
    if (req.query.active !== 'all') where.isActive = req.query.active !== 'false';
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: slugify(q) } },
        { specialty: { contains: q, mode: 'insensitive' } },
      ];
    }

    const partners = await prisma.partner.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 500,
    });

    // Volume confié, tiré du grand livre. Une seule requête agrégée plutôt
    // qu'une par tiers.
    const stats = await prisma.ledgerEntry.groupBy({
      by: ['partnerId'],
      where: { partnerId: { not: null } },
      _sum: { amountFcfa: true },
      _count: { _all: true },
    });
    const byPartner = new Map(
      stats.map((s) => [
        s.partnerId,
        { total: Number(s._sum.amountFcfa ?? 0), mouvements: s._count._all },
      ])
    );

    return res.status(200).json({
      partners: partners.map((p) => {
        const s = byPartner.get(p.id);
        const total = s?.total ?? 0;
        return {
          ...p,
          // Un prestataire coûte : le montant est négatif au grand livre, on
          // l'expose en valeur absolue pour la lecture.
          volume: Math.abs(total),
          sens: total < 0 ? 'depense' : total > 0 ? 'recette' : null,
          mouvements: s?.mouvements ?? 0,
        };
      }),
    });
  } catch (err) {
    console.error('[partners.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /partners/suggestions — regroupements possibles, jamais appliqués d'office
router.get('/suggestions', authorize('clients', 'read'), async (req, res) => {
  try {
    return res.status(200).json({ suggestions: await suggestMerges() });
  } catch (err) {
    console.error('[partners.suggestions]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /partners/:id — fiche avec historique
router.get('/:id', authorize('clients', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const partner = await prisma.partner.findFirst({ where: { id } });
    if (!partner) {
      return res.status(404).json({ message: 'Tiers introuvable', statusCode: 404 });
    }

    const [entries, agg, quotes] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where: { partnerId: id },
        orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
      prisma.ledgerEntry.aggregate({
        where: { partnerId: id },
        _sum: { amountFcfa: true },
        _count: { _all: true },
      }),
      prisma.workshopQuote.findMany({
        where: { partnerId: id },
        orderBy: { id: 'desc' },
        take: 50,
        select: {
          id: true, amount: true, description: true, status: true,
          createdAt: true, vehicle: { select: { vin: true, brand: true, model: true } },
        },
      }),
    ]);

    const total = Number(agg._sum.amountFcfa ?? 0);
    return res.status(200).json({
      partner,
      volume: Math.abs(total),
      mouvements: agg._count._all,
      ticketMoyen: agg._count._all ? Math.abs(total) / agg._count._all : 0,
      entries: entries.map((e) => ({
        id: Number(e.id),
        date: e.entryDate,
        nature: e.nature,
        label: e.label,
        montant: Number(e.amountFcfa),
        vehicle_id: e.vehicleId,
      })),
      interventions: quotes.map((q) => ({
        id: q.id,
        montant: Number(q.amount),
        description: q.description,
        statut: q.status,
        date: q.createdAt,
        vehicule: q.vehicle
          ? `${q.vehicle.brand ?? ''} ${q.vehicle.model ?? ''}`.trim() || q.vehicle.vin
          : null,
      })),
    });
  } catch (err) {
    console.error('[partners.detail]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /partners
router.post('/', authorize('clients', 'create'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) {
      return res.status(400).json({ message: 'Nom requis', statusCode: 400 });
    }
    const kinds = Array.isArray(b.kinds) ? b.kinds : b.kind ? [b.kind] : [];
    const invalid = kinds.filter((k) => !KINDS.includes(k));
    if (invalid.length) {
      return res.status(400).json({
        message: `Rôle inconnu : ${invalid.join(', ')}. Valeurs : ${KINDS.join(', ')}`,
        statusCode: 400,
      });
    }
    // findOrCreate plutôt que create : deux graphies du même nom ne doivent pas
    // produire deux tiers.
    const partner = await findOrCreatePartner(b.name, kinds[0] ?? null, b);
    return res.status(201).json(partner);
  } catch (err) {
    if (String(err.message || '').startsWith('[partners]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[partners.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// PATCH /partners/:id
router.patch('/:id', authorize('clients', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const data = {};
    for (const f of ['contactName', 'email', 'phone', 'address', 'city', 'country', 'legalNumber', 'notes', 'specialty']) {
      if (b[f] !== undefined) data[f] = b[f] || null;
    }
    if (b.isActive !== undefined) data.isActive = !!b.isActive;
    if (Array.isArray(b.kinds)) {
      const invalid = b.kinds.filter((k) => !KINDS.includes(k));
      if (invalid.length) {
        return res.status(400).json({ message: `Rôle inconnu : ${invalid.join(', ')}`, statusCode: 400 });
      }
      data.kinds = b.kinds;
    }
    if (b.name) {
      data.name = String(b.name).trim().slice(0, 255);
      data.slug = slugify(b.name);
    }

    const updated = await prisma.partner.update({ where: { id }, data });
    return res.status(200).json(updated);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Un tiers porte déjà ce nom', statusCode: 409 });
    }
    console.error('[partners.update]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /partners/:id/merge — fusion explicite dans un autre tiers
router.post('/:id/merge', authorize('clients', 'update'), async (req, res) => {
  try {
    const target = Number(req.body?.targetId);
    if (!Number.isInteger(target)) {
      return res.status(400).json({ message: 'targetId requis', statusCode: 400 });
    }
    return res.status(200).json(await mergePartners(req.params.id, target));
  } catch (err) {
    if (String(err.message || '').startsWith('[partners]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[partners.merge]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
