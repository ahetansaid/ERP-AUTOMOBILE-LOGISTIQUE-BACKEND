import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /treasury/summary — encaissements / décaissements (+ par devise pour avertissement multi-devises)
router.get('/summary', async (req, res, next) => {
  try {
    const [payments] = await pool.execute(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM payments'
    );
    const totalEncaissements = Number(payments[0]?.total ?? 0);
    const [charges] = await pool.execute(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM charges'
    );
    const totalDecaissements = Number(charges[0]?.total ?? 0);
    const [byCurrencyPayments] = await pool.execute(
      'SELECT currency, COALESCE(SUM(amount), 0) AS total FROM payments GROUP BY currency'
    );
    const [byCurrencyCharges] = await pool.execute(
      'SELECT currency, COALESCE(SUM(amount), 0) AS total FROM charges GROUP BY currency'
    );
    const currencies = new Set([
      ...byCurrencyPayments.map((p) => p.currency || 'FCFA'),
      ...byCurrencyCharges.map((c) => c.currency || 'FCFA'),
    ]);
    const byCurrency = Array.from(currencies).map((curr) => {
      const enc = byCurrencyPayments.find((p) => (p.currency || 'FCFA') === curr);
      const dec = byCurrencyCharges.find((c) => (c.currency || 'FCFA') === curr);
      const encaissements = Number(enc?.total ?? 0);
      const decaissements = Number(dec?.total ?? 0);
      return {
        currency: curr,
        encaissements,
        decaissements,
        solde: encaissements - decaissements,
      };
    });
    res.status(200).json({
      encaissements: totalEncaissements,
      decaissements: totalDecaissements,
      solde: totalEncaissements - totalDecaissements,
      currency: 'FCFA',
      byCurrency,
      multipleCurrencies: byCurrency.length > 1,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
