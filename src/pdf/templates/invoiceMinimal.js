/**
 * Template PDF "Moderne Minimal"
 * Écrit en React.createElement (pas de JSX) pour fonctionner en CJS sans Babel.
 * Utilise les polices par défaut de @react-pdf/renderer (Helvetica).
 */

const React = require('react');
const { Document, Page, View, Text, StyleSheet } = require('@react-pdf/renderer');

const e = React.createElement;

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 48,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#18181B',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 32,
    fontFamily: 'Helvetica-Bold',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 10,
    color: '#71717A',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBoxText: {
    color: '#fff',
    fontFamily: 'Helvetica-Bold',
    fontSize: 16,
  },
  brandName: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  divider: {
    marginTop: 24,
    marginBottom: 24,
    height: 1,
    backgroundColor: '#F4F4F5',
  },
  partiesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 24,
  },
  partyCol: {
    flex: 1,
  },
  partyLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#A1A1AA',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  partyName: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
  },
  partyText: {
    color: '#52525B',
    marginTop: 2,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F4F4F5',
  },
  lineLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  lineSub: {
    marginTop: 2,
    color: '#A1A1AA',
    fontSize: 9,
  },
  lineMeta: {
    marginTop: 4,
    color: '#71717A',
    fontSize: 9,
  },
  lineAmount: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
  },
  totalsBox: {
    marginTop: 20,
    alignSelf: 'flex-end',
    width: 260,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    color: '#52525B',
  },
  totalBox: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  totalLabel: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  totalValue: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
  },
  footer: {
    marginTop: 32,
    fontSize: 9,
    color: '#71717A',
  },
});

function fmtAmount(n, currency) {
  const rounded = Math.round(Number(n) || 0);
  const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} ${currency || 'FCFA'}`;
}

function fmtDate(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

const KIND_LABEL = {
  FACTURE: 'Facture',
  DEVIS: 'Devis',
  PROFORMA: 'Pro forma',
  RECU: 'Reçu',
};

function buildInvoiceMinimalDocument(data) {
  const accent = (data.brand && data.brand.color) || '#6366F1';
  const currency = data.currency || 'FCFA';

  const lines = (data.lines || []).map((l) => ({
    ...l,
    total: l.total != null ? l.total : (l.quantity || 0) * (l.unitPrice || 0),
  }));
  const subtotal = lines.reduce((s, l) => s + (l.total || 0), 0);
  const vatRate = data.vatRate || 0;
  const vat = (vatRate / 100) * subtotal;
  const total = subtotal + vat;

  return e(
    Document,
    null,
    e(
      Page,
      { size: 'A4', style: styles.page },
      // Header
      e(
        View,
        { style: styles.header },
        e(
          View,
          null,
          e(Text, { style: [styles.title, { color: accent }] }, KIND_LABEL[data.kind] || 'Document'),
          e(Text, { style: styles.subtitle }, `${data.number || ''} · ${fmtDate(data.issuedAt)}`)
        ),
        e(
          View,
          { style: styles.brandRow },
          e(
            View,
            { style: [styles.brandBox, { backgroundColor: accent }] },
            e(
              Text,
              { style: styles.brandBoxText },
              ((data.brand && data.brand.name) || data.from.name || '?')[0]
            )
          ),
          e(
            View,
            null,
            e(Text, { style: styles.brandName }, (data.brand && data.brand.name) || data.from.name),
            e(
              Text,
              { style: styles.subtitle },
              [data.from.city, data.from.country].filter(Boolean).join(' · ')
            )
          )
        )
      ),
      e(View, { style: styles.divider }),

      // Parties (À / De)
      e(
        View,
        { style: styles.partiesRow },
        e(
          View,
          { style: styles.partyCol },
          e(Text, { style: styles.partyLabel }, 'À'),
          e(Text, { style: styles.partyName }, data.to.name),
          data.to.address ? e(Text, { style: styles.partyText }, data.to.address) : null,
          data.to.city || data.to.country
            ? e(
                Text,
                { style: styles.partyText },
                [data.to.city, data.to.country].filter(Boolean).join(', ')
              )
            : null,
          data.to.phone ? e(Text, { style: styles.partyText }, data.to.phone) : null,
          data.to.email ? e(Text, { style: styles.partyText }, data.to.email) : null
        ),
        e(
          View,
          { style: styles.partyCol },
          e(Text, { style: styles.partyLabel }, 'De'),
          e(Text, { style: styles.partyName }, data.from.name),
          data.from.address ? e(Text, { style: styles.partyText }, data.from.address) : null,
          data.from.city || data.from.country
            ? e(
                Text,
                { style: styles.partyText },
                [data.from.city, data.from.country].filter(Boolean).join(', ')
              )
            : null,
          data.from.phone ? e(Text, { style: styles.partyText }, data.from.phone) : null,
          data.from.legalNumber
            ? e(Text, { style: styles.partyText }, `IFU ${data.from.legalNumber}`)
            : null
        )
      ),

      e(View, { style: styles.divider }),

      // Lines
      e(
        View,
        null,
        ...lines.map((line, i) =>
          e(
            View,
            { key: i, style: styles.line },
            e(
              View,
              { style: { flex: 1 } },
              e(Text, { style: styles.lineLabel }, line.label),
              line.sublabel ? e(Text, { style: styles.lineSub }, line.sublabel) : null,
              e(
                Text,
                { style: styles.lineMeta },
                `${line.quantity} × ${fmtAmount(line.unitPrice, currency)}`
              )
            ),
            e(Text, { style: styles.lineAmount }, fmtAmount(line.total, currency))
          )
        )
      ),

      // Totals
      e(
        View,
        { style: styles.totalsBox },
        e(
          View,
          { style: styles.totalsRow },
          e(Text, null, 'Sous-total'),
          e(Text, null, fmtAmount(subtotal, currency))
        ),
        vatRate > 0
          ? e(
              View,
              { style: styles.totalsRow },
              e(Text, null, `TVA ${vatRate}%`),
              e(Text, null, fmtAmount(vat, currency))
            )
          : null,
        e(
          View,
          { style: [styles.totalBox, { backgroundColor: accent }] },
          e(Text, { style: styles.totalLabel }, 'Total'),
          e(Text, { style: styles.totalValue }, fmtAmount(total, currency))
        )
      ),

      // Footer
      e(
        View,
        { style: styles.footer },
        data.kind === 'FACTURE' && data.dueDate
          ? e(Text, null, `À régler avant le ${fmtDate(data.dueDate)}.`)
          : null,
        data.kind === 'DEVIS' && data.validUntil
          ? e(Text, null, `Devis valable jusqu'au ${fmtDate(data.validUntil)}.`)
          : null,
        data.notes ? e(Text, { style: { marginTop: 6 } }, data.notes) : null
      )
    )
  );
}

module.exports = { buildInvoiceMinimalDocument };
