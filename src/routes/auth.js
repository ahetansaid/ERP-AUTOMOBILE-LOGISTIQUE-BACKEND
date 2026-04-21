const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getPool } = require('../config/database');
const { prisma } = require('../lib/prisma');
const { sendMail } = require('../lib/mailer');
const {
  generateSecret,
  buildOtpAuthUrl,
  generateQrDataUrl,
  verifyToken,
} = require('../lib/twofa');
const { JWT_SECRET, JWT_REFRESH_SECRET, authMiddleware } = require('../middleware/auth');

const router = express.Router();
const EXPIRES_IN = '30m';
const REFRESH_EXPIRES = '7d';
const RESET_TOKEN_TTL_MIN = 60;

function issueTokens(user) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId ?? user.company_id,
  };
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? user.first_name,
      lastName: user.lastName ?? user.last_name,
      role: user.role,
      companyId: user.companyId ?? user.company_id,
    },
    accessToken,
    refreshToken,
    expiresIn: 30 * 60,
  };
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis', statusCode: 400 });
    }
    const user = await prisma.user.findFirst({
      where: { email, isActive: true },
    });
    if (!user) {
      return res.status(401).json({ message: 'Identifiants incorrects', statusCode: 401 });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Identifiants incorrects', statusCode: 401 });
    }

    // Si 2FA activé, retourner un challenge (JWT court lived, 5 min)
    if (user.twoFaEnabled) {
      const twoFactorToken = jwt.sign(
        { id: user.id, type: '2fa-challenge' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.status(200).json({
        requiresTwoFactor: true,
        twoFactorToken,
      });
    }

    return res.status(200).json(issueTokens(user));
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * POST /auth/2fa/verify
 * Body: { twoFactorToken, code }
 * Complète le login quand le user a la 2FA activée.
 */
router.post('/2fa/verify', async (req, res) => {
  try {
    const { twoFactorToken, code } = req.body || {};
    if (!twoFactorToken || !code) {
      return res
        .status(400)
        .json({ message: 'twoFactorToken et code requis', statusCode: 400 });
    }
    let decoded;
    try {
      decoded = jwt.verify(twoFactorToken, JWT_SECRET);
    } catch {
      return res
        .status(401)
        .json({ message: 'Challenge invalide ou expiré', statusCode: 401 });
    }
    if (decoded.type !== '2fa-challenge') {
      return res.status(401).json({ message: 'Token invalide', statusCode: 401 });
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || !user.isActive || !user.twoFaEnabled || !user.twoFaSecret) {
      return res
        .status(401)
        .json({ message: '2FA non configurée', statusCode: 401 });
    }
    if (!verifyToken(code, user.twoFaSecret)) {
      return res.status(401).json({ message: 'Code incorrect', statusCode: 401 });
    }
    return res.status(200).json(issueTokens(user));
  } catch (err) {
    console.error('[2fa.verify]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * POST /auth/2fa/setup (auth required)
 * Génère un secret temporaire + QR code. L'utilisateur doit ensuite confirmer
 * avec un code via /auth/2fa/enable pour l'activer.
 */
router.post('/2fa/setup', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur introuvable', statusCode: 404 });
    }
    const secret = generateSecret();
    // Secret stocké en "pending" — on réutilise twoFaSecret tant que twoFaEnabled=false
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFaSecret: secret, twoFaEnabled: false },
    });
    const otpAuthUrl = buildOtpAuthUrl({ email: user.email, secret });
    const qrDataUrl = await generateQrDataUrl(otpAuthUrl);
    return res.status(200).json({
      secret,
      otpAuthUrl,
      qrDataUrl,
      issuer: process.env.TWO_FA_ISSUER || 'ParcAuto Manager',
    });
  } catch (err) {
    console.error('[2fa.setup]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * POST /auth/2fa/enable (auth required)
 * Body: { code }
 * Valide le code TOTP et active la 2FA pour l'utilisateur courant.
 */
router.post('/2fa/enable', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ message: 'code requis', statusCode: 400 });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.twoFaSecret) {
      return res.status(400).json({
        message: 'Configurez la 2FA via /auth/2fa/setup avant de l\'activer',
        statusCode: 400,
      });
    }
    if (!verifyToken(code, user.twoFaSecret)) {
      return res.status(401).json({ message: 'Code incorrect', statusCode: 401 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFaEnabled: true },
    });
    return res.status(200).json({ enabled: true });
  } catch (err) {
    console.error('[2fa.enable]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * POST /auth/2fa/disable (auth required)
 * Body: { code }
 * Exige le code courant pour désactiver (protège contre détournement de session).
 */
router.post('/2fa/disable', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body || {};
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur introuvable', statusCode: 404 });
    }
    if (!user.twoFaEnabled) {
      return res.status(200).json({ enabled: false });
    }
    if (!code || !verifyToken(code, user.twoFaSecret)) {
      return res.status(401).json({ message: 'Code incorrect', statusCode: 401 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFaEnabled: false, twoFaSecret: null },
    });
    return res.status(200).json({ enabled: false });
  } catch (err) {
    console.error('[2fa.disable]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * GET /auth/2fa/status (auth required)
 * Retourne l'état 2FA de l'utilisateur courant.
 */
router.get('/2fa/status', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { twoFaEnabled: true },
    });
    return res.status(200).json({ enabled: !!user?.twoFaEnabled });
  } catch (err) {
    console.error('[2fa.status]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ message: 'refreshToken requis', statusCode: 400 });
    }
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ message: 'Token invalide', statusCode: 401 });
    }
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, email, role, company_id FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
      [decoded.id]
    );
    if (!rows.length) {
      return res.status(401).json({ message: 'Utilisateur introuvable', statusCode: 401 });
    }
    const user = rows[0];
    const payload = { id: user.id, email: user.email, role: user.role, companyId: user.company_id };
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
    const expiresInSeconds = 30 * 60;
    return res.status(200).json({ accessToken, expiresIn: expiresInSeconds });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expiré ou invalide', statusCode: 401 });
    }
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/logout', (req, res) => {
  res.status(200).json({ message: 'Déconnexion réussie' });
});

