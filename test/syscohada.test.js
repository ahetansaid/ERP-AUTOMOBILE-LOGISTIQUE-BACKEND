/**
 * Socle comptable SYSCOHADA.
 *
 * CE QUI EST VÉRIFIÉ
 *
 * La projection d'une écriture analytique en partie double — fonction pure,
 * donc testable sans base. C'est la pièce qui, fausse, produit une balance
 * équilibrée ET fausse : la pire des deux, parce qu'elle ne se voit pas.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  PLAN,
  MAPPING_DEFAUT,
  COMPTE_TRESORERIE,
  verifier,
  projeter,
} = require('../src/lib/syscohada');

const ecriture = (p) => ({
  nature: 'CHARGE',
  label: 'test',
  amountFcfa: -100000,
  cashAccountNature: 'CAISSE',
  ...p,
});

/* ── Équilibre ─────────────────────────────────────────────────────────── */

test('toute projection est équilibrée au franc près', () => {
  for (const nature of Object.keys(MAPPING_DEFAUT)) {
    for (const signe of [-1, 1]) {
      const l = projeter(ecriture({ nature, amountFcfa: signe * 4300000 }));
      const d = l.reduce((s, x) => s + x.debit, 0);
      const c = l.reduce((s, x) => s + x.credit, 0);
      assert.strictEqual(d, c, `${nature} (${signe > 0 ? 'entrée' : 'sortie'}) déséquilibrée`);
      assert.strictEqual(l.length, 2, 'une écriture analytique donne exactement deux lignes');
    }
  }
});

test('une sortie débite la destination et crédite la trésorerie', () => {
  const l = projeter(ecriture({ nature: 'PREPARATION', amountFcfa: -250000 }));
  const atelier = l.find((x) => x.compte === '624');
  const caisse = l.find((x) => x.compte === '571');
  assert.strictEqual(atelier.debit, 250000);
  assert.strictEqual(atelier.credit, 0);
  assert.strictEqual(caisse.credit, 250000);
  assert.strictEqual(caisse.debit, 0);
});

test('une entrée débite la trésorerie et crédite le produit', () => {
  const l = projeter(ecriture({ nature: 'VENTE', amountFcfa: 4300000 }));
  assert.strictEqual(l.find((x) => x.compte === '571').debit, 4300000);
  assert.strictEqual(l.find((x) => x.compte === '701').credit, 4300000);
});

/* ── Les règles métier qui coûtent cher si on les rate ─────────────────── */

test('l’achat d’un véhicule entre en STOCK, pas en charge', () => {
  // C'est l'erreur qui faisait afficher -143 937 718 F de résultat : passer en
  // charge le prix d'achat de véhicules encore invendus.
  const l = projeter(ecriture({ nature: 'ACHAT', amountFcfa: -2150000 }));
  const stock = l.find((x) => x.compte === '311');
  assert.ok(stock, 'ACHAT doit toucher le compte de stock 311');
  assert.strictEqual(stock.debit, 2150000);
  assert.strictEqual(
    l.some((x) => String(x.compte).startsWith('6')),
    false,
    'aucune ligne de charge : un véhicule invendu est un actif'
  );
});

test('un règlement solde le client et ne crée aucun produit', () => {
  // Sans cette règle, la vente facturée puis encaissée serait comptée deux
  // fois dans le chiffre d'affaires.
  const l = projeter(ecriture({ nature: 'REGLEMENT', amountFcfa: 3000000 }));
  assert.ok(l.find((x) => x.compte === '411'), 'doit toucher le compte client');
  assert.strictEqual(
    l.some((x) => x.compte === '701'),
    false,
    'un encaissement n’est pas une vente'
  );
});

test('la contrepartie suit le compte de trésorerie réellement utilisé', () => {
  const parNature = {
    CAISSE: '571',
    BANQUE: '521',
    MOBILE_MONEY: '531',
    AUTRE: '585',
  };
  for (const [nature, compte] of Object.entries(parNature)) {
    const l = projeter(ecriture({ cashAccountNature: nature }));
    assert.ok(
      l.some((x) => x.compte === compte),
      `${nature} doit créditer ${compte} — figer la contrepartie serait faux au premier virement`
    );
  }
  assert.deepStrictEqual(COMPTE_TRESORERIE, parNature);
});

/* ── Ce qui n'est PAS projeté ──────────────────────────────────────────── */

test('sans compte de trésorerie, rien n’est projeté — pas de compte d’attente', () => {
  // 545 écritures sur 1 245 n'ont aucun compte de trésorerie. Les ranger dans
  // un 471 ferait tomber la balance à zéro en masquant le problème.
  const l = projeter(ecriture({ cashAccountNature: null }));
  assert.deepStrictEqual(l, []);
});

test('un montant nul ne produit aucune ligne', () => {
  assert.deepStrictEqual(projeter(ecriture({ amountFcfa: 0 })), []);
});

test('une nature sans règle ne produit aucune ligne', () => {
  assert.deepStrictEqual(projeter(ecriture({ nature: 'INCONNUE' })), []);
});

/* ── Le mapping lui-même ───────────────────────────────────────────────── */

test('le mapping par défaut est cohérent avec le plan', () => {
  assert.deepStrictEqual(verifier(MAPPING_DEFAUT), []);
});

test('un compte absent du plan est refusé', () => {
  const p = verifier({ ...MAPPING_DEFAUT, CHARGE: { compte: '999', sens: 'DEBIT' } });
  assert.ok(p.some((x) => /999/.test(x)));
});

test('une nature oubliée est signalée — ses écritures seraient perdues', () => {
  const partiel = { ...MAPPING_DEFAUT };
  delete partiel.VENTE;
  const p = verifier(partiel);
  assert.ok(p.some((x) => /VENTE/.test(x) && /absente/i.test(x)));
});

test('chaque compte du plan porte une classe et un sens', () => {
  for (const c of PLAN) {
    assert.match(c.numero, /^\d{3}$/, `${c.numero} doit être un numéro à trois chiffres`);
    assert.strictEqual(c.classe, Number(c.numero[0]), `classe incohérente pour ${c.numero}`);
    assert.ok(['DEBIT', 'CREDIT'].includes(c.sens));
  }
});

test('les numéros de compte sont uniques', () => {
  const vus = new Set();
  for (const c of PLAN) {
    assert.strictEqual(vus.has(c.numero), false, `doublon : ${c.numero}`);
    vus.add(c.numero);
  }
});
