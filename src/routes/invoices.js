const express = require('express');
const { getPool } = require('../config/database');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute('SELECT i.*, c.name AS client_name, v.vin, v.price_sale FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN vehicles v ON v.id = i.vehicle_id ORDER BY i.id DESC');
    const out = [];
    for (const r of rows) {
      let paid = 0;
      try {
        const [rec] = await pool.execute('SELECT COALESCE(SUM(amount), 0) AS paid FROM receipts WHERE invoice_id = ?', [r.id]);
        paid = Number(rec[0]?.paid ?? 0);
      } catch (_) {}
      const total = Number(r.total_amount) || 0;
      const priceSale = Number(r.price_sale) || 0;
      const remaining = Math.max(0, priceSale - paid);
      out.push({
        ...r,
        amount: total,
        total_amount: total,
        paid_amount: paid,
        remaining_amount: remaining,
        price_sale: priceSale,
        priceSale: priceSale,
        prix_vente: priceSale,
      });
    }
    return res.status(200).json({ invoices: out, pagination: {} });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const pool = getPool();
    const [rows] = await pool.execute('SELECT i.*, c.name AS client_name, v.vin, v.price_sale FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN vehicles v ON v.id = i.vehicle_id WHERE i.id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Facture introuvable', statusCode: 404 });
    const r = rows[0];
    const [sumRow] = await pool.execute('SELECT COALESCE(SUM(amount), 0) AS paid FROM receipts WHERE invoice_id = ?', [id]);
    const paid = Number(sumRow[0]?.paid ?? 0);
    const priceSale = Number(r.price_sale) || 0;
    const remaining = Math.max(0, priceSale - paid);
    const [recRows] = await pool.execute('SELECT id, amount, payment_method, payment_date, reference FROM receipts WHERE invoice_id = ? ORDER BY payment_date ASC, id ASC', [id]);
    const priceSaleUsed = priceSale;
    let cumulative = 0;
    const receipts = (recRows || []).map(function (rec) {
      cumulative += Number(rec.amount) || 0;
      const soldeApres = Math.max(0, priceSaleUsed - cumulative);
      return {
        id: rec.id,
        amount: Number(rec.amount),
        payment_method: rec.payment_method,
        payment_date: rec.payment_date,
        reference: rec.reference,
        remaining_amount: soldeApres,
        remainingAmount: soldeApres,
        solde_restant_apres: soldeApres,
      };
    });
    const invoice = {
      ...r,
      amount: Number(r.total_amount) || 0,
      total_amount: Number(r.total_amount) || 0,
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

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const vehicleId = body.vehicleId ?? body.vehicle_id;
    const clientId = body.clientId ?? body.client_id;
    const amount = body.amount ?? body.total_amount;
    const dueDate = body.dueDate ?? body.due_date;
    if (!vehicleId || !clientId || amount == null) return res.status(400).json({ message: 'vehicleId, clientId et amount (ou total_amount) requis', statusCode: 400 });
    const pool = getPool();
    const [vRow] = await pool.execute('SELECT price_sale FROM vehicles WHERE id = ?', [vehicleId]);
    if (!vRow || !vRow.length) return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
    const priceSale = Number(vRow[0].price_sale);
    if (priceSale == null || isNaN(priceSale) || priceSale <= 0) {
      return res.status(400).json({
        message: 'Le véhicule doit avoir un prix de vente renseigné pour créer la facture. Montant facture = prix de vente (1 facture = 1 véhicule).',
        statusCode: 400,
      });
    }
    const amountToUse = priceSale;
    const [existingInvs] = await pool.execute('SELECT id, invoice_number FROM invoices WHERE vehicle_id = ?', [vehicleId]);
    if (existingInvs && existingInvs.length > 0) {
      const num = existingInvs[0].invoice_number || existingInvs[0].id;
      return res.status(409).json({
        message: 'Un véhicule ne peut avoir qu\'une seule facture. Ce véhicule a déjà une facture. Les paiements se font via des reçus liés à cette facture (page Reçus).',
        statusCode: 409,
        existingInvoice: num,
      });
    }
    const y = new Date().getFullYear();
    const [seq] = await pool.execute('SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number, -4) AS UNSIGNED)), 0) + 1 AS n FROM invoices WHERE YEAR(created_at) = ?', [y]);
    const n = String(seq[0]?.n ?? 1).padStart(4, '0');
    const invoice_number = 'FAV-' + y + '-' + n;
    const [ins] = await pool.execute(
      'INSERT INTO invoices (vehicle_id, client_id, total_amount, due_date, invoice_number, status) VALUES (?, ?, ?, ?, ?, ?)',
      [vehicleId, clientId, amountToUse, dueDate || null, invoice_number, 'EMISE']
    );
    const [created] = await pool.execute('SELECT i.*, c.name AS client_name, v.vin FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN vehicles v ON v.id = i.vehicle_id WHERE i.id = ?', [ins.insertId]);
    return res.status(201).json(created[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const pool = getPool();
    const [rows] = await pool.execute('SELECT i.id, i.total_amount FROM invoices i WHERE i.id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Facture introuvable', statusCode: 404 });
    const [rec] = await pool.execute('SELECT COALESCE(SUM(amount), 0) AS paid FROM receipts WHERE invoice_id = ?', [id]);
    const paid = Number(rec[0]?.paid ?? 0);
    if (paid > 0) {
      return res.status(409).json({ message: 'Un reçu a déjà été émis pour cette facture. Modification impossible.', statusCode: 409 });
    }
    const updates = [];
    const values = [];
    if (body.vehicleId != null) { updates.push('vehicle_id = ?'); values.push(body.vehicleId); }
    if (body.clientId != null) { updates.push('client_id = ?'); values.push(body.clientId); }
    if (body.amount != null || body.total_amount != null) {
      const amt = body.amount != null ? body.amount : body.total_amount;
      updates.push('total_amount = ?');
      values.push(Number(amt));
    }
    if (body.dueDate !== undefined) { updates.push('due_date = ?'); values.push(body.dueDate || null); }
    if (updates.length === 0) {
      const [inv] = await pool.execute('SELECT i.*, c.name AS client_name, v.vin FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN vehicles v ON v.id = i.vehicle_id WHERE i.id = ?', [id]);
      return res.status(200).json(inv[0]);
    }
    values.push(id);
    await pool.execute('UPDATE invoices SET ' + updates.join(', ') + ' WHERE id = ?', values);
    const [updated] = await pool.execute('SELECT i.*, c.name AS client_name, v.vin FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN vehicles v ON v.id = i.vehicle_id WHERE i.id = ?', [id]);
    const r = updated[0];
    const paidAmount = paid;
    return res.status(200).json({ ...r, paid_amount: paidAmount, remaining_amount: Math.max(0, Number(r.total_amount) - paidAmount) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const reason = (req.body && req.body.reason) != null ? String(req.body.reason).trim() : null;
    const pool = getPool();
    const [rows] = await pool.execute('SELECT id FROM invoices WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Facture introuvable', statusCode: 404 });
    const [rec] = await pool.execute('SELECT COALESCE(SUM(amount), 0) AS paid FROM receipts WHERE invoice_id = ?', [id]);
    const paid = Number(rec[0]?.paid ?? 0);
    if (paid > 0) {
      return res.status(409).json({ message: 'Un reçu a déjà été émis pour cette facture. Suppression impossible.', statusCode: 409 });
    }
    await pool.execute('DELETE FROM receipts WHERE invoice_id = ?', [id]);
    await pool.execute('DELETE FROM invoices WHERE id = ?', [id]);
    return res.status(204).send();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
