/**
 * Pilotes de stockage.
 *
 * Le pilote retenu décide de ce qu'il advient d'une facture normalisée
 * déposée par le gérant. Le mauvais choix ne se voit pas : le dépôt réussit,
 * et le fichier a disparu au redéploiement suivant. Ces tests figent ce qui
 * empêche cette panne silencieuse.
 *
 * Les chemins qui touchent la base sont vérifiés à part, sur une vraie
 * connexion — ici on tient les décisions, pas les entrées-sorties.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'lib', 'storage.js'),
  'utf8'
);

test('les trois pilotes sont câblés sur les trois opérations', () => {
  // Un pilote branché en écriture mais pas en lecture accepterait des dépôts
  // qu'il ne saurait jamais rendre.
  for (const op of ['putObject', 'streamObject', 'deleteObject']) {
    const corps = SOURCE.slice(SOURCE.indexOf(`async function ${op}(`));
    const fin = corps.indexOf('\n}');
    const bloc = corps.slice(0, fin);
    for (const pilote of ['local', 'db', 's3']) {
      assert.match(bloc, new RegExp(`DRIVER === '${pilote}'`), `${op} / ${pilote}`);
    }
  }
});

test('un pilote inconnu est refusé, jamais ignoré', () => {
  // Sans ce refus, une faute de frappe dans STORAGE_DRIVER ferait retomber le
  // service sur un comportement par défaut — et personne ne le saurait.
  const occurrences = SOURCE.match(/Driver stockage non supporté/g) || [];
  assert.equal(occurrences.length, 3, 'les trois opérations doivent refuser');
});

test('le plafond du pilote base est franc et modifiable', () => {
  const { DB_MAX_BYTES } = require('../src/lib/storage');
  assert.equal(DB_MAX_BYTES, 8 * 1024 * 1024);
  assert.match(SOURCE, /STORAGE_DB_MAX_BYTES/, 'le plafond doit être réglable');
});

test('le dépassement est refusé À L’ENTRÉE, et nomme la solution', () => {
  const bloc = SOURCE.slice(SOURCE.indexOf('async function putObjectDb('));
  const controle = bloc.indexOf('DB_MAX_BYTES');
  const ecriture = bloc.indexOf('fileBlob.create');
  assert.ok(controle > -1 && ecriture > -1);
  assert.ok(controle < ecriture, 'le contrôle doit précéder l’écriture');
  // Un refus qui ne dit pas quoi faire oblige à lire le code source.
  assert.match(bloc, /STORAGE_DRIVER=s3/);
});

test('le pilote base exige une société — le contenu est rangé par entreprise', () => {
  // Sans société, deux clients partageraient le même espace de noms, et le
  // filtre d’isolation n’aurait rien sur quoi mordre.
  assert.match(SOURCE, /function ctxCompanyId\(\)/);
  const bloc = SOURCE.slice(SOURCE.indexOf('function ctxCompanyId('));
  assert.match(bloc.slice(0, 500), /hors contexte société/);
});

test('la lecture passe par le client filtré, jamais par le client brut', () => {
  // findFirst sur le client étendu applique le filtre société : une clé d’une
  // autre entreprise n’est tout simplement pas trouvée. prismaRaw le
  // court-circuiterait.
  const bloc = SOURCE.slice(SOURCE.indexOf('async function streamObjectDb('));
  assert.match(bloc.slice(0, 400), /fileBlob\.findFirst/);
  assert.doesNotMatch(bloc.slice(0, 400), /prismaRaw/);
});

test('supprimer une clé absente n’est pas une erreur', () => {
  // Sinon la suppression d’une pièce échouerait pour un fichier déjà parti,
  // et la ligne resterait en base sans son contenu.
  const bloc = SOURCE.slice(SOURCE.indexOf('async function deleteObjectDb('));
  assert.match(bloc.slice(0, 300), /deleteMany/);
});

test('le pilote local est documenté comme inutilisable en ligne', () => {
  // C’est la panne la plus coûteuse de la liste : elle est silencieuse.
  assert.match(SOURCE, /NE PAS utiliser sur Vercel/);
});
