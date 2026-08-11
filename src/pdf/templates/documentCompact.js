/**
 * Modèle PDF « Reçu compact »
 *
 * Format ticket, destiné à la caisse et à la livraison. La largeur est calée
 * sur 80 mm pour l'impression thermique ; `?width=58` produit la variante
 * 58 mm. Tout est centré, en Courier, sans couleur : les imprimantes
 * thermiques ne restituent que du noir.
 *
 * La hauteur est volontairement généreuse — @react-pdf/renderer ne sait pas
 * dimensionner une page au contenu, et une page trop courte tronquerait le
 * document.
 */

const React = require('react');
const { Document, Page, View, Text, StyleSheet } = require('@react-pdf/renderer');
const { KIND_LABEL, fmtAmount, fmtDate, computeTotals, footerNote } = require('./_shared');

const e = React.createElement;

// Points PostScript : 1 mm = 2.8346 pt
const MM = 2.8346;

const s = StyleSheet.create({
  page: { paddingVertical: 14, paddingHorizontal: 10, fontSize: 8, fontFamily: 'Courier', color: '#000' },
  center: { textAlign: 'center' },
  shop: { fontSize: 11, fontFamily: 'Courier-Bold', textAlign: 'center' },
  shopLine: { fontSize: 7.5, textAlign: 'center', marginTop: 1.5 },
  sep: { borderTopWidth: 1, borderTopColor: '#000', borderStyle: 'dashed', marginVertical: 7 },
  kind: { fontSize: 9.5, fontFamily: 'Courier-Bold', textAlign: 'center' },
  meta: { fontSize: 7.5, textAlign: 'center', marginTop: 2 },

  kv: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2.5 },
  k: { fontSize: 7.5 },
  v: { fontSize: 7.5, fontFamily: 'Courier-Bold', textAlign: 'right', flexShrink: 1 },

  item: { marginTop: 5 },
  itemLabel: { fontSize: 8, fontFamily: 'Courier-Bold' },
  itemSub: { fontSize: 7 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 },

  amountBox: { marginTop: 8, alignItems: 'center' },
  amountLabel: { fontSize: 7.5 },
  amount: { fontSize: 14, fontFamily: 'Courier-Bold', marginTop: 2 },

  thanks: { fontSize: 7.5, textAlign: 'center', marginTop: 4, lineHeight: 1.5 },
  legal: { fontSize: 6.5, textAlign: 'center', marginTop: 8, lineHeight: 1.45 },
});

function buildDocumentCompact(data, options = {}) {
  const widthMm = Number(options.widthMm) === 58 ? 58 : 80;
  const currency = data.currency || 'FCFA';
  const { lines, subtotal, vatRate, vat, total } = computeTotals(data);
  const brandName = (data.brand && data.brand.name) || data.from.name;
  const note = footerNote(data);

  const sep = () => e(View, { style: s.sep });

  return e(
    Document, null,
    e(Page, { size: [widthMm * MM, 300 * MM], style: s.page },

      e(Text, { style: s.shop }, (brandName || '').toUpperCase()),
      e(Text, { style: s.shopLine },
        [data.from.city, data.from.country].filter(Boolean).join(' · ')),
      data.from.phone ? e(Text, { style: s.shopLine }, `Tel ${data.from.phone}`) : null,

      sep(),

      e(Text, { style: s.kind }, (KIND_LABEL[data.kind] || 'DOCUMENT').toUpperCase()),
      e(Text, { style: s.meta }, `N° ${data.number || '—'}`),
      e(Text, { style: s.meta }, fmtDate(data.issuedAt, 'short')),

      sep(),

      e(View, null,
        e(View, { style: s.kv },
          e(Text, { style: s.k }, data.kind === 'RECU' ? 'Reçu de' : 'Client'),
          e(Text, { style: s.v }, data.to.name)),
        data.paymentMethod
          ? e(View, { style: s.kv },
              e(Text, { style: s.k }, 'Mode'),
              e(Text, { style: s.v }, data.paymentMethod))
          : null,
        data.reference
          ? e(View, { style: s.kv },
              e(Text, { style: s.k }, 'Réf.'),
              e(Text, { style: s.v }, data.reference))
          : null
      ),

      sep(),

      ...lines.map((l, i) =>
        e(View, { key: i, style: s.item },
          e(Text, { style: s.itemLabel }, l.label),
          l.sublabel ? e(Text, { style: s.itemSub }, l.sublabel) : null,
          e(View, { style: s.itemRow },
            e(Text, { style: s.k }, `${l.quantity} x ${fmtAmount(l.unitPrice, currency)}`),
            e(Text, { style: s.v }, fmtAmount(l.total, currency))))
      ),

      sep(),

      vatRate > 0
        ? e(View, null,
            e(View, { style: s.kv },
              e(Text, { style: s.k }, 'Sous-total'),
              e(Text, { style: s.v }, fmtAmount(subtotal, currency))),
            e(View, { style: s.kv },
              e(Text, { style: s.k }, `TVA ${vatRate}%`),
              e(Text, { style: s.v }, fmtAmount(vat, currency))))
        : null,

      e(View, { style: s.amountBox },
        e(Text, { style: s.amountLabel },
          data.kind === 'RECU' ? 'MONTANT REÇU' : 'TOTAL'),
        e(Text, { style: s.amount }, fmtAmount(total, currency))),

      data.remainingAmount != null
        ? e(View, null,
            sep(),
            e(View, { style: s.kv },
              e(Text, { style: s.k }, 'Solde restant'),
              e(Text, { style: s.v }, fmtAmount(data.remainingAmount, currency))))
        : null,

      sep(),

      note ? e(Text, { style: s.thanks }, note) : null,
      e(Text, { style: s.thanks }, 'Merci de votre confiance.'),

      e(Text, { style: s.legal },
        (data.from.legalNumber ? `IFU / RCCM ${data.from.legalNumber}\n` : '') +
        'Document commercial — ne remplace pas la pièce fiscale.')
    )
  );
}

module.exports = { buildDocumentCompact };
