/**
 * Création automatique des mouvements de trésorerie.
 * À appeler après : reçu facture (encaissement), reçu devis (décaissement réparation),
 * achat arrivée (décaissement achat), transport véhicule, charge.
 */

const { prisma } = require('../lib/prisma');
const ledger = require('./ledgerBridge');

// ---------------------------------------------------------------------------
// PÉRIODE DE DOUBLE ÉCRITURE
// Chaque hook alimente l'ancienne table `transactions_tresorerie` ET le
// nouveau grand livre. On compare les totaux ; quand ils concordent sur
// plusieurs semaines, les appels `createTreasuryTransaction` ci-dessous
// disparaissent et seul le grand livre subsiste.
// ---------------------------------------------------------------------------

const CATEGORIES = {
  ENCAISSEMENT: { PAIEMENT_FACTURE: 'Paiement facture' },
  DECAISSEMENT: {
    ACHAT_VEHICULE: 'Achat véhicule',
    TRANSPORT: 'Transport',
    REPARATION: 'Réparation',
    CHARGE_ADMINISTRATIVE: 'Charge administrative',
    CARBURANT: 'Carburant',
    AUTRES_CHARGES: 'Autres charges',
  },
};

function mapChargeCategoryToTreasury(category) {
  if (!category || typeof category !== 'string') return CATEGORIES.DECAISSEMENT.AUTRES_CHARGES;
  const c = category.toLowerCase();
  if (c === 'transport') return CATEGORIES.DECAISSEMENT.TRANSPORT;
  if (c.includes('admin') || c.includes('administratif')) return CATEGORIES.DECAISSEMENT.CHARGE_ADMINISTRATIVE;
  if (c.includes('carburant') || c.includes('essence') || c.includes('gasoil')) return CATEGORIES.DECAISSEMENT.CARBURANT;
  return CATEGORIES.DECAISSEMENT.AUTRES_CHARGES;
}

/**
 * Insère une transaction trésorerie (si la table existe).
 * @param {Object} opts - company_id, type: 'ENCAISSEMENT'|'DECAISSEMENT', categorie, reference, montant, transaction_date (YYYY-MM-DD), vehicle_id?, description?, receipt_id?, purchase_id?, workshop_quote_id?, charge_id?
 */
async function createTreasuryTransaction(opts) {
  const {
    company_id,
    type,
    categorie,
    reference = null,
    montant,
    transaction_date,
    vehicle_id = null,
    description = null,
    receipt_id = null,
    purchase_id = null,
    workshop_quote_id = null,
    charge_id = null,
  } = opts;

  if (montant == null || isNaN(Number(montant))) return;
  const amount = Number(montant);
  if (amount <= 0) return;

  const dateStr = transaction_date && String(transaction_date).match(/^\d{4}-\d{2}-\d{2}/) ? String(transaction_date).slice(0, 10) : null;
  if (!dateStr) return;

  try {
    await prisma.treasuryTransaction.create({
      data: {
        companyId: company_id != null ? Number(company_id) : null,
        type: type || 'DECAISSEMENT',
        categorie: categorie || 'Autres charges',
        reference,
        montant: amount,
        transactionDate: new Date(dateStr),
        vehicleId: vehicle_id != null ? Number(vehicle_id) : null,
        description,
        receiptId: receipt_id != null ? Number(receipt_id) : null,
        purchaseId: purchase_id != null ? Number(purchase_id) : null,
        workshopQuoteId: workshop_quote_id != null ? Number(workshop_quote_id) : null,
        chargeId: charge_id != null ? Number(charge_id) : null,
      },
    });
  } catch (err) {
    console.error('treasuryTransactions.createTreasuryTransaction:', err.message);
  }
}

/**
 * Encaissement : paiement client (reçu lié à une facture).
 */
async function onReceiptInvoice(companyId, receiptId, amount, paymentDate, reference, vehicleId = null) {
  await createTreasuryTransaction({
    company_id: companyId,
    type: 'ENCAISSEMENT',
    categorie: CATEGORIES.ENCAISSEMENT.PAIEMENT_FACTURE,
    reference: reference || `RC-${receiptId}`,
    montant: amount,
    transaction_date: paymentDate,
    vehicle_id: vehicleId,
    receipt_id: receiptId,
  });
  await ledger.onReceiptInvoice({ receiptId, vehicleId, amount, paymentDate, reference });
}

