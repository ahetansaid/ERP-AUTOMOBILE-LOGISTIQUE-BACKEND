/**
 * Lecture et écriture de CSV.
 *
 * Ce format sert de porte d'entrée en masse : une erreur d'analyse ne lève pas,
 * elle crée des données fausses. Ces tests tiennent les cas qui se produisent
 * réellement quand un gérant exporte, modifie dans Excel, et réimporte.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyser, serialiser, devinerSeparateur, BOM } = require('../src/lib/csv');
const { nombre, COLONNES } = require('../src/lib/importVehicules');

/* ── Analyse ──────────────────────────────────────────────────────────────── */

test('le point-virgule est reconnu — c’est ce qu’Excel français écrit', () => {
  const { entetes, lignes } = analyser('a;b\n1;2');
  assert.deepEqual(entetes, ['a', 'b']);
  assert.equal(lignes[0].a, '1');
});

test('la virgule et la tabulation sont acceptées aussi', () => {
  assert.equal(devinerSeparateur('a,b,c'), ',');
  assert.equal(devinerSeparateur('a\tb\tc'), '\t');
  assert.equal(analyser('a,b\n1,2').lignes[0].b, '2');
});

test('la marque d’ordre d’octets est retirée, pas lue comme un caractère', () => {
  // Sans ça, la première colonne s'appellerait « \uFEFFchassis » et ne
  // correspondrait à rien.
  const { entetes } = analyser(BOM + 'chassis;marque\nX;Y');
  assert.deepEqual(entetes, ['chassis', 'marque']);
});

test('un champ entre guillemets peut contenir le séparateur', () => {
  const { lignes } = analyser('a;b\n"Dupont; et fils";2');
  assert.equal(lignes[0].a, 'Dupont; et fils');
});

test('un guillemet doublé est un guillemet littéral', () => {
  assert.equal(analyser('a\n"il a dit ""oui"""').lignes[0].a, 'il a dit "oui"');
});

test('un retour à la ligne DANS un champ ne casse pas le découpage', () => {
  // Un libellé saisi sur deux lignes dans Excel produit exactement ça, et un
  // découpage naïf par ligne créerait une ligne fantôme.
  const { lignes } = analyser('a;b\n"première\nseconde";2');
  assert.equal(lignes.length, 1);
  assert.match(lignes[0].a, /première\nseconde/);
  assert.equal(lignes[0].b, '2');
});

test('chaque ligne porte son numéro tel qu’Excel l’affiche', () => {
  // En-tête comprise : un message qui cite « ligne 4 » doit désigner la ligne 4
  // du fichier, pas la quatrième donnée.
  const { lignes } = analyser('a\n1\n2\n3');
  assert.deepEqual(lignes.map((l) => l.__ligne), [2, 3, 4]);
});

test('les lignes vides sont ignorées', () => {
  assert.equal(analyser('a;b\n1;2\n\n;\n3;4').lignes.length, 2);
});

test('un fichier vide ne lève pas', () => {
  assert.deepEqual(analyser('').lignes, []);
  assert.deepEqual(analyser('   ').entetes, []);
});

/* ── Écriture ─────────────────────────────────────────────────────────────── */

test('l’export porte la marque d’ordre d’octets et des fins de ligne Windows', () => {
  // Sans la marque, Excel lit « Dépotage » comme « DÃ©potage ».
  const csv = serialiser([{ a: 'Dépotage' }], ['a']);
  assert.ok(csv.startsWith(BOM));
  assert.match(csv, /\r\n/);
});

test('une valeur contenant le séparateur est protégée', () => {
  const csv = serialiser([{ a: 'x;y' }], ['a']);
  assert.match(csv, /"x;y"/);
});

test('l’ordre des colonnes est imposé, jamais celui des clés', () => {
  // L'ordre des clés d'un objet n'est pas un contrat : une colonne qui se
  // déplace d'un export à l'autre rend les fichiers incomparables.
  const csv = serialiser([{ b: 2, a: 1 }], ['a', 'b']);
  assert.match(csv.split('\r\n')[0], /^\uFEFFa;b$/);
});

test('un aller-retour export → import conserve les valeurs', () => {
  const source = [{ chassis: 'ABC;DEF', marque: 'Toyota "TRD"', modele: 'sur\ndeux lignes' }];
  const { lignes } = analyser(serialiser(source, ['chassis', 'marque', 'modele']));
  assert.equal(lignes[0].chassis, 'ABC;DEF');
  assert.equal(lignes[0].marque, 'Toyota "TRD"');
  assert.match(lignes[0].modele, /sur\ndeux lignes/);
});

/* ── Nombres à la française ───────────────────────────────────────────────── */

test('les montants écrits par Excel en français sont lus', () => {
  // « 1 234,56 » : espace comme séparateur de milliers, virgule décimale. Un
  // Number() direct donne NaN et refuserait une ligne parfaitement lisible.
  assert.equal(nombre('1 234,56'), 1234.56);
  assert.equal(nombre('1234.56'), 1234.56);
  assert.equal(nombre('  42 '), 42);
});

test('un champ vide vaut absent, pas zéro', () => {
  // Zéro est une valeur ; l'absence en est une autre.
  assert.equal(nombre(''), null);
  assert.equal(nombre('   '), null);
  assert.equal(nombre(null), null);
  assert.equal(nombre('0'), 0);
});

test('un montant illisible est signalé, pas silencieusement ignoré', () => {
  assert.ok(Number.isNaN(nombre('abc')));
  assert.ok(Number.isNaN(nombre('12x34')));
});

/* ── Le fichier d’export EST le modèle d’import ───────────────────────────── */

test('les colonnes d’export et d’import sont les mêmes', () => {
  // C'est ce qui permet d'exporter, modifier dans Excel, réimporter — sans
  // aucun format à apprendre ni documentation à tenir à jour.
  assert.ok(COLONNES.includes('chassis'));
  assert.ok(COLONNES.includes('conteneur'));
  const csv = serialiser([], COLONNES);
  const { entetes } = analyser(csv);
  assert.deepEqual(entetes, COLONNES);
});
