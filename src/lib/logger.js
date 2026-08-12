/**
 * Journalisation structurée.
 *
 * Deux exigences, et rien de plus :
 *
 * 1. Chaque ligne porte le `correlationId` de la requête. C'est ce qui permet
 *    de relier un incident à toutes les écritures qu'il a produites — le
 *    journal d'audit porte le même identifiant. Sans lui, un échec en
 *    production laisse une ligne isolée qu'on ne peut rattacher à rien.
 *
 * 2. En production, une ligne = un objet JSON. Les plateformes d'hébergement
 *    (Vercel, Railway) indexent le JSON ; elles ne savent rien faire d'un
 *    `console.error` concaténé.
 *
 * Aucune dépendance : le projet est volontairement léger, et le besoin ne
 * justifie pas d'embarquer une bibliothèque de journalisation.
 */

const { getContext } = require('./context');

const NIVEAUX = { debug: 10, info: 20, warn: 30, error: 40 };
const SEUIL =
  NIVEAUX[process.env.LOG_LEVEL] ??
  (process.env.NODE_ENV === 'production' ? NIVEAUX.info : NIVEAUX.debug);

const JSON_SORTIE =
  process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';

/** Ne journalise jamais un secret, même si l'appelant le passe par mégarde. */
const SENSIBLE = new Set([
  'password', 'token', 'refreshToken', 'jwt', 'secret',
  'twoFaSecret', 'authorization',
]);

function nettoyer(valeur, profondeur = 0) {
  if (valeur == null || profondeur > 4) return valeur ?? null;
  if (valeur instanceof Error) {
    return { message: valeur.message, name: valeur.name, stack: valeur.stack };
  }
  if (typeof valeur === 'bigint') return valeur.toString();
  if (valeur instanceof Date) return valeur.toISOString();
  if (Array.isArray(valeur)) return valeur.slice(0, 20).map((v) => nettoyer(v, profondeur + 1));
  if (typeof valeur !== 'object') return valeur;

  const sortie = {};
  for (const [cle, val] of Object.entries(valeur)) {
    sortie[cle] = SENSIBLE.has(cle) ? '[REDACTED]' : nettoyer(val, profondeur + 1);
  }
  return sortie;
}

function ecrire(niveau, portee, message, donnees) {
  if (NIVEAUX[niveau] < SEUIL) return;

  const ctx = getContext();
  const ligne = {
    ts: new Date().toISOString(),
    niveau,
    portee,
    message,
    ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    ...(ctx?.companyId != null ? { companyId: ctx.companyId } : {}),
    ...(ctx?.userId != null ? { userId: ctx.userId } : {}),
    ...(donnees ? { donnees: nettoyer(donnees) } : {}),
  };

  const flux = niveau === 'error' || niveau === 'warn' ? console.error : console.log;

  if (JSON_SORTIE) {
    flux(JSON.stringify(ligne));
    return;
  }

  // En développement, la lisibilité prime sur l'indexation.
  const corr = ctx?.correlationId ? ` (${ctx.correlationId.slice(0, 8)})` : '';
  flux(
    `${niveau.toUpperCase().padEnd(5)} [${portee}]${corr} ${message}`,
    donnees ? nettoyer(donnees) : ''
  );
}

/**
 * Journal cadré sur une portée — le module ou l'opération concernée.
 *
 *   const log = logger('ledger');
 *   log.error('écriture refusée', err);
 */
function logger(portee) {
  return {
    debug: (message, donnees) => ecrire('debug', portee, message, donnees),
    info: (message, donnees) => ecrire('info', portee, message, donnees),
    warn: (message, donnees) => ecrire('warn', portee, message, donnees),
    error: (message, donnees) => ecrire('error', portee, message, donnees),
  };
}

module.exports = { logger, NIVEAUX };
