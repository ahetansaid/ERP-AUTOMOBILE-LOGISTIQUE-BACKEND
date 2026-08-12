/**
 * Chargeur de la caisse — classification et invariants.
 *
 * Le classeur met tout dans deux colonnes : ce qui sort, ce qui entre. Le grand
 * livre distingue, et cette distinction n'est pas décorative — confondre un
 * dépôt et une charge fausse le résultat de 94 842 200 F, confondre un
 * encaissement de créance et une vente double le chiffre d'affaires.
 *
 * Ces tests figent la classification et le contrôle qui la valide : le solde
 * calculé doit retomber sur celui du classeur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  construirePlan,
  natureEncaissement,
  natureDepense,
  resoudreVehicule,
} = require('../scripts/import/load_caisse');

/* ── Nature des encaissements ─────────────────────────────────────────────── */

test('une vente est un produit', () => {
  assert.equal(natureEncaissement('Vente de TOYOTA RAV4 2014 2T3DFREV3EW150583'), 'VENTE');
  assert.equal(natureEncaissement('Vente De MAZDA CX-5 819517'), 'VENTE');
});

test('un acompte n’est pas une vente — la reconnaître deux fois doublerait le CA', () => {
  // « Solde sur vente de X » contient le mot vente : l'ordre des tests compte.
  assert.equal(natureEncaissement('Solde sur vente de TOYOTA HILUX AHTFR22G706050903'), 'REGLEMENT');
  assert.equal(natureEncaissement('Avance reçu sur MAZDA CX-5 2018'), 'REGLEMENT');
  assert.equal(natureEncaissement('Reste sur HONDA CR-V 2015 5J6RM4H91FL800412'), 'REGLEMENT');
});

test('un emprunt est hors résultat', () => {
  assert.equal(natureEncaissement('Fonds reçu à Ecobank (Emprunt chez FARROUKH)'), 'FINANCEMENT');
});

test('un fonds reçu sans qualification n’est pas classé d’office', () => {
  assert.equal(natureEncaissement('Fonds reçu de LOME'), 'AUTRE');
  assert.equal(natureEncaissement('Reçu chez HUSSEIN par FAKIH'), 'AUTRE');
});

/* ── Nature des dépenses ──────────────────────────────────────────────────── */

test('un dépôt est un mouvement de fonds, jamais une charge', () => {
  assert.equal(natureDepense({ prestataire: 'Dépôt CHAFTEL' }, null), 'TRANSFERT');
  assert.equal(natureDepense({ prestataire: 'Dépot à ECOBANK' }, 42), 'TRANSFERT');
});

test('une dépense sur véhicule n’entre dans un coût que si l’axe est demandé', () => {
  assert.equal(natureDepense({ prestataire: 'Jean Peintre EURO' }, null), 'CHARGE');
  assert.equal(natureDepense({ prestataire: 'Jean Peintre EURO' }, 42), 'PREPARATION');
});

/* ── Résolution des véhicules ─────────────────────────────────────────────── */

const PARC = [{ id: 7, vin: '2T3DFREV3EW150583' }, { id: 9, vin: '2T1BU4EE6CC790553' }];
const parVin = new Map(PARC.map((v) => [v.vin, v]));
const parSuffixe = new Map(PARC.map((v) => [v.vin.slice(-6), v]));

test('le châssis complet est reconnu', () => {
  const v = resoudreVehicule('Vente de TOYOTA RAV4 2014 2T3DFREV3EW150583', parVin, parSuffixe);
  assert.equal(v.id, 7);
});

test('les six derniers caractères suffisent — c’est le langage du classeur', () => {
  assert.equal(resoudreVehicule('Vente de TOYOTA COROLLA 790553', parVin, parSuffixe).id, 9);
});

test('un véhicule absent du parc n’est pas rattaché de force', () => {
  assert.equal(resoudreVehicule('Vente de HONDA CIVIC 211499', parVin, parSuffixe), null);
  assert.equal(resoudreVehicule('Connexion internet bureau', parVin, parSuffixe), null);
});

/* ── Le plan, et le contrôle qui le valide ────────────────────────────────── */

function tamponDe(journees) {
  return { source: 'test', journees };
}

const JOUR = (date, depenses, encaissements, report, final) => ({
  date,
  depenses: depenses.map((d) => ({
    prestataire: d[0],
    description: d[1] || '',
    montant: d[2],
    vins_courts: [],
  })),
  total_declare: depenses.reduce((s, d) => s + d[2], 0),
  synthese: {
    solde_reporte: report,
    encaissements: encaissements.map((e) => ({ description: e[0], montant: e[1] })),
    solde_final: final,
  },
});

