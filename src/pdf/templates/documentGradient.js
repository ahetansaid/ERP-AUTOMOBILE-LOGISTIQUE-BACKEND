/**
 * Modèle PDF « Gradient Brand »
 *
 * Orienté marque : bandeau coloré en tête, carte de détail, total mis en avant
 * dans un encadré, bande sombre en pied. Destiné aux documents envoyés par
 * e-mail, où l'identité visuelle porte autant que le contenu.
 *
 * @react-pdf/renderer ne gère pas les dégradés : le bandeau est composé de
 * bandes successives d'opacité décroissante, ce qui donne le même effet.
 */

const React = require('react');
const { Document, Page, View, Text, StyleSheet } = require('@react-pdf/renderer');
const { KIND_LABEL, fmtAmount, fmtDate, computeTotals, footerNote } = require('./_shared');

const e = React.createElement;
const INK = '#18181B';
const MUTED = '#71717A';

const s = StyleSheet.create({
  page: { paddingBottom: 0, fontSize: 9.5, fontFamily: 'Helvetica', color: INK },
  body: { paddingHorizontal: 44, paddingTop: 26 },

  band: { flexDirection: 'row', height: 8 },
  bandSeg: { flex: 1, height: 8 },

  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoBox: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 15 },
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  brandSub: { fontSize: 8, color: MUTED, marginTop: 1 },
  docNo: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  docDate: { fontSize: 8.5, color: MUTED, marginTop: 2, textAlign: 'right' },

  title: { fontSize: 26, fontFamily: 'Helvetica-Bold', marginTop: 22 },

  metaRow: { flexDirection: 'row', gap: 30, marginTop: 16 },
  metaCol: { flex: 1 },
  metaLabel: { fontSize: 7.5, color: MUTED, letterSpacing: 1, fontFamily: 'Helvetica-Bold' },
  metaValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 3 },
  metaLine: { fontSize: 8.5, color: '#3F3F46', marginTop: 1.5 },
  pill: {
    marginTop: 4, alignSelf: 'flex-start', borderRadius: 8,
    paddingVertical: 2.5, paddingHorizontal: 8, fontSize: 8,
  },

  card: {
    marginTop: 20, borderRadius: 10, borderWidth: 1, borderColor: '#E4E4E7', overflow: 'hidden',
  },
  cardHead: { paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#FAFAFA' },
  cardHeadText: { fontSize: 7.5, letterSpacing: 1, color: MUTED, fontFamily: 'Helvetica-Bold' },
  item: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#F4F4F5',
  },
  itemLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  itemSub: { fontSize: 8, color: MUTED, marginTop: 2 },
  itemQty: { fontSize: 8, color: MUTED, marginTop: 3 },
  itemAmount: { fontSize: 10.5, fontFamily: 'Helvetica-Bold' },

  totalCard: { marginTop: 20, borderRadius: 12, padding: 16, alignItems: 'flex-end' },
  totalLabel: { color: '#FFFFFF', fontSize: 9, opacity: 0.85 },
  totalValue: { color: '#FFFFFF', fontSize: 22, fontFamily: 'Helvetica-Bold', marginTop: 3 },
  subRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    width: 200, alignSelf: 'flex-end', paddingVertical: 2.5,
  },
  subLabel: { fontSize: 8.5, color: MUTED },

  note: { marginTop: 18, fontSize: 8.5, color: '#3F3F46', lineHeight: 1.5 },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingVertical: 14, paddingHorizontal: 44, backgroundColor: INK,
  },
  footerText: { color: '#A1A1AA', fontSize: 7.5, lineHeight: 1.5 },
  footerStrong: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
});

