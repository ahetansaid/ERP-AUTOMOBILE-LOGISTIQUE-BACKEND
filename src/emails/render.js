/**
 * Moteur de templates emails — simple & dépendance-zéro.
 * Les templates sont des fonctions qui prennent `data` et renvoient
 * `{ title, body, text?, cta?, preheader? }`. Un layout commun habille tous
 * les emails avec la charte ParcAuto.
 */

const { escapeHtml, escapeHtmlAttr, stripHtml } = require('./utils');

const templates = {
  'reset-password': require('./templates/resetPassword'),
  welcome: require('./templates/welcome'),
  'invoice-sent': require('./templates/invoiceSent'),
};

function layout({ preheader = '', title, body, cta }) {
  const brand = '#6366F1';
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#FAFAFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#18181B;">
<span style="display:none !important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FAFAFA;"><tr><td align="center" style="padding:40px 16px;">
  <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:16px;overflow:hidden;">
    <tr><td style="padding:24px 32px;background:linear-gradient(135deg,${brand} 0%,#8B5CF6 100%);">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
        <td style="vertical-align:middle;">
          <span style="display:inline-block;width:36px;height:36px;background:#FFFFFF;border-radius:8px;color:${brand};font-weight:700;font-size:18px;text-align:center;line-height:36px;">P</span>
        </td>
        <td style="padding-left:12px;vertical-align:middle;">
          <span style="color:#FFFFFF;font-size:15px;font-weight:600;letter-spacing:-0.01em;">ParcAuto Manager</span>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:32px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;letter-spacing:-0.02em;color:#18181B;">${escapeHtml(title)}</h1>
      <div style="font-size:15px;line-height:1.6;color:#3F3F46;">${body}</div>
      ${cta ? `<div style="margin-top:28px;"><a href="${escapeHtmlAttr(cta.href)}" style="display:inline-block;background:${brand};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:10px;">${escapeHtml(cta.label)}</a></div>` : ''}
    </td></tr>
    <tr><td style="padding:20px 32px;background:#FAFAFA;border-top:1px solid #E4E4E7;">
      <p style="margin:0;font-size:12px;color:#71717A;">Ce message a été envoyé par ParcAuto Manager. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message en toute sécurité.</p>
    </td></tr>
  </table>
  <p style="margin:16px 0 0;font-size:11px;color:#A1A1AA;">© ${new Date().getFullYear()} Drwintech SaaS Solutions</p>
</td></tr></table>
</body></html>`;
}

function renderTemplate(name, data) {
  const tpl = templates[name];
  if (!tpl) {
    throw new Error(`Template email inconnu : ${name}`);
  }
  const { title, body, text, cta, preheader } = tpl(data);
  return {
    html: layout({ preheader, title, body, cta }),
    text: text || stripHtml(body),
  };
}

module.exports = { renderTemplate, layout };
