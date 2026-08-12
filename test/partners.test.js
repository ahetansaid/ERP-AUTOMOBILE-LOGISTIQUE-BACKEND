/**
 * Rapprochement des tiers.
 *
 * Les données d'origine contenaient un même prestataire sous plusieurs
 * orthographes — « Razack », « Soudeur Razack », « Razack (Soudeur EURO) ».
 * Impossible, dans ces conditions, de totaliser ce qu'il coûte.
 *
 * Le rapprochement est volontairement CONSERVATEUR : les suffixes de parc
 * EURO/USA sont conservés, faute de savoir s'il s'agit d'une même personne sur
 * deux parcs ou de deux homonymes. Ces tests figent ce choix — mieux vaut deux
 * tiers qu'on fusionne d'un clic qu'un seul qu'on ne peut plus séparer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { slugify, coreSlug, guessSpecialty, mergeKinds } = require('../src/lib/partners');

test('les mots de métier sont retirés : ils décrivent la fonction, pas la personne', () => {
  assert.equal(slugify('Soudeur Razack'), 'razack');
  assert.equal(slugify('Razack'), 'razack');
  assert.equal(slugify('Peintre Jean'), 'jean');
  assert.equal(slugify('Samiou Mécanicien'), 'samiou');
});

test('les variantes de ponctuation et de casse convergent', () => {
  const attendu = 'jean-euro';
  for (const graphie of [
    'Jean EURO',
    'Jean (Peintre EURO)',
    'Peintre Jean EURO',
    'JEAN  euro',
    'jean-euro',
  ]) {
    assert.equal(slugify(graphie), attendu, graphie);
  }
});

test('les accents sont neutralisés', () => {
  assert.equal(slugify('Soudeur Dieudonné'), 'dieudonne');
  assert.equal(slugify('Dieudonné'), 'dieudonne');
});

test('les suffixes de parc sont CONSERVÉS — la fusion reste une décision humaine', () => {
  assert.notEqual(
    slugify('Jean Peintre EURO'),
    slugify('Jean Peintre USA'),
    'EURO et USA ne doivent pas être confondus automatiquement'
  );
  assert.equal(slugify('Jean Peintre USA'), 'jean-usa');
});

test('coreSlug rapproche ce que slugify a laissé distinct', () => {
  // C'est ce qui alimente les suggestions de fusion, sans les appliquer.
  assert.equal(coreSlug('jean-euro'), 'jean');
  assert.equal(coreSlug('jean-usa'), 'jean');
  assert.equal(coreSlug('razack-euro'), 'razack');
  assert.equal(coreSlug('razack'), 'razack');
});

test('un nom réduit à un mot de métier reste exploitable', () => {
  // Sans repli, « Soudeur » seul produirait un slug vide et serait perdu.
  assert.equal(slugify('Soudeur'), 'soudeur');
  assert.equal(slugify('Peintre'), 'peintre');
});

test('un nom vide ne produit pas de slug', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify('   '), '');
});

test('les raisons sociales ne sont pas mutilées', () => {
  assert.equal(slugify('COPART INC'), 'copart-inc');
  assert.equal(slugify('PARC JANA'), 'parc-jana');
  assert.equal(slugify('Aziz SALAO'), 'aziz-salao');
});

test('le métier est deviné depuis le libellé', () => {
  assert.equal(guessSpecialty('Soudeur Razack'), 'Soudure');
  assert.equal(guessSpecialty('Jean Peintre USA'), 'Peinture');
  assert.equal(guessSpecialty('Samiou Mécanicien'), 'Mécanique');
  assert.equal(guessSpecialty('COPART INC'), null);
});

test('un tiers cumule ses rôles sans perdre les précédents', () => {
  // Un garage qui répare puis rachète est prestataire ET client.
  assert.deepEqual(mergeKinds(['PRESTATAIRE'], 'CLIENT'), ['PRESTATAIRE', 'CLIENT']);
  assert.deepEqual(mergeKinds(['CLIENT'], 'CLIENT'), ['CLIENT'], 'pas de doublon');
  assert.deepEqual(mergeKinds(null, 'FOURNISSEUR'), ['FOURNISSEUR']);
});
