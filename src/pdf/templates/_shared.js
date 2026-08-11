/**
 * Utilitaires communs aux modèles PDF.
 *
 * Les quatre modèles partagent le même contrat de données :
 *
 *   {
 *     kind: 'FACTURE' | 'RECU' | 'DEVIS' | 'PROFORMA',
 *     number, issuedAt, dueDate?, validUntil?,
 *     currency, vatRate,
 *     brand: { name, color },
 *     from:  { name, address, city, country, phone, legalNumber },
 *     to:    { name, address, city, country, phone, email },
 *     lines: [{ label, sublabel?, quantity, unitPrice, total? }],
 *     notes?
 *   }
 *
 * Écrits en React.createElement plutôt qu'en JSX : le backend tourne en CommonJS
 * sans étape de compilation.
 */

const KIND_LABEL = {
  FACTURE: 'Facture',
  RECU: 'Reçu',
  DEVIS: 'Devis',
  PROFORMA: 'Pro forma',
};

function fmtAmount(n, currency) {
  const rounded = Math.round(Number(n) || 0);
  const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} ${currency || 'FCFA'}`;
}

/** Sans devise — pour les colonnes de tableau où l'unité est déjà en en-tête. */
function fmtNumber(n) {
  const rounded = Math.round(Number(n) || 0);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function fmtDate(d, style = 'long') {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(
    'fr-FR',
    style === 'short'
      ? { day: '2-digit', month: '2-digit', year: 'numeric' }
      : { day: '2-digit', month: 'long', year: 'numeric' }
  ).format(date);
}

/** Normalise les lignes et calcule sous-total, TVA et total. */
function computeTotals(data) {
  const lines = (data.lines || []).map((l) => ({
    ...l,
    quantity: l.quantity ?? 1,
    unitPrice: l.unitPrice ?? 0,
    total: l.total != null ? l.total : (l.quantity || 0) * (l.unitPrice || 0),
  }));
  const subtotal = lines.reduce((s, l) => s + (l.total || 0), 0);
  const vatRate = data.vatRate || 0;
  const vat = (vatRate / 100) * subtotal;
  return { lines, subtotal, vatRate, vat, total: subtotal + vat };
}

/** Mentions de bas de page, selon le type de document. */
function footerNote(data) {
  if (data.kind === 'FACTURE' && data.dueDate) {
    return `À régler avant le ${fmtDate(data.dueDate)}.`;
  }
  if (data.kind === 'DEVIS' && data.validUntil) {
    return `Devis valable jusqu'au ${fmtDate(data.validUntil)}.`;
  }
  if (data.kind === 'PROFORMA') {
    return 'Pro forma — document non comptabilisé.';
  }
  return null;
}

module.exports = { KIND_LABEL, fmtAmount, fmtNumber, fmtDate, computeTotals, footerNote };