/**
 * Décaissement : paiement garage (reçu lié à un devis atelier).
 */
async function onReceiptWorkshopQuote(companyId, receiptId, amount, paymentDate, reference, vehicleId = null, workshopQuoteId = null) {
  await createTreasuryTransaction({
    company_id: companyId,
    type: 'DECAISSEMENT',
    categorie: CATEGORIES.DECAISSEMENT.REPARATION,
    reference: reference || `RC-DEV-${receiptId}`,
    montant: amount,
    transaction_date: paymentDate,
    vehicle_id: vehicleId,
    receipt_id: receiptId,
    workshop_quote_id: workshopQuoteId,
  });
  await ledger.onReceiptWorkshopQuote({
    receiptId, workshopQuoteId, vehicleId, amount, paymentDate, reference,
  });
}

/**
 * Décaissement : achat véhicule (à l’arrivée d’un achat).
 */
async function onPurchaseArrival(companyId, purchaseId, vehicleId, amount, transactionDate) {
  if (!amount || Number(amount) <= 0) return;
  await createTreasuryTransaction({
    company_id: companyId,
    type: 'DECAISSEMENT',
    categorie: CATEGORIES.DECAISSEMENT.ACHAT_VEHICULE,
    reference: `Achat-${purchaseId}`,
    montant: Number(amount),
    transaction_date: transactionDate,
    vehicle_id: vehicleId,
    purchase_id: purchaseId,
  });
  await ledger.onPurchaseArrival({ purchaseId, vehicleId, amount, transactionDate });
}

/**
 * Décaissement : frais de transport (véhicule).
 * Si une transaction Transport existe déjà pour ce véhicule, on la met à jour (une seule ligne par véhicule).
 */
async function upsertTransportForVehicle(companyId, vehicleId, amount, transactionDate) {
  const amt = Number(amount) || 0;
  const dateStr = transactionDate && String(transactionDate).match(/^\d{4}-\d{2}-\d{2}/) ? String(transactionDate).slice(0, 10) : null;
  if (!dateStr) return;

  try {
    const existing = await prisma.treasuryTransaction.findFirst({
      where: {
        vehicleId: Number(vehicleId),
        categorie: CATEGORIES.DECAISSEMENT.TRANSPORT,
        type: 'DECAISSEMENT',
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.treasuryTransaction.update({
        where: { id: existing.id },
        data: {
          montant: amt,
          transactionDate: new Date(dateStr),
          companyId: companyId != null ? Number(companyId) : null,
        },
      });
    } else if (amt > 0) {
      await createTreasuryTransaction({
        company_id: companyId,
        type: 'DECAISSEMENT',
        categorie: CATEGORIES.DECAISSEMENT.TRANSPORT,
        reference: `Transport-V${vehicleId}`,
        montant: amt,
        transaction_date: dateStr,
        vehicle_id: vehicleId,
      });
    }
  } catch (err) {
    console.error('treasuryTransactions.upsertTransportForVehicle:', err.message);
  }
  await ledger.onTransportFees({ vehicleId, amount, transactionDate });
}

/**
 * Décaissement : charge diverse (administratif, carburant, autres).
 */
async function onChargeCreated(companyId, chargeId, amount, chargeDate, category, label) {
  const categorie = mapChargeCategoryToTreasury(category);
  await createTreasuryTransaction({
    company_id: companyId,
    type: 'DECAISSEMENT',
    categorie,
    reference: label ? String(label).slice(0, 100) : `Charge-${chargeId}`,
    montant: amount,
    transaction_date: chargeDate,
    description: label || null,
    charge_id: chargeId,
  });
  await ledger.onChargeCreated({ chargeId, amount, chargeDate, label });
}

module.exports = {
  createTreasuryTransaction,
  onReceiptInvoice,
  onReceiptWorkshopQuote,
  onPurchaseArrival,
  upsertTransportForVehicle,
  onChargeCreated,
  CATEGORIES,
  mapChargeCategoryToTreasury,
};
