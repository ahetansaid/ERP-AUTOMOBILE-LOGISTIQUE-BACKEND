/**
 * Jetons de téléchargement.
 *
 * Un PDF ouvert par `window.open` ne peut pas porter d'en-tête `Authorization`.
 * Le jeton d'accès complet transitait donc par la query string — donc par
 * l'historique du navigateur, l'en-tête `Referer` et les journaux des proxies —
 * et il ouvrait toute l'API pendant trente minutes.
 *
 * Ces tests figent le remplacement : un jeton étroit, lié à une seule
 * ressource, valable deux minutes, et non substituable à un jeton de session.
 *
 * Aucune base n'est nécessaire : tout se joue avant la requête.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const {
  issueDownloadToken,
  verifyDownloadToken,
  PURPOSE,
  TTL_SECONDS,
} = require('../src/lib/downloadToken');
const {
  authMiddleware,
  downloadTokenBridge,
  ROUTES_TELECHARGEMENT,
  JWT_SECRET,
} = require('../src/middleware/auth');

const UTILISATEUR = { id: 7, email: 'gerant@kadie.bj', role: 'ADMIN', companyId: 3 };

/** Fausse réponse Express : retient le statut sans écrire sur le réseau. */
function fausseReponse() {
  const rep = { statut: null, corps: null };
  rep.status = (code) => {
    rep.statut = code;
    return rep;
  };
  rep.json = (corps) => {
    rep.corps = corps;
    return rep;
  };
  return rep;
}

/* ── Périmètre du jeton ───────────────────────────────────────────────────── */

test('un jeton n’ouvre que la ressource pour laquelle il a été émis', () => {
  const jeton = issueDownloadToken(UTILISATEUR, 'uploads', 42);

  const ok = verifyDownloadToken(jeton, 'uploads', '42');
  assert.equal(ok.id, 7);
  assert.equal(ok.companyId, 3);

  // Autre fichier, autre famille de ressource : refusé dans les deux cas.
  assert.equal(verifyDownloadToken(jeton, 'uploads', '43'), null);
  assert.equal(verifyDownloadToken(jeton, 'invoices', '42'), null);
});

test('le jeton porte la société : la lecture reste cloisonnée', () => {
  const charge = jwt.verify(issueDownloadToken(UTILISATEUR, 'invoices', 9), JWT_SECRET);
  assert.equal(charge.companyId, 3);
  assert.equal(charge.scope, 'invoices:9');
  assert.equal(charge.purpose, PURPOSE);
});

test('la durée de vie se compte en minutes, pas en demi-heures', () => {
  assert.ok(TTL_SECONDS <= 300, 'un jeton présent dans une URL doit expirer vite');
  const charge = jwt.verify(issueDownloadToken(UTILISATEUR, 'uploads', 1), JWT_SECRET);
  assert.equal(charge.exp - charge.iat, TTL_SECONDS);
});

test('un utilisateur sans société ne peut pas obtenir de jeton', () => {
  assert.throws(() => issueDownloadToken({ id: 1, companyId: null }, 'uploads', 1));
  assert.throws(() => issueDownloadToken(UTILISATEUR, 'uploads', null));
});

/* ── Non-substituable à un jeton de session ───────────────────────────────── */

test('un jeton de téléchargement ne vaut pas jeton de session', () => {
  const jeton = issueDownloadToken(UTILISATEUR, 'uploads', 42);
  const req = { headers: { authorization: `Bearer ${jeton}` } };
  const rep = fausseReponse();
  let suivant = false;

  authMiddleware(req, rep, () => {
    suivant = true;
  });

  assert.equal(suivant, false, 'il ne doit pas ouvrir l’API');
  assert.equal(rep.statut, 401);
});

