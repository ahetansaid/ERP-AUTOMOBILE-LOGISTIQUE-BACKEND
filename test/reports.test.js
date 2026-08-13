/**
 * Bornes de période.
 *
 * Le piège corrigé : les bornes construites en heure locale puis sérialisées en
 * UTC dérivaient d'un jour sur une colonne Date. Le serveur tourne à Cotonou
 * (UTC+1) et la base sur Neon en UTC — un rapport mensuel de juillet devenait
 * « 30/06 → 30/07 ».
 *
 * Ces tests figent le comportement attendu, quel que soit le fuseau du serveur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { periodBounds, TRANSITIONS } = require('../src/lib/reports');

const iso = (d) => d.toISOString().slice(0, 10);

test('le rapport quotidien couvre exactement sa journée', () => {
  const { start, end } = periodBounds('QUOTIDIEN', new Date('2026-07-08T12:00:00'));
  assert.equal(iso(start), '2026-07-08');
  assert.equal(iso(end), '2026-07-08');
});

test('la journée reste la bonne même saisie juste avant minuit', () => {
  // Cas typique du décalage : 23 h 30 en heure locale bascule au lendemain en
  // UTC si le calcul n'est pas fait en UTC.
  const { start } = periodBounds('QUOTIDIEN', new Date('2026-07-08T23:30:00'));
  assert.equal(iso(start), '2026-07-08');
});

test('la semaine va du lundi au dimanche', () => {
  // 8 juillet 2026 est un mercredi.
  const { start, end } = periodBounds('HEBDOMADAIRE', new Date('2026-07-08T12:00:00'));
  assert.equal(iso(start), '2026-07-06', 'lundi');
  assert.equal(iso(end), '2026-07-12', 'dimanche');
});

test('un dimanche appartient à la semaine qui vient de finir', () => {
  const { start, end } = periodBounds('HEBDOMADAIRE', new Date('2026-07-12T10:00:00'));
  assert.equal(iso(start), '2026-07-06');
  assert.equal(iso(end), '2026-07-12');
});

test('le mois couvre du premier au dernier jour', () => {
  const { start, end } = periodBounds('MENSUEL', new Date('2026-07-08T12:00:00'));
  assert.equal(iso(start), '2026-07-01');
  assert.equal(iso(end), '2026-07-31');
});

test('les fins de mois irrégulières sont correctes', () => {
  const cas = [
    ['2026-01-31', '2026-01-01', '2026-01-31'],
    ['2026-02-15', '2026-02-01', '2026-02-28'], // année non bissextile
    ['2024-02-15', '2024-02-01', '2024-02-29'], // année bissextile
    ['2026-04-10', '2026-04-01', '2026-04-30'], // mois de 30 jours
    ['2026-12-01', '2026-12-01', '2026-12-31'],
  ];
  for (const [ref, attenduDebut, attenduFin] of cas) {
    const { start, end } = periodBounds('MENSUEL', new Date(`${ref}T23:30:00`));
    assert.equal(iso(start), attenduDebut, `début pour ${ref}`);
    assert.equal(iso(end), attenduFin, `fin pour ${ref}`);
  }
});

test('le cycle de vie interdit les raccourcis', () => {
  // Un rapport non relu ne se diffuse pas.
  assert.ok(!TRANSITIONS.GENERE.includes('DIFFUSE'));
  assert.ok(!TRANSITIONS.EN_REVUE.includes('DIFFUSE'));
  assert.ok(TRANSITIONS.APPROUVE.includes('DIFFUSE'));
});

test('un rapport diffusé est terminal', () => {
  assert.deepEqual(TRANSITIONS.DIFFUSE, []);
});

test('un rapport approuvé peut être renvoyé en correction', () => {
  // Sinon une erreur découverte après coup serait irrattrapable.
  assert.ok(TRANSITIONS.APPROUVE.includes('A_CORRIGER'));
  assert.ok(TRANSITIONS.A_CORRIGER.includes('EN_REVUE'));
});

/* ── Le coût des ventes ne porte que sur ce qui est vendu ─────────────────── */

const { COST_NATURES: NATURES_DE_COUT } = require('../src/lib/ledger');

test('les natures de coût sont celles qui composent un coût de revient', () => {
  // profitAndLoss n'agrège que celles-ci face au produit ; une nature ajoutée
  // ici entre mécaniquement dans la marge.
  assert.deepEqual(NATURES_DE_COUT, [
    'ACHAT',
    'LOGISTIQUE',
    'TAXE',
    'MANUTENTION',
    'PREPARATION',
  ]);
});

test('le compte de résultat sépare le stock du coût des ventes', () => {
  // Garde-fou structurel : le calcul doit restreindre le coût aux véhicules
  // ayant une écriture de VENTE. Sans cette restriction, les 45 véhicules en
  // stock passaient en charge et la marge affichait −143 937 718 F.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'lib', 'costing.js'),
    'utf8'
  );
  assert.match(source, /nature:\s*'VENTE'/, 'les véhicules vendus doivent être identifiés');
  assert.match(source, /vehicleId:\s*\{\s*in:\s*vendus\s*\}/, 'le coût doit être restreint aux vendus');
  assert.match(source, /stockValue/, 'le stock doit être exposé à part');
});

test('la marge ne compte pas un produit dont le coût est inconnu', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'lib', 'costing.js'),
    'utf8'
  );
  // grossMargin doit partir du produit RAPPROCHÉ, jamais du produit total :
  // 34 850 000 F de ventes portent sur des véhicules non chiffrés.
  assert.match(source, /grossMargin:\s*revenueRapproche\s*-\s*costOfSales/);
  assert.doesNotMatch(source, /grossMargin:\s*revenue\s*-\s*costOfSales/);
});
