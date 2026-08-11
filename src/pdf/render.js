/**
 * Service PDF — rend un document (facture / reçu / devis / proforma) en Buffer.
 *
 * Quatre modèles, tous alimentés par le même contrat de données décrit dans
 * templates/_shared.js :
 *
 *   minimal  — moderne, épuré (défaut)
 *   classic  — corporate, tableau détaillé, mentions légales
 *   gradient — orienté marque, pour l'envoi par e-mail
 *   compact  — ticket 80 mm (ou 58 mm), impression thermique
 *
 * Usage :
 *   const buffer = await renderDocumentPdf(data, { template: 'classic' });
 *   res.setHeader('Content-Type', 'application/pdf');
 *   res.send(buffer);
 */

const ReactPDF = require('@react-pdf/renderer');
const { buildInvoiceMinimalDocument } = require('./templates/invoiceMinimal');
const { buildDocumentClassic } = require('./templates/documentClassic');
const { buildDocumentGradient } = require('./templates/documentGradient');
const { buildDocumentCompact } = require('./templates/documentCompact');

const TEMPLATES = {
  minimal: (data) => buildInvoiceMinimalDocument(data),
  classic: (data) => buildDocumentClassic(data),
  gradient: (data) => buildDocumentGradient(data),
  compact: (data, opts) => buildDocumentCompact(data, opts),
};

const AVAILABLE_TEMPLATES = Object.keys(TEMPLATES);

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function renderDocumentPdf(data, options = {}) {
  const name = String(options.template || 'minimal').toLowerCase();
  // Modèle inconnu : on retombe sur `minimal` plutôt que d'échouer — un PDF
  // dans le mauvais habillage vaut mieux qu'une erreur 500 devant le client.
  const build = TEMPLATES[name] || TEMPLATES.minimal;
  const doc = build(data, options);
  const stream = await ReactPDF.renderToStream(doc);
  return streamToBuffer(stream);
}

module.exports = { renderDocumentPdf, AVAILABLE_TEMPLATES };
