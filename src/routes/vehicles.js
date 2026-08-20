const express = require('express');
const { prisma } = require('../lib/prisma');
const { authorize } = require('../middleware/rbac');
const { upsertTransportForVehicle } = require('../services/treasuryTransactions');
const { NON_ARCHIVES, ARCHIVES } = require('../lib/archive');
const { analyser, serialiser, entetesTelechargement } = require('../lib/csv');
const importVehicules = require('../lib/importVehicules');

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
/**
 * GET /vehicles/export — le parc en CSV.
 *
 * Le fichier produit est AUSSI le modèle d'import : mêmes colonnes, même ordre.
 * On exporte, on modifie dans Excel, on réimporte. Aucun format à apprendre, et
 * aucune documentation à tenir à jour puisque c'est le code qui la porte.
 *
 * `?modele=1` renvoie les seules en-têtes, pour partir d'un fichier vide.
 */
router.get('/export', authorize('vehicles', 'read'), async (req, res) => {
  try {
    const modele = String(req.query.modele || '') === '1';
    const vueArchives = String(req.query.archives || '') === '1';

    const lignes = modele
      ? []
      : (
          await prisma.vehicle.findMany({
            where: {
              ...req.tenantWhere(),
              ...(vueArchives ? ARCHIVES : NON_ARCHIVES),
            },
            include: { purchaseVehicles: { include: { purchase: true } } },
            orderBy: { id: 'asc' },
          })
        ).map((v) => ({
          chassis: v.vin ?? '',
          marque: v.brand ?? '',
          modele: v.model ?? '',
          annee: v.year ?? '',
          couleur: v.color ?? '',
          statut: v.status,
          prix_achat_devise: v.purchasePrice != null ? Number(v.purchasePrice) : '',
          prix_achat_fcfa: v.purchasePriceFcfa != null ? Number(v.purchasePriceFcfa) : '',
          prix_vente: v.priceSale != null ? Number(v.priceSale) : '',
          kilometrage: v.mileage ?? '',
          immatriculation: v.registration ?? '',
          pays_origine: v.countryOrigin ?? '',
          poids_kg: v.weightKg ?? '',
          conteneur: v.purchaseVehicles?.[0]?.purchase?.containerReference ?? '',
        }));

    const jour = new Date().toISOString().slice(0, 10);
    entetesTelechargement(res, modele ? 'modele-vehicules.csv' : `vehicules-${jour}.csv`);
    return res.send(serialiser(lignes, importVehicules.COLONNES));
  } catch (err) {
    console.error('[vehicles.export]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

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

/**
 * POST /vehicles — créer un véhicule.
 *
 * Cette route n'existait pas : jusqu'ici un véhicule ne pouvait entrer que par
 * le script de reprise. Un conteneur qui arrivait ne pouvait pas être saisi.
 */
router.post('/', authorize('vehicles', 'create'), async (req, res) => {
  try {
    const b = req.body || {};
    const chassis = String(b.vin ?? b.chassis ?? '').trim().toUpperCase();
    if (chassis.length < 11) {
      return res.status(400).json({
        message: 'Châssis requis, 11 caractères minimum.',
        statusCode: 400,
      });
    }
    const deja = await prisma.vehicle.findFirst({
      where: { vin: chassis, ...req.tenantWhere() },
    });
    if (deja) {
      // 409 et non 400 : la demande est valide, c'est l'état qui s'y oppose.
      return res.status(409).json({
        message: `Le châssis ${chassis} est déjà dans le parc (véhicule ${deja.id}).`,
        statusCode: 409,
      });
    }

    const { valides, refus } = await importVehicules.preparer(
      [{ ...b, chassis, __ligne: 1 }],
      req.tenantWhere()
    );
    if (refus.length) {
      return res.status(400).json({
        message: refus[0].erreurs.join(' ; '),
        statusCode: 400,
      });
    }

    const [cree] = await importVehicules.ecrire(valides, req.audit);
    const v = await prisma.vehicle.findFirst({ where: { id: cree.id } });
    return res.status(201).json(enrichVehicle(v));
  } catch (err) {
    console.error('[vehicles.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});


/**
 * POST /vehicles/import — création en masse depuis un CSV.
 *
 * Body : { csv: "<contenu>" }  ou  multipart avec un champ `file`.
 * Query : `?valider=1` pour écrire réellement.
 *
 * À BLANC PAR DÉFAUT, et ce n'est pas une politesse : un châssis créé en double
 * ou rattaché au mauvais conteneur se répare ligne par ligne, et si des coûts
 * ont déjà été ventilés dessus, ils sont au grand livre — donc définitifs.
 */
router.post('/import', authorize('vehicles', 'create'), async (req, res) => {
  try {
    const contenu = req.file?.buffer
      ? req.file.buffer.toString('utf8')
      : String((req.body || {}).csv || '');
    if (!contenu.trim()) {
      return res.status(400).json({
        message: 'Aucun contenu CSV reçu (champ « csv » ou fichier « file »).',
        statusCode: 400,
      });
    }

    const { entetes, lignes } = analyser(contenu);
    if (!lignes.length) {
      return res.status(400).json({
        message: 'Le fichier ne contient aucune ligne de données.',
        statusCode: 400,
        entetesLues: entetes,
      });
    }

    const manquantes = ['chassis'].filter((c) => !entetes.includes(c));
    if (manquantes.length) {
      return res.status(400).json({
        message:
          `Colonne obligatoire absente : ${manquantes.join(', ')}. ` +
          `Colonnes attendues : ${importVehicules.COLONNES.join(', ')}.`,
        statusCode: 400,
        entetesLues: entetes,
      });
    }

    const { valides, refus } = await importVehicules.preparer(lignes, req.tenantWhere());
    const valider = String(req.query.valider || '') === '1';

    if (!valider) {
      return res.status(200).json({
        mode: 'a-blanc',
        message:
          `${valides.length} véhicule(s) seraient créés, ${refus.length} refusé(s). ` +
          'Rien n’a été écrit. Relancez avec ?valider=1 pour appliquer.',
        lus: lignes.length,
        creables: valides.length,
        refuses: refus.length,
        apercu: valides.slice(0, 10).map((v) => ({
          ligne: v.ligne,
          chassis: v.data.vin,
          vehicule: [v.data.brand, v.data.model].filter(Boolean).join(' '),
          conteneur: v.refConteneur,
        })),
        refus,
      });
    }

    const crees = await importVehicules.ecrire(valides, req.audit);
    return res.status(201).json({
      mode: 'applique',
      message: `${crees.length} véhicule(s) créé(s), ${refus.length} refusé(s).`,
      lus: lignes.length,
      crees,
      refuses: refus.length,
      refus,
    });
  } catch (err) {
    console.error('[vehicles.import]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
