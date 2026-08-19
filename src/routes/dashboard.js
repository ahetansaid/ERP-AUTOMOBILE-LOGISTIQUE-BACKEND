const express = require('express');
const { prisma } = require('../lib/prisma');

const router = express.Router();
const { authorize } = require('../middleware/rbac');
const { NON_ARCHIVES } = require('../lib/archive');

// Minuit il y a N jours (équivalent DATE_SUB(CURDATE(), INTERVAL N DAY)).
function midnightDaysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

router.get('/stats', authorize('dashboard', 'read'), async (req, res) => {
  try {
    // req.companyId vient de tenantScope (override ?companyId réservé aux ADMIN).
    const companyId = req.companyId;
    const vehicleWhere = companyId ? { companyId } : {};
    const receiptWhere = companyId ? { companyId } : {};

    // Les archivés sortent du parc visible : le tableau de bord est une vue
    // d'inventaire, pas une vue comptable.
    const countVehicles = (status) =>
      prisma.vehicle.count({ where: { ...vehicleWhere, ...NON_ARCHIVES, status } });

    const [
      stockDisp,
      stockNonReg,
      stockReg,
      nombreClients,
      caSemaineAgg,
      caMoisAgg,
      enMaintenance,
      enTransit,
    ] = await Promise.all([
      countVehicles('DISPONIBLE'),
      countVehicles('EN_VENTE'),
      countVehicles('VENDU'),
      prisma.client.count({ where: companyId ? { companyId } : {} }),
      prisma.receipt.aggregate({
        _sum: { amount: true },
        where: { ...receiptWhere, paymentDate: { gte: midnightDaysAgo(7) } },
      }),
      prisma.receipt.aggregate({
        _sum: { amount: true },
        where: { ...receiptWhere, paymentDate: { gte: midnightDaysAgo(30) } },
      }),
      countVehicles('EN_MAINTENANCE'),
      countVehicles('EN_TRANSIT'),
    ]);

    return res.status(200).json({
      stockDisponible: stockDisp,
      stockNonRegulier: stockNonReg,
      stockRegularise: stockReg,
      nombreClients,
      caSemaine: Number(caSemaineAgg._sum.amount ?? 0),
      caMois: Number(caMoisAgg._sum.amount ?? 0),
      vehiclesEnMaintenance: enMaintenance,
      vehiclesEnTransit: enTransit,
      currency: 'XOF',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * GET /dashboard/alerts
 * Calcule les alertes dynamiques pour la société courante :
 *   - Factures impayées > 30 jours
 *   - Échéances proches (< 7 jours)
 *   - Véhicules en transit depuis > 20 jours
 *   - Véhicules en maintenance depuis > 14 jours
 *   - Devis atelier arrivant à expiration
 *
 * Chaque alerte a : id, severity (info/warning/danger), title, message, link, count.
 */
router.get('/alerts', authorize('dashboard', 'read'), async (req, res) => {
  try {
    const companyId =
      req.companyId ?? req.user?.companyId ?? null;
    const tenantWhere = companyId ? { companyId } : {};
    const alerts = [];

    const now = new Date();
    const D_7 = new Date(now.getTime() - 7 * 24 * 3600_000);
    const D_14 = new Date(now.getTime() - 14 * 24 * 3600_000);
    const D_20 = new Date(now.getTime() - 20 * 24 * 3600_000);
    const D_30 = new Date(now.getTime() - 30 * 24 * 3600_000);
    const IN_7 = new Date(now.getTime() + 7 * 24 * 3600_000);

    // 1. Factures impayées > 30 jours (échéance dépassée de 30j et solde > 0)
    const oldUnpaidInvoices = await prisma.invoice.findMany({
      where: {
        ...tenantWhere,
        dueDate: { lt: D_30 },
        status: { notIn: ['PAYEE', 'ANNULEE'] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        dueDate: true,
        client: { select: { name: true } },
        receipts: { select: { amount: true } },
      },
      take: 50,
    });
    const reallyUnpaid = oldUnpaidInvoices.filter((inv) => {
      const paid = inv.receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
      return paid < Number(inv.totalAmount || 0);
    });
    if (reallyUnpaid.length > 0) {
      alerts.push({
        id: 'unpaid_over_30',
        severity: 'danger',
        title: `${reallyUnpaid.length} facture${reallyUnpaid.length > 1 ? 's' : ''} impayée${reallyUnpaid.length > 1 ? 's' : ''} > 30 jours`,
        message: reallyUnpaid
          .slice(0, 3)
          .map(
            (i) =>
              `${i.invoiceNumber} · ${i.client?.name ?? '—'} · ${Number(i.totalAmount).toLocaleString('fr-FR')} FCFA`
          )
          .join(' · '),
        link: '/comptabilite/factures',
        count: reallyUnpaid.length,
      });
    }

    // 2. Échéances proches (< 7 jours) pour factures non soldées
    const soonDueInvoices = await prisma.invoice.findMany({
      where: {
        ...tenantWhere,
        dueDate: { gte: now, lte: IN_7 },
        status: { notIn: ['PAYEE', 'ANNULEE'] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        dueDate: true,
        client: { select: { name: true } },
        receipts: { select: { amount: true } },
      },
      take: 50,
    });
    const soonUnpaid = soonDueInvoices.filter((inv) => {
      const paid = inv.receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
      return paid < Number(inv.totalAmount || 0);
    });
    if (soonUnpaid.length > 0) {
      alerts.push({
        id: 'due_soon',
        severity: 'warning',
        title: `${soonUnpaid.length} échéance${soonUnpaid.length > 1 ? 's' : ''} dans 7 jours`,
        message: soonUnpaid
          .slice(0, 3)
          .map((i) => {
            const date = i.dueDate ? new Date(i.dueDate).toLocaleDateString('fr-FR') : '—';
            return `${i.invoiceNumber} · ${i.client?.name ?? '—'} · ${date}`;
          })
          .join(' · '),
        link: '/comptabilite/factures',
        count: soonUnpaid.length,
      });
    }

    // 3. Véhicules en transit depuis > 20 jours (updatedAt ou createdAt)
    const stuckTransit = await prisma.vehicle.count({
      where: {
        ...tenantWhere,
        status: 'EN_TRANSIT',
        updatedAt: { lt: D_20 },
      },
    });
    if (stuckTransit > 0) {
      alerts.push({
        id: 'transit_stuck',
        severity: 'warning',
        title: `${stuckTransit} véhicule${stuckTransit > 1 ? 's' : ''} en transit > 20 jours`,
        message: 'Vérifier le statut auprès du transitaire.',
        link: '/transit/suivi',
        count: stuckTransit,
      });
    }

    // 4. Véhicules en maintenance depuis > 14 jours
    const stuckMaintenance = await prisma.vehicle.count({
      where: {
        ...tenantWhere,
        status: 'EN_MAINTENANCE',
        updatedAt: { lt: D_14 },
      },
    });
    if (stuckMaintenance > 0) {
      alerts.push({
        id: 'maintenance_stuck',
        severity: 'warning',
        title: `${stuckMaintenance} véhicule${stuckMaintenance > 1 ? 's' : ''} en atelier > 14 jours`,
        message: 'Relancer le prestataire ou clôturer le devis.',
        link: '/supply-chain/atelier',
        count: stuckMaintenance,
      });
    }

    // 5. Devis atelier arrivant à expiration (< 7 jours)
    const expiringQuotes = await prisma.workshopQuote.count({
      where: {
        ...tenantWhere,
        validUntil: { gte: now, lte: IN_7 },
        status: { in: ['EN_ATTENTE', 'APPROUVE', 'EN_COURS'] },
      },
    });
    if (expiringQuotes > 0) {
      alerts.push({
        id: 'quotes_expiring',
        severity: 'info',
        title: `${expiringQuotes} devis expire${expiringQuotes > 1 ? 'nt' : ''} sous 7 jours`,
        message: 'À approuver ou renouveler.',
        link: '/comptabilite/devis',
        count: expiringQuotes,
      });
    }

    // 6. Devis déjà expirés mais pas clôturés
    const expiredQuotes = await prisma.workshopQuote.count({
      where: {
        ...tenantWhere,
        validUntil: { lt: now },
        status: { in: ['EN_ATTENTE', 'APPROUVE'] },
      },
    });
    if (expiredQuotes > 0) {
      alerts.push({
        id: 'quotes_expired',
        severity: 'warning',
        title: `${expiredQuotes} devis expiré${expiredQuotes > 1 ? 's' : ''}`,
        message: 'Clôturer ou renouveler.',
        link: '/comptabilite/devis',
        count: expiredQuotes,
      });
    }

    return res.status(200).json({
      alerts,
      generatedAt: now.toISOString(),
      total: alerts.length,
    });
  } catch (err) {
    console.error('[dashboard.alerts]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
