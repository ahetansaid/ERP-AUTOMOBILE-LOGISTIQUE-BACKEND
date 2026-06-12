const express = require('express');
const { prisma } = require('../lib/prisma');
const { toSnake } = require('../lib/serialize');
const { onChargeCreated } = require('../services/treasuryTransactions');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const rows = await prisma.charge.findMany({
      orderBy: { chargeDate: 'desc' },
    });
    return res.status(200).json({ charges: toSnake(rows), pagination: {} });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/', async (req, res) => {
  try {
    const { label, category, amount, chargeDate, charge_date } = req.body || {};
    if (!label || amount == null) return res.status(400).json({ message: 'label et amount requis', statusCode: 400 });
    const companyId = req.query.companyId || req.user?.companyId || null;
    const d = chargeDate || charge_date || new Date();
    const dateStr = typeof d === 'string' && d.match(/^\d{4}-\d{2}-\d{2}/) ? d.slice(0, 10) : (d instanceof Date ? d.toISOString().slice(0, 10) : null) || null;
    const effectiveDate = dateStr || (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

    const created = await prisma.charge.create({
      data: {
        companyId: companyId ? Number(companyId) : null,
        label,
        category: category || null,
        amount,
        chargeDate: new Date(effectiveDate),
      },
    });

    const amt = Number(amount);
    if (created.id && amt > 0) await onChargeCreated(companyId, created.id, amt, effectiveDate, category, label);

    return res.status(201).json(toSnake(created));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.charge.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ message: 'Charge introuvable', statusCode: 404 });
    await prisma.charge.delete({ where: { id } });
    return res.status(204).send();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
