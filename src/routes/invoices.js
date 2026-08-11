const express = require('express');
const { prisma } = require('../lib/prisma');
const { toSnake } = require('../lib/serialize');
const { nextDocumentNumber } = require('../lib/numbering');
const ledgerBridge = require('../services/ledgerBridge');
const { authorize } = require('../middleware/rbac');
// @react-pdf/renderer est lourd : on le charge paresseusement (require dans le
// handler PDF) pour ne pas l'embarquer dans le démarrage à froid serverless.
const router = express.Router();

router.get('/', authorize('invoices', 'read'), async (req, res) => {
  try {
    const rows = await prisma.invoice.findMany({
      where: { ...req.tenantWhere() },
      orderBy: { id: 'desc' },
      include: {
        client: { select: { name: true } },
        vehicle: { select: { vin: true, priceSale: true } },
        receipts: { select: { amount: true } },
      },
    });
    const out = rows.map((r) => {
      const paid = (r.receipts || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const total = Number(r.totalAmount) || 0;
      const priceSale = Number(r.vehicle?.priceSale) || 0;
      const remaining = Math.max(0, priceSale - paid);
      const { client, vehicle, receipts, ...rest } = r;
      return {
        ...toSnake(rest),
        client_name: client?.name ?? null,
        vin: vehicle?.vin ?? null,
        amount: total,
        total_amount: total,
        paid_amount: paid,
        remaining_amount: remaining,
        price_sale: priceSale,
        priceSale: priceSale,
        prix_vente: priceSale,
      };
    });
    return res.status(200).json({ invoices: out, pagination: {} });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.get('/:id', authorize('invoices', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await prisma.invoice.findFirst({
      where: { id, ...req.tenantWhere() },
      include: {
        client: { select: { name: true } },
        vehicle: { select: { vin: true, priceSale: true } },
        receipts: {
          orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }],
          select: { id: true, amount: true, paymentMethod: true, paymentDate: true, reference: true },
        },
      },
    });
    if (!r) return res.status(404).json({ message: 'Facture introuvable', statusCode: 404 });

    const paid = (r.receipts || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const priceSale = Number(r.vehicle?.priceSale) || 0;
    const remaining = Math.max(0, priceSale - paid);

    let cumulative = 0;
    const receipts = (r.receipts || []).map((rec) => {
      cumulative += Number(rec.amount) || 0;
      const soldeApres = Math.max(0, priceSale - cumulative);
      return {
        id: rec.id,
        amount: Number(rec.amount),
        payment_method: rec.paymentMethod,
        payment_date: rec.paymentDate,
        reference: rec.reference,
        remaining_amount: soldeApres,
        remainingAmount: soldeApres,
        solde_restant_apres: soldeApres,
      };
    });

    const { client, vehicle, receipts: _rec, ...rest } = r;
    const invoice = {
      ...toSnake(rest),
      client_name: client?.name ?? null,
      vin: vehicle?.vin ?? null,
      amount: Number(r.totalAmount) || 0,
      total_amount: Number(r.totalAmount) || 0,
      paid_amount: paid,
      remaining_amount: remaining,
      price_sale: priceSale,
      priceSale: priceSale,
      receipts,
    };
    return res.status(200).json(invoice);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/', authorize('invoices', 'create'), async (req, res) => {
  try {
    const body = req.body || {};
    const vehicleId = body.vehicleId ?? body.vehicle_id;
    const clientId = body.clientId ?? body.client_id;
    const amount = body.amount ?? body.total_amount;
    const dueDate = body.dueDate ?? body.due_date;
    if (!vehicleId || !clientId || amount == null) return res.status(400).json({ message: 'vehicleId, clientId et amount (ou total_amount) requis', statusCode: 400 });

    // Véhicule ET client doivent appartenir à la société courante.
    const vehicle = await prisma.vehicle.findFirst({ where: { id: Number(vehicleId), ...req.tenantWhere() }, select: { priceSale: true } });
    if (!vehicle) return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
    const clientRow = await prisma.client.findFirst({ where: { id: Number(clientId), ...req.tenantWhere() }, select: { id: true } });
    if (!clientRow) return res.status(404).json({ message: 'Client introuvable', statusCode: 404 });
    const priceSale = Number(vehicle.priceSale);
    if (priceSale == null || isNaN(priceSale) || priceSale <= 0) {
      return res.status(400).json({
        message: 'Le véhicule doit avoir un prix de vente renseigné pour créer la facture. Montant facture = prix de vente (1 facture = 1 véhicule).',
        statusCode: 400,
      });
    }
    const amountToUse = priceSale;

    const existing = await prisma.invoice.findUnique({
      where: { vehicleId: Number(vehicleId) },
      select: { id: true, invoiceNumber: true },
    });
    if (existing) {
      return res.status(409).json({
        message: 'Un véhicule ne peut avoir qu\'une seule facture. Ce véhicule a déjà une facture. Les paiements se font via des reçus liés à cette facture (page Reçus).',
        statusCode: 409,
        existingInvoice: existing.invoiceNumber || existing.id,
      });
    }

    // Numéro de facture : FAV-{année}-{séquence 4 chiffres}, réservé de façon
    // atomique (voir src/lib/numbering.js). Deux créations simultanées ne
    // peuvent plus obtenir le même numéro.
    const { number: invoice_number } = await nextDocumentNumber(
      req.companyId,
      'INVOICE'
    );

    await prisma.invoice.create({
      data: {
        companyId: req.companyId ?? null,
        vehicleId: Number(vehicleId),
        clientId: Number(clientId),
        totalAmount: amountToUse,
        dueDate: dueDate ? new Date(dueDate) : null,
        invoiceNumber: invoice_number,
        status: 'EMISE',
      },
    });
    const created = await prisma.invoice.findUnique({
      where: { vehicleId: Number(vehicleId) },
      include: { client: { select: { name: true } }, vehicle: { select: { vin: true } } },
    });
    // Le produit de la vente est reconnu ici, à l'émission — pas à
    // l'encaissement, qui n'est qu'un mouvement de trésorerie (REGLEMENT).
    await ledgerBridge.onInvoiceIssued({
      invoiceId: created.id,
      vehicleId: Number(vehicleId),
      amount: amountToUse,
      issuedAt: created.createdAt,
      label: `Vente ${invoice_number}`,
    });

    const { client, vehicle: veh, ...rest } = created;
    return res.status(201).json({
      ...toSnake(rest),
      client_name: client?.name ?? null,
      vin: veh?.vin ?? null,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.patch('/:id', authorize('invoices', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const inv = await prisma.invoice.findFirst({ where: { id, ...req.tenantWhere() }, select: { id: true, totalAmount: true } });
    if (!inv) return res.status(404).json({ message: 'Facture introuvable', statusCode: 404 });

    const paidAgg = await prisma.receipt.aggregate({ _sum: { amount: true }, where: { invoiceId: id } });
    const paid = Number(paidAgg._sum.amount ?? 0);
    if (paid > 0) {
      return res.status(409).json({ message: 'Un reçu a déjà été émis pour cette facture. Modification impossible.', statusCode: 409 });
    }

    const data = {};
    if (body.vehicleId != null) data.vehicleId = Number(body.vehicleId);
    if (body.clientId != null) data.clientId = Number(body.clientId);
    if (body.amount != null || body.total_amount != null) {
      data.totalAmount = Number(body.amount != null ? body.amount : body.total_amount);
    }
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;

    if (Object.keys(data).length === 0) {
      const current = await prisma.invoice.findUnique({
        where: { id },
        include: { client: { select: { name: true } }, vehicle: { select: { vin: true } } },
      });
      const { client, vehicle, ...rest } = current;
      return res.status(200).json({ ...toSnake(rest), client_name: client?.name ?? null, vin: vehicle?.vin ?? null });
    }

    await prisma.invoice.update({ where: { id }, data });
    const updated = await prisma.invoice.findUnique({
      where: { id },
      include: { client: { select: { name: true } }, vehicle: { select: { vin: true } } },
    });
    const { client, vehicle, ...rest } = updated;
    return res.status(200).json({
      ...toSnake(rest),
      client_name: client?.name ?? null,
      vin: vehicle?.vin ?? null,
      paid_amount: paid,
      remaining_amount: Math.max(0, Number(updated.totalAmount) - paid),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.delete('/:id', authorize('invoices', 'delete'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findFirst({ where: { id, ...req.tenantWhere() }, select: { id: true } });
    if (!inv) return res.status(404).json({ message: 'Facture introuvable', statusCode: 404 });
    const paidAgg = await prisma.receipt.aggregate({ _sum: { amount: true }, where: { invoiceId: id } });
    const paid = Number(paidAgg._sum.amount ?? 0);
    if (paid > 0) {
      return res.status(409).json({ message: 'Un reçu a déjà été émis pour cette facture. Suppression impossible.', statusCode: 409 });
    }
    await prisma.receipt.deleteMany({ where: { invoiceId: id } });
    await prisma.invoice.delete({ where: { id } });
    return res.status(204).send();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /invoices/:id/pdf — génère un PDF de la facture (template au choix via ?template=minimal)
router.get('/:id/pdf', authorize('invoices', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const { renderDocumentPdf } = require('../pdf/render');

    const [invoice, receipts] = await Promise.all([
      prisma.invoice.findFirst({
        where: { id, ...req.tenantWhere() },
        include: {
          client: true,
          vehicle: true,
          company: true,
        },
      }),
      prisma.receipt.findMany({
        where: { invoiceId: id },
        orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }],
      }),
    ]);

    if (!invoice) {
      return res.status(404).json({ message: 'Facture introuvable', statusCode: 404 });
    }

    const paid = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    const priceSale = Number(invoice.vehicle?.priceSale) || Number(invoice.totalAmount) || 0;
    const totalAmount = priceSale > 0 ? priceSale : Number(invoice.totalAmount) || 0;

    const data = {
      kind: 'FACTURE',
      number: invoice.invoiceNumber,
      issuedAt: invoice.createdAt,
      dueDate: invoice.dueDate,
      currency: 'FCFA',
      vatRate: 0,
      statusLabel:
        paid >= totalAmount ? 'Payée' : paid > 0 ? 'Partiellement payée' : 'En attente',
      lines: [
        {
          label:
            invoice.vehicle
              ? `${invoice.vehicle.brand || ''} ${invoice.vehicle.model || ''}`.trim() ||
                'Véhicule'
              : 'Prestation',
          sublabel: invoice.vehicle?.vin ? `VIN : ${invoice.vehicle.vin}` : undefined,
          quantity: 1,
          unitPrice: totalAmount,
          total: totalAmount,
        },
      ],
      from: {
        name: invoice.company?.name || 'ParcAuto Manager',
        address: invoice.company?.address || undefined,
        city: invoice.company?.country ? undefined : undefined,
        country: invoice.company?.country || undefined,
        phone: invoice.company?.phone || undefined,
        email: invoice.company?.email || undefined,
        legalNumber: invoice.company?.legalNumber || undefined,
      },
      to: {
        name: invoice.client?.name || 'Client',
        address: invoice.client?.address || undefined,
        city: invoice.client?.city || undefined,
        country: invoice.client?.country || undefined,
        phone: invoice.client?.phone || undefined,
        email: invoice.client?.email || undefined,
      },
      brand: {
        name: invoice.company?.name,
        color: invoice.company?.primaryColor || '#6366F1',
      },
      notes:
        paid > 0 && paid < totalAmount
          ? `Paiement partiel reçu : ${paid.toLocaleString('fr-FR')} FCFA. Solde restant : ${(totalAmount - paid).toLocaleString('fr-FR')} FCFA.`
          : undefined,
    };

    const template = typeof req.query.template === 'string' ? req.query.template : 'minimal';
    const buffer = await renderDocumentPdf(data, { template });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${invoice.invoiceNumber || 'facture'}.pdf"`
    );
    return res.send(buffer);
  } catch (err) {
    console.error('[invoices.pdf]', err);
    return res
      .status(500)
      .json({ message: 'Erreur lors de la génération du PDF', statusCode: 500 });
  }
});

module.exports = router;
