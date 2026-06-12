const express = require('express');
const { prisma } = require('../lib/prisma');
const { toSnake } = require('../lib/serialize');
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
  return String(d).slice(0, 10);
}

// GET /transit/steps/summary — compte par étape (scope tenant)
router.get('/steps/summary', async (req, res) => {
  try {
    const companyId = req.companyId ?? req.user?.companyId ?? null;
    const result = [];
    for (const step of STEPS_ORDER) {
      try {
        const count = await prisma.transitStep.count({
          where: {
            stepName: step,
            ...(companyId ? { vehicle: { is: { companyId: Number(companyId) } } } : {}),
          },
        });
        result.push({ step, label: STEP_LABEL[step] ?? step, count });
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
    const companyId = req.companyId ?? req.user?.companyId ?? null;
    const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : null;

    const where = {};
    if (vehicleId) where.vehicleId = vehicleId;
    if (companyId) {
      // Équivalent du LEFT JOIN + (v.company_id = ? OR v.company_id IS NULL) :
      // étapes sans véhicule, ou dont le véhicule appartient à la société, ou
      // dont le véhicule n'a pas de société.
      where.OR = [
        { vehicleId: null },
        { vehicle: { is: { companyId: Number(companyId) } } },
        { vehicle: { is: { companyId: null } } },
      ];
    }

    const rows = await prisma.transitStep.findMany({
      where,
      orderBy: { id: 'desc' },
      include: {
        vehicle: {
          select: {
            vin: true,
            brand: true,
            model: true,
            clientId: true,
            client: { select: { name: true } },
          },
        },
      },
    });

    const transitSteps = rows.map((ts) => {
      const { vehicle, ...rest } = ts;
      return {
        ...toSnake(rest),
        vin: vehicle?.vin ?? null,
        brand: vehicle?.brand ?? null,
        model: vehicle?.model ?? null,
        client_id: vehicle?.clientId ?? null,
        client_name: vehicle?.client?.name ?? null,
      };
    });

    return res.status(200).json({ transitSteps, pagination: {} });
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
      return res.status(400).json({ message: 'vehicleId et stepName requis', statusCode: 400 });
    }
    if (!STEPS_ORDER.includes(stepName)) {
      return res.status(400).json({
        message: `stepName invalide. Valeurs : ${STEPS_ORDER.join(', ')}`,
        statusCode: 400,
      });
    }

    const created = await prisma.transitStep.create({
      data: {
        vehicleId,
        stepName,
        dateArrival: dateArrival ? new Date(dateArrival) : null,
        dateDeparture: dateDeparture ? new Date(dateDeparture) : null,
      },
    });
    const row = toSnake(created);

    if (req.audit) {
      req.audit({ action: 'CREATE', resource: 'transit_steps', resourceId: created.id, after: row });
    }

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
    const data = {};

    if (body.stepName !== undefined || body.step_name !== undefined) {
      const v = String(body.stepName ?? body.step_name ?? '').trim();
      if (!STEPS_ORDER.includes(v)) {
        return res.status(400).json({
          message: `stepName invalide. Valeurs : ${STEPS_ORDER.join(', ')}`,
          statusCode: 400,
        });
      }
      data.stepName = v;
    }
    if (body.dateArrival !== undefined || body.date_arrival !== undefined) {
      const v = toDateOnly(body.dateArrival ?? body.date_arrival);
      data.dateArrival = v ? new Date(v) : null;
    }
    if (body.dateDeparture !== undefined || body.date_departure !== undefined) {
      const v = toDateOnly(body.dateDeparture ?? body.date_departure);
      data.dateDeparture = v ? new Date(v) : null;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour', statusCode: 400 });
    }

    const existing = await prisma.transitStep.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Étape introuvable', statusCode: 404 });
    }

    const updated = await prisma.transitStep.update({ where: { id }, data });

    if (req.audit) {
      req.audit({
        action: 'UPDATE',
        resource: 'transit_steps',
        resourceId: id,
        before: toSnake(existing),
        after: toSnake(updated),
      });
    }

    return res.status(200).json(toSnake(updated));
  } catch (e) {
    console.error('[transit.updateStep]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /transit/steps/advance — avance un véhicule à l'étape suivante
router.post('/steps/advance', async (req, res) => {
  try {
    const vehicleId = Number(req.body?.vehicleId ?? req.body?.vehicle_id);
    if (!Number.isInteger(vehicleId)) {
      return res.status(400).json({ message: 'vehicleId requis', statusCode: 400 });
    }

    const last = await prisma.transitStep.findFirst({
      where: { vehicleId },
      orderBy: { id: 'desc' },
      select: { stepName: true },
    });
    const currentStep = last?.stepName ?? null;

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
    const created = await prisma.transitStep.create({
      data: { vehicleId, stepName: nextStep, dateArrival: new Date(today) },
    });
    const row = toSnake(created);

    if (req.audit) {
      req.audit({ action: 'CREATE', resource: 'transit_steps', resourceId: created.id, after: row });
    }

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

    return res.status(201).json({ ...row, label: STEP_LABEL[nextStep] });
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
    const existing = await prisma.transitStep.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Étape introuvable', statusCode: 404 });
    }
    await prisma.transitStep.delete({ where: { id } });
    if (req.audit) {
      req.audit({ action: 'DELETE', resource: 'transit_steps', resourceId: id, before: toSnake(existing) });
    }
    return res.status(204).send();
  } catch (e) {
    console.error('[transit.deleteStep]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
