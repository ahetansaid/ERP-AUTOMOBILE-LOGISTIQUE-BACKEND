const express = require('express');
const { prisma } = require('../lib/prisma');
const { toSnake } = require('../lib/serialize');
const { onReceiptInvoice, onReceiptWorkshopQuote } = require('../services/treasuryTransactions');
const { notify } = require('../services/notifications');
const { nextDocumentNumber } = require('../lib/numbering');
const { authorize } = require('../middleware/rbac');
const router = express.Router();

function sortByDateThenId(a, b) {
  const da = a.paymentDate ? new Date(a.paymentDate).getTime() : 0;
  const db = b.paymentDate ? new Date(b.paymentDate).getTime() : 0;
  if (da !== db) return da - db;
  return (a.id || 0) - (b.id || 0);
}

router.get('/', authorize('receipts', 'read'), async (req, res) => {
  try {
    const rows = await prisma.receipt.findMany({
      where: { ...req.tenantWhere() },
      orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            client: { select: { name: true } },
            vehicle: { select: { priceSale: true } },
          },
        },
        workshopQuote: {
          select: {
            amount: true,
            prestataire: true,
            vehicle: { select: { vin: true } },
          },
        },
      },
    });

    // Soldes restants cumulés (par facture via prix de vente du véhicule, par devis via montant du devis)
    const byInvoice = {};
    const byQuote = {};
    for (const r of rows) {
      if (r.invoiceId != null) (byInvoice[r.invoiceId] ||= []).push(r);
      if (r.workshopQuoteId != null) (byQuote[r.workshopQuoteId] ||= []).push(r);
    }
    const remainingByReceiptId = {};
    const priceSaleByReceiptId = {};
    for (const recs of Object.values(byInvoice)) {
      const priceSale = Number(recs[0].invoice?.vehicle?.priceSale) || 0;
      const sorted = recs.slice().sort(sortByDateThenId);
      let cumulative = 0;
      for (const rec of sorted) {
        cumulative += Number(rec.amount) || 0;
        remainingByReceiptId[rec.id] = Math.max(0, priceSale - cumulative);
        priceSaleByReceiptId[rec.id] = priceSale;
      }
    }
    for (const recs of Object.values(byQuote)) {
      const devisAmount = Number(recs[0].workshopQuote?.amount) || 0;
      const sorted = recs.slice().sort(sortByDateThenId);
      let cumulative = 0;
      for (const rec of sorted) {
        cumulative += Number(rec.amount) || 0;
        remainingByReceiptId[rec.id] = Math.max(0, devisAmount - cumulative);
      }
    }

    const receipts = rows.map((r) => {
      const { invoice, workshopQuote, ...recRest } = r;
      const out = toSnake(recRest);
      out.invoice_number = invoice?.invoiceNumber ?? null;
      out.client_name = invoice?.client?.name ?? null;
      out.devis_prestataire = workshopQuote?.prestataire ?? null;
      out.devis_vin = workshopQuote?.vehicle?.vin ?? null;

      out.source_type = r.workshopQuoteId ? 'DEVIS' : 'FACTURE';
      if (r.workshopQuoteId) {
        out.devis_id = r.workshopQuoteId;
        out.devisPrestataire = out.devis_prestataire;
        out.prestataire = out.devis_prestataire;
        out.workshop_prestataire = out.devis_prestataire;
        const remDevis = remainingByReceiptId[r.id];
        if (remDevis !== undefined) {
          out.remaining_amount = remDevis;
          out.remainingAmount = remDevis;
          out.solde_restant = remDevis;
        }
      } else {
        out.clientName = out.client_name;
        out.client = out.client_name;
        const rem = remainingByReceiptId[r.id];
        if (rem !== undefined) {
          out.remaining_amount = rem;
          out.remainingAmount = rem;
          out.solde_restant = rem;
        }
        const ps = priceSaleByReceiptId[r.id];
        if (ps !== undefined) {
          out.invoice_price_sale = ps;
          out.price_sale = ps;
        }
      }
      return out;
    });
    return res.status(200).json({ receipts, pagination: {} });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

