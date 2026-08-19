/**
 * Session en cookies httpOnly, et le CSRF qui vient avec.
 *
 * Le passage aux cookies supprime le vol de jeton par script ET introduit la
 * falsification de requête entre sites : un cookie voyage tout seul, un
 * `Bearer` non. Ces tests tiennent les deux bouts — sans quoi on aurait échangé
 * une faille contre une autre.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { lireCookies, serialiser, ACCES, RAFRAICHISSEMENT } = require('../src/lib/cookies');
const { csrfProtection, MODIFIANTES } = require('../src/middleware/csrf');

const AUTORISEES = ['https://app.exemple.test'];

/** Fausse réponse Express, sans réseau. */
function rep() {
  const r = { statut: null, corps: null };
  r.status = (c) => { r.statut = c; return r; };
  r.json = (c) => { r.corps = c; return r; };
  return r;
}

/* ── Lecture des cookies ──────────────────────────────────────────────────── */

test('l’en-tête Cookie est lu sans dépendance', () => {
  const req = { headers: { cookie: `${ACCES}=abc; autre=1; ${RAFRAICHISSEMENT}=def` } };
  const c = lireCookies(req);
  assert.equal(c[ACCES], 'abc');
  assert.equal(c[RAFRAICHISSEMENT], 'def');
  assert.equal(c.autre, '1');
});

test('une valeur mal encodée ne fait pas perdre les autres', () => {
  const req = { headers: { cookie: `casse=%E0%A4%A; ${ACCES}=bon` } };
  assert.equal(lireCookies({ headers: { cookie: '' } })[ACCES], undefined);
  assert.equal(lireCookies(req)[ACCES], 'bon');
});

test('absence d’en-tête donne un objet, jamais null', () => {
  assert.deepEqual(lireCookies({ headers: {} }), {});
  assert.deepEqual(lireCookies({}), {});
});

/* ── Attributs du cookie ──────────────────────────────────────────────────── */

test('le cookie de session est illisible par script', () => {
  // C'est tout l'objet de la migration : même un script qui s'exécute ne peut
  // pas le lire.
  const c = serialiser(ACCES, 'jeton', {
    httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 1800,
  });
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=None/);
  assert.match(c, /Max-Age=1800/);
});

test('la valeur est encodée — un jeton ne casse pas l’en-tête', () => {
  const c = serialiser(ACCES, 'a b;c', { path: '/' });
  assert.doesNotMatch(c.split(';')[0], /[; ]/, 'la valeur ne doit pas rompre la sérialisation');
});

/* ── CSRF ─────────────────────────────────────────────────────────────────── */

const csrf = csrfProtection(AUTORISEES);
const passe = (req) => {
  let suivant = false;
  const r = rep();
  csrf(req, r, () => { suivant = true; });
  return { suivant, code: r.statut };
};

test('une lecture n’est jamais contrôlée', () => {
  for (const m of ['GET', 'HEAD', 'OPTIONS']) {
    assert.ok(!MODIFIANTES.has(m));
    assert.equal(passe({ method: m, headers: { cookie: `${ACCES}=x` } }).suivant, true, m);
  }
});

test('une requête portant un Bearer n’est pas contrôlée', () => {
  // Le navigateur n'ajoute jamais cet en-tête tout seul : pas de CSRF possible.
  const r = passe({
    method: 'POST',
    headers: { authorization: 'Bearer abc', origin: 'https://mechant.test' },
  });
  assert.equal(r.suivant, true);
});

test('sans cookie de session, rien à détourner', () => {
  assert.equal(passe({ method: 'POST', headers: {} }).suivant, true);
});

test('une écriture par cookie depuis l’application passe', () => {
  const r = passe({
    method: 'POST',
    headers: { cookie: `${ACCES}=x`, origin: AUTORISEES[0] },
  });
  assert.equal(r.suivant, true);
});

test('une écriture par cookie depuis un autre site est REFUSÉE', () => {
  const r = passe({
    method: 'POST',
    headers: { cookie: `${ACCES}=x`, origin: 'https://mechant.test' },
    path: '/vehicles/1',
  });
  assert.equal(r.suivant, false);
  assert.equal(r.code, 403);
});

test('une écriture par cookie SANS origine est refusée — échec fermé', () => {
  // Un client incapable d'envoyer une origine doit utiliser un Bearer.
  const r = passe({ method: 'POST', headers: { cookie: `${ACCES}=x` }, path: '/vehicles/1' });
  assert.equal(r.suivant, false);
  assert.equal(r.code, 403);
});

test('le Referer sert de second recours, sur schéma et hôte seulement', () => {
  const bon = passe({
    method: 'DELETE',
    headers: { cookie: `${ACCES}=x`, referer: `${AUTORISEES[0]}/vehicules/12` },
  });
  assert.equal(bon.suivant, true);

  const mauvais = passe({
    method: 'DELETE',
    headers: { cookie: `${ACCES}=x`, referer: 'https://mechant.test/page' },
    path: '/x',
  });
  assert.equal(mauvais.suivant, false);

  const illisible = passe({
    method: 'DELETE',
    headers: { cookie: `${ACCES}=x`, referer: 'pas-une-url' },
    path: '/x',
  });
  assert.equal(illisible.suivant, false, 'un Referer illisible vaut absent');
});

test('toutes les méthodes modifiantes sont couvertes', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = passe({
      method: m,
      headers: { cookie: `${ACCES}=x`, origin: 'https://mechant.test' },
      path: '/x',
    });
    assert.equal(r.suivant, false, m + ' doit être contrôlée');
  }
});
