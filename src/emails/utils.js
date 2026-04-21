function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { escapeHtml, escapeHtmlAttr, stripHtml };
