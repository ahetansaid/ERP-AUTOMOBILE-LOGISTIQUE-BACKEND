require('dotenv').config();
const express = require('express');
const cors = require('cors');
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
const { authMiddleware } = require('./middleware/auth');
const { tenantScope } = require('./middleware/tenant');
const { attachAudit } = require('./middleware/audit');

const app = express();
const PORT = process.env.PORT || 3001;

const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(attachAudit);

app.use('/auth', authRoutes);

app.use('/dashboard', authMiddleware, tenantScope, dashboardRoutes);
app.use('/vehicles', authMiddleware, tenantScope, vehiclesRoutes);
app.use('/purchases', authMiddleware, purchasesRoutes);
app.use('/suppliers', authMiddleware, tenantScope, suppliersRoutes);
app.use('/clients', authMiddleware, tenantScope, clientsRoutes);
app.use('/charges', authMiddleware, chargesRoutes);
app.use('/devis', authMiddleware, devisRoutes);
app.use('/invoices', authMiddleware, invoicesRoutes);
app.use('/receipts', authMiddleware, receiptsRoutes);
app.use('/treasury', authMiddleware, treasuryRoutes);
app.use('/proformas', authMiddleware, tenantScope, proformasRoutes);
app.use('/reports', authMiddleware, tenantScope, reportsRoutes);
app.use('/transit', authMiddleware, tenantScope, transitRoutes);
app.use('/users', authMiddleware, usersRoutes);
app.use('/settings', authMiddleware, settingsRoutes);
app.use('/notifications', authMiddleware, tenantScope, notificationsRoutes);
app.use('/uploads', authMiddleware, tenantScope, uploadsRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', authMiddleware, tenantScope, dashboardRoutes);
app.use('/api/vehicles', authMiddleware, tenantScope, vehiclesRoutes);
app.use('/api/purchases', authMiddleware, purchasesRoutes);
app.use('/api/suppliers', authMiddleware, tenantScope, suppliersRoutes);
app.use('/api/clients', authMiddleware, tenantScope, clientsRoutes);
app.use('/api/charges', authMiddleware, chargesRoutes);
app.use('/api/devis', authMiddleware, devisRoutes);
app.use('/api/invoices', authMiddleware, invoicesRoutes);
app.use('/api/receipts', authMiddleware, receiptsRoutes);
app.use('/api/treasury', authMiddleware, treasuryRoutes);
app.use('/api/proformas', authMiddleware, tenantScope, proformasRoutes);
app.use('/api/reports', authMiddleware, tenantScope, reportsRoutes);
app.use('/api/transit', authMiddleware, tenantScope, transitRoutes);
app.use('/api/users', authMiddleware, usersRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);
app.use('/api/notifications', authMiddleware, tenantScope, notificationsRoutes);
app.use('/api/uploads', authMiddleware, tenantScope, uploadsRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
});

app.listen(PORT, () => {
  console.log('Serveur ParcAuto Manager sur le port', PORT);
});
