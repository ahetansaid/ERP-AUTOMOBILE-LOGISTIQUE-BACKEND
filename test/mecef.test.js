/**
 * Connecteur e-MECeF.
 *
 * CE QUI EST VÉRIFIÉ ICI
 *
 * La charge utile envoyée à la DGI, et le comportement du client face aux
 * réponses d'erreur. Rien ne sort sur le réseau : `fetch` est remplacé, et
 * `construireCharge` est pure par construction.
 *
 * C'est la seule partie du chemin fiscal qu'on peut tenir sans jeton — et
 * c'est aussi celle qui, fausse, produit une déclaration fausse.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  construireCharge,
  montant,
  message,
  client,
  normaliser,
  ErreurMecef,
} = require('../src/lib/mecef');

const BASE = {
  ifu: '3202367439923',
  groupeTaxe: 'B',
  operateur: 'KADIE AUTO',
  vehicule: { brand: 'Toyota', model: 'RAV4', vin: 'JTMBFREV30D123456' },
  montantTotal: 4300000,
};

/* ── La charge utile ───────────────────────────────────────────────────── */

test('la charge porte un article unique désigné par le châssis', () => {
  const c = construireCharge(BASE);
  assert.strictEqual(c.items.length, 1, 'une facture = un véhicule = un article');
  assert.match(c.items[0].name, /Toyota RAV4/);
  assert.match(c.items[0].name, /JTMBFREV30D123456/, 'le châssis identifie le bien vendu');
  assert.strictEqual(c.items[0].quantity, 1);
  assert.strictEqual(c.ifu, '3202367439923');
});

test('le total du paiement égale celui de l’article', () => {
  const c = construireCharge(BASE);
  assert.strictEqual(c.payment[0].amount, c.items[0].price);
  // Un écart ici passerait le contrôle de la DGI et fausserait la déclaration.
  assert.strictEqual(c.payment.reduce((s, p) => s + p.amount, 0), 4300000);
});

test('les montants sont des entiers — le franc CFA n’a pas de centime', () => {
  assert.strictEqual(montant(4300000.4), 4300000);
  assert.strictEqual(montant(4300000.6), 4300001);
  assert.strictEqual(montant('2950000'), 2950000);
  const c = construireCharge({ ...BASE, montantTotal: 1234567.89 });
  assert.strictEqual(Number.isInteger(c.items[0].price), true);
  assert.strictEqual(c.items[0].price, 1234568);
});

test('un montant illisible est refusé avant tout appel réseau', () => {
  assert.throws(() => montant('quatre millions'), ErreurMecef);
  assert.throws(() => construireCharge({ ...BASE, montantTotal: 'abc' }), ErreurMecef);
});

test('sans IFU, la charge n’est pas construite', () => {
  assert.throws(
    () => construireCharge({ ...BASE, ifu: null }),
    (e) => e instanceof ErreurMecef && /IFU/.test(e.message)
  );
});

test('le groupe de taxation n’est jamais deviné', () => {
  // Choisir un taux de TVA par défaut serait le genre de supposition qui se
  // découvre au contrôle fiscal.
  assert.throws(
    () => construireCharge({ ...BASE, groupeTaxe: undefined }),
    (e) => e instanceof ErreurMecef && /taxation/i.test(e.message)
  );
});

test('un montant nul ou négatif est refusé', () => {
  for (const v of [0, -1, -4300000]) {
    assert.throws(() => construireCharge({ ...BASE, montantTotal: v }), ErreurMecef);
  }
});

test('un véhicule sans marque ni modèle reste désignable', () => {
  const c = construireCharge({ ...BASE, vehicule: { vin: 'ABC12345678901234' } });
  assert.match(c.items[0].name, /Véhicule/);
  assert.match(c.items[0].name, /ABC12345678901234/);
});

test('le client est omis plutôt qu’envoyé vide', () => {
  const sans = construireCharge(BASE);
  assert.strictEqual(sans.client, undefined);
  const avec = construireCharge({ ...BASE, client: { name: 'SARL Exemple' } });
  assert.strictEqual(avec.client.name, 'SARL Exemple');
});

