const express = require('express');
const { getPool } = require('../config/database');
const { onPurchaseArrival } = require('../services/treasuryTransactions');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const companyId = req.query.companyId || req.user?.companyId;
    const pool = getPool();
    const sql = "SELECT p.*, (SELECT COUNT(*) FROM purchase_vehicles pv WHERE pv.purchase_id = p.id) AS vehicle_count, (SELECT COALESCE(SUM(COALESCE(v.purchase_price_fcfa, v.purchase_price, 0)), 0) FROM purchase_vehicles pv INNER JOIN vehicles v ON v.id = pv.vehicle_id WHERE pv.purchase_id = p.id) AS total_amount_fcfa FROM purchases p" + (companyId ? " WHERE p.company_id = ?" : "") + " ORDER BY p.purchase_date DESC, p.id DESC";
    const params = companyId ? [companyId] : [];
    const [rows] = await pool.execute(sql, params);
    const purchases = rows.map(function (p) {
      const name = p.supplier_name || '';
      const { vehicle_count, total_amount_fcfa, ...rest } = p;
      const status = rest.status ?? '';
      const arrivalDate = rest.arrival_date ?? (status === 'ARRIVE' ? rest.updated_at : null);
      const totalFcfa = Number(total_amount_fcfa ?? 0);
      return {
        ...rest,
        supplier_name: name,
        fournisseurNom: name,
        vehicle_count: Number(vehicle_count) || 0,
        statut: status,
        arrival_date: arrivalDate,
        date_arrivee: arrivalDate,
        arrived_at: arrivalDate,
        status_updated_at: arrivalDate,
        amount_fcfa: totalFcfa,
        montant_fcfa: totalFcfa,
        montantFCFA: totalFcfa,
        total_fcfa: totalFcfa,
        total_amount: totalFcfa,
      };
    });
    return res.status(200).json({ purchases });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const [purchases] = await pool.execute('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!purchases.length) return res.status(404).json({ message: 'Achat introuvable', statusCode: 404 });
    const [vehiclesRows] = await pool.execute('SELECT v.* FROM vehicles v INNER JOIN purchase_vehicles pv ON pv.vehicle_id = v.id WHERE pv.purchase_id = ? ORDER BY v.id', [id]);
    const vehicles = (vehiclesRows || []).map(function (v) {
      const fcfa = v.purchase_price_fcfa != null ? Number(v.purchase_price_fcfa) : null;
      return { ...v, purchasePriceFcfa: fcfa, montant_fcfa: fcfa, montantFCFA: fcfa };
    });
    const totalFcfa = vehicles.reduce(function (sum, v) {
      const val = v.purchase_price_fcfa != null ? Number(v.purchase_price_fcfa) : (Number(v.purchase_price) || 0);
      return sum + val;
    }, 0);
    const p = purchases[0];
    const name = p.supplier_name || '';
    const arrivalDate = p.arrival_date ?? (p.status === 'ARRIVE' ? p.updated_at : null);
    const purchase = {
      ...p,
      supplier_name: name,
      fournisseurNom: name,
      vehicle_count: vehicles.length,
      statut: p.status ?? '',
      arrival_date: arrivalDate,
      date_arrivee: arrivalDate,
      arrived_at: arrivalDate,
      status_updated_at: arrivalDate,
      amount_fcfa: totalFcfa,
      montant_fcfa: totalFcfa,
      montantFCFA: totalFcfa,
      total_fcfa: totalFcfa,
      total_amount: totalFcfa,
    };
    return res.status(200).json({ purchase, vehicles });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

function mapVehicleFromBody(v) {
  const purchasePrice = Number(v.purchase_price ?? v.prix_achat ?? v.prixAchat ?? 0);
  const purchasePriceFcfaRaw = v.purchase_price_fcfa ?? v.purchasePriceFcfa ?? v.montant_fcfa ?? v.montantFCFA;
  const purchase_price_fcfa = purchasePriceFcfaRaw != null && purchasePriceFcfaRaw !== '' ? Number(purchasePriceFcfaRaw) : null;
  return {
    vin: v.vin ?? v.VIN ?? '',
    brand: v.brand ?? v.marque ?? '',
    model: v.model ?? v.modele ?? '',
    year: v.year ?? v.annee ?? null,
    color: v.color ?? v.couleur ?? '',
    purchase_price: purchasePrice,
    purchase_price_fcfa: purchase_price_fcfa,
    price_sale: Number(v.price_sale ?? v.prix_vente ?? v.prixVente ?? 0),
  };
}

router.post('/', async (req, res) => {
  try {
    const companyId = req.body.companyId || req.user?.companyId;
    if (companyId == null || companyId === '') {
      return res.status(400).json({ message: 'companyId requis (body ou JWT). Utilisateur sans societe : creer une company ou passer companyId dans le body.', statusCode: 400 });
    }
    const body = req.body || {};
    const supplier_name = (body.fournisseurNom || body.supplier_name || '').trim();
    if (!supplier_name) {
      return res.status(400).json({ message: 'Le fournisseur est obligatoire (fournisseurNom ou supplier_name).', statusCode: 400 });
    }
    const purchase_date = body.purchase_date ?? body.dateAchat ?? body.date_achat ?? new Date();
    const container_reference = body.container_reference ?? body.conteneur ?? body.reference_conteneur ?? null;
    const vessel = body.vessel ?? body.navire ?? null;
    const purchase_type = body.purchase_type ?? body.type_achat ?? body.typeAchat ?? 'VRAC';
    const currency = body.currency ?? body.devise ?? 'FCFA';
    const vehicles = Array.isArray(body.vehicles) ? body.vehicles : (Array.isArray(body.vehicules) ? body.vehicules : []);
    const pool = getPool();
    const [insert] = await pool.execute(
      "INSERT INTO purchases (company_id, supplier_name, purchase_date, container_reference, vessel, purchase_type, currency, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'EN_COURS')",
      [companyId, supplier_name, purchase_date, container_reference, vessel, purchase_type, currency]
    );
    const purchaseId = insert.insertId;
    let totalSaleValue = 0;
    for (const v of vehicles) {
      const m = mapVehicleFromBody(v);
      const [vIns] = await pool.execute(
        "INSERT INTO vehicles (company_id, vin, brand, model, year, color, status, purchase_price, purchase_price_fcfa, price_sale) VALUES (?, ?, ?, ?, ?, ?, 'EN_TRANSIT', ?, ?, ?)",
        [companyId, m.vin, m.brand, m.model, m.year, m.color, m.purchase_price, m.purchase_price_fcfa, m.price_sale]
      );
      await pool.execute('INSERT INTO purchase_vehicles (purchase_id, vehicle_id) VALUES (?, ?)', [purchaseId, vIns.insertId]);
      totalSaleValue += m.price_sale;
    }
    const [created] = await pool.execute('SELECT * FROM purchases WHERE id = ?', [purchaseId]);
    const [createdVehiclesRows] = await pool.execute('SELECT v.* FROM vehicles v INNER JOIN purchase_vehicles pv ON pv.vehicle_id = v.id WHERE pv.purchase_id = ? ORDER BY v.id', [purchaseId]);
    const createdVehicles = (createdVehiclesRows || []).map(function (v) {
      const fcfa = v.purchase_price_fcfa != null ? Number(v.purchase_price_fcfa) : null;
      return { ...v, purchasePriceFcfa: fcfa, montant_fcfa: fcfa, montantFCFA: fcfa };
    });
    const out = { ...created[0], supplier_name, fournisseurNom: supplier_name, vehicle_count: vehicles.length, total_sale_value: totalSaleValue };
    return res.status(201).json({ message: 'Achat créé', purchase: out, vehicles: createdVehicles });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const [rows] = await pool.execute('SELECT status FROM purchases WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Achat introuvable', statusCode: 404 });
    if (rows[0].status !== 'EN_COURS') {
      return res.status(409).json({ message: 'Modification autorisée uniquement si statut EN_COURS', statusCode: 409 });
    }
    const updates = [];
    const values = [];
    const body = req.body || {};
    const supplierVal = body.fournisseurNom !== undefined ? body.fournisseurNom : body.supplier_name;
    if (supplierVal !== undefined) {
      updates.push('supplier_name = ?');
      values.push(String(supplierVal).trim());
    }
    const dateVal = body.purchase_date ?? body.dateAchat ?? body.date_achat;
    if (dateVal !== undefined) { updates.push('purchase_date = ?'); values.push(dateVal); }
    const containerVal = body.container_reference ?? body.conteneur ?? body.reference_conteneur;
    if (containerVal !== undefined) { updates.push('container_reference = ?'); values.push(containerVal); }
    const vesselVal = body.vessel ?? body.navire;
    if (vesselVal !== undefined) { updates.push('vessel = ?'); values.push(vesselVal); }
    const typeVal = body.purchase_type ?? body.type_achat ?? body.typeAchat;
    if (typeVal !== undefined) { updates.push('purchase_type = ?'); values.push(typeVal); }
    const currencyVal = body.currency ?? body.devise;
    if (currencyVal !== undefined) { updates.push('currency = ?'); values.push(currencyVal); }
    if (updates.length) {
      values.push(id);
      await pool.execute('UPDATE purchases SET ' + updates.join(', ') + ' WHERE id = ?', values);
    }
    const vehiclesPayload = Array.isArray(body.vehicles) ? body.vehicles : (Array.isArray(body.vehicules) ? body.vehicules : []);
    if (vehiclesPayload.length) {
      const [pvRows] = await pool.execute('SELECT vehicle_id FROM purchase_vehicles WHERE purchase_id = ? ORDER BY vehicle_id', [id]);
      const vehicleIds = (pvRows || []).map(function (row) { return row.vehicle_id; });
      for (let i = 0; i < vehiclesPayload.length; i++) {
        const v = vehiclesPayload[i];
        const vid = v.id ?? v.vehicle_id ?? vehicleIds[i];
        if (vid == null || !vehicleIds.includes(vid)) continue;
        const fcfaRaw = v.purchase_price_fcfa ?? v.purchasePriceFcfa ?? v.montant_fcfa ?? v.montantFCFA;
        const purchase_price_fcfa = (fcfaRaw != null && fcfaRaw !== '') ? Number(fcfaRaw) : null;
        await pool.execute('UPDATE vehicles SET purchase_price_fcfa = ? WHERE id = ?', [purchase_price_fcfa, vid]);
      }
    }
    const [updated] = await pool.execute('SELECT * FROM purchases WHERE id = ?', [id]);
    return res.status(200).json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.patch('/:id/arrive', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const [rows] = await pool.execute('SELECT id, status, company_id FROM purchases WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Achat introuvable', statusCode: 404 });
    const wasAlreadyArrive = rows[0].status === 'ARRIVE';
    try {
      await pool.execute("UPDATE purchases SET status = ?, arrival_date = COALESCE(?, CURDATE()) WHERE id = ?", ['ARRIVE', (req.body || {}).arrival_date || (req.body || {}).date_arrivee || null, id]);
    } catch (e) {
      await pool.execute("UPDATE purchases SET status = ? WHERE id = ?", ['ARRIVE', id]);
    }
    const [purch] = await pool.execute('SELECT arrival_date FROM purchases WHERE id = ?', [id]);
    const arrivalDate = (purch[0] && purch[0].arrival_date) ? String(purch[0].arrival_date).slice(0, 10) : null;
    const [vehicles] = await pool.execute('SELECT vehicle_id FROM purchase_vehicles WHERE purchase_id = ?', [id]);
    for (const v of vehicles) {
      await pool.execute('UPDATE vehicles SET status = ? WHERE id = ?', ['DISPONIBLE', v.vehicle_id]);
    }
    if (!wasAlreadyArrive) {
      const companyId = rows[0].company_id;
      const [vehiclesWithAmount] = await pool.execute(
        'SELECT pv.vehicle_id, COALESCE(v.purchase_price_fcfa, v.purchase_price, 0) AS amount FROM purchase_vehicles pv INNER JOIN vehicles v ON v.id = pv.vehicle_id WHERE pv.purchase_id = ?',
        [id]
      );
      const txnDate = arrivalDate || new Date().toISOString().slice(0, 10);
      for (const row of vehiclesWithAmount || []) {
        const amt = Number(row.amount) || 0;
        if (amt > 0) await onPurchaseArrival(companyId, Number(id), row.vehicle_id, amt, txnDate);
      }
    }
    const [updated] = await pool.execute('SELECT * FROM purchases WHERE id = ?', [id]);
    return res.status(200).json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const [rows] = await pool.execute('SELECT status FROM purchases WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Achat introuvable', statusCode: 404 });
    if (rows[0].status !== 'EN_COURS') {
      return res.status(409).json({ message: 'Suppression autorisée uniquement si statut EN_COURS', statusCode: 409 });
    }
    await pool.execute('DELETE FROM purchase_vehicles WHERE purchase_id = ?', [id]);
    await pool.execute('DELETE FROM purchases WHERE id = ?', [id]);
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