function toDateOnly(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : s;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function safeReceived(body) {
  try {
    const o = {};
    if (body.amount !== undefined) o.amount = body.amount;
    if (body.invoiceId !== undefined) o.invoiceId = body.invoiceId;
    if (body.invoice_id !== undefined) o.invoice_id = body.invoice_id;
    if (body.devisId !== undefined) o.devisId = body.devisId;
    if (body.devis_id !== undefined) o.devis_id = body.devis_id;
    if (body.source_type !== undefined) o.source_type = body.source_type;
    if (body.paymentMethod !== undefined) o.paymentMethod = body.paymentMethod;
    if (body.payment_method !== undefined) o.payment_method = body.payment_method;
    if (body.paymentDate !== undefined) o.paymentDate = body.paymentDate;
    if (body.payment_date !== undefined) o.payment_date = body.payment_date;
    return o;
  } catch (e) {
    return {};
  }
}

async function sumReceipts(where) {
  const agg = await prisma.receipt.aggregate({ _sum: { amount: true }, where });
  return Number(agg._sum.amount ?? 0);
}

router.post('/', authorize('receipts', 'create'), async (req, res) => {
  try {
    const raw = req.body || {};
    const body = raw.data && typeof raw.data === 'object' ? { ...raw.data, ...raw } : raw;
    let invoiceId = body.invoiceId ?? body.invoice_id;
    let devisId = body.devisId ?? body.devis_id ?? body.quoteId ?? body.quote_id;
    const sourceType = (body.source_type ?? body.sourceType ?? '').toString().toUpperCase();
    if (sourceType === 'DEVIS') {
      if (devisId != null && devisId !== '') {
        invoiceId = null;
      } else if (body.id != null && body.id !== '') {
        devisId = body.id;
        invoiceId = null;
      }
    }
    if (sourceType === 'FACTURE') {
      if (invoiceId != null && invoiceId !== '') {
        devisId = null;
      } else if (body.id != null && body.id !== '') {
        invoiceId = body.id;
        devisId = null;
      }
    }
    const amount = body.amount != null ? Number(body.amount) : undefined;
    let paymentMethod = (body.paymentMethod ?? body.payment_method ?? '').toString().trim();
    if (!paymentMethod) paymentMethod = 'ESPECES';
    let paymentDate = toDateOnly(body.paymentDate ?? body.payment_date);
    if (!paymentDate) paymentDate = todayStr();
    const reference = body.reference != null ? String(body.reference).trim() : null;

    const received = safeReceived(body);

    if (amount == null || isNaN(amount)) {
      return res.status(400).json({
        message: 'amount requis (nombre)',
        statusCode: 400,
        field: 'amount',
        received: received,
        hint: 'Envoyer par ex. { "devisId": 1, "amount": 75000, "paymentMethod": "ESPECES", "paymentDate": "2026-03-07" }',
      });
    }
    if (invoiceId != null && invoiceId !== '' && devisId != null && devisId !== '') {
      return res.status(400).json({
        message: 'Indiquer soit invoiceId soit devisId, pas les deux',
        statusCode: 400,
        field: 'source',
        received: received,
      });
    }
    const hasInvoice = invoiceId != null && invoiceId !== '';
    const hasDevis = devisId != null && devisId !== '';
    if (!hasInvoice && !hasDevis) {
      return res.status(400).json({
        message: 'invoiceId ou devisId requis. Pour un reçu devis : envoyer devisId (ou devis_id). Pour une facture : invoiceId (ou invoice_id).',
        statusCode: 400,
        field: 'invoiceId',
        received: received,
        hint: 'Reçu devis : { "devisId": 1, "amount": 75000, "paymentMethod": "ESPECES", "paymentDate": "2026-03-07" }',
      });
    }
    if (hasDevis) devisId = Number(devisId) || devisId;
    if (hasInvoice) invoiceId = Number(invoiceId) || invoiceId;

    const paymentDateObj = new Date(paymentDate);

    let created;
    if (hasDevis) {
      const q = await prisma.workshopQuote.findFirst({
        where: { id: Number(devisId), ...req.tenantWhere() },
        select: { id: true, amount: true, companyId: true, vehicleId: true, closedAt: true },
      });
      if (!q) return res.status(404).json({ message: 'Devis introuvable', statusCode: 404 });
      const devisAmount = Number(q.amount) || 0;
      const alreadyPaid = await sumReceipts({ workshopQuoteId: Number(devisId) });
      const remainingBefore = Math.max(0, devisAmount - alreadyPaid);
      if (remainingBefore <= 0) {
        return res.status(409).json({
          message: 'Ce devis est entièrement réglé. Aucun nouveau reçu ne peut être émis.',
          statusCode: 409,
        });
      }
      if (amount > remainingBefore) {
        return res.status(409).json({
          message: 'Le montant du reçu ne peut pas dépasser le solde restant.',
          statusCode: 409,
          solde_restant: remainingBefore,
          remaining_amount: remainingBefore,
        });
      }
      const { number: receiptNumber } = await nextDocumentNumber(req.companyId, 'RECEIPT');
      created = await prisma.receipt.create({
        data: {
          companyId: req.companyId ?? null,
          receiptNumber,
          workshopQuoteId: Number(devisId),
          amount,
          paymentMethod,
          paymentDate: paymentDateObj,
          reference,
        },
      });
      const totalPaidAfter = await sumReceipts({ workshopQuoteId: Number(devisId) });
      if (totalPaidAfter >= devisAmount) {
        await prisma.workshopQuote.update({
          where: { id: Number(devisId) },
          data: { status: 'TERMINE', closedAt: q.closedAt ?? new Date() },
        });
      }
      if (created.id) await onReceiptWorkshopQuote(q.companyId, created.id, amount, paymentDate, reference, q.vehicleId, Number(devisId));
    } else {
      const inv = await prisma.invoice.findFirst({
        where: { id: Number(invoiceId), ...req.tenantWhere() },
        select: { id: true, vehicleId: true, companyId: true, invoiceNumber: true, vehicle: { select: { priceSale: true } } },
      });
      if (!inv) return res.status(404).json({ message: 'Facture introuvable', statusCode: 404 });
      const vehicleId = inv.vehicleId;
      const priceSale = Number(inv.vehicle?.priceSale) || 0;
      const alreadyPaid = await sumReceipts({ invoiceId: Number(invoiceId) });
      const remainingBefore = Math.max(0, priceSale - alreadyPaid);
      if (remainingBefore <= 0) {
        return res.status(409).json({
          message: 'La facture de ce véhicule est entièrement réglée. Aucun nouveau reçu ne peut être émis.',
          statusCode: 409,
        });
      }
      if (amount > remainingBefore) {
        return res.status(409).json({
          message: 'Le montant du reçu ne peut pas dépasser le solde restant.',
          statusCode: 409,
          solde_restant: remainingBefore,
          remaining_amount: remainingBefore,
        });
      }
      const { number: receiptNumber } = await nextDocumentNumber(req.companyId, 'RECEIPT');
      created = await prisma.receipt.create({
        data: {
          companyId: req.companyId ?? null,
          receiptNumber,
          invoiceId: Number(invoiceId),
          amount,
          paymentMethod,
          paymentDate: paymentDateObj,
          reference,
        },
      });
      const companyId = inv.companyId;
      if (created.id) await onReceiptInvoice(companyId, created.id, amount, paymentDate, reference, vehicleId);
      const invNumber = inv.invoiceNumber || `#${invoiceId}`;
      notify({
        companyId,
        type: 'SUCCESS',
        title: 'Paiement reçu',
        message: `Reçu de ${Number(amount).toLocaleString('fr-FR')} FCFA sur la facture ${invNumber}.`,
        link: `/comptabilite/factures/${invoiceId}`,
        audience: 'admins',
      });
    }

    return res.status(201).json(toSnake(created));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.patch('/:id', authorize('receipts', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const amount = body.amount != null ? Number(body.amount) : undefined;
    const paymentMethod = body.paymentMethod ?? body.payment_method;
    const paymentDateRaw = body.paymentDate ?? body.payment_date;
    const paymentDate = paymentDateRaw != null && paymentDateRaw !== '' ? toDateOnly(paymentDateRaw) : undefined;
    const reference = body.reference !== undefined ? String(body.reference).trim() : undefined;

    const existing = await prisma.receipt.findFirst({ where: { id, ...req.tenantWhere() }, select: { id: true } });
    if (!existing) return res.status(404).json({ message: 'Reçu introuvable', statusCode: 404 });

    const data = {};
    if (amount != null && !isNaN(amount)) data.amount = amount;
    if (paymentMethod !== undefined) data.paymentMethod = paymentMethod;
    if (paymentDate !== undefined) data.paymentDate = new Date(paymentDate);
    if (reference !== undefined) data.reference = reference || null;

    if (Object.keys(data).length === 0) {
      const current = await prisma.receipt.findUnique({ where: { id } });
      return res.status(200).json(toSnake(current));
    }
    const updated = await prisma.receipt.update({ where: { id }, data });
    return res.status(200).json(toSnake(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.delete('/:id', authorize('receipts', 'delete'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.receipt.findFirst({ where: { id, ...req.tenantWhere() }, select: { id: true } });
    if (!existing) return res.status(404).json({ message: 'Reçu introuvable', statusCode: 404 });
    await prisma.receipt.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
