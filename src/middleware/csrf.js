/**
 * Protection contre la falsification de requête entre sites (CSRF).
 *
 * POURQUOI ELLE APPARAÎT MAINTENANT
 *
 * Tant que la session tenait dans un jeton `Bearer`, le CSRF n'existait pas :
 * un en-tête `Authorization` n'est jamais envoyé tout seul par le navigateur,
 * donc un site tiers ne pouvait pas agir au nom de l'utilisateur.
 *
 * Le passage aux cookies `httpOnly` supprime le vol de jeton par script — et
 * introduit exactement ce risque-là, puisqu'un cookie voyage automatiquement.
 * Migrer sans ce fichier échangerait une faille contre une autre.
 *
 * CE QUI EST CONTRÔLÉ, ET CE QUI NE L'EST PAS
 *
 * Seules les requêtes qui MODIFIENT quelque chose (POST, PUT, PATCH, DELETE) et
 * qui s'authentifient PAR COOKIE. Une requête portant un `Authorization: Bearer`
 * est hors d'atteinte par construction : le navigateur ne l'ajoute pas seul.
 * L'exempter n'affaiblit rien et laisse les clients non-navigateur tranquilles.
 *
 * POURQUOI L'ORIGINE PLUTÔT QU'UN JETON À DOUBLE SOUMISSION
 *
 * Un jeton anti-CSRF suppose de le générer, le transmettre, le stocker côté
 * client et le renvoyer — quatre endroits où se tromper. Le navigateur, lui,
 * pose `Origin` sur toute requête cross-site et sur toute requête modifiante,
 * sans que la page puisse mentir : cet en-tête est interdit d'écriture par
 * script. Comparer `Origin` à la liste CORS déjà tenue est plus court, et il n'y
 * a rien à synchroniser.
 *
 * Le refus est FERMÉ : une requête modifiante par cookie sans `Origin` lisible
 * est rejetée. Un client qui ne peut pas envoyer d'origine doit utiliser un
 * jeton `Bearer`.
 */

const { lireCookies, ACCES } = require('../lib/cookies');
const { logger } = require('../lib/logger');

const log = logger('csrf');

const MODIFIANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * @param {string[]} originesAutorisees la même liste que CORS — une seule
 *   source de vérité, sinon les deux dérivent.
 */
function csrfProtection(originesAutorisees) {
  const autorisees = new Set(originesAutorisees);

  return function verifier(req, res, next) {
    if (!MODIFIANTES.has(req.method)) return next();

    // Authentifiée par en-tête : pas de credentials ambiants, pas de CSRF.
    const entete = req.headers.authorization;
    if (entete && entete.startsWith('Bearer ')) return next();

    // Pas de cookie de session : rien à détourner.
    const cookies = lireCookies(req);
    if (!cookies[ACCES]) return next();

    const origine = req.headers.origin;
    if (origine && autorisees.has(origine)) return next();

    // `Referer` en second recours : certains navigateurs l'envoient là où
    // `Origin` manque. On ne compare que le schéma et l'hôte.
    const referer = req.headers.referer;
    if (referer) {
      try {
        const u = new URL(referer);
        if (autorisees.has(`${u.protocol}//${u.host}`)) return next();
      } catch {
        // Referer illisible : traité comme absent.
      }
    }

    log.warn('requête modifiante refusée — origine non reconnue', {
      method: req.method,
      path: req.path,
      origine: origine ?? null,
      referer: referer ?? null,
    });
    return res.status(403).json({
      message:
        'Origine de la requête non reconnue. Une opération authentifiée par ' +
        'cookie doit provenir de l’application.',
      statusCode: 403,
    });
  };
}

module.exports = { csrfProtection, MODIFIANTES };
