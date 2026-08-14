/**
 * Point d'entrée des tâches planifiées.
 *
 * Vercel Cron appelle cette route en GET avec l'en-tête
 * `Authorization: Bearer $CRON_SECRET`. Ce n'est pas un utilisateur : la route
 * est donc montée AVANT les gardes de session, et elle porte sa propre
 * authentification.
 *
 * UN SEUL POINT D'ENTRÉE, PAS TROIS.
 *
 * On pourrait déclarer une tâche par périodicité. Une seule suffit : c'est le
 * planificateur qui décide, à partir de la date, ce qui est dû. Trois avantages
 * concrets — une seule configuration à tenir, aucune dérive possible entre les
 * trois horaires, et la tâche tient dans les quotas des offres où le nombre de
 * crons est limité.
 */

const express = require('express');
const crypto = require('node:crypto');
const { executer } = require('../lib/planificateur');
const { logger } = require('../lib/logger');

const log = logger('cron');

const router = express.Router();

/**
 * Comparaison à temps constant.
 *
 * Un `===` sur un secret fuit sa longueur et son préfixe par le temps de
 * réponse. Le coût est nul, l'omission serait gratuite aussi — autant faire
 * juste.
 */
function memeSecret(fourni, attendu) {
  const a = Buffer.from(String(fourni));
  const b = Buffer.from(String(attendu));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Échoue FERMÉ : sans CRON_SECRET configuré, la route est refusée plutôt
 * qu'ouverte. Un planificateur accessible sans secret laisserait n'importe qui
 * régénérer les rapports de toutes les sociétés.
 */
function authCron(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error('CRON_SECRET absent : la route planifiée est refusée');
    return res.status(503).json({
      message: 'Planificateur non configuré (CRON_SECRET manquant)',
      statusCode: 503,
    });
  }

  const entete = req.headers.authorization || '';
  const fourni = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  if (!fourni || !memeSecret(fourni, secret)) {
    log.warn('appel planifié refusé', {
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
    });
    return res.status(401).json({ message: 'Non autorisé', statusCode: 401 });
  }
  return next();
}

/**
 * GET /cron/quotidien
 *
 * Réévalue les alertes de chaque société et produit les rapports dus. Réponse
 * en 200 même si une société a échoué : la plateforme de cron ne doit pas
 * relancer indéfiniment une tâche dont l'échec est propre à un client. Le
 * nombre d'erreurs est dans le corps, et chacune est journalisée.
 */
router.get('/quotidien', authCron, async (req, res) => {
  try {
    const compteRendu = await executer(new Date());
    return res.status(200).json(compteRendu);
  } catch (err) {
    log.error('planification en échec', { err });
    return res.status(500).json({ message: 'Planification en échec', statusCode: 500 });
  }
});

module.exports = router;
