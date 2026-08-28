const express = require('express');
const { prisma } = require('../lib/prisma');
const { toSnake } = require('../lib/serialize');
const { authorize } = require('../middleware/rbac');
const router = express.Router();

router.get('/', authorize('workshop_quotes', 'read'), async (req, res) => {
  try {
    const quotes = await prisma.workshopQuote.findMany({
      where: { ...req.tenantWhere() },
      orderBy: { id: 'desc' },
      include: {
        vehicle: { select: { vin: true, brand: true, model: true } },
        receipts: { select: { amount: true } },
      },
    });
    const workshopQuotes = quotes.map((q) => {
      const amt = q.amount != null ? Number(q.amount) : 0;
      const paid = (q.receipts || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const remaining = Math.max(0, amt - paid);
      const { vehicle, receipts, ...rest } = q;
      const base = toSnake(rest);
      return {
        ...base,
        vin: vehicle?.vin ?? null,
        brand: vehicle?.brand ?? null,
        model: vehicle?.model ?? null,
        total_amount: amt,
        amount: amt,
        paid_amount: paid,
        paidAmount: paid,
        remaining_amount: remaining,
        remainingAmount: remaining,
        solde_restant: remaining,
        closed_at: base.closed_at || null,
        date_cloture: base.closed_at || null,
      };
    });
    return res.status(200).json({ workshopQuotes, pagination: {} });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/', authorize('workshop_quotes', 'create'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.vehicleId || !b.prestataire || b.amount == null) return res.status(400).json({ message: 'vehicleId, prestataire et amount requis', statusCode: 400 });
    // Le véhicule doit appartenir à la société courante (anti cross-tenant).
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: Number(b.vehicleId), ...req.tenantWhere() },
      select: { id: true },
    });
    if (!vehicle) return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
    // Plusieurs devis ouverts sont la règle, pas l'exception : un véhicule passe
    // chez le mécanicien, le tôlier, l'électricien et le peintre, chacun avec
    // son devis et ses reçus. Le blocage « un seul devis actif » obligeait à
    // clore un devis non payé pour en saisir un autre — donc à mentir sur ce
    // qu'on devait. La cohérence est portée par la porte de sortie, qui refuse
    // sans motif tant qu'un devis reste non soldé.
    const created = await prisma.workshopQuote.create({
      data: {
        companyId: req.companyId ?? null,
        vehicleId: Number(b.vehicleId),
        prestataire: b.prestataire,
        amount: b.amount,
        currency: b.currency || 'FCFA',
        description: b.description || null,
        validUntil: b.validUntil ? new Date(b.validUntil) : null,
        status: 'EN_ATTENTE',
      },
    });
    return res.status(201).json(toSnake(created));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * PATCH /devis/:id — cycle de vie du devis.
 *
 * Il n'existait aucun moyen d'approuver un devis : il naissait EN_ATTENTE et
 * ne bougeait qu'en étant payé. Un devis refusé restait donc éternellement en
 * attente, et pesait sur la sortie d'atelier.
 *
 * TERMINE n'est pas proposé ici : il est POSÉ PAR LES REÇUS. Un devis est
 * terminé quand le prestataire est payé, pas quand quelqu'un l'a décidé —
 * l'autoriser à la main rouvrirait le trou que les reçus viennent de fermer.
 */
const TRANSITIONS = {
  EN_ATTENTE: ['APPROUVE', 'REFUSE'],
  APPROUVE: ['EN_COURS', 'REFUSE'],
  EN_COURS: ['CLOTURE'],
  CLOTURE: ['EN_COURS'],
  REFUSE: [],
  TERMINE: [],
};

router.patch('/:id', authorize('workshop_quotes', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const b = req.body || {};
    const existing = await prisma.workshopQuote.findFirst({
      where: { id, ...req.tenantWhere() },
      select: { id: true, status: true, amount: true, closedAt: true },
    });
    if (!existing) return res.status(404).json({ message: 'Devis introuvable', statusCode: 404 });

    const data = {};
    const nouveauStatut = b.status ? String(b.status).trim().toUpperCase() : null;

    if (nouveauStatut && nouveauStatut !== existing.status) {
      const permises = TRANSITIONS[existing.status] ?? [];
      if (!permises.includes(nouveauStatut)) {
        return res.status(409).json({
          message:
            `Transition impossible : ${existing.status} → ${nouveauStatut}. ` +
            (permises.length
              ? `Depuis ${existing.status}, seul ${permises.join(' ou ')} est possible.`
              : `${existing.status} est un état terminal.`) +
            (nouveauStatut === 'TERMINE'
              ? ' Un devis devient TERMINE en étant réglé, par l’émission des reçus.'
              : ''),
          statusCode: 409,
        });
      }
      data.status = nouveauStatut;
      if (nouveauStatut === 'CLOTURE') data.closedAt = existing.closedAt ?? new Date();
      if (nouveauStatut === 'EN_COURS') data.closedAt = null;
    }

    // Le montant ne bouge plus dès qu'un reçu existe : il est le plafond des
    // reçus déjà émis, et le baisser après coup rendrait le devis surpayé.
    if (b.amount != null) {
      const paid = await prisma.receipt.aggregate({
        _sum: { amount: true },
        where: { workshopQuoteId: id },
      });
      const regle = Number(paid._sum.amount ?? 0);
      if (regle > 0) {
        return res.status(409).json({
          message:
            `Un reçu de ${Math.round(regle).toLocaleString('fr-FR')} FCFA a déjà été émis sur ce devis. ` +
            'Son montant ne peut plus être modifié — établissez un devis complémentaire.',
          statusCode: 409,
        });
      }
      data.amount = Number(b.amount);
    }
    if (b.description !== undefined) data.description = b.description || null;
    if (b.prestataire !== undefined && b.prestataire) data.prestataire = b.prestataire;
    if (b.validUntil !== undefined) data.validUntil = b.validUntil ? new Date(b.validUntil) : null;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour', statusCode: 400 });
    }

    const updated = await prisma.workshopQuote.update({ where: { id }, data });
    return res.status(200).json(toSnake(updated));
  } catch (e) {
    console.error('[devis.patch]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
