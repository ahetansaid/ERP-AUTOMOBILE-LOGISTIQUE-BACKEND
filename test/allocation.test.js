/**
 * Moteur de répartition — c'est ici que se joue l'exactitude des montants.
 *
 * La propriété critique : la somme des parts doit égaler EXACTEMENT le montant
 * réparti. Un franc perdu à chaque ventilation et le total du conteneur ne se
 * réconcilie plus jamais avec la somme des véhicules — le défaut même relevé
 * dans les classeurs d'origine.
 *
 * Lancement : npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeShares, NATURE_BY_TYPE } = require('../src/lib/allocation');

/** Véhicules réels du conteneur HAMU 1376147, d'après le connaissement. */
const HAMU = [
  { id: 1, weightKg: 1676, purchasePriceFcfa: 3794130 },
  { id: 2, weightKg: 1676, purchasePriceFcfa: 3501186 },
  { id: 3, weightKg: 1585, purchasePriceFcfa: 2225058 },
  { id: 4, weightKg: 1585, purchasePriceFcfa: 1954464 },
];

const somme = (parts) => parts.reduce((s, p) => s + p.part, 0);

test('la somme des parts égale exactement le montant, quel que soit le mode', () => {
  const montant = 3078000;
  for (const mode of ['PAR_VEHICULE', 'PRORATA_POIDS', 'PRORATA_VALEUR']) {
    const parts = computeShares(montant, HAMU, mode);
    assert.equal(somme(parts), montant, `mode ${mode}`);
  }
});

test('un montant non divisible ne perd pas son reste', () => {
  // 1 000 000 sur 3 : 333 333,33 par part. Le reste doit être attribué,
  // jamais laissé de côté.
  const parts = computeShares(1000000, HAMU.slice(0, 3), 'PAR_VEHICULE');
  assert.equal(somme(parts), 1000000);
  assert.deepEqual(
    parts.map((p) => p.part).sort((a, b) => b - a),
    [333334, 333333, 333333]
  );
});

test('le reste va à la plus grosse part, pas au premier venu', () => {
  const vehicules = [
    { id: 1, weightKg: 100 },
    { id: 2, weightKg: 900 }, // dominant
  ];
  const parts = computeShares(1001, vehicules, 'PRORATA_POIDS');
  assert.equal(somme(parts), 1001);
  const dominant = parts.find((p) => p.vehicleId === 2);
  assert.equal(dominant.part, 901, 'le reste doit rejoindre la part dominante');
});

test('le prorata du poids respecte les proportions', () => {
  const parts = computeShares(4000, HAMU, 'PRORATA_POIDS');
  const p1 = parts.find((p) => p.vehicleId === 1).part;
  const p3 = parts.find((p) => p.vehicleId === 3).part;
  // 1676 kg contre 1585 kg : la part la plus lourde doit être la plus grande.
  assert.ok(p1 > p3, 'un véhicule plus lourd supporte une part plus lourde');
});

test('le prorata de la valeur respecte les proportions', () => {
  const parts = computeShares(1000000, HAMU, 'PRORATA_VALEUR');
  const p1 = parts.find((p) => p.vehicleId === 1).part;
  const p4 = parts.find((p) => p.vehicleId === 4).part;
  // 3 794 130 contre 1 954 464 : environ le double.
  assert.ok(p1 > p4 * 1.5, 'la part suit la valeur du véhicule');
});

test('une clé inexploitable retombe sur des parts égales', () => {
  // Poids absents : sans garde-fou, tout serait imputé au premier véhicule.
  const sansPoids = HAMU.map((v) => ({ id: v.id }));
  const parts = computeShares(4000, sansPoids, 'PRORATA_POIDS');
  assert.equal(somme(parts), 4000);
  assert.deepEqual(
    parts.map((p) => p.part),
    [1000, 1000, 1000, 1000],
    'à défaut de clé, la répartition doit rester équitable'
  );
});

test('le montant fixe ne réclame aucun total', () => {
  const parts = computeShares(0, HAMU, 'MONTANT_FIXE', {
    1: 500000,
    3: 250000,
  });
  assert.equal(parts.length, 2, 'seuls les véhicules dotés reçoivent une part');
  assert.equal(somme(parts), 750000);
});

test('un dossier sans véhicule ne produit aucune part', () => {
  assert.deepEqual(computeShares(100000, [], 'PAR_VEHICULE'), []);
});

test('un véhicule unique reçoit la totalité', () => {
  const parts = computeShares(777777, [{ id: 9, weightKg: 1200 }], 'PRORATA_POIDS');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].part, 777777);
});

test('chaque type de frais est rattaché à une nature de coût', () => {
  const NATURES_DE_COUT = ['ACHAT', 'LOGISTIQUE', 'TAXE', 'MANUTENTION', 'PREPARATION'];
  for (const [type, nature] of Object.entries(NATURE_BY_TYPE)) {
    assert.ok(
      NATURES_DE_COUT.includes(nature),
      `${type} pointe vers ${nature}, qui n'entre pas dans le coût de revient`
    );
  }
});
