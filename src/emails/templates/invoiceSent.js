const { escapeHtml } = require('../utils');

module.exports = function invoiceSent({ clientName, invoiceNumber, amount, dueDate, payUrl }) {
  const name = clientName ? escapeHtml(clientName) : null;
  return {
    preheader: `Facture ${escapeHtml(invoiceNumber)} disponible.`,
    title: `Facture ${escapeHtml(invoiceNumber)}`,
    body: `
      <p>${name ? `Bonjour ${name},` : 'Bonjour,'}</p>
      <p>Vous trouverez en pièce jointe votre facture <strong>${escapeHtml(invoiceNumber)}</strong> pour un montant de <strong>${escapeHtml(amount)}</strong>${dueDate ? `, à régler avant le <strong>${escapeHtml(dueDate)}</strong>` : ''}.</p>
      ${payUrl ? `<p style="font-size:13px;color:#71717A;margin-top:12px;">Vous pouvez régler cette facture en ligne (carte ou mobile money) en cliquant sur le bouton ci-dessous.</p>` : ''}
    `,
    cta: payUrl ? { label: 'Payer en ligne', href: payUrl } : undefined,
  };
};
