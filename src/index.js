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

// Routes métier (conformes au rapport API frontend)
app.use('/auth', authRoutes);
app.use('/vehicles', vehiclesRoutes);
app.use('/clients', clientsRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/transit', transitRoutes);
app.use('/reporting', reportingRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ message: 'Route non trouvée', statusCode: 404 });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`API ERP running on http://localhost:${PORT}`);
});
