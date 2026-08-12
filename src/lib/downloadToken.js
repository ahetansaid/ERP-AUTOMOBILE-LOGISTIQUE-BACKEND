/**
 * Jetons de téléchargement.
 *
 * Le problème : un PDF ouvert par `window.open` ne peut pas porter d'en-tête
 * `Authorization`. La solution retenue jusqu'ici était de mettre le jeton
 * d'accès complet dans la query string — donc dans l'historique du navigateur,
 * dans l'en-tête `Referer` envoyé aux tiers, dans les journaux des proxies, et
 * dans toute capture d'écran de l'URL.
 *
 * Un jeton d'accès y reste valide trente minutes et ouvre TOUTE l'API.
 *
 * Ce module le remplace par un jeton :
 *   · à usage unique de lecture — il n'autorise aucune écriture ;
 *   · limité à UNE ressource précise (`uploads:42`) ;
 *   · valable deux minutes.
 *
 * Fuité, il ne donne accès qu'au fichier qu'on était déjà en train d'ouvrir, et
 * seulement pendant le temps de le télécharger.
 */

const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

/** Marque le jeton comme non substituable à un jeton d'accès. */
const PURPOSE = 'download';
const TTL_SECONDS = 120;

/**
 * Émet un jeton pour une ressource donnée.
 *
 * @param {object} user      utilisateur authentifié (req.user)
 * @param {string} resource  famille de ressource, ex. 'uploads' ou 'invoices'
 * @param {number|string} resourceId
 */
function issueDownloadToken(user, resource, resourceId) {
  if (!user?.id || user.companyId == null) {
    throw new Error('[download] utilisateur non authentifié');
  }
  if (!resource || resourceId == null) {
    throw new Error('[download] ressource requise');
  }
  return jwt.sign(
    {
      purpose: PURPOSE,
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      // Le périmètre est figé dans le jeton : il ne peut pas servir ailleurs.
      scope: `${resource}:${resourceId}`,
    },
    JWT_SECRET,
    { expiresIn: TTL_SECONDS }
  );
}

/**
 * Vérifie qu'un jeton de téléchargement couvre bien la ressource demandée.
 * Retourne l'utilisateur, ou `null` si le jeton ne convient pas.
 */
function verifyDownloadToken(token, resource, resourceId) {
  try {
    const d = jwt.verify(token, JWT_SECRET);
    if (d.purpose !== PURPOSE) return null;
    if (d.scope !== `${resource}:${resourceId}`) return null;
    return { id: d.id, email: d.email, role: d.role, companyId: d.companyId };
  } catch {
    return null;
  }
}

module.exports = { issueDownloadToken, verifyDownloadToken, PURPOSE, TTL_SECONDS };