function buildDocumentGradient(data) {
  const accent = (data.brand && data.brand.color) || '#4F46E5';
  const currency = data.currency || 'FCFA';
  const { lines, subtotal, vatRate, vat, total } = computeTotals(data);
  const brandName = (data.brand && data.brand.name) || data.from.name;
  const note = footerNote(data);

  // Dégradé simulé : 6 segments d'opacité décroissante.
  const band = e(View, { style: s.band },
    ...[1, 0.86, 0.72, 0.58, 0.44, 0.3].map((o, i) =>
      e(View, { key: i, style: [s.bandSeg, { backgroundColor: accent, opacity: o }] })));

  return e(
    Document, null,
    e(Page, { size: 'A4', style: s.page },
      band,
      e(View, { style: s.body },

        e(View, { style: s.head },
          e(View, { style: s.brandRow },
            e(View, { style: [s.logoBox, { backgroundColor: accent }] },
              e(Text, { style: s.logoText }, (brandName || '?')[0])),
            e(View, null,
              e(Text, { style: s.brandName }, brandName),
              e(Text, { style: s.brandSub },
                [data.from.city, data.from.country].filter(Boolean).join(' · ')))),
          e(View, null,
            e(Text, { style: s.docNo }, data.number || '—'),
            e(Text, { style: s.docDate }, fmtDate(data.issuedAt)))
        ),

        e(Text, { style: [s.title, { color: accent }] }, KIND_LABEL[data.kind] || 'Document'),

        e(View, { style: s.metaRow },
          e(View, { style: s.metaCol },
            e(Text, { style: s.metaLabel }, 'FACTURÉ À'),
            e(Text, { style: s.metaValue }, data.to.name),
            data.to.address ? e(Text, { style: s.metaLine }, data.to.address) : null,
            e(Text, { style: s.metaLine },
              [data.to.city, data.to.country].filter(Boolean).join(', ')),
            data.to.phone ? e(Text, { style: s.metaLine }, data.to.phone) : null),
          e(View, { style: s.metaCol },
            e(Text, { style: s.metaLabel }, 'STATUT'),
            e(Text, {
              style: [s.pill, { backgroundColor: `${accent}22`, color: accent }],
            }, data.status || (data.kind === 'RECU' ? 'Encaissé' : 'En attente')),
            data.dueDate
              ? e(Text, { style: [s.metaLine, { marginTop: 7 }] },
                  `Échéance ${fmtDate(data.dueDate, 'short')}`)
              : null)
        ),

        e(View, { style: s.card },
          e(View, { style: s.cardHead }, e(Text, { style: s.cardHeadText }, 'DÉTAIL')),
          ...lines.map((l, i) =>
            e(View, { key: i, style: s.item },
              e(View, { style: { flex: 1, paddingRight: 12 } },
                e(Text, { style: s.itemLabel }, l.label),
                l.sublabel ? e(Text, { style: s.itemSub }, l.sublabel) : null,
                e(Text, { style: s.itemQty },
                  `${l.quantity} × ${fmtAmount(l.unitPrice, currency)}`)),
              e(Text, { style: s.itemAmount }, fmtAmount(l.total, currency))))
        ),

        vatRate > 0
          ? e(View, { style: { marginTop: 12 } },
              e(View, { style: s.subRow },
                e(Text, { style: s.subLabel }, 'Sous-total'),
                e(Text, { style: s.subLabel }, fmtAmount(subtotal, currency))),
              e(View, { style: s.subRow },
                e(Text, { style: s.subLabel }, `TVA ${vatRate} %`),
                e(Text, { style: s.subLabel }, fmtAmount(vat, currency))))
          : null,

        e(View, { style: [s.totalCard, { backgroundColor: accent }] },
          e(Text, { style: s.totalLabel },
            data.kind === 'RECU' ? 'Montant encaissé' : 'Total à payer'),
          e(Text, { style: s.totalValue }, fmtAmount(total, currency))),

        note ? e(Text, { style: s.note }, note) : null,
        data.notes ? e(Text, { style: s.note }, data.notes) : null
      ),

      e(View, { style: s.footer },
        e(Text, { style: s.footerStrong }, brandName),
        e(Text, { style: s.footerText },
          [data.from.address, data.from.city, data.from.country].filter(Boolean).join(' · ')),
        data.from.legalNumber
          ? e(Text, { style: s.footerText }, `IFU / RCCM ${data.from.legalNumber}`)
          : null)
    )
  );
}

module.exports = { buildDocumentGradient };