test('un jeton d’accès en query string n’est plus accepté', () => {
  const acces = jwt.sign({ id: 7, role: 'ADMIN', companyId: 3 }, JWT_SECRET, {
    expiresIn: '30m',
  });
  const req = { method: 'GET', headers: {}, path: '/uploads/42/raw', query: { token: acces } };
  const rep = fausseReponse();
  let passeLaPasserelle = false;

  downloadTokenBridge(req, rep, () => {
    passeLaPasserelle = true;
  });

  // La passerelle refuse : un jeton d'accès n'est pas un jeton de téléchargement.
  assert.equal(passeLaPasserelle, false);
  assert.equal(rep.statut, 401);
  assert.equal(req.user, undefined);
});

/* ── Passerelle : liste fermée d’URL ──────────────────────────────────────── */

test('la passerelle ne couvre que les URL qu’un navigateur ouvre sans en-tête', () => {
  const chemins = ROUTES_TELECHARGEMENT.map((r) => r.motif.source);
  assert.equal(chemins.length, 2, 'toute nouvelle URL doit être un choix explicite');
  assert.ok(ROUTES_TELECHARGEMENT.every((r) => ['uploads', 'invoices'].includes(r.ressource)));
});

test('la passerelle ignore les autres routes, même avec un jeton valide', () => {
  const jeton = issueDownloadToken(UTILISATEUR, 'uploads', 42);
  const req = { method: 'GET', headers: {}, path: '/vehicles', query: { token: jeton } };
  let suivant = false;

  downloadTokenBridge(req, fausseReponse(), () => {
    suivant = true;
  });

  // Elle laisse passer sans authentifier : authMiddleware exigera l'en-tête.
  assert.equal(suivant, true);
  assert.equal(req.user, undefined);
});

test('la passerelle n’authentifie pas une écriture', () => {
  const jeton = issueDownloadToken(UTILISATEUR, 'uploads', 42);
  const req = { method: 'DELETE', headers: {}, path: '/uploads/42/raw', query: { token: jeton } };
  let suivant = false;

  downloadTokenBridge(req, fausseReponse(), () => {
    suivant = true;
  });

  assert.equal(suivant, true);
  assert.equal(req.user, undefined, 'un jeton de lecture ne doit jamais autoriser une suppression');
});

test('la passerelle authentifie le téléchargement légitime, et authMiddleware s’efface', () => {
  const jeton = issueDownloadToken(UTILISATEUR, 'invoices', 9);
  const req = { method: 'GET', headers: {}, path: '/invoices/9/pdf', query: { token: jeton } };
  let passerelle = false;
  let garde = false;

  downloadTokenBridge(req, fausseReponse(), () => {
    passerelle = true;
  });
  assert.equal(passerelle, true);
  assert.equal(req.user.companyId, 3);
  assert.equal(req.isDownloadToken, true);

  authMiddleware(req, fausseReponse(), () => {
    garde = true;
  });
  assert.equal(garde, true, 'la requête déjà authentifiée doit poursuivre');
});

test('un jeton émis pour un autre fichier est refusé sur l’URL visée', () => {
  const jeton = issueDownloadToken(UTILISATEUR, 'uploads', 42);
  const req = { method: 'GET', headers: {}, path: '/uploads/43/raw', query: { token: jeton } };
  const rep = fausseReponse();
  let suivant = false;

  downloadTokenBridge(req, rep, () => {
    suivant = true;
  });

  assert.equal(suivant, false);
  assert.equal(rep.statut, 401);
});

test('un jeton expiré est refusé', () => {
  const expire = jwt.sign(
    { purpose: PURPOSE, id: 7, companyId: 3, scope: 'uploads:42' },
    JWT_SECRET,
    { expiresIn: -10 }
  );
  assert.equal(verifyDownloadToken(expire, 'uploads', '42'), null);
});

test('un jeton signé avec un autre secret est refusé', () => {
  const faux = jwt.sign(
    { purpose: PURPOSE, id: 7, companyId: 3, scope: 'uploads:42' },
    'un-autre-secret-totalement-different',
    { expiresIn: 120 }
  );
  assert.equal(verifyDownloadToken(faux, 'uploads', '42'), null);
});
