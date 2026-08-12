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

/* ── Les trois arbitrages du chargeur ─────────────────────────────────────── */

const { construirePlan, marqueEtModele } = require('../scripts/import/load');
const { analyser } = require('../scripts/import/report');

/** Tampon minimal : un conteneur, les véhicules qu'on lui passe. */
function tamponDe(vehicules, interventions = []) {
  return {
    source: 'test',
    conteneurs: [
      {
        feuille: 'F1',
        reference: 'TEST 0000001',
        date: '2026-03-01',
        blocs: { frais: 2, manutention: 12, repartition: 22 },
        vehicules,
        interventions,
      },
    ],
    pieces_detachees: {},
  };
}

function planDe(vehicules, interventions = []) {
  const tampon = tamponDe(vehicules, interventions);
  return construirePlan(tampon, analyser(tampon), { dateDefaut: '2026-01-01' });
}

const COMPLET = {
  ligne: 3,
  vehicule: 'TOYOTA COROLLA',
  annee: 2011,
  vin: '2T1BU4EE6BC608039',
  achat_devise: 1000,
  fret_devise: 100,
  depotage: 50000,
};

test('arbitrage 1 — le taux du bloc coût fait foi, et l’écriture le dit', () => {
  const [v] = planDe([
    { ...COMPLET, taux_bloc_cout: 580, taux_bloc_repartition: 600 },
  ]).conteneurs[0].vehicules;

  assert.equal(v.tauxRetenu, 580);
  assert.equal(v.tauxDivergent, true);
  const achat = v.ecritures.find((e) => e.type === 'ACHAT');
  assert.match(achat.label, /taux 580 retenu/);
  assert.equal(achat.amountFcfa, -580000);
});

test('un taux unique ne fait mentionner aucune divergence', () => {
  const [v] = planDe([
    { ...COMPLET, taux_bloc_cout: 600, taux_bloc_repartition: 600 },
  ]).conteneurs[0].vehicules;

  assert.equal(v.tauxDivergent, false);
  assert.equal(v.ecritures.find((e) => e.type === 'ACHAT').label, "Prix d'achat");
});

test('arbitrage 2 — sans prix d’achat, le véhicule existe mais n’a aucun coût', () => {
  const [v] = planDe([
    { ...COMPLET, achat_devise: null, taux_bloc_cout: 600 },
  ]).conteneurs[0].vehicules;

  assert.equal(v.vin, COMPLET.vin, 'le véhicule doit exister dans le parc');
  assert.equal(v.chiffrable, false);
  assert.equal(v.ecritures.length, 0);
});

test('un véhicule sans prix d’achat garde tout de même ses réparations', () => {
  const [v] = planDe(
    [{ ...COMPLET, achat_devise: null, taux_bloc_cout: 600 }],
    [
      {
        vin: COMPLET.vin,
        description: 'Peinture',
        prestataire: 'Jean Euro',
        montant: 50000,
      },
    ]
  ).conteneurs[0].vehicules;

  assert.equal(v.chiffrable, false);
  assert.equal(v.ecritures.length, 1);
  assert.equal(v.ecritures[0].nature, 'PREPARATION');
  assert.equal(v.ecritures[0].prestataire, 'Jean Euro');
});

test('arbitrage 3 — une écriture par intervention, chacune avec son prestataire', () => {
  const [v] = planDe(
    [{ ...COMPLET, taux_bloc_cout: 600, reparation: 670000 }],
    [
      { vin: COMPLET.vin, description: 'Soudure', prestataire: 'Razack', montant: 35000 },
      { vin: COMPLET.vin, description: 'Peinture', prestataire: 'Jean Euro', montant: 50000 },
    ]
  ).conteneurs[0].vehicules;

  const prep = v.ecritures.filter((e) => e.nature === 'PREPARATION');
  assert.equal(prep.length, 2, 'le détail fait foi, pas la colonne');
  assert.equal(
    prep.reduce((s, e) => s + e.amountFcfa, 0),
    -85000,
    'le forfait de 670 000 F de la colonne ne doit pas être repris'
  );
  assert.deepEqual(prep.map((e) => e.prestataire), ['Razack', 'Jean Euro']);
});

