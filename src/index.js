import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pool from './db.js';
import { errorHandler } from './middlewares/errorHandler.js';
import authRoutes from './routes/auth.js';
import vehiclesRoutes from './routes/vehicles.js';
import clientsRoutes from './routes/clients.js';
import dashboardRoutes from './routes/dashboard.js';
import transitRoutes from './routes/transit.js';
import reportingRoutes from './routes/reporting.js';
import documentsRoutes from './routes/documents.js';
import chargesRoutes from './routes/charges.js';
import transitStepsRoutes from './routes/transitSteps.js';
import proformasRoutes from './routes/proformas.js';
import invoicesRoutes from './routes/invoices.js';
import paymentsRoutes from './routes/payments.js';
import treasuryRoutes from './routes/treasury.js';
import chargesListRoutes from './routes/chargesList.js';
import stockRoutes from './routes/stock.js';
import companyInfoRoutes from './routes/companyInfo.js';
import receiptsRoutes from './routes/receipts.js';
import transitOperationsRoutes from './routes/transitOperations.js';
import purchasesRoutes from './routes/purchases.js';
import devisRoutes from './routes/devis.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:3000' }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'erp-automobile-api' });
});

// Test MySQL (optionnel)
app.get('/api/ping-db', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT 1 AS ok');
    res.json({ db: 'ok', result: rows[0] });
  } catch (err) {
    res.status(500).json({ db: 'error', message: err.message });
  }
});

// Routes métier (sous-routes véhicules avant /vehicles/:id)
app.use('/auth', authRoutes);
app.use('/vehicles', documentsRoutes);
app.use('/vehicles', chargesRoutes);
app.use('/vehicles', transitStepsRoutes);
app.use('/vehicles', proformasRoutes);
app.use('/vehicles', stockRoutes);
app.use('/vehicles', vehiclesRoutes);
app.use('/clients', clientsRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/transit', transitOperationsRoutes);
app.use('/transit', transitRoutes);
app.use('/company-info', companyInfoRoutes);
app.use('/receipts', receiptsRoutes);
app.use('/purchases', purchasesRoutes);
app.use('/devis', devisRoutes);
app.use('/reporting', reportingRoutes);
app.use('/charges', chargesListRoutes);
app.use('/invoices', invoicesRoutes);
app.use('/payments', paymentsRoutes);
app.use('/treasury', treasuryRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ message: 'Route non trouvée', statusCode: 404 });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`API ERP running on http://localhost:${PORT}`);
});
