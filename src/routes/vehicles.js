const express = require('express');
const { prisma } = require('../lib/prisma');
const { authorize } = require('../middleware/rbac');
const { upsertTransportForVehicle } = require('../services/treasuryTransactions');
const { NON_ARCHIVES, ARCHIVES } = require('../lib/archive');

const router = express.Router();

// Helpers ------------------------------------------------------------------

function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseIntParam(val, fallback, min = 1, max = 100) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Retrouve la première date d'arrivée (status ARRIVE) pour un véhicule. */
function firstArrivalDate(purchaseVehicles) {
  const arrived = purchaseVehicles.find(
    (pv) => pv.purchase && pv.purchase.status === 'ARRIVE'
  );
  if (!arrived) return null;
  return arrived.purchase.arrivalDate || arrived.purchase.updatedAt || null;
}

/**
 * Enrichit une ligne véhicule avec tous les alias attendus par le front
 * (snake_case + camelCase + variantes historiques).
 */
function enrichVehicle(v, extras = {}) {
  const purchasePriceFcfaRaw =
    v.purchasePriceFcfa != null && v.purchasePriceFcfa !== ''
      ? Number(v.purchasePriceFcfa)
      : Number(v.purchasePrice) || 0;
  const priceSaleNum = v.priceSale != null ? Number(v.priceSale) : null;

  const {
    arrivalDate = null,
    clientName = null,
    totalAmount = null,
    paidAmount = null,
    remainingAmount = null,
    purchaseDate = null,
    supplierName = null,
  } = extras;

  return {
    id: v.id,
    company_id: v.companyId,
    vin: v.vin,
    brand: v.brand,
    model: v.model,
    year: v.year,
    color: v.color,
    status: v.status,
    purchase_price: v.purchasePrice != null ? Number(v.purchasePrice) : null,
    purchase_price_fcfa: purchasePriceFcfaRaw,
    purchasePriceFcfa: purchasePriceFcfaRaw,
    transport_fees: v.transportFees != null ? Number(v.transportFees) : 0,
    transportFees: v.transportFees != null ? Number(v.transportFees) : 0,
    price_sale: priceSaleNum,
    priceSale: priceSaleNum,
    client_id: v.clientId,
    client_name: clientName,
    created_at: v.createdAt,
    updated_at: v.updatedAt,

    // Alias montant FCFA
    montant_fcfa: purchasePriceFcfaRaw,
    montantFCFA: purchasePriceFcfaRaw,

    // Alias facturation
    total_amount: totalAmount,
    invoice_total: totalAmount,
    paid_amount: paidAmount,
    paidAmount: paidAmount,
    montant_paye: paidAmount,
    remaining_amount: remainingAmount,
    remainingAmount: remainingAmount,
    solde_restant: remainingAmount,
    remaining_balance: remainingAmount,

    // Alias dates
    arrival_date: arrivalDate,
    date_arrivee: arrivalDate,
    arrived_at: arrivalDate,
    available_since: arrivalDate,
    purchase_date: purchaseDate,
    date_achat: purchaseDate,

    // Alias fournisseur
    supplier_name: supplierName,
    fournisseurNom: supplierName,
  };
}

