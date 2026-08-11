/**
 * Numérotation des documents
 *
 * La plateforme ne produit pas de pièce fiscale certifiée : le numéro qu'elle
 * attribue est donc la SEULE référence d'une facture ou d'un reçu. Un doublon
 * n'aurait rien pour le rattraper — d'où l'incrément atomique ci-dessous.
 *
 * Ce que faisait l'ancienne implémentation (invoices.js) :
 *   1. charger toutes les factures de l'année
 *   2. chercher le plus grand suffixe
 *   3. ajouter 1
 * Deux requêtes simultanées lisaient la même valeur et calculaient le même
 * numéro. Aucune contrainte d'unicité ne les empêchait de coexister.
 *
 * Ici, un unique `INSERT … ON CONFLICT DO UPDATE … RETURNING` réserve le numéro
 * en une seule instruction : la base sérialise les accès concurrents, chaque
 * appelant repart avec un numéro distinct.
 */

const { prismaRaw } = require('./prisma');

const FORMATS = {
  INVOICE: (y, n) => `FAV-${y}-${n}`,
  RECEIPT: (y, n) => `REC-${y}-${n}`,
  QUOTE: (y, n) => `DEV-${y}-${n}`,
  PROFORMA: (y, n) => `PRO-${y}-${n}`,
};

/**
 * Réserve et retourne le prochain numéro pour un type de document.
 *
 * @param {number} companyId  société propriétaire de la séquence
 * @param {'INVOICE'|'RECEIPT'|'QUOTE'|'PROFORMA'} docType
 * @param {number} [year]     année de la séquence (défaut : année courante)
 * @returns {Promise<{number: string, sequence: number, year: number}>}
 */
async function nextDocumentNumber(companyId, docType, year = new Date().getFullYear()) {
  if (!Number.isInteger(companyId)) {
    throw new Error('[numbering] companyId requis');
  }
  const format = FORMATS[docType];
  if (!format) {
    throw new Error(
      `[numbering] type inconnu : ${docType}. Attendu : ${Object.keys(FORMATS).join(', ')}`
    );
  }

  // Requête volontairement passée au client brut : elle porte déjà companyId
  // explicitement, et l'extension Prisma ne réécrit pas le SQL natif.
  const rows = await prismaRaw.$queryRaw`
    INSERT INTO document_counters (company_id, doc_type, year, last_number, updated_at)
    VALUES (${companyId}, ${docType}, ${year}, 1, NOW())
    ON CONFLICT (company_id, doc_type, year)
    DO UPDATE SET last_number = document_counters.last_number + 1, updated_at = NOW()
    RETURNING last_number
  `;

  const sequence = Number(rows?.[0]?.last_number);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('[numbering] séquence non retournée par la base');
  }

  return {
    number: format(year, String(sequence).padStart(4, '0')),
    sequence,
    year,
  };
}

module.exports = { nextDocumentNumber, FORMATS };
