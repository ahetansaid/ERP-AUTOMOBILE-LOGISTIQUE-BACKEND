/**
 * Reprise de l'historique — contrôles de lecture.
 *
 * Le rapport d'anomalies décide de ce qui part en base. S'il se trompe, soit on
 * refuse des véhicules corrects, soit on en écrit d'incomplets dans un grand
 * livre qui ne s'efface pas. Ces tests figent les deux mécanismes sur lesquels
 * tout le reste repose : le recalcul du coût et la validité des châssis.
 *
 * Aucune base, aucun classeur : les fonctions sont pures.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { vinValide, recalculer, TAUX_MIN, TAUX_MAX } = require('../scripts/import/report');

/* ── Recalcul du coût ─────────────────────────────────────────────────────── */

test('le coût est la somme de ses composants, jamais le total du classeur', () => {
  // Cas réel : HYUNDAI ELANTRA du conteneur GCXU 5928812.
  const v = {
    achat_devise: 5205,
    transport_devise: 418,
    fret_devise: 1137.5,
    taux_bloc_cout: 580,
    depotage: 168750,
    main_oeuvre: 25500,
    frais_connexe: 2000,
    reparation: 622500,
    cout_total: 999999999, // volontairement faux
  };
  assert.equal(recalculer(v, 580), 4739840);
});

test('la commission entre dans le coût', () => {
  const sans = recalculer(
    { achat_devise: 1000, transport_devise: 0, fret_devise: 0, depotage: 0 },
    600
  );
  const avec = recalculer(
    { achat_devise: 1000, transport_devise: 0, fret_devise: 0, commission_devise: 100, depotage: 0 },
    600
  );
  assert.equal(sans, 600000);
  assert.equal(avec, 660000, 'une commission perdue sous-estime le coût de revient');
});

test('un composant absent vaut zéro, il ne fait pas échouer le calcul', () => {
  assert.equal(recalculer({ achat_devise: 1000 }, 600), 600000);
});

test('sans taux, on ne devine pas', () => {
  assert.equal(recalculer({ achat_devise: 1000 }, null), null);
});

test('sans aucun montant en devise, il n’y a rien à convertir', () => {
  assert.equal(recalculer({ depotage: 50000 }, 600), null);
});

test('la fourchette de taux découle de la parité fixe FCFA/euro', () => {
  // 655,957 FCFA pour un euro : le taux dollar ne peut pas s'en éloigner
  // arbitrairement. 500 et 1127 sont hors de portée, 580 et 600 y sont.
  assert.ok(TAUX_MIN < 580 && 580 < TAUX_MAX);
  assert.ok(TAUX_MIN < 600 && 600 < TAUX_MAX);
  assert.ok(500 < TAUX_MIN, '500 doit être signalé comme aberrant');
  assert.ok(1127 > TAUX_MAX, '1127 doit être signalé comme aberrant');
});

/* ── Validité des châssis ─────────────────────────────────────────────────── */

test('les châssis réels des classeurs passent le contrôle ISO 3779', () => {
  for (const vin of [
    '5NPLM4AG5MH045481', // HYUNDAI ELANTRA
    '1HGCV1F3XLA037093', // HONDA ACCORD
    '5TDDGRFH5HS027332', // TOYOTA HIGHLANDER
    '2T1BU4EE6BC608039', // TOYOTA COROLLA
  ]) {
    assert.equal(vinValide(vin), true, vin);
  }
});

test('un caractère modifié fait tomber la clé de contrôle', () => {
  const bon = '5NPLM4AG5MH045481';
  assert.equal(vinValide(bon), true);
  // Un 4 devenu 5 dans le numéro de série : le châssis reste crédible à l'œil.
  assert.equal(vinValide('5NPLM4AG5MH045581'), false);
});

test('les lettres I, O et Q sont interdites dans un châssis', () => {
  assert.equal(vinValide('5NPLM4AGOMH045481'), false);
});

test('le contrôle ne s’applique pas hors Amérique du Nord', () => {
  // Corée (K), Allemagne (W), Japon (J) ne renseignent pas la clé : la
  // déclarer fausse rejetterait des châssis parfaitement valides.
  assert.equal(vinValide('KM8J3CA47JU707147'), null);
  assert.equal(vinValide('WDDGF8JB6DA852354'), null);
  assert.equal(vinValide('JM3KE4DY7E0349222'), null);
});

test('une longueur autre que 17 n’est pas contrôlable', () => {
  assert.equal(vinValide('5NPLM4AG5MH04548'), null);
  assert.equal(vinValide(null), null);
});
