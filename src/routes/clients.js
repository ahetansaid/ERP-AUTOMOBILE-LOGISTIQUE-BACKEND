const express = require('express');
const { prisma } = require('../lib/prisma');
const { authorize } = require('../middleware/rbac');
const { monterImportExport } = require('../lib/importExport');

const router = express.Router();

// Enrichit un client avec les alias français attendus par le front.
function withFrenchAliases(c) {
  return {
    ...c,
    nom: c.name,
    telephone: c.phone,
    adresse: c.address,
    ville: c.city,
    pays: c.country,
    raison_sociale: c.name,
  };
}

// Champs modifiables via PATCH/POST
const MUTABLE_FIELDS = [
  'name',
  'email',
  'phone',
  'address',
  'city',
  'country',
  'notes',
  'status',
  'contactName',
];

function pickMutable(body) {
  const data = {};
  for (const key of MUTABLE_FIELDS) {
    if (body[key] !== undefined) {
      data[key] = body[key] === '' ? null : body[key];
    }
  }
  return data;
}

// GET /clients — liste scope tenant
router.get('/', authorize('clients', 'read'), async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      where: req.tenantWhere(),
      orderBy: { name: 'asc' },
    });
    return res.status(200).json({
      clients: clients.map(withFrenchAliases),
      pagination: {},
    });
  } catch (err) {
    console.error('[clients.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /clients/:id — détail + historiques (factures, paiements, transit)
router.get('/:id', authorize('clients', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const clientRow = await prisma.client.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!clientRow) {
      return res.status(404).json({ message: 'Client introuvable', statusCode: 404 });
    }

    const [invoices, paymentRows, transitRows] = await Promise.all([
      prisma.invoice.findMany({
        where: { clientId: id },
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.receipt.findMany({
        where: { invoice: { clientId: id } },
        select: {
          id: true,
          amount: true,
          paymentDate: true,
          paymentMethod: true,
          reference: true,
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
      }),
      prisma.transitStep.findMany({
        where: { vehicle: { clientId: id } },
        select: {
          id: true,
          stepName: true,
          dateArrival: true,
          dateDeparture: true,
          vehicle: {
            select: { vin: true, brand: true, model: true },
          },
        },
        orderBy: [{ dateArrival: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const paymentHistory = paymentRows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      payment_date: r.paymentDate,
      payment_method: r.paymentMethod,
      reference: r.reference,
      source: r.invoice?.invoiceNumber || 'Facture',
      invoice_number: r.invoice?.invoiceNumber,
    }));

    const transitHistory = transitRows.map((t) => {
      const label =
        [t.vehicle?.brand, t.vehicle?.model].filter(Boolean).join(' ') ||
        'Véhicule';
      return {
        id: t.id,
        vin: t.vehicle?.vin,
        vehicle: label,
        etape: t.stepName,
        step_name: t.stepName,
        date_arrival: t.dateArrival,
        date_departure: t.dateDeparture,
        date_arrivee: t.dateArrival,
        date_depart: t.dateDeparture,
      };
    });

    const purchaseHistory = invoices.map((i) => ({
      id: i.id,
      invoice_number: i.invoiceNumber,
      total_amount: Number(i.totalAmount),
      created_at: i.createdAt,
    }));

    return res.status(200).json({
      client: withFrenchAliases(clientRow),
      purchaseHistory,
      paymentHistory,
      transitHistory,
    });
  } catch (err) {
    console.error('[clients.detail]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /clients
router.post('/', authorize('clients', 'create'), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name) {
      return res.status(400).json({ message: 'Nom requis', statusCode: 400 });
    }
    const data = {
      ...pickMutable(body),
      status: body.status || 'ACTIF',
      companyId: req.companyId,
    };
    const created = await prisma.client.create({ data });
    req.audit({
      action: 'CREATE',
      resource: 'clients',
      resourceId: created.id,
      after: created,
    });
    return res.status(201).json(withFrenchAliases(created));
  } catch (err) {
    console.error('[clients.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// PATCH /clients/:id
router.patch('/:id', authorize('clients', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const before = await prisma.client.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!before) {
      return res.status(404).json({ message: 'Client introuvable', statusCode: 404 });
    }

    const data = pickMutable(req.body || {});
    const updated = Object.keys(data).length
      ? await prisma.client.update({ where: { id }, data })
      : before;

    if (Object.keys(data).length) {
      req.audit({
        action: 'UPDATE',
        resource: 'clients',
        resourceId: id,
        before,
        after: updated,
      });
    }

    return res.status(200).json(withFrenchAliases(updated));
  } catch (err) {
    console.error('[clients.update]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// DELETE /clients/:id — refus 409 si factures ou véhicules liés
router.delete('/:id', authorize('clients', 'delete'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const before = await prisma.client.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!before) {
      return res.status(404).json({ message: 'Client introuvable', statusCode: 404 });
    }

    const [invoiceCount, vehicleCount] = await Promise.all([
      prisma.invoice.count({ where: { clientId: id } }),
      prisma.vehicle.count({ where: { clientId: id } }),
    ]);

    if (invoiceCount > 0) {
      return res.status(409).json({
        message: 'Impossible de supprimer : ce client a des factures liées.',
        statusCode: 409,
      });
    }
    if (vehicleCount > 0) {
      return res.status(409).json({
        message: 'Impossible de supprimer : ce client a des véhicules liés.',
        statusCode: 409,
      });
    }

    await prisma.client.delete({ where: { id } });
    req.audit({
      action: 'DELETE',
      resource: 'clients',
      resourceId: id,
      before,
    });
    return res.status(204).send();
  } catch (err) {
    console.error('[clients.delete]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/* ── Export et import en masse ───────────────────────────────────────────── */

const COLONNES_CLIENTS = ['nom', 'contact', 'email', 'telephone', 'ville', 'pays', 'adresse', 'statut', 'notes'];

async function preparerClients(lignes, tenantWhere) {
  const refus = [];
  const valides = [];

  const noms = [...new Set(lignes.map((l) => String(l.nom || '').trim()).filter(Boolean))];
  const existants = new Set(
    (
      await prisma.client.findMany({ where: { ...tenantWhere, name: { in: noms } }, select: { name: true } })
    ).map((c) => c.name.toLowerCase())
  );
  const vus = new Map();

  for (const l of lignes) {
    const erreurs = [];
    const nom = String(l.nom || '').trim();

    if (!nom) erreurs.push('nom absent');
    else if (existants.has(nom.toLowerCase())) erreurs.push(`« ${nom} » existe déjà`);
    else if (vus.has(nom.toLowerCase())) {
      erreurs.push(`« ${nom} » déjà présent ligne ${vus.get(nom.toLowerCase())} du fichier`);
    }

    const email = String(l.email || '').trim();
    // Contrôle volontairement minimal : refuser une adresse exotique mais
    // valide serait plus coûteux que de laisser passer une faute de frappe,
    // qui se voit à l'usage.
    if (email && !email.includes('@')) erreurs.push(`email sans arobase : « ${email} »`);

    const statut = String(l.statut || 'ACTIF').trim().toUpperCase();
    if (!['ACTIF', 'INACTIF'].includes(statut)) {
      erreurs.push(`statut inconnu : « ${l.statut} ». Valeurs : ACTIF, INACTIF`);
    }

    if (erreurs.length) {
      refus.push({ ligne: l.__ligne, nom: nom || null, erreurs });
      continue;
    }
    vus.set(nom.toLowerCase(), l.__ligne);

    valides.push({
      ligne: l.__ligne,
      apercu: { nom, ville: String(l.ville || '').trim() || null, statut },
      data: {
        name: nom.slice(0, 255),
        contactName: String(l.contact || '').trim().slice(0, 255) || null,
        email: email.slice(0, 255) || null,
        phone: String(l.telephone || '').trim().slice(0, 50) || null,
        city: String(l.ville || '').trim().slice(0, 100) || null,
        country: String(l.pays || '').trim().slice(0, 100) || null,
        address: String(l.adresse || '').trim() || null,
        notes: String(l.notes || '').trim() || null,
        status: statut,
      },
    });
  }
  return { valides, refus };
}

monterImportExport(router, {
  authorize,
  module: 'clients',
  nom: 'clients',
  colonnes: COLONNES_CLIENTS,
  obligatoires: ['nom'],
  exporter: async (req) =>
    (
      await prisma.client.findMany({ where: { ...req.tenantWhere() }, orderBy: { id: 'asc' }, take: 10000 })
    ).map((c) => ({
      nom: c.name, contact: c.contactName ?? '', email: c.email ?? '',
      telephone: c.phone ?? '', ville: c.city ?? '', pays: c.country ?? '',
      adresse: c.address ?? '', statut: c.status, notes: c.notes ?? '',
    })),
  preparer: preparerClients,
  ecrire: async (valides, req) => {
    const crees = [];
    for (const v of valides) {
      const c = await prisma.client.create({ data: v.data });
      if (req?.audit) req.audit({ action: 'CREATE', resource: 'clients', resourceId: c.id, before: null, after: c });
      crees.push({ ligne: v.ligne, id: c.id, nom: c.name });
    }
    return crees;
  },
});

module.exports = router;
