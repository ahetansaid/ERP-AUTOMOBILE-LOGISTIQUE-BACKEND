/**
 * Création automatique des mouvements de trésorerie.
 * À appeler après : reçu facture (encaissement), reçu devis (décaissement réparation),
 * achat arrivée (décaissement achat), transport véhicule, charge.
 */

const { getPool } = require('../config/database');

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
  const pool = getPool();
  let tableExists = false;
  try {
    const [rows] = await pool.execute("SHOW TABLES LIKE 'transactions_tresorerie'");
    tableExists = rows && rows.length > 0;
  } catch (_) {}
  if (!tableExists) return;

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
    await pool.execute(
      `INSERT INTO transactions_tresorerie (company_id, type, categorie, reference, montant, transaction_date, vehicle_id, description, receipt_id, purchase_id, workshop_quote_id, charge_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [company_id || null, type || 'DECAISSEMENT', categorie || 'Autres charges', reference, amount, dateStr, vehicle_id, description, receipt_id, purchase_id, workshop_quote_id, charge_id]
    );
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
}

/**
 * Décaissement : frais de transport (véhicule).
 * Si une transaction Transport existe déjà pour ce véhicule, on la met à jour (une seule ligne par véhicule).
 */
async function upsertTransportForVehicle(companyId, vehicleId, amount, transactionDate) {
  const pool = getPool();
  let tableExists = false;
  try {
    const [rows] = await pool.execute("SHOW TABLES LIKE 'transactions_tresorerie'");
    tableExists = rows && rows.length > 0;
  } catch (_) {}
  if (!tableExists) return;

  const amt = Number(amount) || 0;
  const dateStr = transactionDate && String(transactionDate).match(/^\d{4}-\d{2}-\d{2}/) ? String(transactionDate).slice(0, 10) : null;
  if (!dateStr) return;

  try {
    const [existing] = await pool.execute(
      'SELECT id FROM transactions_tresorerie WHERE vehicle_id = ? AND categorie = ? AND type = ? LIMIT 1',
      [vehicleId, CATEGORIES.DECAISSEMENT.TRANSPORT, 'DECAISSEMENT']
    );
    if (existing && existing.length > 0) {
      await pool.execute('UPDATE transactions_tresorerie SET montant = ?, transaction_date = ?, company_id = ? WHERE id = ?', [amt, dateStr, companyId || null, existing[0].id]);
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
