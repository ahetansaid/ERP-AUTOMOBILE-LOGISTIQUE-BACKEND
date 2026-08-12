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
