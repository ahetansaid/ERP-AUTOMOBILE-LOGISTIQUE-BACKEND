const express = require('express');
const { getPool } = require('../config/database');
const router = express.Router();

router.get('/steps/summary', async (req, res) => {
  try {
    const pool = getPool();
    const steps = ['ARRIVEE_PORT', 'ADMISSION_TEMPORAIRE', 'DECLARATION_DOUANE', 'MAINLEVEE', 'SCELLES_POSES', 'EN_ACHEMINEMENT', 'LIVRE'];
    const result = [];
    for (const step of steps) {
      try {
        const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM transit_steps WHERE step_name = ?', [step]);
        result.push({ step, count: rows[0]?.count ?? 0 });
      } catch (_) {
        result.push({ step, count: 0 });
      }
    }
    return res.status(200).json({ steps: result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.get('/steps', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute('SELECT ts.*, v.vin, v.brand, v.model FROM transit_steps ts LEFT JOIN vehicles v ON v.id = ts.vehicle_id ORDER BY ts.id DESC');
    return res.status(200).json({ transitSteps: rows, pagination: {} });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
