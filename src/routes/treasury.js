const express = require('express');
const { getPool } = require('../config/database');
const router = express.Router();

function getDateFilter(period) {
  const p = (period || '').toLowerCase();
  if (p === 'week' || p === 'hebdo') {
    return { sql: 'AND payment_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)', chargeSql: 'AND charge_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)', txnSql: 'AND t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)' };
  }
  if (p === 'month' || p === 'mensuel') {
    return { sql: "AND payment_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')", chargeSql: "AND charge_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')", txnSql: "AND t.transaction_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')" };
  }
  if (p === 'year' || p === 'annuel') {
    return { sql: "AND payment_date >= DATE_FORMAT(CURDATE(), '%Y-01-01')", chargeSql: "AND charge_date >= DATE_FORMAT(CURDATE(), '%Y-01-01')", txnSql: "AND t.transaction_date >= DATE_FORMAT(CURDATE(), '%Y-01-01')" };
  }
  return { sql: '', chargeSql: '', txnSql: '' };
}

router.get('/', async (req, res) => {
  try {
    const companyId = req.query.companyId || req.user?.companyId;
    const period = req.query.period || req.query.periode || '';
    const pool = getPool();
    const { sql: recDateCond, chargeSql: chDateCond, txnSql: txnDateCond } = getDateFilter(period);

    let tableTreasuryExists = false;
    try {
      const [tt] = await pool.execute("SHOW TABLES LIKE 'transactions_tresorerie'");
      tableTreasuryExists = tt && tt.length > 0;
    } catch (_) {}

    if (tableTreasuryExists) {
      let whereTxn = '1=1';
      if (companyId) {
        whereTxn += ' AND t.company_id = ?';
      }
      if (txnDateCond) {
        whereTxn += ' ' + txnDateCond;
      }
      const txnParams = companyId ? [companyId] : [];

      const [enc] = await pool.execute(
        'SELECT COALESCE(SUM(t.montant), 0) AS total FROM transactions_tresorerie t WHERE t.type = ? AND ' + whereTxn,
        ['ENCAISSEMENT', ...txnParams]
      );
      const total_entrees = Number(enc[0]?.total ?? 0);

      const [dec] = await pool.execute(
        'SELECT COALESCE(SUM(t.montant), 0) AS total FROM transactions_tresorerie t WHERE t.type = ? AND ' + whereTxn,
        ['DECAISSEMENT', ...txnParams]
      );
      const total_sorties = Number(dec[0]?.total ?? 0);

      const solde = total_entrees - total_sorties;

      let byCategory = {};
      const [catRows] = await pool.execute(
        'SELECT t.categorie, COALESCE(SUM(t.montant), 0) AS total FROM transactions_tresorerie t WHERE t.type = ? AND ' + whereTxn + ' GROUP BY t.categorie',
        ['DECAISSEMENT', ...txnParams]
      );
      for (const row of catRows || []) {
        byCategory[row.categorie || 'Autres'] = Number(row.total ?? 0);
      }

      let transactions = [];
      const listSql = 'SELECT t.id, t.type, t.categorie, t.reference, t.montant AS amount, t.transaction_date AS date, t.vehicle_id, t.description, t.receipt_id, t.purchase_id, t.workshop_quote_id, t.charge_id FROM transactions_tresorerie t WHERE ' + whereTxn + ' ORDER BY t.transaction_date DESC, t.id DESC LIMIT 500';
      const [txnRows] = await pool.execute(listSql, txnParams);
      for (const row of txnRows || []) {
        transactions.push({
          id: row.id,
          type: row.type === 'ENCAISSEMENT' ? 'encaissement' : 'decaissement',
          categorie: row.categorie,
          reference: row.reference,
          amount: row.type === 'ENCAISSEMENT' ? Number(row.amount) : -Number(row.amount),
          date: row.date,
          vehicle_id: row.vehicle_id,
          description: row.description,
          receipt_id: row.receipt_id,
          purchase_id: row.purchase_id,
          workshop_quote_id: row.workshop_quote_id,
          charge_id: row.charge_id,
        });
      }

      let by_month = [];
      if (!period || period === '') {
        const [monthRows] = await pool.execute(
          `SELECT DATE_FORMAT(t.transaction_date, '%Y-%m') AS mois,
            SUM(CASE WHEN t.type = 'ENCAISSEMENT' THEN t.montant ELSE 0 END) AS encaissements,
            SUM(CASE WHEN t.type = 'DECAISSEMENT' THEN t.montant ELSE 0 END) AS decaissements
           FROM transactions_tresorerie t
           WHERE t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)` + (companyId ? ' AND t.company_id = ?' : '') + `
           GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
           ORDER BY mois DESC
           LIMIT 12`,
          companyId ? [companyId] : []
        );
        by_month = (monthRows || []).map(function (r) {
          return {
            mois: r.mois,
            encaissements: Number(r.encaissements ?? 0),
            decaissements: Number(r.decaissements ?? 0),
            resultat: Number(r.encaissements ?? 0) - Number(r.decaissements ?? 0),
          };
        });
      }

      return res.status(200).json({
        total_entrees,
        total_sorties,
        solde,
        benefice: solde,
        by_category: byCategory,
        transactions,
        by_month,
        pagination: {},
      });
    }

    let recSql = 'SELECT COALESCE(SUM(amount), 0) AS total FROM receipts WHERE 1=1 ' + recDateCond;
    let chargeSql = 'SELECT COALESCE(SUM(amount), 0) AS total FROM charges WHERE (deleted_at IS NULL) ' + chDateCond;
    const recParams = [];
    const chargeParams = [];
    try {
      const [cols] = await pool.execute('SHOW COLUMNS FROM receipts LIKE ?', ['company_id']);
      if (cols.length && companyId) { recSql += ' AND company_id = ?'; recParams.push(companyId); }
    } catch (_) {}
    try {
      const [cols] = await pool.execute('SHOW COLUMNS FROM charges LIKE ?', ['company_id']);
      if (cols.length && companyId) { chargeSql += ' AND company_id = ?'; chargeParams.push(companyId); }
    } catch (_) {}

    const [rec] = await pool.execute(recSql, recParams);
    const [ch] = await pool.execute(chargeSql, chargeParams);
    const total_entrees = Number(rec[0]?.total ?? 0);
    const total_sorties = Number(ch[0]?.total ?? 0);
    const solde = total_entrees - total_sorties;

    let transactions = [];
    try {
      const recListSql = 'SELECT id, amount, payment_date AS date, reference, invoice_id, workshop_quote_id FROM receipts WHERE 1=1 ' + recDateCond;
      const [recRows] = await pool.execute(recListSql, recParams);
      for (const row of recRows || []) {
        transactions.push({
          id: row.id,
          type: 'encaissement',
          amount: Number(row.amount),
          date: row.date,
          reference: row.reference,
          invoice_id: row.invoice_id,
          workshop_quote_id: row.workshop_quote_id,
        });
      }
      const chListSql = 'SELECT id, amount, charge_date AS date, label, category FROM charges WHERE (deleted_at IS NULL) ' + chDateCond;
      const [chRows] = await pool.execute(chListSql, chargeParams);
      for (const row of chRows || []) {
        transactions.push({
          id: 'ch-' + row.id,
          type: 'decaissement',
          amount: -Number(row.amount),
          date: row.date,
          label: row.label,
          category: row.category,
        });
      }
      transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (_) {}

    return res.status(200).json({
      total_entrees,
      total_sorties,
      solde,
      benefice: solde,
      transactions,
      pagination: {},
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
