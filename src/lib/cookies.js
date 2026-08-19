/**
 * Jetons de session en cookies `httpOnly`.
 *
 * POURQUOI
 *
 * Les jetons vivaient dans `localStorage`, donc lisibles par tout script
 * s'exécutant sur l'origine. L'audit a montré ce que ça coûte : une injection
 * HTML dans un document d'impression suffisait à exfiltrer le jeton d'accès ET
 * celui de rafraîchissement, valable trente jours.
 *
 * La Content-Security-Policy rend désormais cette exécution très difficile. Un
 * cookie `httpOnly` la rend INUTILE : même un script qui parvient à s'exécuter
 * ne peut pas lire le cookie. C'est la différence entre rendre l'attaque dure
 * et la rendre sans objet.
 *
 * LE PRIX À PAYER, ET IL EST RÉEL
 *
 * Un cookie est envoyé AUTOMATIQUEMENT par le navigateur. C'est tout son
 * intérêt, et c'est aussi ce qui ouvre la falsification de requête entre sites :
 * un site tiers peut déclencher un POST vers l'API, et le navigateur y joindra
 * le cookie. Le jeton `Bearer`, lui, n'était jamais envoyé tout seul.
 *
 * Migrer sans traiter ce point échangerait une faille contre une autre. Voir
 * src/middleware/csrf.js — le contrôle d'origine n'est pas optionnel.
 *
 * CROSS-SITE, DONC `SameSite=None`
 *
 * Le front et l'API sont sur deux sous-domaines de `vercel.app`, qui figure sur
 * la Public Suffix List : impossible de partager un cookie de domaine parent.
 * Le cookie appartient donc à l'API et voyage en cross-site, ce qui impose
 * `SameSite=None; Secure`. En développement, front et API sont tous deux sur
 * `localhost` — même site — donc `Lax` suffit et `Secure` empêcherait le cookie
 * de s'installer en HTTP.
 */

const PRODUCTION = process.env.NODE_ENV === 'production';

const ACCES = 'parcauto_acces';
const RAFRAICHISSEMENT = 'parcauto_rafraichissement';

/** Trente minutes, comme le jeton d'accès. */
const TTL_ACCES = 30 * 60;
/** Trente jours, comme le jeton de rafraîchissement. */
const TTL_RAFRAICHISSEMENT = 30 * 24 * 60 * 60;

function options(maxAge) {
  return {
    httpOnly: true,
    // Un script ne doit jamais pouvoir le lire — c'est tout l'objet.
    secure: PRODUCTION,
    sameSite: PRODUCTION ? 'None' : 'Lax',
    path: '/',
    maxAge,
  };
}

/**
 * Sérialise un cookie sans dépendance.
 *
 * `cookie-parser` et `cookie` feraient l'affaire, mais ce projet vient de
 * retirer douze vulnérabilités venues de dépendances transitives : dix lignes
 * vérifiables valent mieux qu'un paquet de plus.
 */
function serialiser(nom, valeur, opt) {
  const bouts = [`${nom}=${encodeURIComponent(valeur)}`, `Path=${opt.path}`];
  if (opt.maxAge != null) bouts.push(`Max-Age=${opt.maxAge}`);
  if (opt.httpOnly) bouts.push('HttpOnly');
  if (opt.secure) bouts.push('Secure');
  if (opt.sameSite) bouts.push(`SameSite=${opt.sameSite}`);
  return bouts.join('; ');
}

/** Lit l'en-tête `Cookie` d'une requête. Retourne un objet, jamais null. */
function lireCookies(req) {
  const brut = req.headers?.cookie;
  if (!brut) return {};
  const out = {};
  for (const morceau of String(brut).split(';')) {
    const i = morceau.indexOf('=');
    if (i < 1) continue;
    const nom = morceau.slice(0, i).trim();
    if (!nom) continue;
    try {
      out[nom] = decodeURIComponent(morceau.slice(i + 1).trim());
    } catch {
      // Une valeur mal encodée n'est pas une raison de perdre les autres.
      out[nom] = morceau.slice(i + 1).trim();
    }
  }
  return out;
}

/** Pose les deux cookies de session sur la réponse. */
function poserSession(res, { accessToken, refreshToken }) {
  const entetes = [];
  if (accessToken) {
    entetes.push(serialiser(ACCES, accessToken, options(TTL_ACCES)));
  }
  if (refreshToken) {
    entetes.push(
      serialiser(RAFRAICHISSEMENT, refreshToken, options(TTL_RAFRAICHISSEMENT))
    );
  }
  if (entetes.length) res.append('Set-Cookie', entetes);
}

/**
 * Efface les deux cookies.
 *
 * Les attributs doivent être IDENTIQUES à la pose, sinon le navigateur crée un
 * second cookie au lieu de remplacer le premier — et la déconnexion ne
 * déconnecte rien.
 */
function effacerSession(res) {
  const mort = { ...options(0), maxAge: 0 };
  res.append('Set-Cookie', [
    serialiser(ACCES, '', mort),
    serialiser(RAFRAICHISSEMENT, '', mort),
  ]);
}

module.exports = {
  ACCES,
  RAFRAICHISSEMENT,
  TTL_ACCES,
  TTL_RAFRAICHISSEMENT,
  lireCookies,
  poserSession,
  effacerSession,
  serialiser,
};