/* ── Les codes de la DGI ───────────────────────────────────────────────── */

test('les codes DGI sont traduits en consignes, pas en numéros', () => {
  assert.match(message(8), /aucun article/i);
  assert.match(message(1), /en attente/i);
  assert.match(message(20), /déjà finalisée|inexistante/i);
  // Un code inconnu ne doit pas produire « undefined ».
  assert.match(message(4242), /4242/);
});

/* ── Le client HTTP ────────────────────────────────────────────────────── */

test('un jeton absent est refusé à la construction, pas au premier appel', () => {
  assert.throws(() => client({ token: '' }), (e) => e instanceof ErreurMecef && /[Jj]eton/.test(e.message));
});

const avecFetch = async (impl, fn) => {
  const vrai = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = vrai;
  }
};

const reponse = (corps, ok = true, status = 200) => ({
  ok,
  status,
  text: async () => JSON.stringify(corps),
});

test('un code d’erreur applicatif dans une réponse 200 lève quand même', async () => {
  await avecFetch(async () => reponse({ code: 8, errorDesc: 'no items' }), async () => {
    const api = client({ token: 'x' });
    await assert.rejects(() => api.statut(), (e) => e instanceof ErreurMecef && e.code === 8);
  });
});

test('un 401 dit que le jeton est en cause, pas que le réseau a lâché', async () => {
  await avecFetch(async () => reponse({}, false, 401), async () => {
    const api = client({ token: 'perime' });
    await assert.rejects(
      () => api.statut(),
      (e) => e.code === 'JETON_REFUSE' && /expiré|refusé/i.test(e.message)
    );
  });
});

test('un délai dépassé n’invite PAS à réessayer', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await avecFetch(async () => { throw abort; }, async () => {
    const api = client({ token: 'x', timeoutMs: 5 });
    await assert.rejects(
      () => api.statut(),
      (e) => e.code === 'DELAI_DEPASSE' && /PEUT-ÊTRE/.test(e.message)
    );
  });
});

/* ── Le cycle en deux temps ────────────────────────────────────────────── */

test('l’uid est remis à l’appelant AVANT la confirmation', async () => {
  const ordre = [];
  await avecFetch(async (url, init) => {
    if (init?.method === 'POST') { ordre.push('creer'); return reponse({ uid: 'U-1', total: 4300000 }); }
    ordre.push('confirmer');
    return reponse({ codeMECeFDGI: 'MECEF-ABC', qrCode: 'QR', total: 4300000 });
  }, async () => {
    const r = await normaliser({ token: 'x' }, construireCharge(BASE), async (uid) => {
      ordre.push(`persiste:${uid}`);
    });
    assert.deepStrictEqual(ordre, ['creer', 'persiste:U-1', 'confirmer']);
    assert.strictEqual(r.code, 'MECEF-ABC');
    assert.strictEqual(r.uid, 'U-1');
    assert.strictEqual(r.qrCode, 'QR');
  });
});

test('une confirmation sans code MECeF n’est pas une normalisation', async () => {
  await avecFetch(async (url, init) =>
    init?.method === 'POST' ? reponse({ uid: 'U-2' }) : reponse({ qrCode: 'QR' }),
  async () => {
    await assert.rejects(
      () => normaliser({ token: 'x' }, construireCharge(BASE), () => {}),
      (e) => e instanceof ErreurMecef && /code MECeF/.test(e.message)
    );
  });
});

test('une création sans uid s’arrête avant de confirmer', async () => {
  let confirmations = 0;
  await avecFetch(async (url, init) => {
    if (init?.method === 'POST') return reponse({ total: 4300000 });
    confirmations += 1;
    return reponse({ codeMECeFDGI: 'X' });
  }, async () => {
    await assert.rejects(() => normaliser({ token: 'x' }, construireCharge(BASE)), ErreurMecef);
    assert.strictEqual(confirmations, 0, 'rien ne doit être confirmé sans identifiant');
  });
});
