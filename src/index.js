require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const vehiclesRoutes = require('./routes/vehicles');
const purchasesRoutes = require('./routes/purchases');
const suppliersRoutes = require('./routes/suppliers');
const clientsRoutes = require('./routes/clients');
const chargesRoutes = require('./routes/charges');
const devisRoutes = require('./routes/devis');
const invoicesRoutes = require('./routes/invoices');
const receiptsRoutes = require('./routes/receipts');
const treasuryRoutes = require('./routes/treasury');
const proformasRoutes = require('./routes/proformas');
const reportsRoutes = require('./routes/reports');
const transitRoutes = require('./routes/transit');
const usersRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const notificationsRoutes = require('./routes/notifications');
const uploadsRoutes = require('./routes/uploads');
const ledgerRoutes = require('./routes/ledger');
const partnersRoutes = require('./routes/partners');
const searchRoutes = require('./routes/search');
const rapportsRoutes = require('./routes/reportsPeriodiques');
const alertesRoutes = require('./routes/alertes');
const fraisRoutes = require('./routes/purchaseCosts');
const installationRoutes = require('./routes/installation');
const { authMiddleware } = require('./middleware/auth');
const { tenantScope } = require('./middleware/tenant');
const { attachAudit } = require('./middleware/audit');
const { withContext } = require('./lib/context');
const { logger } = require('./lib/logger');

const log = logger('http');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS_ORIGIN peut contenir plusieurs origines séparées par des virgules,
// ou "*" pour tout autoriser. On reflète l'origine de la requête quand elle
// est autorisée (compatible avec credentials: true, contrairement à un "*"
// brut que les navigateurs rejettent).
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    // Requêtes sans Origin (curl, server-to-server, health checks) : autorisées.
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`Origine non autorisée par CORS : ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// En-têtes de sécurité (HSTS, X-Content-Type-Options, etc.).
// crossOriginResourcePolicy désactivé : API consommée cross-origin (frontend).
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
// Derrière le proxy Vercel : nécessaire pour que le rate-limit identifie l'IP réelle.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(attachAudit);

// Rate limiting agressif sur l'authentification (anti brute-force / credential stuffing).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20, // 20 tentatives / IP / fenêtre
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de tentatives. Réessayez dans quelques minutes.', statusCode: 429 },
});

// Chaîne des routes authentifiées :
//   authMiddleware → qui es-tu
//   tenantScope    → sur quelle société tu opères
//   withContext    → ouvre le contexte que l'extension Prisma consulte pour
//                    appliquer le filtre société et écrire le journal d'audit
// L'ordre est significatif : withContext lit ce que les deux précédents posent.
const guarded = [authMiddleware, tenantScope, withContext];

function mount(prefix) {
  app.use(`${prefix}/auth`, authLimiter, authRoutes);
  app.use(`${prefix}/dashboard`, ...guarded, dashboardRoutes);
  app.use(`${prefix}/vehicles`, ...guarded, vehiclesRoutes);
  app.use(`${prefix}/purchases`, ...guarded, purchasesRoutes);
  app.use(`${prefix}/suppliers`, ...guarded, suppliersRoutes);
  app.use(`${prefix}/clients`, ...guarded, clientsRoutes);
  app.use(`${prefix}/charges`, ...guarded, chargesRoutes);
  app.use(`${prefix}/devis`, ...guarded, devisRoutes);
  app.use(`${prefix}/invoices`, ...guarded, invoicesRoutes);
  app.use(`${prefix}/receipts`, ...guarded, receiptsRoutes);
  app.use(`${prefix}/treasury`, ...guarded, treasuryRoutes);
  app.use(`${prefix}/proformas`, ...guarded, proformasRoutes);
  app.use(`${prefix}/reports`, ...guarded, reportsRoutes);
  app.use(`${prefix}/transit`, ...guarded, transitRoutes);
  app.use(`${prefix}/users`, ...guarded, usersRoutes);
  app.use(`${prefix}/settings`, ...guarded, settingsRoutes);
  app.use(`${prefix}/notifications`, ...guarded, notificationsRoutes);
  app.use(`${prefix}/uploads`, ...guarded, uploadsRoutes);
  app.use(`${prefix}/ledger`, ...guarded, ledgerRoutes);
  app.use(`${prefix}/partners`, ...guarded, partnersRoutes);
  app.use(`${prefix}/search`, ...guarded, searchRoutes);
  app.use(`${prefix}/rapports`, ...guarded, rapportsRoutes);
  app.use(`${prefix}/alertes`, ...guarded, alertesRoutes);
  app.use(`${prefix}/frais-conteneur`, ...guarded, fraisRoutes);
  app.use(`${prefix}/installation`, ...guarded, installationRoutes);
}

mount('');
mount('/api');

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Dernier filet. L'identifiant de corrélation est renvoyé au client : c'est ce
// qui permet, à partir d'une capture d'écran, de retrouver la requête, ses
// écritures et son journal d'audit — tous portent le même identifiant.
app.use((err, req, res, next) => {
  log.error('requête en échec', {
    err,
    method: req.method,
    // `req.path` et non `req.originalUrl` : la query string peut porter
    // `?token=<JWT>`, utilisé pour les téléchargements ouverts par window.open.
    // L'écrire dans les journaux y déposerait un jeton valide en clair.
    path: req.path,
    userId: req.user?.id ?? null,
  });
  res.status(500).json({
    message: 'Erreur serveur',
    statusCode: 500,
    correlationId: req.correlationId ?? null,
  });
});

// En environnement serverless (Vercel), l'app est importée par api/index.js
// et la plateforme gère le cycle de vie HTTP. On ne démarre un serveur
// persistant (app.listen) que hors serverless : dev local ou hébergement
// classique type Railway/Render.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    log.info('serveur démarré', { port: PORT, env: process.env.NODE_ENV ?? 'development' });
  });
}

module.exports = app;