/**
 * POST /auth/forgot-password
 * Body: { email }
 * Toujours renvoie 200 (pour ne pas divulguer l'existence d'un compte).
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ message: 'Email requis', statusCode: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { email, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    // Réponse générique même si l'utilisateur n'existe pas (anti-enum)
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60_000);

      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      });

      const base =
        process.env.FRONTEND_URL ||
        process.env.CORS_ORIGIN ||
        'http://localhost:3000';
      const resetUrl = `${base.replace(/\/$/, '')}/reset-password?token=${token}`;

      const userName =
        [user.firstName, user.lastName].filter(Boolean).join(' ') || null;

      // Envoi email en arrière-plan — on ne fait pas attendre l'utilisateur
      sendMail({
        to: user.email,
        subject: 'Réinitialisation de votre mot de passe',
        template: 'reset-password',
        data: { userName, resetUrl, expiresInMinutes: RESET_TOKEN_TTL_MIN },
        resource: 'users',
        resourceId: user.id,
      }).catch((err) => console.error('[forgot-password.mail]', err.message));
    }

    return res.status(200).json({
      message:
        'Si un compte existe avec cette adresse, un email de réinitialisation a été envoyé.',
    });
  } catch (err) {
    console.error('[forgot-password]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * POST /auth/reset-password
 * Body: { token, newPassword }
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res
        .status(400)
        .json({ message: 'Token et nouveau mot de passe requis', statusCode: 400 });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({
        message: 'Le mot de passe doit contenir au moins 8 caractères',
        statusCode: 400,
      });
    }

    const entry = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!entry || entry.usedAt || entry.expiresAt < new Date()) {
      return res
        .status(400)
        .json({ message: 'Lien invalide ou expiré', statusCode: 400 });
    }

    const hash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: entry.userId },
        data: { password: hash },
      }),
      prisma.passwordResetToken.update({
        where: { token },
        data: { usedAt: new Date() },
      }),
      // Révoque également toutes les autres sessions actives de l'utilisateur
      prisma.session.updateMany({
        where: { userId: entry.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return res.status(200).json({
      message: 'Mot de passe mis à jour. Vous pouvez maintenant vous connecter.',
    });
  } catch (err) {
    console.error('[reset-password]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
