/**
 * Planificateur — ce qui est dû, et pour quelle période.
 *
 * Le moteur d'alertes et le générateur de rapports étaient écrits et testés,
 * mais rien ne les déclenchait. Ces tests figent la seule décision que prend le
 * planificateur, et c'est celle qui peut le plus discrètement se tromper : la
 * période couverte. Un rapport quotidien qui couvre le jour en cours au lieu de
 * la veille est faux tous les jours, sans que rien ne le signale.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { periodicitesDues, veille } = require('../src/lib/planificateur');

/** Instant UTC, pour ne pas dépendre du fuseau de la machine. */
const t = (iso) => new Date(iso);

/* ── La période couverte ──────────────────────────────────────────────────── */

test('la référence est la veille, jamais le jour en cours', () => {
  // Exécution à 3 h du matin le 15 : le 15 vient de commencer, il n'y a rien à
  // en dire. C'est le 14 qu'on rapporte.
  assert.equal(veille(t('2026-08-15T02:00:00Z')).toISOString().slice(0, 10), '2026-08-14');
});

test('la veille traverse les changements de mois et d’année', () => {
  assert.equal(veille(t('2026-09-01T02:00:00Z')).toISOString().slice(0, 10), '2026-08-31');
  assert.equal(veille(t('2027-01-01T02:00:00Z')).toISOString().slice(0, 10), '2026-12-31');
  // Année bissextile : 2028 en est une.
  assert.equal(veille(t('2028-03-01T02:00:00Z')).toISOString().slice(0, 10), '2028-02-29');
});

test('la référence est ramenée à minuit UTC', () => {
  const r = veille(t('2026-08-15T23:59:59Z'));
  assert.equal(r.getUTCHours(), 0);
  assert.equal(r.getUTCMinutes(), 0);
  assert.equal(r.toISOString().slice(0, 10), '2026-08-14');
});

/* ── Ce qui est dû ────────────────────────────────────────────────────────── */

test('le quotidien est dû chaque jour', () => {
  for (const jour of ['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-15', '2026-08-16']) {
    assert.deepEqual(periodicitesDues(t(`${jour}T02:00:00Z`)), ['QUOTIDIEN'], jour);
  }
});

test('l’hebdomadaire n’est dû que le lundi', () => {
  // 2026-08-17 est un lundi ; la veille, dimanche 16, clôt la semaine du 10 au 16.
  assert.deepEqual(periodicitesDues(t('2026-08-17T02:00:00Z')), ['QUOTIDIEN', 'HEBDOMADAIRE']);
  assert.ok(!periodicitesDues(t('2026-08-18T02:00:00Z')).includes('HEBDOMADAIRE'));
  assert.ok(!periodicitesDues(t('2026-08-16T02:00:00Z')).includes('HEBDOMADAIRE'));
});

test('le mensuel n’est dû que le premier du mois', () => {
  assert.ok(periodicitesDues(t('2026-09-01T02:00:00Z')).includes('MENSUEL'));
  assert.ok(!periodicitesDues(t('2026-09-02T02:00:00Z')).includes('MENSUEL'));
  assert.ok(!periodicitesDues(t('2026-08-31T02:00:00Z')).includes('MENSUEL'));
});

test('un lundi premier du mois cumule les trois', () => {
  // 2027-02-01 est un lundi.
  const dues = periodicitesDues(t('2027-02-01T02:00:00Z'));
  assert.deepEqual(dues, ['QUOTIDIEN', 'HEBDOMADAIRE', 'MENSUEL']);
});

test('rien d’autre que les trois périodicités automatiques', () => {
  // PONCTUEL existe, mais il se demande à la main : le planificateur ne doit
  // jamais en produire.
  for (let j = 1; j <= 31; j += 1) {
    const dues = periodicitesDues(t(`2026-08-${String(j).padStart(2, '0')}T02:00:00Z`));
    assert.ok(!dues.includes('PONCTUEL'), `jour ${j}`);
    assert.equal(dues[0], 'QUOTIDIEN');
  }
});

/* ── La période couverte, bout en bout ────────────────────────────────────── */

test('les bornes calculées depuis la veille couvrent bien la période écoulée', () => {
  const { periodBounds } = require('../src/lib/reports');

  // Lundi 17 août : l'hebdomadaire doit couvrir lundi 10 → dimanche 16.
  const ref = veille(t('2026-08-17T02:00:00Z'));
  const semaine = periodBounds('HEBDOMADAIRE', ref);
  assert.equal(semaine.start.toISOString().slice(0, 10), '2026-08-10');
  assert.equal(semaine.end.toISOString().slice(0, 10), '2026-08-16');

  // 1er septembre : le mensuel doit couvrir tout août.
  const refMois = veille(t('2026-09-01T02:00:00Z'));
  const mois = periodBounds('MENSUEL', refMois);
  assert.equal(mois.start.toISOString().slice(0, 10), '2026-08-01');
  assert.equal(mois.end.toISOString().slice(0, 10), '2026-08-31');

  // Le quotidien couvre la seule journée écoulée.
  const jour = periodBounds('QUOTIDIEN', veille(t('2026-08-15T02:00:00Z')));
  assert.equal(jour.start.toISOString().slice(0, 10), '2026-08-14');
  assert.equal(jour.end.toISOString().slice(0, 10), '2026-08-14');
});

/* ── Budget de temps ──────────────────────────────────────────────────────── */

test('le budget de temps est vérifié avant d’engager une société, jamais au milieu', () => {
  // Une société traitée à moitié laisserait des alertes réévaluées sans rapport,
  // ou l'inverse. La lecture du code fige l'ordre : on teste le budget en tête
  // de boucle, et on saute la société entière.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'lib', 'planificateur.js'),
    'utf8'
  );
  const boucle = source.slice(source.indexOf('for (const s of liste)'));
  const testBudget = boucle.indexOf('BUDGET_MS');
  const appel = boucle.indexOf('traiterSociete(s');
  assert.ok(testBudget > -1 && appel > -1);
  assert.ok(testBudget < appel, 'le budget doit être testé avant le traitement');
  assert.match(boucle, /reportees\.push/, 'une société sautée doit être nommée');
});

test('la première société est toujours traitée, quel que soit le budget', () => {
  // Sinon une plateforme lente ne produirait jamais rien, et le compte rendu
  // serait vide sans que personne ne comprenne pourquoi.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'lib', 'planificateur.js'),
    'utf8'
  );
  assert.match(source, /if \(resultats\.length && Date\.now\(\) - debut > BUDGET_MS\)/);
});
