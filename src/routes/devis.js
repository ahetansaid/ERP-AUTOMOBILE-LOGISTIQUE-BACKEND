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
    const existing = await prisma.workshopQuote.findFirst({
      where: { vehicleId: Number(b.vehicleId), status: { not: 'TERMINE' }, ...req.tenantWhere() },
      select: { id: true },
    });
    if (existing) return res.status(409).json({ message: 'Devis actif existant', statusCode: 409 });
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

module.exports = router;
