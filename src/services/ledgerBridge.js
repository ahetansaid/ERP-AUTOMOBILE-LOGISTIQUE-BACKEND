/**
 * Pont vers le grand livre — période de double écriture.
 *
 * Pendant la bascule, chaque flux métier écrit à la fois dans l'ancienne table
 * `transactions_tresorerie` et dans le nouveau grand livre. On compare les deux
 * totaux ; quand ils concordent sur plusieurs semaines, l'ancienne écriture est
 * retirée et ce fichier disparaît.
 *
 * Règle absolue de cette période : une défaillance du grand livre ne doit
 * JAMAIS faire échouer une opération métier. Toutes les fonctions ici sont
 * silencieuses en cas d'erreur — elles la journalisent et rendent la main.
 *
 * Correspondance des natures :
 *   reçu sur facture   → REGLEMENT   (entrée de caisse, hors résultat)
 *   reçu sur devis     → PREPARATION (sortie, imputée au véhicule)
 *   arrivée d'achat    → ACHAT       (sortie, imputée au véhicule)
 *   frais de transport → LOGISTIQUE  (sortie, imputée au véhicule)
 *   charge diverse     → CHARGE      (sortie, non imputable)
 *   facture émise      → VENTE       (produit, imputé au véhicule)
 */

const { prisma } = require('../lib/prisma');
const { postEntry, reverseEntry } = require('../lib/ledger');
const { findOrCreatePartner } = require('../lib/partners');
const { logger } = require('../lib/logger');

const log = logger('ledger-bridge');

/** Compte de caisse par défaut de la société courante, ou null. */
async function defaultCashAccount() {
  const account =
    (await prisma.cashAccount.findFirst({
      where: { isActive: true, nature: 'CAISSE' },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })) ??
    (await prisma.cashAccount.findFirst({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }));
  return account?.id ?? null;
}