test('le solde calculé retombe sur celui du classeur', () => {
  const tampon = tamponDe([
    JOUR('2026-06-02', [['Essence', 'HONDA', 1000]], [['Vente de X', 5000]], 500, 4500),
    JOUR('2026-06-03', [['Jean', 'MAZDA', 500]], [], 4500, 4000),
  ]);
  const plan = construirePlan(tampon, { axeVehicule: false }, []);
  const solde = plan.ecritures.reduce((s, e) => s + e.montant, 0);
  assert.equal(solde, 4000, 'c’est le contrôle de bout en bout de toute la reprise');
});

test('le solde d’ouverture est repris une fois, et une seule', () => {
  const tampon = tamponDe([JOUR('2026-06-02', [['Essence', '', 100]], [], 668700, 668600)]);
  const plan = construirePlan(tampon, { axeVehicule: false }, []);
  const ouvertures = plan.ecritures.filter((e) => e.categorie === 'OUVERTURE');
  assert.equal(ouvertures.length, 1);
  assert.equal(ouvertures[0].montant, 668700);
});

test('une rupture de report produit une régularisation qui rétablit le solde', () => {
  const tampon = tamponDe([
    JOUR('2026-06-02', [['Essence', '', 1000]], [], 5000, 4000),
    // Le report annonce 3 500 au lieu de 4 000 : 500 F se sont évaporés.
    JOUR('2026-06-03', [['Jean', '', 500]], [], 3500, 3000),
  ]);
  const plan = construirePlan(tampon, { axeVehicule: false }, []);
  const regul = plan.ecritures.filter((e) => e.categorie === 'REGULARISATION');
  assert.equal(regul.length, 1);
  assert.equal(regul[0].montant, -500);
  assert.equal(
    plan.ecritures.reduce((s, e) => s + e.montant, 0),
    3000,
    'sans la régularisation, le solde ne serait pas celui de la caisse physique'
  );
});

test('--sans-regularisation laisse l’écart visible plutôt que de le combler', () => {
  const tampon = tamponDe([
    JOUR('2026-06-02', [['Essence', '', 1000]], [], 5000, 4000),
    JOUR('2026-06-03', [['Jean', '', 500]], [], 3500, 3000),
  ]);
  const plan = construirePlan(tampon, { axeVehicule: false, sansRegularisation: true }, []);
  assert.equal(plan.ecritures.filter((e) => e.categorie === 'REGULARISATION').length, 0);
  assert.equal(plan.ecritures.reduce((s, e) => s + e.montant, 0), 3500);
});

test('les dépôts sortent, les ventes entrent', () => {
  const tampon = tamponDe([
    JOUR('2026-06-02', [['Dépôt CHAFTEL', '', 6385500]], [['Vente de X', 5000]], 0, -6380500),
  ]);
  const plan = construirePlan(tampon, { axeVehicule: false, sansRegularisation: true }, []);
  const depot = plan.ecritures.find((e) => e.nature === 'TRANSFERT');
  const vente = plan.ecritures.find((e) => e.nature === 'VENTE');
  assert.ok(depot.montant < 0);
  assert.ok(vente.montant > 0);
  assert.equal(depot.prestataire, null, 'un dépôt n’a pas de prestataire à créer');
});

test('sans axe véhicule, aucune écriture n’entre dans un coût de revient', () => {
  const tampon = tamponDe([
    JOUR('2026-06-02', [['Jean Peintre EURO', 'HONDA CR-V 790553', 30000]], [], 100000, 70000),
  ]);
  const plan = construirePlan(tampon, { axeVehicule: false, sansRegularisation: true }, PARC);
  assert.equal(plan.ecritures.filter((e) => e.nature === 'PREPARATION').length, 0);
  const charge = plan.ecritures.find((e) => e.nature === 'CHARGE');
  assert.equal(charge.vehicleId, null);
  assert.match(charge.label, /790553/, 'le véhicule reste trouvable par la recherche');
});

test('avec axe véhicule, la même dépense entre dans le coût', () => {
  const tampon = tamponDe([
    JOUR('2026-06-02', [['Jean Peintre EURO', 'HONDA CR-V 790553', 30000]], [], 100000, 70000),
  ]);
  const plan = construirePlan(tampon, { axeVehicule: true, sansRegularisation: true }, PARC);
  const prep = plan.ecritures.find((e) => e.nature === 'PREPARATION');
  assert.equal(prep.vehicleId, 9);
  assert.equal(prep.montant, -30000);
});

test('une vente porte son véhicule quel que soit le drapeau', () => {
  // Le drapeau ne concerne que les COÛTS : un produit ne double rien.
  for (const axeVehicule of [false, true]) {
    const tampon = tamponDe([
      JOUR('2026-06-02', [], [['Vente de TOYOTA COROLLA 790553', 2950000]], 0, 2950000),
    ]);
    const plan = construirePlan(tampon, { axeVehicule, sansRegularisation: true }, PARC);
    const vente = plan.ecritures.find((e) => e.nature === 'VENTE');
    assert.equal(vente.vehicleId, 9, `axeVehicule=${axeVehicule}`);
  }
});