test('sans détail, la colonne réparation est reprise en une écriture, dite telle quelle', () => {
  const [v] = planDe([
    { ...COMPLET, taux_bloc_cout: 600, reparation: 285000 },
  ]).conteneurs[0].vehicules;

  const prep = v.ecritures.filter((e) => e.nature === 'PREPARATION');
  assert.equal(prep.length, 1);
  assert.equal(prep[0].amountFcfa, -285000);
  assert.match(prep[0].label, /sans détail/);
});

/* ── Invariants d’écriture ────────────────────────────────────────────────── */

test('toute écriture de reprise est une sortie', () => {
  const [v] = planDe(
    [{ ...COMPLET, taux_bloc_cout: 600, imv: 78600, main_oeuvre: 25500 }],
    [{ vin: COMPLET.vin, description: 'Soudure', prestataire: 'Razack', montant: 35000 }]
  ).conteneurs[0].vehicules;

  assert.ok(v.ecritures.length >= 5);
  for (const e of v.ecritures) {
    assert.ok(e.amount < 0, `${e.label} devrait être négative`);
    assert.ok(e.amountFcfa < 0, `${e.label} devrait être négative en FCFA`);
  }
});

test('les montants en devise sont convertis, ceux en FCFA ne le sont pas', () => {
  const [v] = planDe([
    { ...COMPLET, taux_bloc_cout: 600, imv: 78600 },
  ]).conteneurs[0].vehicules;

  const parType = Object.fromEntries(v.ecritures.map((e) => [e.type, e]));
  assert.equal(parType.ACHAT.currency, 'USD');
  assert.equal(parType.ACHAT.rateApplied, 600);
  assert.equal(parType.ACHAT.amountFcfa, -600000);

  assert.equal(parType.DEPOTAGE.currency, 'FCFA');
  assert.equal(parType.DEPOTAGE.rateApplied, 1);
  assert.equal(parType.DEPOTAGE.amountFcfa, -50000);
  assert.equal(parType.IMV.amountFcfa, -78600);
});

test('aucune écriture de reprise ne touche la trésorerie', () => {
  const [v] = planDe(
    [{ ...COMPLET, taux_bloc_cout: 600 }],
    [{ vin: COMPLET.vin, description: 'Soudure', prestataire: 'Razack', montant: 35000 }]
  ).conteneurs[0].vehicules;

  // Les clés sont figées : la reprise reconstitue des COÛTS, pas des
  // décaissements. Le jour où quelqu'un ajoutera un compte de caisse au plan,
  // ce test tombera — c'est son seul objet.
  const attendues = [
    'type', 'nature', 'label', 'amount', 'currency', 'rateApplied', 'amountFcfa',
  ];
  for (const e of v.ecritures) {
    const cles = Object.keys(e).filter((k) => k !== 'prestataire');
    assert.deepEqual(cles, attendues, `${e.label} porte des champs inattendus`);
  }
});

test('un prix de vente renseigné marque le véhicule comme vendu', () => {
  const vendu = planDe([{ ...COMPLET, taux_bloc_cout: 600, prix_vente: 4000000 }]);
  const stock = planDe([{ ...COMPLET, taux_bloc_cout: 600 }]);
  assert.equal(vendu.conteneurs[0].vehicules[0].status, 'VENDU');
  assert.equal(vendu.conteneurs[0].vehicules[0].priceSale, 4000000);
  assert.equal(stock.conteneurs[0].vehicules[0].status, 'DISPONIBLE');
});

test('le conteneur sans date est signalé et daté explicitement', () => {
  const tampon = tamponDe([{ ...COMPLET, taux_bloc_cout: 600 }]);
  tampon.conteneurs[0].date = null;
  const plan = construirePlan(tampon, analyser(tampon), { dateDefaut: '2026-01-01' });

  assert.equal(plan.conteneurs[0].date, '2026-01-01');
  assert.equal(plan.conteneurs[0].dateDeduite, true);
  assert.equal(plan.avertissements.length, 1);
});

test('la marque est le premier mot, le modèle le reste', () => {
  assert.deepEqual(marqueEtModele('TOYOTA HIGHLANDER'), {
    brand: 'TOYOTA',
    model: 'HIGHLANDER',
  });
  assert.deepEqual(marqueEtModele('MERCEDES BENZ C 300'), {
    brand: 'MERCEDES',
    model: 'BENZ C 300',
  });
  assert.deepEqual(marqueEtModele(null), { brand: null, model: null });
});
