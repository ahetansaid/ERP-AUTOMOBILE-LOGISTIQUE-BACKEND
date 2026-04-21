const express = require('express');
const { prisma } = require('../lib/prisma');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const MUTABLE_FIELDS = [
  'vehicleId',
  'clientId',
  'totalAmount',
  'proformaNumber',
  'status',
];

function pickMutable(body) {
  const data = {};
  // Accept camelCase + snake_case du front
  const alias = {
    vehicleId: body.vehicleId ?? body.vehicle_id,
    clientId: body.clientId ?? body.client_id,
    totalAmount: body.totalAmount ?? body.total_amount ?? body.amount,
    proformaNumber: body.proformaNumber ?? body.proforma_number,
    status: body.status,
  };
  for (const key of MUTABLE_FIELDS) {
    const v = alias[key];
    if (v === undefined) continue;
    if (v === '' || v === null) {
      data[key] = null;
      continue;
    }
    if (key === 'vehicleId' || key === 'clientId') {
      const n = Number(v);
      data[key] = Number.isInteger(n) ? n : null;
    } else if (key === 'totalAmount') {
      const n = Number(v);
      data[key] = Number.isFinite(n) ? n : null;
    } else {
      data[key] = v;
    }
  }
  return data;
}

// Enrichit avec les champs attendus par le front
function enrich(p) {
  return {
    ...p,
    total_amount: p.totalAmount != null ? Number(p.totalAmount) : null,
    proforma_number: p.proformaNumber ?? null,
    vehicle_id: p.vehicleId ?? null,
    client_id: p.clientId ?? null,
    client_name: p.client?.name ?? null,
    vin: p.vehicle?.vin ?? null,
    brand: p.vehicle?.brand ?? null,
    model: p.vehicle?.model ?? null,
  };
}

router.get('/', authorize('proformas', 'read'), async (req, res) => {
  try {
    const rows = await prisma.proforma.findMany({
      where: req.tenantWhere(),
      orderBy: { id: 'desc' },
      include: {
        client: { select: { name: true } },
        vehicle: { select: { vin: true, brand: true, model: true } },
      },
    });
    return res.status(200).json({ proformas: rows.map(enrich), pagination: {} });
  } catch (err) {
    console.error('[proformas.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.get('/:id', authorize('proformas', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const pf = await prisma.proforma.findFirst({
      where: { id, ...req.tenantWhere() },
      include: {
        client: { select: { name: true } },
        vehicle: { select: { vin: true, brand: true, model: true } },
      },
    });
    if (!pf) {
      return res.status(404).json({ message: 'Pro forma introuvable', statusCode: 404 });
    }
    return res.status(200).json(enrich(pf));
  } catch (err) {
    console.error('[proformas.detail]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/', authorize('proformas', 'create'), async (req, res) => {
  try {
    const body = req.body || {};
    const data = pickMutable(body);

    // Génération automatique du numéro si non fourni
    if (!data.proformaNumber) {
      const year = new Date().getFullYear();
      const count = await prisma.proforma.count({ where: req.tenantWhere() });
      data.proformaNumber = `PRO-${year}-${String(count + 1).padStart(4, '0')}`;
    }

    if (!data.status) data.status = 'BROUILLON';

    const created = await prisma.proforma.create({
      data: { ...data, companyId: req.companyId },
    });
    req.audit({
      action: 'CREATE',
      resource: 'proformas',
      resourceId: created.id,
      after: created,
    });
    return res.status(201).json(enrich(created));
  } catch (err) {
    console.error('[proformas.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.patch('/:id', authorize('proformas', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const before = await prisma.proforma.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!before) {
      return res.status(404).json({ message: 'Pro forma introuvable', statusCode: 404 });
    }
    const data = pickMutable(req.body || {});
    const updated = Object.keys(data).length
      ? await prisma.proforma.update({ where: { id }, data })
      : before;
    if (Object.keys(data).length) {
      req.audit({
        action: 'UPDATE',
        resource: 'proformas',
        resourceId: id,
        before,
        after: updated,
      });
    }
    return res.status(200).json(enrich(updated));
  } catch (err) {
    console.error('[proformas.update]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.delete('/:id', authorize('proformas', 'delete'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const before = await prisma.proforma.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!before) {
      return res.status(404).json({ message: 'Pro forma introuvable', statusCode: 404 });
    }
    await prisma.proforma.delete({ where: { id } });
    req.audit({
      action: 'DELETE',
      resource: 'proformas',
      resourceId: id,
      before,
    });
    return res.status(204).send();
  } catch (err) {
    console.error('[proformas.delete]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /proformas/:id/convert — crée une facture depuis une proforma acceptée
router.post('/:id/convert', authorize('invoices', 'create'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const pf = await prisma.proforma.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!pf) {
      return res.status(404).json({ message: 'Pro forma introuvable', statusCode: 404 });
    }
    if (!pf.vehicleId || !pf.clientId || pf.totalAmount == null) {
      return res.status(400).json({
        message: 'Véhicule, client et montant sont requis pour convertir',
        statusCode: 400,
      });
    }
    const existingInvoice = await prisma.invoice.findUnique({
      where: { vehicleId: pf.vehicleId },
      select: { id: true },
    });
    if (existingInvoice) {
      return res.status(409).json({
        message: 'Une facture existe déjà pour ce véhicule',
        statusCode: 409,
      });
    }
    const year = new Date().getFullYear();
    const count = await prisma.invoice.count({ where: req.tenantWhere() });
    const invoiceNumber = `FAC-${year}-${String(count + 1).padStart(4, '0')}`;

    const [invoice] = await prisma.$transaction([
      prisma.invoice.create({
        data: {
          companyId: pf.companyId,
          vehicleId: pf.vehicleId,
          clientId: pf.clientId,
          totalAmount: pf.totalAmount,
          invoiceNumber,
          status: 'EMISE',
        },
      }),
      prisma.proforma.update({
        where: { id },
        data: { status: 'CONVERTIE' },
      }),
    ]);

    req.audit({
      action: 'CREATE',
      resource: 'invoices',
      resourceId: invoice.id,
      after: { fromProforma: id, invoice },
    });
    return res.status(201).json(invoice);
  } catch (err) {
    console.error('[proformas.convert]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
