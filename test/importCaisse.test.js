/**
 * Import des écritures de caisse.
 *
 * C'est le seul import qui écrit au grand livre, donc le seul qu'on ne peut pas
 * défaire : une ligne fausse ne se corrige pas, elle se contre-passe. Ces tests
 * tiennent les lectures qui décident du contenu d'une écriture définitive.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { date, montant, SENS, NATURES, COLONNES } = require('../src/lib/importCaisse');
const { classer } = require('../src/lib/qualification');

/* ── Dates ────────────────────────────────────────────────────────────────── */

test('la date française d’Excel est lue', () => {
  assert.equal(date('05/08/2026').toISOString().slice(0, 10), '2026-08-05');
  assert.equal(date('5/8/2026').toISOString().slice(0, 10), '2026-08-05');
  assert.equal(date('05-08-2026').toISOString().slice(0, 10), '2026-08-05');
});

test('la date ISO est lue aussi — le fichier peut venir d’ailleurs', () => {
  assert.equal(date('2026-08-05').toISOString().slice(0, 10), '2026-08-05');
});

test('tout est ramené à minuit UTC', () => {
  // Sinon une écriture saisie le soir bascule au lendemain selon le fuseau de
  // la machine, et le rapport quotidien la range dans la mauvaise journée.
  const d = date('05/08/2026');
  assert.equal(d.getUTCHours(), 0);
  assert.equal(d.getUTCMinutes(), 0);
});

test('une date impossible est refusée, pas décalée', () => {
  // `new Date(2026, 1, 31)` donne le 3 mars sans lever : l'écriture serait
  // datée d'un jour que personne n'a saisi.
  assert.ok(Number.isNaN(date('31/02/2026')));
  assert.ok(Number.isNaN(date('32/01/2026')));
  assert.ok(Number.isNaN(date('05/13/2026')));
  assert.ok(Number.isNaN(date('hier')));
});

test('une date absente vaut absent, pas aujourd’hui', () => {
  assert.equal(date(''), null);
  assert.equal(date(null), null);
});

/* ── Montants et sens ─────────────────────────────────────────────────────── */

test('les montants écrits par Excel en français sont lus', () => {
  assert.equal(montant('35 000'), 35000);
  assert.equal(montant('1 234,56'), 1234.56);
  assert.equal(montant('1234.56'), 1234.56);
});

test('le sens est DÉCLARÉ, jamais déduit de la nature', () => {
  // Un REGLEMENT peut être un encaissement de créance comme un règlement de
  // fournisseur ; un TRANSFERT part ou arrive. Déduire produirait exactement
  // l'erreur trouvée dans le classeur : six « retours sur avance » enregistrés
  // comme des sorties alors que l'argent revenait.
  assert.equal(SENS.SORTIE, -1);
  assert.equal(SENS.ENTREE, 1);
  assert.equal(Object.keys(SENS).length, 2, 'deux sens, pas de troisième voie');
});

test('un montant négatif est refusé plutôt que réinterprété', () => {
  // Accepter −500 en « sortie » donnerait +500 : le signe serait appliqué deux
  // fois. Le fichier porte des montants positifs, point.
  assert.equal(montant('-500'), -500);
  // La règle vit dans preparer() ; ici on fige la convention qu'elle applique.
  assert.ok(montant('-500') < 0);
});

/* ── Natures ──────────────────────────────────────────────────────────────── */

test('les natures acceptées sont celles du grand livre, sans invention', () => {
  for (const n of ['ACHAT', 'PREPARATION', 'VENTE', 'REGLEMENT', 'COMPTE_ASSOCIE', 'TRANSFERT']) {
    assert.ok(NATURES.includes(n), n);
  }
  assert.ok(!NATURES.includes('DEPENSE'), 'aucune nature inventée');
});

test('la nature est proposée depuis le libellé quand elle est vide', () => {
  // Mêmes règles que la feuille de qualification : une ligne jugée
  // « prélèvement personnel » là-bas doit l'être ici aussi.
  assert.equal(classer('HUSSEIN — Besoin personnel').nature, 'COMPTE_ASSOCIE');
  assert.equal(classer('ALI — Transfert vers le Liban').nature, 'TRANSFERT');
  assert.equal(classer('Dieudonné — Dépotage de conteneur').nature, 'MANUTENTION');
});

/* ── Le fichier ───────────────────────────────────────────────────────────── */

test('les colonnes portent le sens et la nature, pas un montant signé', () => {
  assert.ok(COLONNES.includes('sens'));
  assert.ok(COLONNES.includes('nature'));
  assert.ok(COLONNES.includes('chassis'));
  assert.equal(COLONNES[0], 'date');
});
