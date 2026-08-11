/**
 * Dossier 360°.
 *
 * Toute entité s'ouvre sur la même structure : identité, rattachements,
 * financier, chronologie, documents. La chronologie fusionne quatre sources qui
 * vivaient jusqu'ici séparément — écritures du grand livre, documents joints,
 * envois d'e-mails et journal d'audit.
 *
 * C'est ce qui transforme l'audit d'une table technique en histoire lisible du
 * dossier.
 */

const { prisma } = require('./prisma');
const { vehicleCost } = require('./costing');

const num = (v) => (v == null ? 0 : Number(v));

/** Trie décroissant et tronque : le plus récent d'abord. */
const timeline = (events, limit = 80) =>
  events
    .filter((e) => e && e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);

/** Événements communs à toute entité : documents, e-mails, audit. */
async function commonEvents(resource, id) {
  const [uploads, emails, audits] = await Promise.all([
    prisma.upload.findMany({
      where: { resource, resourceId: id },
      orderBy: { id: 'desc' },
      take: 50,
    }),
    prisma.emailEvent.findMany({
      where: { resource, resourceId: id },
      orderBy: { id: 'desc' },
      take: 30,
    }),
    prisma.auditLog.findMany({
      where: { resource, resourceId: id },
      orderBy: { id: 'desc' },
      take: 50,
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    }),
  ]);

  const who = (u) =>
    u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email : 'Système';

  return {
    documents: uploads.map((u) => ({
      id: u.id,
      kind: u.kind,
      fileName: u.fileName,
      docNumber: u.docNumber,
      docDate: u.docDate,
      docAmount: u.docAmount != null ? num(u.docAmount) : null,
      createdAt: u.createdAt,
    })),
    events: [
      ...uploads.map((u) => ({
        date: u.createdAt,
        type: 'document',
        label: u.docNumber ? `Document ${u.docNumber}` : `Fichier ${u.fileName}`,
        detail: u.kind,
      })),
      ...emails.map((e) => ({
        date: e.sentAt ?? e.createdAt,
        type: 'email',
        label: e.subject,
        detail: `${e.toEmail} · ${e.status}`,
      })),
      ...audits.map((a) => ({
        date: a.createdAt,
        type: 'audit',
        label:
          a.action === 'CREATE' ? 'Création'
            : a.action === 'UPDATE' ? 'Modification'
              : a.action === 'DELETE' ? 'Suppression'
                : a.action,
        detail: who(a.user),
      })),
    ],
  };
}

/** Écritures du grand livre rattachées à une entité, converties en événements. */
function ledgerEvents(entries) {
  return entries.map((e) => ({
    date: e.entryDate,
    type: 'ledger',
    label: e.label,
    detail: e.nature,
    amount: num(e.amountFcfa),
  }));
}

async function vehicleDossier(id) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      invoice: { select: { id: true, invoiceNumber: true, totalAmount: true, status: true } },
      purchaseVehicles: {
        include: {
          purchase: {
            select: { id: true, containerReference: true, vessel: true, purchaseDate: true, arrivalDate: true },
          },
        },
      },
      workshopQuotes: {
        select: { id: true, prestataire: true, amount: true, status: true, createdAt: true },
        orderBy: { id: 'desc' },
        take: 30,
      },
    },
  });
  if (!vehicle) return null;

  const [entries, cost, common] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { vehicleId: id },
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      take: 100,
    }),
    vehicleCost(id),
    commonEvents('vehicles', id),
  ]);

  const purchase = vehicle.purchaseVehicles[0]?.purchase ?? null;

  return {
    type: 'Vehicle',
    id,
    identite: {
      titre: [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' '),
      vin: vehicle.vin,
      statut: vehicle.status,
      couleur: vehicle.color,
      immatriculation: vehicle.registration,
      kilometrage: vehicle.mileage,
      paysOrigine: vehicle.countryOrigin,
    },
    rattachements: {
      conteneur: purchase
        ? {
            id: purchase.id,
            reference: purchase.containerReference,
            navire: purchase.vessel,
            dateAchat: purchase.purchaseDate,
            dateArrivee: purchase.arrivalDate,
          }
        : null,
      client: vehicle.client,
      facture: vehicle.invoice
        ? { ...vehicle.invoice, totalAmount: num(vehicle.invoice.totalAmount) }
        : null,
    },
    financier: cost,
    atelier: vehicle.workshopQuotes.map((q) => ({
      id: q.id,
      prestataire: q.prestataire,
      montant: num(q.amount),
      statut: q.status,
      date: q.createdAt,
    })),
    documents: common.documents,
    chronologie: timeline([
      ...ledgerEvents(entries),
      ...common.events,
      vehicle.createdAt
        ? { date: vehicle.createdAt, type: 'statut', label: 'Entrée en stock', detail: null }
        : null,
    ]),
  };
}