/** Première catégorie de la société portant cette nature, ou null. */
async function categoryFor(nature) {
  const c = await prisma.costCategory.findFirst({
    where: { nature, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return c?.id ?? null;
}

/** Écrit au grand livre sans jamais propager d'erreur. */
async function safePost(params, tag) {
  try {
    return await postEntry(params);
  } catch (err) {
    // Silencieux pour le flux métier, mais jamais pour l'exploitant : c'est
    // pendant la double écriture que les divergences se créent.
    log.error('écriture au grand livre refusée', { err, hook: tag, params });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Points d'accroche — un par flux métier
// ---------------------------------------------------------------------------

/** Facture émise : produit de la vente, imputé au véhicule. */
async function onInvoiceIssued({ invoiceId, vehicleId, amount, issuedAt, label }) {
  return safePost(
    {
      nature: 'VENTE',
      label: label || `Facture ${invoiceId}`,
      amount: Math.abs(Number(amount)), // entrée : positif
      entryDate: issuedAt,
      vehicleId,
      // Pas de compte de caisse : la facture crée une créance, pas un
      // encaissement. C'est le reçu qui touchera la trésorerie.
      cashAccountId: null,
      categoryId: await categoryFor('VENTE'),
      source: { invoiceId },
    },
    'invoiceIssued'
  );
}

/** Reçu sur facture : encaissement d'une créance déjà reconnue. */
async function onReceiptInvoice({ receiptId, invoiceId, vehicleId, amount, paymentDate, reference }) {
  return safePost(
    {
      nature: 'REGLEMENT',
      label: reference ? `Règlement ${reference}` : `Règlement reçu ${receiptId}`,
      amount: Math.abs(Number(amount)),
      entryDate: paymentDate,
      vehicleId: vehicleId ?? null,
      cashAccountId: await defaultCashAccount(),
      source: { receiptId, invoiceId },
    },
    'receiptInvoice'
  );
}

/** Reçu sur devis atelier : sortie de caisse, imputée au coût du véhicule. */
async function onReceiptWorkshopQuote({ receiptId, workshopQuoteId, vehicleId, amount, paymentDate, reference }) {
  if (vehicleId == null) {
    // Sans véhicule, la dépense d'atelier serait perdue pour le coût de
    // revient — exactement le défaut relevé dans les classeurs.
    log.warn('devis sans véhicule : dépense exclue du coût de revient', {
      receiptId, workshopQuoteId,
    });
    return null;
  }

  // Le prestataire est porté par l'écriture : c'est ce qui permettra de
  // répondre à « combien m'a coûté ce prestataire cette année ? ».
  let partnerId = null;
  let prestataire = null;
  if (workshopQuoteId != null) {
    const quote = await prisma.workshopQuote.findFirst({
      where: { id: Number(workshopQuoteId) },
      select: { partnerId: true, prestataire: true },
    });
    partnerId = quote?.partnerId ?? null;
    prestataire = quote?.prestataire ?? null;

    // Devis antérieur à la reprise : on crée ou retrouve le tiers à la volée
    // plutôt que de perdre le rattachement.
    if (partnerId == null && prestataire) {
      try {
        const partner = await findOrCreatePartner(prestataire, 'PRESTATAIRE');
        partnerId = partner.id;
        await prisma.workshopQuote.update({
          where: { id: Number(workshopQuoteId) },
          data: { partnerId },
        });
      } catch (err) {
        log.warn('rattachement du prestataire impossible', { err, prestataire });
      }
    }
  }

  return safePost(
    {
      nature: 'PREPARATION',
      label: prestataire
        ? `Atelier — ${prestataire}`
        : reference
          ? `Atelier ${reference}`
          : `Atelier — devis ${workshopQuoteId}`,
      amount: -Math.abs(Number(amount)), // sortie : négatif
      entryDate: paymentDate,
      vehicleId,
      partnerId,
      cashAccountId: await defaultCashAccount(),
      categoryId: await categoryFor('PREPARATION'),
      source: { receiptId, workshopQuoteId },
    },
    'receiptWorkshopQuote'
  );
}

/** Arrivée d'un achat : prix d'acquisition imputé au véhicule. */
async function onPurchaseArrival({ purchaseId, vehicleId, amount, transactionDate }) {
  if (!amount || Number(amount) <= 0 || vehicleId == null) return null;
  return safePost(
    {
      nature: 'ACHAT',
      label: `Achat véhicule — dossier ${purchaseId}`,
      amount: -Math.abs(Number(amount)),
      entryDate: transactionDate,
      vehicleId,
      cashAccountId: await defaultCashAccount(),
      categoryId: await categoryFor('ACHAT'),
      source: { purchaseId },
    },
    'purchaseArrival'
  );
}

/**
 * Frais de transport d'un véhicule.
 *
 * L'ancienne implémentation METTAIT À JOUR la ligne existante. Le grand livre
 * étant en écriture seule, on contre-passe l'écriture précédente puis on en
 * pose une nouvelle : la correction reste visible, ce qui est tout l'intérêt.
 */
async function onTransportFees({ vehicleId, amount, transactionDate }) {
  try {
    const previous = await prisma.ledgerEntry.findFirst({
      where: { vehicleId: Number(vehicleId), nature: 'LOGISTIQUE', reversesId: null },
      orderBy: { id: 'desc' },
    });

    if (previous) {
      const alreadyReversed = await prisma.ledgerEntry.findFirst({
        where: { reversesId: previous.id },
        select: { id: true },
      });
      if (!alreadyReversed) {
        if (Math.abs(Number(previous.amountFcfa)) === Math.abs(Number(amount))) {
          return null; // montant inchangé : rien à corriger
        }
        await reverseEntry(previous.id, 'Frais de transport révisés');
      }
    }

    if (!amount || Number(amount) <= 0) return null;
    return await postEntry({
      nature: 'LOGISTIQUE',
      label: 'Frais de transport',
      amount: -Math.abs(Number(amount)),
      entryDate: transactionDate,
      vehicleId: Number(vehicleId),
      cashAccountId: await defaultCashAccount(),
      categoryId: await categoryFor('LOGISTIQUE'),
    });
  } catch (err) {
    log.error('frais de transport non enregistrés', { err, vehicleId });
    return null;
  }
}

/** Charge générale : sortie non imputable à un véhicule. */
async function onChargeCreated({ chargeId, amount, chargeDate, label }) {
  return safePost(
    {
      nature: 'CHARGE',
      label: label || `Charge ${chargeId}`,
      amount: -Math.abs(Number(amount)),
      entryDate: chargeDate,
      cashAccountId: await defaultCashAccount(),
      categoryId: await categoryFor('CHARGE'),
      source: { chargeId },
    },
    'chargeCreated'
  );
}

module.exports = {
  onInvoiceIssued,
  onReceiptInvoice,
  onReceiptWorkshopQuote,
  onPurchaseArrival,
  onTransportFees,
  onChargeCreated,
  defaultCashAccount,
};
