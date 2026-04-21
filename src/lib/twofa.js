/**
 * 2FA TOTP — helpers autour de otplib.
 * Compatible Google Authenticator, Authy, 1Password, etc.
 */

const { authenticator } = require('otplib');
const qrcode = require('qrcode');

authenticator.options = { window: 1 }; // tolère ±30s de dérive

const ISSUER = process.env.TWO_FA_ISSUER || 'ParcAuto Manager';

function generateSecret() {
  return authenticator.generateSecret();
}

function buildOtpAuthUrl({ email, secret }) {
  return authenticator.keyuri(email, ISSUER, secret);
}

async function generateQrDataUrl(otpAuthUrl) {
  return qrcode.toDataURL(otpAuthUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
  });
}

function verifyToken(token, secret) {
  if (!token || !secret) return false;
  try {
    return authenticator.verify({ token: String(token).replace(/\s/g, ''), secret });
  } catch {
    return false;
  }
}

module.exports = {
  generateSecret,
  buildOtpAuthUrl,
  generateQrDataUrl,
  verifyToken,
};
