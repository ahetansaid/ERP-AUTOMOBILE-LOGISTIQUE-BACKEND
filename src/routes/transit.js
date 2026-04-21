const express = require('express');
const { getPool } = require('../config/database');
const { notify } = require('../services/notifications');

const router = express.Router();

// Workflow transit : ordre logique des étapes (côte ouest-africaine)
const STEPS_ORDER = [
  'ARRIVEE_PORT',
  'ADMISSION_TEMPORAIRE',
  'DECLARATION_DOUANE',
  'MAINLEVEE',
  'SCELLES_POSES',
  'EN_ACHEMINEMENT',
  'LIVRE',
];

const STEP_LABEL = {
  ARRIVEE_PORT: 'Arrivée au port',
  ADMISSION_TEMPORAIRE: 'Admission temporaire',
  DECLARATION_DOUANE: 'Déclaration douane',
  MAINLEVEE: 'Mainlevée',
  SCELLES_POSES: 'Scellés posés',
  EN_ACHEMINEMENT: 'En acheminement',
  LIVRE: 'Livré',
};

function toDateOnly(d) {
  if (!d) return null;
  const s = String(d);
  return s.slice(0, 10);
}

// GET /transit/steps/summary — compte par étape (scope tenant)
router.get('/steps/summary', async (req, res) => {
  try {
    const pool = getPool();
    const companyId = req.companyId ?? req.user?.companyId ?? null;
    const result = [];
    for (const step of STEPS_ORDER) {
      try {
        const [rows] = companyId
          ? await pool.execute(
              'SELECT COUNT(*) AS count FROM transit_steps ts INNER JOIN vehicles v ON v.id = ts.vehicle_id WHERE ts.step_name = ? AND v.company_id = ?',
              [step, companyId]
            )
          : await pool.execute(
              'SELECT COUNT(*) AS count FROM transit_steps WHERE step_name = ?',
              [step]
            );
        result.push({
          step,
          label: STEP_LABEL[step] ?? step,
          count: rows[0]?.count ?? 0,
        });
      } catch (_) {
        result.push({ step, label: STEP_LABEL[step] ?? step, count: 0 });
      }
    }
    return res.status(200).json({ steps: result });
  } catch (e) {
    console.error('[transit.summary]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /transit/steps — liste complète avec infos véhicule (scope tenant)
router.get('/steps', async (req, res) => {
  try {
    const pool = getPool();
    const companyId = req.companyId ?? req.user?.companyId ?? null;
    const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : null;

    let sql =
      'SELECT ts.*, v.vin, v.brand, v.model, v.client_id, c.name AS client_name FROM transit_steps ts LEFT JOIN vehicles v ON v.id = ts.vehicle_id LEFT JOIN clients c ON c.id = v.client_id WHERE 1=1';
    const params = [];
    if (companyId) {
      sql += ' AND (v.company_id = ? OR v.company_id IS NULL)';
      params.push(companyId);
    }
    if (vehicleId) {
      sql += ' AND ts.vehicle_id = ?';
      params.push(vehicleId);
    }
    sql += ' ORDER BY ts.id DESC';
    const [rows] = await pool.execute(sql, params);
    return res.status(200).json({ transitSteps: rows, pagination: {} });
  } catch (e) {
    console.error('[transit.list]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /transit/steps — crée une nouvelle étape pour un véhicule
router.post('/steps', async (req, res) => {
  try {
    const body = req.body || {};
    const vehicleId = Number(body.vehicleId ?? body.vehicle_id);
    const stepName = String(body.stepName ?? body.step_name ?? '').trim();
    const dateArrival = toDateOnly(body.dateArrival ?? body.date_arrival);
    const dateDeparture = toDateOnly(body.dateDeparture ?? body.date_departure);

    if (!Number.isInteger(vehicleId) || !stepName) {
      return res
        .status(400)
        .json({ message: 'vehicleId et stepName requis', statusCode: 400 });
    }
    if (!STEPS_ORDER.includes(stepName)) {
      return res.status(400).json({
        message: `stepName invalide. Valeurs : ${STEPS_ORDER.join(', ')}`,
        statusCode: 400,
      });
    }

    const pool = getPool();
    const [insert] = await pool.execute(
      'INSERT INTO transit_steps (vehicle_id, step_name, date_arrival, date_departure) VALUES (?, ?, ?, ?)',
      [vehicleId, stepName, dateArrival, dateDeparture]
    );
    const [rows] = await pool.execute(
      'SELECT * FROM transit_steps WHERE id = ?',
      [insert.insertId]
    );
    const row = rows[0];

    if (req.audit) {
      req.audit({
        action: 'CREATE',
        resource: 'transit_steps',
        resourceId: row.id,
        after: row,
      });
    }

    // Notification pour la livraison finale
    if (stepName === 'LIVRE') {
      notify({
        companyId: req.companyId ?? req.user?.companyId ?? null,
        type: 'SUCCESS',
        title: 'Véhicule livré',
        message: `Véhicule #${vehicleId} livré le ${dateArrival || new Date().toISOString().slice(0, 10)}.`,
        link: `/vehicules/${vehicleId}`,
        audience: 'admins',
      });
    }

    return res.status(201).json(row);
  } catch (e) {
    console.error('[transit.createStep]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// PATCH /transit/steps/:id — met à jour une étape (dates, nom)
router.patch('/steps/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const body = req.body || {};
    const updates = [];
    const values = [];

    if (body.stepName !== undefined || body.step_name !== undefined) {
      const v = String(body.stepName ?? body.step_name ?? '').trim();
      if (!STEPS_ORDER.includes(v)) {
        return res.status(400).json({
          message: `stepName invalide. Valeurs : ${STEPS_ORDER.join(', ')}`,
          statusCode: 400,
        });
      }
      updates.push('step_name = ?');
      values.push(v);
    }
    if (body.dateArrival !== undefined || body.date_arrival !== undefined) {
      updates.push('date_arrival = ?');
      values.push(toDateOnly(body.dateArrival ?? body.date_arrival));
    }
    if (body.dateDeparture !== undefined || body.date_departure !== undefined) {
      updates.push('date_departure = ?');
      values.push(toDateOnly(body.dateDeparture ?? body.date_departure));
    }

    if (!updates.length) {
      return res.status(400).json({
        message: 'Aucun champ à mettre à jour',
        statusCode: 400,
      });
    }

    const pool = getPool();
    const [existing] = await pool.execute(
      'SELECT * FROM transit_steps WHERE id = ?',
      [id]
    );
    if (!existing.length) {
      return res
        .status(404)
        .json({ message: 'Étape introuvable', statusCode: 404 });
    }
    const before = existing[0];

    values.push(id);
    await pool.execute(
      'UPDATE transit_steps SET ' + updates.join(', ') + ' WHERE id = ?',
      values
    );
    const [rows] = await pool.execute(
      'SELECT * FROM transit_steps WHERE id = ?',
      [id]
    );

    if (req.audit) {
      req.audit({
        action: 'UPDATE',
        resource: 'transit_steps',
        resourceId: id,
        before,
        after: rows[0],
      });
    }

    return res.status(200).json(rows[0]);
  } catch (e) {
    console.error('[transit.updateStep]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /transit/steps/advance — avance un véhicule à l'étape suivante
// Body: { vehicleId } — détermine l'étape courante et crée la suivante
router.post('/steps/advance', async (req, res) => {
  try {
    const vehicleId = Number(req.body?.vehicleId ?? req.body?.vehicle_id);
    if (!Number.isInteger(vehicleId)) {
      return res.status(400).json({ message: 'vehicleId requis', statusCode: 400 });
    }
    const pool = getPool();

    // Dernière étape enregistrée pour ce véhicule
    const [last] = await pool.execute(
      'SELECT step_name FROM transit_steps WHERE vehicle_id = ? ORDER BY id DESC LIMIT 1',
      [vehicleId]
    );
    const currentStep = last[0]?.step_name ?? null;

    let nextStep;
    if (!currentStep) {
      nextStep = STEPS_ORDER[0];
    } else {
      const idx = STEPS_ORDER.indexOf(currentStep);
      if (idx === -1) {
        return res.status(409).json({
          message: `Étape courante "${currentStep}" inconnue — impossible d'avancer`,
          statusCode: 409,
        });
      }
      if (idx === STEPS_ORDER.length - 1) {
        return res.status(409).json({
          message: 'Véhicule déjà à la dernière étape (LIVRÉ)',
          statusCode: 409,
        });
      }
      nextStep = STEPS_ORDER[idx + 1];
    }

    const today = new Date().toISOString().slice(0, 10);
    const [insert] = await pool.execute(
      'INSERT INTO transit_steps (vehicle_id, step_name, date_arrival) VALUES (?, ?, ?)',
      [vehicleId, nextStep, today]
    );
    const [rows] = await pool.execute(
      'SELECT * FROM transit_steps WHERE id = ?',
      [insert.insertId]
    );

    if (req.audit) {
      req.audit({
        action: 'CREATE',
        resource: 'transit_steps',
        resourceId: rows[0].id,
        after: rows[0],
      });
    }

    // Notification
    notify({
      companyId: req.companyId ?? req.user?.companyId ?? null,
      type: nextStep === 'LIVRE' ? 'SUCCESS' : 'INFO',
      title:
        nextStep === 'LIVRE'
          ? 'Véhicule livré'
          : `Transit avancé : ${STEP_LABEL[nextStep]}`,
      message: `Véhicule #${vehicleId} — ${STEP_LABEL[nextStep]}.`,
      link: `/vehicules/${vehicleId}`,
      audience: 'admins',
    });

    return res.status(201).json({ ...rows[0], label: STEP_LABEL[nextStep] });
  } catch (e) {
    console.error('[transit.advance]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// DELETE /transit/steps/:id
router.delete('/steps/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const pool = getPool();
    const [existing] = await pool.execute(
      'SELECT * FROM transit_steps WHERE id = ?',
      [id]
    );
    if (!existing.length) {
      return res
        .status(404)
        .json({ message: 'Étape introuvable', statusCode: 404 });
    }
    await pool.execute('DELETE FROM transit_steps WHERE id = ?', [id]);
    if (req.audit) {
      req.audit({
        action: 'DELETE',
        resource: 'transit_steps',
        resourceId: id,
        before: existing[0],
      });
    }
    return res.status(204).send();
  } catch (e) {
    console.error('[transit.deleteStep]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
