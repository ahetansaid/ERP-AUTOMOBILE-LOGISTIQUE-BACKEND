const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-change-me';

/**
 * Refus de démarrer en production avec des secrets faibles.
 *
 * Le contrôle de longueur ne portait que sur JWT_SECRET : un secret de
 * rafraîchissement de dix-sept caractères passait, alors que c'est le jeton
 * LONGUE DURÉE — celui qui permet de régénérer indéfiniment des accès. Les deux
 * sont désormais tenus au même seuil.
 */
if (process.env.NODE_ENV === 'production') {
  const faible = [
    !process.env.JWT_SECRET,
    !process.env.JWT_REFRESH_SECRET,
    JWT_SECRET === 'change-me-in-production',
    JWT_REFRESH_SECRET === 'refresh-change-me',
    JWT_SECRET === JWT_REFRESH_SECRET,
    JWT_SECRET.length < 32,
    JWT_REFRESH_SECRET.length < 32,
  ].some(Boolean);
  if (faible) {
    throw new Error(
      'JWT_SECRET / JWT_REFRESH_SECRET manquants, identiques ou trop courts. ' +
        'Chacun doit faire au moins 32 caractères et être distinct de l’autre. ' +
        'Génération : node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
  }
}

/**
 * Le jeton de session est attendu dans l'en-tête `Authorization`.
 *
 * La query string n'est PLUS acceptée pour un jeton d'accès : une URL finit
 * dans l'historique du navigateur, dans l'en-tête `Referer` transmis aux tiers,
 * dans les journaux des proxies et dans les captures d'écran. Un jeton d'accès
 * y resterait valide trente minutes et ouvrirait toute l'API.
 *
 * Les téléchargements ouverts par `window.open`, qui ne peuvent pas porter
 * d'en-tête, utilisent désormais un jeton dédié : limité à une seule ressource,
 * en lecture, et valable deux minutes (voir src/lib/downloadToken.js et
 * `downloadAuth`).
 */
function authMiddleware(req, res, next) {
  // La passerelle de téléchargement a déjà authentifié la requête, avec un
  // jeton volontairement plus étroit. On ne repasse pas dessus.
  if (req.user && req.isDownloadToken) return next();

  const entete = req.headers.authorization;
  if (!entete || !entete.startsWith('Bearer ')) {
    return res
      .status(401)
      .json({ message: 'Token manquant ou invalide', statusCode: 401 });
  }

  try {
    const decoded = jwt.verify(entete.slice(7), JWT_SECRET);

    // Un jeton de téléchargement ne vaut pas jeton de session : il est
    // volontairement plus faible, il ne doit pas servir à appeler l'API.
    if (decoded.purpose === 'download') {
      return res
        .status(401)
        .json({ message: 'Jeton non valable pour cette opération', statusCode: 401 });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId ?? decoded.company_id,
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token expiré ou invalide', statusCode: 401 });
  }
}

/**
 * URL autorisées à s'authentifier par jeton de téléchargement.
 *
 * Liste FERMÉE et explicite : le mécanisme ne doit couvrir que les URL qu'un
 * navigateur ouvre sans pouvoir porter d'en-tête. Toute autre route reste sur
 * l'en-tête `Authorization`.
 */
const ROUTES_TELECHARGEMENT = [
  { motif: /^(?:\/api)?\/uploads\/(\d+)\/raw\/?$/, ressource: 'uploads' },
  { motif: /^(?:\/api)?\/invoices\/(\d+)\/pdf\/?$/, ressource: 'invoices' },
];

/**
 * Passerelle de téléchargement.
 *
 * Placée AVANT les routes gardées. Sur les seules URL ci-dessus, elle accepte
 * un jeton de téléchargement en query string et pose `req.user`, ce qui permet
 * à `authMiddleware` de laisser passer. Partout ailleurs, elle ne fait rien.
 *
 * Un jeton fuité dans une URL ne donne alors accès qu'au fichier qu'on était
 * déjà en train d'ouvrir, et pendant deux minutes.
 */
function downloadTokenBridge(req, res, next) {
  if (req.method !== 'GET') return next();
  const token = typeof req.query.token === 'string' ? req.query.token : null;
  if (!token) return next();

  const route = ROUTES_TELECHARGEMENT.find((r) => r.motif.test(req.path));
  if (!route) return next();

  const id = req.path.match(route.motif)[1];
  // Chargé ici : downloadToken.js importe ce module, un require en tête
  // créerait un cycle.
  const { verifyDownloadToken } = require('../lib/downloadToken');
  const user = verifyDownloadToken(token, route.ressource, id);
  if (!user) {
    return res.status(401).json({
      message:
        'Jeton de téléchargement invalide, expiré, ou émis pour une autre ressource',
      statusCode: 401,
    });
  }

  req.user = user;
  req.isDownloadToken = true;
  next();
}

module.exports = {
  authMiddleware,
  downloadTokenBridge,
  ROUTES_TELECHARGEMENT,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
};
