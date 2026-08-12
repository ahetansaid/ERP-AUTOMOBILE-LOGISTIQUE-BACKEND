/**
 * Reprise du registre de caisse — contrôles de lecture.
 *
 * Le registre est le seul endroit où la trésorerie réelle est écrite. S'il est
 * mal lu, le solde de la plateforme sera faux et personne ne s'en apercevra
 * avant de compter la caisse physique.
 *
 * Ces tests figent les trois lectures qui décident de tout : la chaîne des
 * soldes, le recoupement des montants avec ce qui est déjà en base, et la
 * distinction entre une charge et un mouvement de fonds.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { verifierChaine, communs, estMouvement, classer } = require('../scripts/import/report_caisse');

/** Journée minimale, telle que l'extracteur la produit. */
function journee(date, { depenses = [], encaissements = [], report = null, final = null, total } = {}) {
  return {
    date,
    depenses: depenses.map((montant, i) => ({ ligne: i + 3, prestataire: 'X', description: '', montant, vins_courts: [] })),
    total_declare: total !== undefined ? total : depenses.reduce((s, m) => s + m, 0),
    synthese: {
      solde_reporte: report,
      encaissements: encaissements.map((montant) => ({ description: 'Fonds', montant })),
      solde_final: final,
    },
  };
}

/* ── La chaîne des soldes ─────────────────────────────────────────────────── */

test('une chaîne cohérente ne signale rien', () => {
  const r = verifierChaine([
    journee('2026-06-02', { depenses: [1000], encaissements: [5000], report: 500, final: 4500 }),
    journee('2026-06-03', { depenses: [500], report: 4500, final: 4000 }),
  ]);
  assert.deepEqual(r.anomalies, []);
  assert.equal(r.ecartReport, 0);
  assert.equal(r.ecartCalcul, 0);
});

test('un report qui ne reprend pas le solde de la veille est signalé et chiffré', () => {
  const r = verifierChaine([
    journee('2026-06-02', { depenses: [1000], report: 5000, final: 4000 }),
    journee('2026-06-03', { depenses: [500], report: 3500, final: 3000 }),
  ]);
  const rompu = r.anomalies.filter((a) => a.code === 'REPORT_ROMPU');
  assert.equal(rompu.length, 1);
  assert.equal(rompu[0].montant, -500);
  assert.equal(r.ecartReport, -500);
});

test('une rupture qui suit une feuille vide est une journée manquante, pas une erreur', () => {
  // Cas réel : la feuille du 11/06/2026 est vide, et le 12/06 reporte
  // 8 627 000 F de moins que la clôture du 10/06.
  const r = verifierChaine([
    journee('2026-06-10', { depenses: [1000], report: 9000, final: 8000 }),
    journee('2026-06-11'),
    journee('2026-06-12', { depenses: [200], report: 300, final: 100 }),
  ]);
  const codes = r.anomalies.map((a) => a.code);
  assert.ok(codes.includes('JOURNEE_VIDE'));
  assert.ok(codes.includes('JOURNEE_MANQUANTE'), 'la distinction change ce qu’il faut faire');
  assert.ok(!codes.includes('REPORT_ROMPU'));
  assert.match(r.anomalies.find((a) => a.code === 'JOURNEE_MANQUANTE').message, /2026-06-11/);
});

test('une feuille vide isolée ne contamine pas les jours suivants', () => {
  const r = verifierChaine([
    journee('2026-06-10', { depenses: [1000], report: 9000, final: 8000 }),
    journee('2026-06-11'),
    journee('2026-06-12', { depenses: [200], report: 300, final: 100 }),
    // Le 15 enchaîne correctement : plus aucune journée manquante à invoquer.
    journee('2026-06-15', { depenses: [50], report: 50, final: 0 }),
  ]);
  const suivantes = r.anomalies.filter((a) => a.date === '2026-06-15');
  assert.equal(suivantes.length, 1);
  assert.equal(suivantes[0].code, 'REPORT_ROMPU');
});

test('un solde du jour mal calculé est signalé avec son détail', () => {
  const r = verifierChaine([
    journee('2026-06-05', { depenses: [833200], encaissements: [4300000], report: 44500, final: 3506300 }),
  ]);
  const faux = r.anomalies.filter((a) => a.code === 'SOLDE_DU_JOUR_FAUX');
  assert.equal(faux.length, 1);
  assert.equal(faux[0].montant, -5000);
});

test('un total de journée qui ne fait pas la somme de ses lignes est signalé', () => {
  const r = verifierChaine([
    journee('2026-06-02', { depenses: [1000, 2000], total: 4000, report: 5000, final: 2000 }),
  ]);
  assert.ok(r.anomalies.some((a) => a.code === 'TOTAL_DU_JOUR_FAUX'));
});

/* ── Recoupement des montants ─────────────────────────────────────────────── */

test('le recoupement se fait en multi-ensemble, pas en ensemble', () => {
  // Deux soudures à 10 000 dans la caisse, une seule au costing : une seule
  // coïncide. Un ensemble simple en aurait vu deux et surestimé le doublon.
  const r = communs([10000, 10000, 30000], [10000, 50000]);
  assert.equal(r.lignes, 1);
  assert.equal(r.total, 10000);
});

test('aucun montant commun donne un recoupement nul', () => {
  assert.deepEqual(communs([1000], [2000]), { total: 0, lignes: 0 });
});

/* ── Charges contre mouvements de fonds ───────────────────────────────────── */

test('un dépôt n’est pas une charge, quelle que soit sa graphie', () => {
  for (const nom of ['Dépôt CHAFTEL', 'Dépot à ECOBANK', 'DEPOT  JANA', 'Versement RAMA']) {
    assert.equal(estMouvement(nom), true, nom);
  }
});

test('un prestataire reste une charge', () => {
  for (const nom of ['Jean Peintre EURO', 'Razack (Soudeur EURO)', 'Essence', 'HUSSEIN']) {
    assert.equal(estMouvement(nom), false, nom);
  }
});

test('le classement sépare les deux masses', () => {
  const { mouvements, charges } = classer([
    {
      date: '2026-06-02',
      depenses: [
        { prestataire: 'Dépôt CHAFTEL', montant: 6385500 },
        { prestataire: 'Jean Peintre EURO', montant: 30000 },
        { prestataire: 'Essence', montant: 3750 },
      ],
      synthese: { encaissements: [] },
    },
  ]);
  assert.equal(mouvements.lignes, 1);
  assert.equal(mouvements.montant, 6385500);
  assert.equal(charges.lignes, 2);
  assert.equal(charges.montant, 33750);
});
