/**
 * Modèle PDF « Classique Pro »
 *
 * Sobre et corporate : en-tête à deux colonnes, tableau détaillé avec quantités
 * et prix unitaires, totaux alignés à droite, bloc de mentions légales.
 * Destiné aux clients B2B et aux exports comptables.
 */

const React = require('react');
const { Document, Page, View, Text, StyleSheet } = require('@react-pdf/renderer');
const {
  KIND_LABEL, fmtAmount, fmtNumber, fmtDate, computeTotals, footerNote,
} = require('./_shared');

const e = React.createElement;
const INK = '#18181B';
const MUTED = '#71717A';
const LINE = '#D4D4D8';

const s = StyleSheet.create({
  page: { padding: 44, fontSize: 9.5, fontFamily: 'Helvetica', color: INK },

  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logoBox: { width: 46, height: 46, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 18 },
  issuer: { marginTop: 8, fontFamily: 'Helvetica-Bold', fontSize: 11 },
  issuerLine: { fontSize: 8.5, color: MUTED, marginTop: 1.5 },

  docBlock: { alignItems: 'flex-end' },
  docTitle: { fontFamily: 'Helvetica-Bold', fontSize: 15, letterSpacing: 0.5 },
  docMeta: { fontSize: 9, color: MUTED, marginTop: 3 },

  rule: { height: 1.4, backgroundColor: INK, marginTop: 16, marginBottom: 14 },
  thinRule: { height: 1, backgroundColor: LINE, marginVertical: 10 },

  parties: { flexDirection: 'row', gap: 28 },
  party: { flex: 1 },
  partyLabel: {
    fontSize: 7.5, color: MUTED, letterSpacing: 1.1, marginBottom: 4, fontFamily: 'Helvetica-Bold',
  },
  partyName: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  partyLine: { fontSize: 8.5, color: '#3F3F46', marginTop: 1.5 },

  thead: {
    flexDirection: 'row', backgroundColor: '#F4F4F5',
    paddingVertical: 6, paddingHorizontal: 8, marginTop: 16,
  },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 0.8 },
  row: {
    flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: '#E4E4E7',
  },
  cDesc: { flex: 1 },
  cQty: { width: 42, textAlign: 'right' },
  cPu: { width: 82, textAlign: 'right' },
  cTot: { width: 92, textAlign: 'right' },
  lineLabel: { fontSize: 9.5 },
  lineSub: { fontSize: 7.5, color: MUTED, marginTop: 1.5 },

  totals: { marginTop: 14, alignItems: 'flex-end' },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', width: 220, paddingVertical: 3 },
  tLabel: { fontSize: 9, color: MUTED },
  tValue: { fontSize: 9 },
  grand: {
    flexDirection: 'row', justifyContent: 'space-between', width: 220,
    borderTopWidth: 1.4, borderTopColor: INK, marginTop: 5, paddingTop: 6,
  },
  grandLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10.5 },
  grandValue: { fontFamily: 'Helvetica-Bold', fontSize: 12 },

  legal: {
    marginTop: 26, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10,
    fontSize: 7.5, color: MUTED, lineHeight: 1.5,
  },
  sign: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26 },
  signBox: { width: 170 },
  signLine: { borderTopWidth: 1, borderTopColor: LINE, marginTop: 34, paddingTop: 3, fontSize: 7.5, color: MUTED },
});

