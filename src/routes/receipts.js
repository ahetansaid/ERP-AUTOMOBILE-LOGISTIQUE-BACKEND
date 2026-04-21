const express = require('express');
const { getPool } = require('../config/database');
const { onReceiptInvoice, onReceiptWorkshopQuote } = require('../services/treasuryTransactions');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const sql = 'SELECT r.*, i.invoice_number, c.name AS client_name, wq.prestataire AS devis_prestataire, v.vin AS devis_vin FROM receipts r LEFT JOIN invoices i ON i.id = r.invoice_id LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN workshop_quotes wq ON wq.id = r.workshop_quote_id LEFT JOIN vehicles v ON v.id = wq.vehicle_id ORDER BY r.payment_date DESC, r.id DESC';
    const [rows] = await pool.execute(sql).catch(function () { return []; });
    const remainingByReceiptId = {};
    const priceSaleByReceiptId = {};
    const invoiceIds = [...new Set((rows || []).filter(function (x) { return x.invoice_id != null; }).map(function (x) { return x.invoice_id; }))];
    for (const invId of invoiceIds) {
      const [invRow] = await pool.execute('SELECT vehicle_id FROM invoices WHERE id = ?', [invId]).catch(function () { return [[]]; });
      const vehicleId = invRow[0] && invRow[0].vehicle_id;
      if (!vehicleId) continue;
      const [vRow] = await pool.execute('SELECT price_sale FROM vehicles WHERE id = ?', [vehicleId]).catch(function () { return [[]]; });
      const priceSale = Number(vRow[0] && vRow[0].price_sale) || 0;
      const [recList] = await pool.execute('SELECT id, amount, payment_date FROM receipts WHERE invoice_id = ?', [invId]).catch(function () { return [[]]; });
      const sorted = (recList || []).slice().sort(function (a, b) {
        const da = a.payment_date ? new Date(a.payment_date).getTime() : 0;
        const db = b.payment_date ? new Date(b.payment_date).getTime() : 0;
        if (da !== db) return da - db;
        return (a.id || 0) - (b.id || 0);
      });
      let cumulative = 0;
      for (const rec of sorted) {
        cumulative += Number(rec.amount) || 0;
        remainingByReceiptId[rec.id] = Math.max(0, priceSale - cumulative);
        priceSaleByReceiptId[rec.id] = priceSale;
      }
    }
    const devisIds = [...new Set((rows || []).filter(function (x) { return x.workshop_quote_id != null; }).map(function (x) { return x.workshop_quote_id; }))];
    for (const wqId of devisIds) {
      const [wqRow] = await pool.execute('SELECT amount FROM workshop_quotes WHERE id = ?', [wqId]).catch(function () { return [[]]; });
      const devisAmount = Number(wqRow[0] && wqRow[0].amount) || 0;
      const [recList] = await pool.execute('SELECT id, amount FROM receipts WHERE workshop_quote_id = ? ORDER BY payment_date ASC, id ASC', [wqId]).catch(function () { return [[]]; });
      let cumulative = 0;
      for (const rec of recList || []) {
        cumulative += Number(rec.amount) || 0;
        remainingByReceiptId[rec.id] = Math.max(0, devisAmount - cumulative);
      }
    }
    const receipts = rows.map(function (r) {
      const out = { ...r };
      out.source_type = r.workshop_quote_id ? 'DEVIS' : 'FACTURE';
      if (r.workshop_quote_id) {
        out.devis_id = r.workshop_quote_id;
        out.devis_prestataire = r.devis_prestataire || null;
        out.devisPrestataire = out.devis_prestataire;
        out.prestataire = out.devis_prestataire;
        out.workshop_prestataire = out.devis_prestataire;
        out.devis_vin = r.devis_vin || null;
        const remDevis = remainingByReceiptId[r.id];
        if (remDevis !== undefined) {
          out.remaining_amount = remDevis;
          out.remainingAmount = remDevis;
          out.solde_restant = remDevis;
        }
      } else {
        out.invoice_id = r.invoice_id;
        out.client_name = r.client_name || null;
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

router.post('/', async (req, res) => {
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

    const pool = getPool();
    let hasWorkshopQuoteCol = false;
    try {
      await pool.execute('SELECT workshop_quote_id FROM receipts LIMIT 0');
      hasWorkshopQuoteCol = true;
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' || (e.message && e.message.indexOf('workshop_quote_id') !== -1)) {
        hasWorkshopQuoteCol = false;
      } else {
        throw e;
      }
    }

    if (hasDevis) {
      if (!hasWorkshopQuoteCol) {
        return res.status(400).json({
          message: "Reçu devis non supporté : la table receipts n'a pas la colonne workshop_quote_id. Exécuter la migration scripts/migrations/add_receipts_workshop_quote_id.sql puis redémarrer.",
          statusCode: 400,
        });
      }
      const [q] = await pool.execute('SELECT id, amount FROM workshop_quotes WHERE id = ?', [devisId]);
      if (!q.length) return res.status(404).json({ message: 'Devis introuvable', statusCode: 404 });
      const devisAmount = Number(q[0].amount) || 0;
      const [sumRow] = await pool.execute('SELECT COALESCE(SUM(amount), 0) AS total FROM receipts WHERE workshop_quote_id = ?', [devisId]);
      const alreadyPaid = Number(sumRow[0] && sumRow[0].total) || 0;
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
      const [insRec] = await pool.execute('INSERT INTO receipts (workshop_quote_id, amount, payment_method, payment_date, reference) VALUES (?, ?, ?, ?, ?)', [devisId, amount, paymentMethod, paymentDate, reference]);
      const receiptId = insRec && insRec.insertId;
      const [newSumRow] = await pool.execute('SELECT COALESCE(SUM(amount), 0) AS total FROM receipts WHERE workshop_quote_id = ?', [devisId]);
      const totalPaidAfter = Number(newSumRow[0] && newSumRow[0].total) || 0;
      if (totalPaidAfter >= devisAmount) {
        try {
          await pool.execute("UPDATE workshop_quotes SET status = ?, closed_at = COALESCE(closed_at, NOW()) WHERE id = ?", ['TERMINE', devisId]);
        } catch (e) {
          await pool.execute('UPDATE workshop_quotes SET status = ? WHERE id = ?', ['TERMINE', devisId]);
        }
      }
      const [wqRow] = await pool.execute('SELECT company_id, vehicle_id FROM workshop_quotes WHERE id = ?', [devisId]).catch(() => [[]]);
      const companyId = wqRow[0] && wqRow[0].company_id;
      const vehicleId = wqRow[0] && wqRow[0].vehicle_id;
      if (receiptId) await onReceiptWorkshopQuote(companyId, receiptId, amount, paymentDate, reference, vehicleId, devisId);
    } else {
      const [inv] = await pool.execute('SELECT id, vehicle_id FROM invoices WHERE id = ?', [invoiceId]);
      if (!inv.length) return res.status(404).json({ message: 'Facture introuvable', statusCode: 404 });
      const vehicleId = inv[0].vehicle_id;
      const [vRow] = await pool.execute('SELECT price_sale FROM vehicles WHERE id = ?', [vehicleId]).catch(function () { return [[]]; });
      const priceSale = Number(vRow[0] && vRow[0].price_sale) || 0;
      const [sumRow] = await pool.execute('SELECT COALESCE(SUM(amount), 0) AS total FROM receipts WHERE invoice_id = ?', [invoiceId]);
      const alreadyPaid = Number(sumRow[0] && sumRow[0].total) || 0;
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
      const [insRec] = await pool.execute('INSERT INTO receipts (invoice_id, amount, payment_method, payment_date, reference) VALUES (?, ?, ?, ?, ?)', [invoiceId, amount, paymentMethod, paymentDate, reference]);
      const receiptId = insRec && insRec.insertId;
      const [invRow] = await pool.execute('SELECT company_id FROM invoices WHERE id = ?', [invoiceId]).catch(() => [[]]);
      const companyId = invRow[0] && invRow[0].company_id;
      if (receiptId) await onReceiptInvoice(companyId, receiptId, amount, paymentDate, reference, vehicleId);
    }
    const createdId = hasDevis
      ? (await pool.execute('SELECT id FROM receipts WHERE workshop_quote_id = ? ORDER BY id DESC LIMIT 1', [devisId]))[0][0].id
      : (await pool.execute('SELECT id FROM receipts WHERE invoice_id = ? ORDER BY id DESC LIMIT 1', [invoiceId]))[0][0].id;
    const [insert] = await pool.execute('SELECT * FROM receipts WHERE id = ?', [createdId]);
    return res.status(201).json(insert[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const amount = body.amount != null ? Number(body.amount) : undefined;
    const paymentMethod = body.paymentMethod ?? body.payment_method;
    const paymentDateRaw = body.paymentDate ?? body.payment_date;
    const paymentDate = paymentDateRaw != null && paymentDateRaw !== '' ? toDateOnly(paymentDateRaw) : undefined;
    const reference = body.reference !== undefined ? String(body.reference).trim() : undefined;
    const pool = getPool();
    const [rows] = await pool.execute('SELECT id FROM receipts WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Reçu introuvable', statusCode: 404 });
    const updates = [];
    const values = [];
    if (amount != null && !isNaN(amount)) { updates.push('amount = ?'); values.push(amount); }
    if (paymentMethod !== undefined) { updates.push('payment_method = ?'); values.push(paymentMethod); }
    if (paymentDate !== undefined) { updates.push('payment_date = ?'); values.push(paymentDate); }
    if (reference !== undefined) { updates.push('reference = ?'); values.push(reference || null); }
    if (updates.length === 0) {
      const [r] = await pool.execute('SELECT * FROM receipts WHERE id = ?', [id]);
      return res.status(200).json(r[0]);
    }
    values.push(id);
    await pool.execute('UPDATE receipts SET ' + updates.join(', ') + ' WHERE id = ?', values);
    const [updated] = await pool.execute('SELECT * FROM receipts WHERE id = ?', [id]);
    return res.status(200).json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const reason = (req.body && req.body.reason) != null ? String(req.body.reason).trim() : null;
    const pool = getPool();
    const [rows] = await pool.execute('SELECT id FROM receipts WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Reçu introuvable', statusCode: 404 });
    try {
      const [cols] = await pool.execute("SHOW COLUMNS FROM receipts LIKE 'deletion_reason'");
      if (cols.length && reason) {
        await pool.execute('UPDATE receipts SET deletion_reason = ?, deleted_at = NOW() WHERE id = ?', [reason, id]);
      }
    } catch (_) {}
    await pool.execute('DELETE FROM receipts WHERE id = ?', [id]);
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