// GET /vehicles — liste paginée avec filtres + calcul solde
router.get('/', authorize('vehicles', 'read'), async (req, res) => {
  try {
    const { status, search } = req.query;
    // Le parc vivant par défaut. `?archives=1` montre au contraire ce qui a été
    // mis de côté — sinon un véhicule archivé deviendrait introuvable, et
    // l'archivage un moyen de perdre des choses.
    const vueArchives = String(req.query.archives || '') === '1';
    const page = parseIntParam(req.query.page, 1, 1, 10_000);
    const perPage = parseIntParam(req.query.limit, 20, 1, 100);
    const offset = (page - 1) * perPage;

    const where = {
      ...req.tenantWhere(),
      ...(vueArchives ? ARCHIVES : NON_ARCHIVES),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { vin: { contains: String(search) } },
              { brand: { contains: String(search) } },
              { model: { contains: String(search) } },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await Promise.all([
      prisma.vehicle.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: perPage,
        include: {
          client: { select: { name: true } },
          purchaseVehicles: {
            where: { purchase: { status: 'ARRIVE' } },
            include: {
              purchase: { select: { arrivalDate: true, updatedAt: true } },
            },
            take: 1,
          },
          invoice: {
            select: {
              id: true,
              totalAmount: true,
              receipts: { select: { amount: true } },
            },
          },
        },
      }),
      prisma.vehicle.count({ where }),
    ]);

    const data = rows.map((v) => {
      const invoice = v.invoice;
      const hasInvoice = !!invoice;
      const total = hasInvoice ? Number(invoice.totalAmount) : null;
      const paid = hasInvoice
        ? invoice.receipts.reduce((s, r) => s + toNumber(r.amount), 0)
        : null;
      const priceSale = Number(v.priceSale) || 0;
      const remaining = hasInvoice ? Math.max(0, priceSale - (paid ?? 0)) : null;
      return enrichVehicle(v, {
        arrivalDate: firstArrivalDate(v.purchaseVehicles),
        clientName: v.client?.name ?? null,
        totalAmount: total,
        paidAmount: paid,
        remainingAmount: remaining,
      });
    });

    return res.status(200).json({
      data,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalItems / perPage) || 1,
        totalItems,
        itemsPerPage: perPage,
      },
    });
  } catch (err) {
    console.error('[vehicles.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /vehicles/:id
router.get('/:id', authorize('vehicles', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const v = await prisma.vehicle.findFirst({
      where: { id, ...req.tenantWhere() },
      include: {
        client: { select: { name: true } },
        purchaseVehicles: {
          include: {
            purchase: {
              select: {
                arrivalDate: true,
                updatedAt: true,
                status: true,
                purchaseDate: true,
                supplierName: true,
              },
            },
          },
        },
        invoice: {
          select: {
            id: true,
            totalAmount: true,
            receipts: { select: { amount: true } },
          },
        },
      },
    });

    if (!v) {
      return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
    }

    const invoice = v.invoice;
    const hasInvoice = !!invoice;
    const totalAmount = hasInvoice ? Number(invoice.totalAmount) : null;
    const paidAmount = hasInvoice
      ? invoice.receipts.reduce((s, r) => s + toNumber(r.amount), 0)
      : null;
    const priceSale = Number(v.priceSale) || 0;
    const remainingAmount = hasInvoice
      ? Math.max(0, priceSale - (paidAmount ?? 0))
      : null;

    const firstPurchase = v.purchaseVehicles[0]?.purchase ?? null;

    return res.status(200).json(
      enrichVehicle(v, {
        arrivalDate: firstArrivalDate(v.purchaseVehicles),
        clientName: v.client?.name ?? null,
        totalAmount,
        paidAmount,
        remainingAmount,
        purchaseDate: firstPurchase?.purchaseDate ?? null,
        supplierName: firstPurchase?.supplierName ?? null,
      })
    );
  } catch (err) {
    console.error('[vehicles.detail]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// PATCH /vehicles/:id — gère transitions de statut + transport_fees → trésorerie
router.patch('/:id', authorize('vehicles', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const body = req.body || {};
    const nextStatus = body.status;
    const priceSale = body.price_sale ?? body.priceSale;
    const clientId = body.client_id ?? body.clientId;
    const transportFees = body.transport_fees ?? body.transportFees;

    const before = await prisma.vehicle.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!before) {
      return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
    }

    // Règle : EN_MAINTENANCE → DISPONIBLE exige un devis atelier clôturé (TERMINE ou CLOTURE)
    if (nextStatus === 'DISPONIBLE' && before.status === 'EN_MAINTENANCE') {
      const closedQuote = await prisma.workshopQuote.findFirst({
        where: {
          vehicleId: id,
          status: { in: ['TERMINE', 'CLOTURE'] },
        },
        select: { id: true },
      });
      if (!closedQuote) {
        return res.status(409).json({
          message:
            'Impossible de repasser en DISPONIBLE sans reçu lié au devis (devis non clôturé).',
          statusCode: 409,
        });
      }
    }

    // Règle : EN_VENTE → VENDU exige solde = 0 (prix de vente − paiements)
    if (nextStatus === 'VENDU' && before.status === 'EN_VENTE') {
      const priceSaleCurrent = Number(before.priceSale) || 0;
      const invoice = await prisma.invoice.findUnique({
        where: { vehicleId: id },
        select: {
          id: true,
          receipts: { select: { amount: true } },
        },
      });
      if (invoice) {
        const paid = invoice.receipts.reduce((s, r) => s + toNumber(r.amount), 0);
        if (paid < priceSaleCurrent) {
          return res.status(409).json({
            message:
              'Clôture impossible : solde non nul (prix de vente − montant payé > 0). Veuillez solder.',
            statusCode: 409,
          });
        }
      }
    }

    // Construire le payload Prisma uniquement avec les champs fournis
    const data = {};
    if (nextStatus !== undefined) data.status = nextStatus;
    if (priceSale !== undefined) data.priceSale = priceSale;
    if (clientId !== undefined)
      data.clientId = clientId === null || clientId === '' ? null : Number(clientId);
    if (transportFees !== undefined) data.transportFees = toNumber(transportFees);

    const updated = Object.keys(data).length
      ? await prisma.vehicle.update({ where: { id }, data })
      : before;

    // Transport fees → trésorerie (upsert DECAISSEMENT)
    if (transportFees !== undefined) {
      const amt = toNumber(transportFees);
      const txnDate = (updated.updatedAt
        ? updated.updatedAt.toISOString()
        : new Date().toISOString()
      ).slice(0, 10);
      await upsertTransportForVehicle(
        updated.companyId ?? before.companyId,
        id,
        amt,
        txnDate
      );
    }

    if (Object.keys(data).length) {
      req.audit({
        action: 'UPDATE',
        resource: 'vehicles',
        resourceId: id,
        before,
        after: updated,
      });
    }

    return res.status(200).json(enrichVehicle(updated));
  } catch (err) {
    console.error('[vehicles.update]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /vehicles/:id/timeline
router.get('/:id/timeline', authorize('vehicles', 'read'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: { id, ...req.tenantWhere() },
      select: { id: true },
    });
    if (!vehicle) {
      return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
    }

    const [purchases, invoices] = await Promise.all([
      prisma.purchase.findMany({
        where: { purchaseVehicles: { some: { vehicleId: id } } },
        select: { purchaseDate: true },
      }),
      prisma.invoice.findMany({
        where: { vehicleId: id },
        select: { createdAt: true, invoiceNumber: true },
      }),
    ]);

    const timeline = [
      ...purchases.map((p) => ({
        type: 'PURCHASE',
        date: p.purchaseDate,
        description: 'Achat enregistré',
      })),
      ...invoices.map((i) => ({
        type: 'INVOICE',
        date: i.createdAt,
        description: 'Facture ' + i.invoiceNumber,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.status(200).json({ timeline });
  } catch (err) {
    console.error('[vehicles.timeline]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * DELETE /vehicles/:id — retirer un véhicule entré par erreur.
 *
 * REFUSE PAR CONSTRUCTION dès que le véhicule a laissé une trace comptable.
 *
 * `ledger_entries.vehicle_id` n'a volontairement aucune contrainte vers
 * `vehicles` : le grand livre ne doit dépendre de rien pour rester intact. La
 * conséquence est qu'une suppression naïve ne serait PAS bloquée par la base —
 * elle laisserait les écritures de coût en place, toujours comptées dans le coût
 * des ventes et la valeur du stock, mais rattachées à un véhicule introuvable.
 * Et le grand livre étant en écriture seule, ces écritures ne pourraient plus
 * jamais être retirées.
 *
 * D'où un contrôle explicite AVANT toute suppression. Un véhicule qui porte des
 * écritures, une facture ou un devis ne se supprime pas : il se sort du parc en
 * contre-passant ses écritures, ce qui laisse une trace au lieu d'un trou.
 *
 * Le rattachement au conteneur (`purchase_vehicles`) est en CASCADE : il
 * disparaît avec le véhicule, ce qui est correct — c'est un lien, pas une trace.
 */
router.delete('/:id', authorize('vehicles', 'delete'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: { id, ...req.tenantWhere() },
    });
    if (!vehicle) {
      return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
    }

    // Chaque compte est fait séparément pour pouvoir NOMMER ce qui bloque :
    // « impossible de supprimer » sans dire pourquoi envoie l'utilisateur
    // chercher dans le code.
    const [ecritures, factures, devis, recus] = await Promise.all([
      prisma.ledgerEntry.count({ where: { vehicleId: id } }),
      prisma.invoice.count({ where: { vehicleId: id } }),
      prisma.workshopQuote.count({ where: { vehicleId: id } }),
      prisma.receipt.count({ where: { invoice: { vehicleId: id } } }).catch(() => 0),
    ]);

    const traces = [
      ecritures && `${ecritures} écriture(s) au grand livre`,
      factures && `${factures} facture(s)`,
      devis && `${devis} devis`,
      recus && `${recus} reçu(s)`,
    ].filter(Boolean);

    if (traces.length) {
      return res.status(409).json({
        message:
          `Ce véhicule ne peut pas être supprimé : il porte ${traces.join(', ')}. ` +
          'Le grand livre ne s’efface pas — supprimer le véhicule laisserait ses ' +
          'coûts comptés dans les totaux, rattachés à un véhicule introuvable. ' +
          'Contre-passez d’abord ses écritures, puis marquez-le hors parc.',
        statusCode: 409,
        traces: { ecritures, factures, devis, recus },
      });
    }

    await prisma.vehicle.delete({ where: { id } });

    req.audit({
      action: 'DELETE',
      resource: 'vehicles',
      resourceId: id,
      before: vehicle,
      after: null,
    });

    return res.status(204).end();
  } catch (err) {
    console.error('[vehicles.delete]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * POST /vehicles/:id/archiver { motif }
 *
 * Sort le véhicule des listes, du tableau de bord, des alertes et du rapport de
 * stock. NE TOUCHE PAS AU GRAND LIVRE : ses écritures continuent de compter.
 *
 * Le motif est OBLIGATOIRE. Un archivage sans raison, c'est un véhicule qui
 * disparaît sans que personne ne sache pourquoi six mois plus tard — et comme
 * l'opération est réversible, la seule chose qui compte est de pouvoir la
 * relire.
 */
router.post('/:id/archiver', authorize('vehicles', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const motif = String(req.body?.motif ?? req.body?.reason ?? '').trim();
    if (motif.length < 3) {
      return res.status(400).json({
        message: 'Un motif d’archivage est requis — au moins trois caractères.',
        statusCode: 400,
      });
    }

    const before = await prisma.vehicle.findFirst({ where: { id, ...req.tenantWhere() } });
    if (!before) {
      return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
    }
    if (before.archivedAt) {
      return res.status(409).json({ message: 'Ce véhicule est déjà archivé', statusCode: 409 });
    }

    const updated = await prisma.vehicle.update({
      where: { id },
      data: { archivedAt: new Date(), archiveReason: motif.slice(0, 500) },
    });

    req.audit({ action: 'UPDATE', resource: 'vehicles', resourceId: id, before, after: updated });

    // Le nombre d'écritures est renvoyé pour que l'appelant puisse le dire :
    // archiver ne fait pas disparaître cet argent des totaux.
    const ecritures = await prisma.ledgerEntry.count({ where: { vehicleId: id } });
    return res.status(200).json({ ...enrichVehicle(updated), ecritures });
  } catch (err) {
    console.error('[vehicles.archiver]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/** POST /vehicles/:id/desarchiver — remet le véhicule dans le parc visible. */
router.post('/:id/desarchiver', authorize('vehicles', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const before = await prisma.vehicle.findFirst({ where: { id, ...req.tenantWhere() } });
    if (!before) {
      return res.status(404).json({ message: 'Véhicule introuvable', statusCode: 404 });
    }
    if (!before.archivedAt) {
      return res.status(409).json({ message: 'Ce véhicule n’est pas archivé', statusCode: 409 });
    }

    const updated = await prisma.vehicle.update({
      where: { id },
      // Le motif est conservé : il raconte pourquoi on l'avait mis de côté.
      data: { archivedAt: null },
    });

    req.audit({ action: 'UPDATE', resource: 'vehicles', resourceId: id, before, after: updated });
    return res.status(200).json(enrichVehicle(updated));
  } catch (err) {
    console.error('[vehicles.desarchiver]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
