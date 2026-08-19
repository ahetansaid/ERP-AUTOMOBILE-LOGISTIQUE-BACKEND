const express = require('express');
const { prisma } = require('../lib/prisma');
const { toSnake } = require('../lib/serialize');
const { onPurchaseArrival } = require('../services/treasuryTransactions');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

function vehicleFcfa(v) {
  if (v.purchasePriceFcfa != null) return Number(v.purchasePriceFcfa);
  return Number(v.purchasePrice) || 0;
}

router.get('/', authorize('purchases', 'read'), async (req, res) => {
  try {
    const rows = await prisma.purchase.findMany({
      where: { ...req.tenantWhere() },
      orderBy: [{ purchaseDate: 'desc' }, { id: 'desc' }],
      include: {
        purchaseVehicles: {
          include: { vehicle: { select: { purchasePrice: true, purchasePriceFcfa: true } } },
        },
      },
    });
    const purchases = rows.map((p) => {
      const { purchaseVehicles, ...prest } = p;
      const rest = toSnake(prest);
      const vehicle_count = purchaseVehicles.length;
      const totalFcfa = purchaseVehicles.reduce((s, pv) => s + vehicleFcfa(pv.vehicle), 0);
      const name = rest.supplier_name || '';
      const status = rest.status ?? '';
      const arrivalDate = rest.arrival_date ?? (status === 'ARRIVE' ? rest.updated_at : null);
      return {
        ...rest,
        supplier_name: name,
        fournisseurNom: name,
        vehicle_count,
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

router.get('/:id', authorize('purchases', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const p = await prisma.purchase.findFirst({ where: { id, ...req.tenantWhere() } });
    if (!p) return res.status(404).json({ message: 'Achat introuvable', statusCode: 404 });

    const pvs = await prisma.purchaseVehicle.findMany({
      where: { purchaseId: id },
      include: { vehicle: true },
    });
    const vehiclesRaw = pvs.map((pv) => pv.vehicle).sort((a, b) => a.id - b.id);
    const vehicles = vehiclesRaw.map((v) => {
      const fcfa = v.purchasePriceFcfa != null ? Number(v.purchasePriceFcfa) : null;
      return { ...toSnake(v), purchasePriceFcfa: fcfa, montant_fcfa: fcfa, montantFCFA: fcfa };
    });
    const totalFcfa = vehiclesRaw.reduce((sum, v) => sum + vehicleFcfa(v), 0);

    const rest = toSnake(p);
    const name = rest.supplier_name || '';
    const arrivalDate = rest.arrival_date ?? (rest.status === 'ARRIVE' ? rest.updated_at : null);
    const purchase = {
      ...rest,
      supplier_name: name,
      fournisseurNom: name,
      vehicle_count: vehicles.length,
      statut: rest.status ?? '',
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

router.post('/', authorize('purchases', 'create'), async (req, res) => {
  try {
    // companyId forcé au tenant courant (jamais piloté par le body).
    const companyId = req.companyId;
    if (companyId == null || companyId === '') {
      return res.status(400).json({ message: 'Utilisateur non associé à une société.', statusCode: 400 });
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

    const purchase = await prisma.purchase.create({
      data: {
        companyId: Number(companyId),
        supplierName: supplier_name,
        purchaseDate: new Date(purchase_date),
        containerReference: container_reference,
        vessel,
        purchaseType: purchase_type,
        currency,
        status: 'EN_COURS',
      },
    });
    const purchaseId = purchase.id;

    let totalSaleValue = 0;
    for (const v of vehicles) {
      const m = mapVehicleFromBody(v);
      const createdVehicle = await prisma.vehicle.create({
        data: {
          companyId: Number(companyId),
          vin: m.vin,
          brand: m.brand,
          model: m.model,
          year: m.year != null ? Number(m.year) : null,
          color: m.color,
          status: 'EN_TRANSIT',
          purchasePrice: m.purchase_price,
          purchasePriceFcfa: m.purchase_price_fcfa,
          priceSale: m.price_sale,
        },
      });
      await prisma.purchaseVehicle.create({
        data: { purchaseId, vehicleId: createdVehicle.id },
      });
      totalSaleValue += m.price_sale;
    }

    const created = await prisma.purchase.findUnique({ where: { id: purchaseId } });
    const pvs = await prisma.purchaseVehicle.findMany({
      where: { purchaseId },
      include: { vehicle: true },
    });
    const createdVehicles = pvs
      .map((pv) => pv.vehicle)
      .sort((a, b) => a.id - b.id)
      .map((v) => {
        const fcfa = v.purchasePriceFcfa != null ? Number(v.purchasePriceFcfa) : null;
        return { ...toSnake(v), purchasePriceFcfa: fcfa, montant_fcfa: fcfa, montantFCFA: fcfa };
      });
    const out = { ...toSnake(created), supplier_name, fournisseurNom: supplier_name, vehicle_count: vehicles.length, total_sale_value: totalSaleValue };
    return res.status(201).json({ message: 'Achat créé', purchase: out, vehicles: createdVehicles });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.patch('/:id', authorize('purchases', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.purchase.findFirst({ where: { id, ...req.tenantWhere() }, select: { status: true } });
    if (!current) return res.status(404).json({ message: 'Achat introuvable', statusCode: 404 });
    if (current.status !== 'EN_COURS') {
      return res.status(409).json({ message: 'Modification autorisée uniquement si statut EN_COURS', statusCode: 409 });
    }
    const body = req.body || {};
    const data = {};
    const supplierVal = body.fournisseurNom !== undefined ? body.fournisseurNom : body.supplier_name;
    if (supplierVal !== undefined) data.supplierName = String(supplierVal).trim();
    const dateVal = body.purchase_date ?? body.dateAchat ?? body.date_achat;
    if (dateVal !== undefined) data.purchaseDate = dateVal ? new Date(dateVal) : null;
    const containerVal = body.container_reference ?? body.conteneur ?? body.reference_conteneur;
    if (containerVal !== undefined) data.containerReference = containerVal;
    const vesselVal = body.vessel ?? body.navire;
    if (vesselVal !== undefined) data.vessel = vesselVal;
    const typeVal = body.purchase_type ?? body.type_achat ?? body.typeAchat;
    if (typeVal !== undefined) data.purchaseType = typeVal;
    const currencyVal = body.currency ?? body.devise;
    if (currencyVal !== undefined) data.currency = currencyVal;

    if (Object.keys(data).length) {
      await prisma.purchase.update({ where: { id }, data });
    }

    const vehiclesPayload = Array.isArray(body.vehicles) ? body.vehicles : (Array.isArray(body.vehicules) ? body.vehicules : []);
    if (vehiclesPayload.length) {
      const pvRows = await prisma.purchaseVehicle.findMany({
        where: { purchaseId: id },
        orderBy: { vehicleId: 'asc' },
        select: { vehicleId: true },
      });
      const vehicleIds = pvRows.map((r) => r.vehicleId);
      for (let i = 0; i < vehiclesPayload.length; i++) {
        const v = vehiclesPayload[i];
        const vid = v.id ?? v.vehicle_id ?? vehicleIds[i];
        if (vid == null || !vehicleIds.includes(Number(vid))) continue;
        const fcfaRaw = v.purchase_price_fcfa ?? v.purchasePriceFcfa ?? v.montant_fcfa ?? v.montantFCFA;
        const purchase_price_fcfa = (fcfaRaw != null && fcfaRaw !== '') ? Number(fcfaRaw) : null;
        await prisma.vehicle.update({ where: { id: Number(vid) }, data: { purchasePriceFcfa: purchase_price_fcfa } });
      }
    }

    const updated = await prisma.purchase.findUnique({ where: { id } });
    return res.status(200).json(toSnake(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.patch('/:id/arrive', authorize('purchases', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.purchase.findFirst({ where: { id, ...req.tenantWhere() }, select: { id: true, status: true, companyId: true } });
    if (!current) return res.status(404).json({ message: 'Achat introuvable', statusCode: 404 });
    const wasAlreadyArrive = current.status === 'ARRIVE';

    const provided = (req.body || {}).arrival_date || (req.body || {}).date_arrivee || null;
    const arrivalStr = (provided ? String(provided) : new Date().toISOString()).slice(0, 10);
    await prisma.purchase.update({
      where: { id },
      data: { status: 'ARRIVE', arrivalDate: new Date(arrivalStr) },
    });

    const pvs = await prisma.purchaseVehicle.findMany({
      where: { purchaseId: id },
      include: { vehicle: { select: { id: true, purchasePrice: true, purchasePriceFcfa: true } } },
    });
    for (const pv of pvs) {
      await prisma.vehicle.update({ where: { id: pv.vehicleId }, data: { status: 'DISPONIBLE' } });
    }

    if (!wasAlreadyArrive) {
      const companyId = current.companyId;
      for (const pv of pvs) {
        const amt = vehicleFcfa(pv.vehicle);
        if (amt > 0) await onPurchaseArrival(companyId, id, pv.vehicleId, amt, arrivalStr);
      }
    }

    const updated = await prisma.purchase.findUnique({ where: { id } });
    return res.status(200).json(toSnake(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * DELETE /purchases/:id — retirer un conteneur entré par erreur.
 *
 * L'ancienne version ne contrôlait que le STATUT : elle refusait tout ce qui
 * n'était pas EN_COURS, et acceptait tout le reste. Deux défauts symétriques.
 *
 * Trop permissive là où ça compte : un conteneur EN_COURS peut déjà porter des
 * frais de fret ventilés, donc des écritures au grand livre. Or
 * `ledger_entries.purchase_id` n'a aucune contrainte vers `purchases` — la base
 * ne l'aurait pas bloqué. Les écritures seraient restées, comptées dans les
 * totaux, rattachées à un conteneur introuvable, et le grand livre étant en
 * écriture seule, plus jamais retirables.
 *
 * Elle détachait aussi les véhicules en silence, par un deleteMany sur la table
 * de liaison. Les véhicules survivaient, mais perdaient la trace de leur
 * arrivée — c'est-à-dire la seule chose qui rattache un châssis à sa caisse.
 *
 * Trop restrictive là où ça ne compte pas : un conteneur ARRIVÉ mais vide, sans
 * frais ni écriture, est parfaitement supprimable. Le statut ne dit rien de la
 * trace comptable ; ce sont les traces qu'il faut regarder.
 */
router.delete('/:id', authorize('purchases', 'delete'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const current = await prisma.purchase.findFirst({ where: { id, ...req.tenantWhere() } });
    if (!current) {
      return res.status(404).json({ message: 'Conteneur introuvable', statusCode: 404 });
    }

    // Comptés séparément pour pouvoir NOMMER ce qui bloque.
    const [vehicules, ecritures, frais] = await Promise.all([
      prisma.purchaseVehicle.count({ where: { purchaseId: id } }),
      prisma.ledgerEntry.count({ where: { purchaseId: id } }),
      prisma.purchaseCost.count({ where: { purchaseId: id } }),
    ]);

    const traces = [
      vehicules && `${vehicules} véhicule(s) rattaché(s)`,
      ecritures && `${ecritures} écriture(s) au grand livre`,
      frais && `${frais} frais de conteneur`,
    ].filter(Boolean);

    if (traces.length) {
      return res.status(409).json({
        message:
          `Ce conteneur ne peut pas être supprimé : il porte ${traces.join(', ')}. ` +
          'Détachez d’abord ses véhicules, et contre-passez ses écritures — le ' +
          'grand livre ne s’efface pas, et supprimer le conteneur laisserait ses ' +
          'coûts comptés dans les totaux sans plus rien à quoi les rattacher.',
        statusCode: 409,
        traces: { vehicules, ecritures, frais },
      });
    }

    await prisma.purchase.delete({ where: { id } });

    req.audit({
      action: 'DELETE',
      resource: 'purchases',
      resourceId: id,
      before: current,
      after: null,
    });

    return res.status(204).send();
  } catch (err) {
    console.error('[purchases.delete]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
