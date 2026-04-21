const express = require('express');
const { getPool } = require('../config/database');

const router = express.Router();

router.get('/stats', async (req, res) => {
  try {
    const companyId = req.query.companyId || req.user?.companyId;
    const pool = getPool();

    const baseWhere = companyId ? ' WHERE company_id = ? AND ' : ' WHERE ';
    const args = companyId ? [companyId] : [];

    const [stockDisp] = await pool.execute(
      `SELECT COUNT(*) AS c FROM vehicles${baseWhere}status = 'DISPONIBLE'`,
      args
    );
    const [stockNonReg] = await pool.execute(
      `SELECT COUNT(*) AS c FROM vehicles${baseWhere}status = 'EN_VENTE'`,
      args
    );
    const [stockReg] = await pool.execute(
      `SELECT COUNT(*) AS c FROM vehicles${baseWhere}status = 'VENDU'`,
      args
    );
    const clientWhere = companyId ? ' WHERE company_id = ?' : '';
    const [clients] = await pool.execute(
      `SELECT COUNT(DISTINCT id) AS c FROM clients${clientWhere}`,
      companyId ? [companyId] : []
    );
    const [caSemaine] = await pool.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM receipts WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)${companyId ? ' AND company_id = ?' : ''}`,
      companyId ? [companyId] : []
    );
    const [caMois] = await pool.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM receipts WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)${companyId ? ' AND company_id = ?' : ''}`,
      companyId ? [companyId] : []
    );
    const [enMaintenance] = await pool.execute(
      `SELECT COUNT(*) AS c FROM vehicles${baseWhere}status = 'EN_MAINTENANCE'`,
      args
    );
    const [enTransit] = await pool.execute(
      `SELECT COUNT(*) AS c FROM vehicles${baseWhere}status = 'EN_TRANSIT'`,
      args
    );

    return res.status(200).json({
      stockDisponible: stockDisp[0]?.c ?? 0,
      stockNonRegulier: stockNonReg[0]?.c ?? 0,
      stockRegularise: stockReg[0]?.c ?? 0,
      nombreClients: clients[0]?.c ?? 0,
      caSemaine: Number(caSemaine[0]?.total ?? 0),
      caMois: Number(caMois[0]?.total ?? 0),
      vehiclesEnMaintenance: enMaintenance[0]?.c ?? 0,
      vehiclesEnTransit: enTransit[0]?.c ?? 0,
      currency: 'XOF',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
