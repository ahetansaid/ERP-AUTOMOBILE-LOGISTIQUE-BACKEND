/**
 * Identité de la société.
 *
 * La référence de logo est le seul endroit où une chaîne venue du client est
 * transformée en identifiant de fichier. Elle mérite d'être figée : une forme
 * acceptée à tort ferait désigner par une société un fichier qui n'est pas le
 * sien, et le contrôle d'appartenance qui suit dans la route ne servirait à
 * rien s'il portait sur un identifiant mal extrait.
 */

const test = require('node:test');
const assert = require('node:assert');

const { idDepuisReference, MIME_LOGO, LOGO_MAX_BYTES } = require('../src/lib/identite');

test('idDepuisReference accepte la forme attendue', () => {
  assert.strictEqual(idDepuisReference('upload:1'), 1);
  assert.strictEqual(idDepuisReference('upload:4242'), 4242);
  // Les espaces autour viennent des copier-coller, ils ne sont pas une erreur.
  assert.strictEqual(idDepuisReference('  upload:7  '), 7);
});

test('idDepuisReference refuse tout le reste', () => {
  for (const forme of [
    null,
    undefined,
    '',
    'upload:',
    'upload:abc',
    'upload:-3',
    'upload:1.5',
    '1',
    'uploads:1',
    'UPLOAD:1',
    // Un chemin ou une URL : ce serait le signe qu'on a stocké autre chose
    // qu'une référence, et la route irait chercher un fichier inexistant.
    '/uploads/1/raw',
    'https://exemple.test/logo.png',
    // Injection : rien ne doit franchir l'expression régulière.
    'upload:1 OR 1=1',
    'upload:1;drop table uploads',
    'upload:1\nupload:2',
  ]) {
    assert.strictEqual(
      idDepuisReference(forme),
      null,
      `« ${String(forme)} » ne doit pas être accepté`
    );
  }
});

test('un logo trop lourd est refusé — il est relu à chaque facture', () => {
  assert.strictEqual(LOGO_MAX_BYTES, 2 * 1024 * 1024);
});

test('seuls les formats que react-pdf sait rendre sont admis', () => {
  assert.ok(MIME_LOGO.has('image/png'));
  assert.ok(MIME_LOGO.has('image/jpeg'));
  assert.ok(MIME_LOGO.has('image/webp'));
  // Un SVG rendu par react-pdf est un vecteur d'exécution, et il ne s'affiche
  // pas dans un PDF de toute façon.
  assert.ok(!MIME_LOGO.has('image/svg+xml'));
  assert.ok(!MIME_LOGO.has('text/html'));
});
