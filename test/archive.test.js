/**
 * Archivage d'un véhicule.
 *
 * Décision de VISIBILITÉ, jamais de comptabilité. C'est la distinction que ces
 * tests protègent : si archiver retirait les coûts des totaux, un simple drapeau
 * permettrait de modifier les comptes sans laisser de trace — exactement ce que
 * le grand livre en écriture seule s'emploie à empêcher.
 *
 * Les requêtes sont vérifiées sur la source : leur oubli est silencieux, et un
 * véhicule archivé qui continue d'apparaître dans une liste ne lève aucune
 * erreur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..', 'src');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

test('le filtre est nommé et partagé, pas recopié à la main', () => {
  // Un `archivedAt: null` écrit en dur à six endroits est un endroit où on
  // l'oubliera. Le constant nommé est greppable.
  const { NON_ARCHIVES, ARCHIVES } = require('../src/lib/archive');
  assert.deepEqual(NON_ARCHIVES, { archivedAt: null });
  assert.deepEqual(ARCHIVES, { archivedAt: { not: null } });
});

test('archiver ne touche jamais au grand livre', () => {
  const source = lire('routes', 'vehicles.js');
  const bloc = source.slice(
    source.indexOf("router.post('/:id/archiver'"),
    source.indexOf("router.post('/:id/desarchiver'")
  );
  // Seul le véhicule est modifié. Aucune écriture créée, contre-passée ou
  // touchée : pour qu'un coût cesse de compter, il faut le contre-passer, et
  // cela se fait ailleurs, explicitement.
  assert.match(bloc, /vehicle\.update/);
  assert.doesNotMatch(bloc, /ledgerEntry\.(create|update|delete)/);
  assert.doesNotMatch(bloc, /postEntry|reverseEntry/);
  // Il COMPTE les écritures pour pouvoir le dire à l'appelant.
  assert.match(bloc, /ledgerEntry\.count/);
});

test('un motif est exigé — un archivage sans raison est illisible six mois plus tard', () => {
  const source = lire('routes', 'vehicles.js');
  const bloc = source.slice(source.indexOf("router.post('/:id/archiver'"));
  assert.match(bloc.slice(0, 1200), /motif/);
  assert.match(bloc.slice(0, 1200), /statusCode: 400/);
});

test('désarchiver conserve le motif', () => {
  // Il raconte pourquoi on l'avait mis de côté ; l'effacer perdrait l'histoire.
  const source = lire('routes', 'vehicles.js');
  const bloc = source.slice(source.indexOf("router.post('/:id/desarchiver'"));
  assert.match(bloc.slice(0, 1200), /archivedAt: null/);
  assert.doesNotMatch(bloc.slice(0, 1200), /archiveReason: null/);
});

test('les deux opérations sont tracées au journal d’audit', () => {
  const source = lire('routes', 'vehicles.js');
  for (const route of ["router.post('/:id/archiver'", "router.post('/:id/desarchiver'"]) {
    const bloc = source.slice(source.indexOf(route), source.indexOf(route) + 2500);
    assert.match(bloc, /req\.audit\(/, route);
    assert.match(bloc, /before/, route);
  }
});

/* ── Là où le filtre doit s'appliquer, et là où il ne doit pas ────────────── */

test('le parc visible exclut les archivés, et la vue archives les montre', () => {
  const source = lire('routes', 'vehicles.js');
  const liste = source.slice(source.indexOf("router.get('/',"), source.indexOf("router.get('/:id'"));
  assert.match(liste, /vueArchives \? ARCHIVES : NON_ARCHIVES/);
  // Sans la vue « archives », un véhicule archivé deviendrait introuvable et
  // l'archivage un moyen de perdre des choses.
  assert.match(liste, /req\.query\.archives/);
});

test('le tableau de bord, les alertes et le rapport de stock excluent les archivés', () => {
  assert.match(lire('routes', 'dashboard.js'), /NON_ARCHIVES/);
  assert.match(lire('routes', 'reports.js'), /NON_ARCHIVES/);
  const alertes = lire('lib', 'alertRules.js');
  // Les trois règles qui parcourent le parc.
  const n = (alertes.match(/NON_ARCHIVES/g) || []).length;
  assert.ok(n >= 4, `alertRules doit filtrer ses 3 requêtes (import + 3), trouvé ${n}`);
});

test('le filtre ne s’applique PAS là où le lien compte encore', () => {
  // Supprimer un client doit rester bloqué par un véhicule archivé : le
  // rattachement existe toujours. Et la sonde d'installation demande « y a-t-il
  // des données ? », pas « y a-t-il du parc visible ? ».
  assert.doesNotMatch(lire('routes', 'clients.js'), /NON_ARCHIVES/);
  assert.doesNotMatch(lire('lib', 'presets.js'), /NON_ARCHIVES/);
});
