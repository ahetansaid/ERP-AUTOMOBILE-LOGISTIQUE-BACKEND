/**
 * Service PDF — rend un document (facture/reçu/devis/proforma) en Buffer PDF.
 *
 * Usage :
 *   const buffer = await renderDocumentPdf(data, { template: 'minimal' });
 *   res.setHeader('Content-Type', 'application/pdf');
 *   res.send(buffer);
 */

const ReactPDF = require('@react-pdf/renderer');
const { buildInvoiceMinimalDocument } = require('./templates/invoiceMinimal');

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function renderDocumentPdf(data, options = {}) {
  const template = options.template || 'minimal';
  let doc;
  switch (template) {
    case 'minimal':
    default:
      doc = buildInvoiceMinimalDocument(data);
      break;
    // TODO: classic, gradient, compact — portés depuis les composants frontend
  }

  const stream = await ReactPDF.renderToStream(doc);
  return streamToBuffer(stream);
}

module.exports = { renderDocumentPdf };
