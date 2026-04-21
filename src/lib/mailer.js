/**
 * Service email — ParcAuto Manager
 *
 * Trois modes de transport, choisis via env :
 *   - EMAIL_PROVIDER=console  → log dans la console (dev par défaut)
 *   - EMAIL_PROVIDER=smtp     → SMTP générique (SMTP_* env vars)
 *   - EMAIL_PROVIDER=resend   → Resend API (RESEND_API_KEY)
 *
 * Les envois sont tracés dans la table `email_events` (fire-and-forget) pour
 * monitoring et debug.
 *
 * Usage :
 *   await sendMail({
 *     to: 'user@example.com',
 *     subject: 'Bienvenue',
 *     template: 'welcome',
 *     data: { userName: 'Jean' },
 *   });
 */

const nodemailer = require('nodemailer');
const { prisma } = require('./prisma');
const { renderTemplate } = require('../emails/render');

const FROM =
  process.env.EMAIL_FROM || 'ParcAuto Manager <no-reply@parcauto.app>';
const PROVIDER = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (PROVIDER === 'smtp') {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
  } else if (PROVIDER === 'resend') {
    // Resend propose un endpoint SMTP compatible (smtp.resend.com)
    transporter = nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: {
        user: 'resend',
        pass: process.env.RESEND_API_KEY,
      },
    });
  } else {
    // Mode "console" : dev sans creds, log les mails au lieu d'envoyer
    transporter = {
      sendMail: async (opts) => {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━ EMAIL (console mode) ━━━━━━━━━━━━━━━━━━━');
        console.log('From    :', opts.from);
        console.log('To      :', opts.to);
        console.log('Subject :', opts.subject);
        console.log('Text    :', (opts.text || '').slice(0, 500));
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return { messageId: `console-${Date.now()}@parcauto.local` };
      },
    };
  }

  return transporter;
}

/**
 * Envoie un email via le template indiqué. Enregistre l'événement en DB.
 */
async function sendMail({
  to,
  subject,
  template,
  data = {},
  companyId = null,
  resource = null,
  resourceId = null,
  attachments = undefined,
}) {
  const { html, text } = renderTemplate(template, data);
  const tr = getTransporter();

  let status = 'PENDING';
  let providerId = null;
  let errorMsg = null;

  try {
    const info = await tr.sendMail({
      from: FROM,
      to,
      subject,
      html,
      text,
      attachments,
    });
    status = 'SENT';
    providerId = info.messageId || null;
  } catch (err) {
    status = 'FAILED';
    errorMsg = err.message || String(err);
    console.error('[mailer]', errorMsg);
  }

  // Trace (fire-and-forget) dans email_events
  prisma.emailEvent
    .create({
      data: {
        companyId: companyId ?? null,
        toEmail: to,
        subject,
        template,
        status,
        providerId,
        errorMsg,
        resource,
        resourceId,
        sentAt: status === 'SENT' ? new Date() : null,
      },
    })
    .catch((err) => console.error('[mailer.trace]', err.message));

  if (status === 'FAILED') {
    throw new Error(errorMsg || 'Échec envoi email');
  }

  return { status, providerId };
}

module.exports = { sendMail };