async function purchaseDossier(id) {
  const purchase = await prisma.purchase.findFirst({
    where: { id },
    include: {
      purchaseVehicles: {
        include: {
          vehicle: {
            select: { id: true, vin: true, brand: true, model: true, year: true, status: true },
          },
        },
      },
    },
  });
  if (!purchase) return null;

  const vehicleIds = purchase.purchaseVehicles.map((pv) => pv.vehicle.id);
  const [entries, common] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { OR: [{ purchaseId: id }, { vehicleId: { in: vehicleIds } }] },
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      take: 150,
    }),
    commonEvents('purchases', id),
  ]);

  const couts = await Promise.all(vehicleIds.map((v) => vehicleCost(v)));
  const total = couts.reduce((s, c) => s + c.cost, 0);

  return {
    type: 'Purchase',
    id,
    identite: {
      titre: purchase.containerReference || `Achat ${id}`,
      navire: purchase.vessel,
      fournisseur: purchase.supplierName,
      statut: purchase.status,
      type: purchase.purchaseType,
      dateAchat: purchase.purchaseDate,
      dateArrivee: purchase.arrivalDate,
    },
    rattachements: {
      vehicules: purchase.purchaseVehicles.map((pv, i) => ({
        ...pv.vehicle,
        cout: couts[i]?.cost ?? 0,
      })),
    },
    financier: {
      coutTotal: total,
      coutMoyen: vehicleIds.length ? total / vehicleIds.length : 0,
      nbVehicules: vehicleIds.length,
    },
    documents: common.documents,
    chronologie: timeline([...ledgerEvents(entries), ...common.events]),
  };
}

async function invoiceDossier(id) {
  const invoice = await prisma.invoice.findFirst({
    where: { id },
    include: {
      client: { select: { id: true, name: true, phone: true, email: true } },
      vehicle: { select: { id: true, vin: true, brand: true, model: true, year: true } },
      receipts: {
        select: { id: true, receiptNumber: true, amount: true, paymentDate: true, paymentMethod: true },
        orderBy: { paymentDate: 'asc' },
      },
    },
  });
  if (!invoice) return null;

  const [entries, common] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { invoiceId: id },
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      take: 60,
    }),
    commonEvents('invoices', id),
  ]);

  const total = num(invoice.totalAmount);
  const paid = invoice.receipts.reduce((s, r) => s + num(r.amount), 0);

  return {
    type: 'Invoice',
    id,
    identite: {
      titre: invoice.invoiceNumber || `Facture ${id}`,
      statut: invoice.status,
      dateEmission: invoice.createdAt,
      echeance: invoice.dueDate,
    },
    rattachements: { client: invoice.client, vehicule: invoice.vehicle },
    financier: {
      total,
      encaisse: paid,
      restant: Math.max(0, total - paid),
      // La pièce fiscale est établie hors plateforme : son absence est une
      // information, pas un détail.
      pieceFiscale: common.documents.some((d) => d.kind === 'FACTURE_NORMALISEE'),
    },
    reglements: invoice.receipts.map((r) => ({
      id: r.id,
      numero: r.receiptNumber,
      montant: num(r.amount),
      date: r.paymentDate,
      mode: r.paymentMethod,
    })),
    documents: common.documents,
    chronologie: timeline([
      ...ledgerEvents(entries),
      ...common.events,
      ...invoice.receipts.map((r) => ({
        date: r.paymentDate,
        type: 'reglement',
        label: `Règlement ${r.receiptNumber ?? r.id}`,
        detail: r.paymentMethod,
        amount: num(r.amount),
      })),
    ]),
  };
}

async function partnerDossier(id) {
  const partner = await prisma.partner.findFirst({ where: { id } });
  if (!partner) return null;

  const [entries, agg, quotes, common] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { partnerId: id },
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      take: 100,
    }),
    prisma.ledgerEntry.aggregate({
      where: { partnerId: id },
      _sum: { amountFcfa: true },
      _count: { _all: true },
    }),
    prisma.workshopQuote.findMany({
      where: { partnerId: id },
      orderBy: { id: 'desc' },
      take: 50,
      include: { vehicle: { select: { vin: true, brand: true, model: true } } },
    }),
    commonEvents('partners', id),
  ]);

  const volume = Math.abs(num(agg._sum.amountFcfa));
  return {
    type: 'Partner',
    id,
    identite: {
      titre: partner.name,
      metier: partner.specialty,
      roles: partner.kinds,
      telephone: partner.phone,
      email: partner.email,
      ville: partner.city,
      actif: partner.isActive,
    },
    rattachements: {
      interventions: quotes.map((q) => ({
        id: q.id,
        montant: num(q.amount),
        statut: q.status,
        vehicule: q.vehicle
          ? `${q.vehicle.brand ?? ''} ${q.vehicle.model ?? ''}`.trim() || q.vehicle.vin
          : null,
      })),
    },
    financier: {
      volume,
      mouvements: agg._count._all,
      ticketMoyen: agg._count._all ? volume / agg._count._all : 0,
    },
    documents: common.documents,
    chronologie: timeline([...ledgerEvents(entries), ...common.events]),
  };
}

const BUILDERS = {
  Vehicle: vehicleDossier,
  Purchase: purchaseDossier,
  Invoice: invoiceDossier,
  Partner: partnerDossier,
};

async function getDossier(type, id) {
  const build = BUILDERS[type];
  if (!build) {
    throw new Error(
      `[dossier] type non pris en charge : ${type}. Disponibles : ${Object.keys(BUILDERS).join(', ')}`
    );
  }
  return build(Number(id));
}

module.exports = { getDossier, DOSSIER_TYPES: Object.keys(BUILDERS) };