function buildDocumentClassic(data) {
  const accent = (data.brand && data.brand.color) || '#4F46E5';
  const currency = data.currency || 'FCFA';
  const { lines, subtotal, vatRate, vat, total } = computeTotals(data);
  const brandName = (data.brand && data.brand.name) || data.from.name;
  const note = footerNote(data);

  return e(
    Document, null,
    e(Page, { size: 'A4', style: s.page },

      e(View, { style: s.head },
        e(View, { style: { flex: 1 } },
          e(View, { style: [s.logoBox, { backgroundColor: accent }] },
            e(Text, { style: s.logoText }, (brandName || '?')[0])),
          e(Text, { style: s.issuer }, brandName),
          data.from.address ? e(Text, { style: s.issuerLine }, data.from.address) : null,
          e(Text, { style: s.issuerLine },
            [data.from.city, data.from.country].filter(Boolean).join(', ')),
          data.from.phone ? e(Text, { style: s.issuerLine }, `Tél. ${data.from.phone}`) : null,
          data.from.legalNumber ? e(Text, { style: s.issuerLine }, `IFU / RCCM ${data.from.legalNumber}`) : null
        ),
        e(View, { style: s.docBlock },
          e(Text, { style: s.docTitle }, (KIND_LABEL[data.kind] || 'Document').toUpperCase()),
          e(Text, { style: s.docMeta }, `N° ${data.number || '—'}`),
          e(Text, { style: s.docMeta }, `Date : ${fmtDate(data.issuedAt, 'short')}`),
          data.dueDate ? e(Text, { style: s.docMeta }, `Échéance : ${fmtDate(data.dueDate, 'short')}`) : null
        )
      ),

      e(View, { style: s.rule }),

      e(View, { style: s.parties },
        e(View, { style: s.party },
          e(Text, { style: s.partyLabel }, 'ÉMETTEUR'),
          e(Text, { style: s.partyName }, data.from.name),
          data.from.address ? e(Text, { style: s.partyLine }, data.from.address) : null,
          e(Text, { style: s.partyLine },
            [data.from.city, data.from.country].filter(Boolean).join(', '))
        ),
        e(View, { style: s.party },
          e(Text, { style: s.partyLabel }, 'DESTINATAIRE'),
          e(Text, { style: s.partyName }, data.to.name),
          data.to.address ? e(Text, { style: s.partyLine }, data.to.address) : null,
          e(Text, { style: s.partyLine },
            [data.to.city, data.to.country].filter(Boolean).join(', ')),
          data.to.phone ? e(Text, { style: s.partyLine }, `Tél. ${data.to.phone}`) : null,
          data.to.email ? e(Text, { style: s.partyLine }, data.to.email) : null
        )
      ),

      e(View, { style: s.thead },
        e(Text, { style: [s.th, s.cDesc] }, 'DÉSIGNATION'),
        e(Text, { style: [s.th, s.cQty] }, 'QTÉ'),
        e(Text, { style: [s.th, s.cPu] }, `P.U. (${currency})`),
        e(Text, { style: [s.th, s.cTot] }, `MONTANT (${currency})`)
      ),

      ...lines.map((l, i) =>
        e(View, { key: i, style: s.row },
          e(View, { style: s.cDesc },
            e(Text, { style: s.lineLabel }, l.label),
            l.sublabel ? e(Text, { style: s.lineSub }, l.sublabel) : null),
          e(Text, { style: s.cQty }, String(l.quantity)),
          e(Text, { style: s.cPu }, fmtNumber(l.unitPrice)),
          e(Text, { style: s.cTot }, fmtNumber(l.total))
        )
      ),

      e(View, { style: s.totals },
        e(View, { style: s.tRow },
          e(Text, { style: s.tLabel }, 'Total HT'),
          e(Text, { style: s.tValue }, fmtAmount(subtotal, currency))),
        vatRate > 0
          ? e(View, { style: s.tRow },
              e(Text, { style: s.tLabel }, `TVA ${vatRate} %`),
              e(Text, { style: s.tValue }, fmtAmount(vat, currency)))
          : null,
        e(View, { style: s.grand },
          e(Text, { style: s.grandLabel }, vatRate > 0 ? 'TOTAL TTC' : 'TOTAL'),
          e(Text, { style: [s.grandValue, { color: accent }] }, fmtAmount(total, currency)))
      ),

      e(View, { style: s.sign },
        e(View, { style: s.signBox },
          e(Text, { style: s.signLine }, 'Cachet et signature de l’émetteur')),
        e(View, { style: s.signBox },
          e(Text, { style: s.signLine }, 'Signature du destinataire'))
      ),

      e(View, { style: s.legal },
        note ? e(Text, null, note) : null,
        data.notes ? e(Text, { style: { marginTop: 3 } }, data.notes) : null,
        e(Text, { style: { marginTop: 3 } },
          `${brandName}${data.from.legalNumber ? ` — IFU / RCCM ${data.from.legalNumber}` : ''}. ` +
          'Document commercial émis par ParcAuto Manager.')
      )
    )
  );
}

module.exports = { buildDocumentClassic };
