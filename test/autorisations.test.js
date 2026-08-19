/**
 * Couverture des autorisations.
 *
 * `authorize()` est appelé route par route. Rien, dans l'application, ne
 * rattrape un oubli : une route écrite sans lui est simplement ouverte à tout
 * utilisateur authentifié, quel que soit son rôle.
 *
 * C'est exactement ce qui s'était produit — six routes de transit et deux du
 * tableau de bord n'en avaient aucun. Un compte READ_ONLY pouvait créer et
 * SUPPRIMER des étapes de transit ; un compte PARTNER, destiné à un
 * transitaire externe, pouvait lire le tablede bord financier de la société.
 *
 * Ce test rend l'oubli impossible : toute nouvelle route sans `authorize()`
 * doit être déclarée ici, à côté de la raison pour laquelle elle s'en passe.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DOSSIER = path.join(__dirname, '..', 'src', 'routes');

/**
 * Fichiers dont les routes portent leur propre authentification, et pourquoi.
 * Toute addition ici est une décision, pas un oubli.
 */
const EXEMPTS = {
  // Connexion, rafraîchissement, mot de passe oublié : par définition
  // accessibles avant toute session. La protection est dans chaque route.
  'auth.js': 'authentification elle-même',
  // Appelée par la plateforme de cron, pas par un utilisateur. Authentifiée
  // par CRON_SECRET, comparé à temps constant.
  'cron.js': 'authentifiée par CRON_SECRET',
};

const ROUTE = /^router\.(get|post|put|patch|delete)\s*\(\s*(['"`][^'"`]*['"`])([^)]*)/gm;

function routes(fichier) {
  const source = fs.readFileSync(path.join(DOSSIER, fichier), 'utf8');
  const trouvees = [];
  let m;
  while ((m = ROUTE.exec(source)) !== null) {
    trouvees.push({
      methode: m[1].toUpperCase(),
      chemin: m[2].replace(/['"`]/g, ''),
      // Les arguments entre le chemin et le corps : c'est là que vivent les
      // intergiciels.
      intergiciels: m[3],
    });
  }
  return trouvees;
}

test('toute route de l’API vérifie un rôle, sauf exemption déclarée', () => {
  const fichiers = fs.readdirSync(DOSSIER).filter((f) => f.endsWith('.js'));
  assert.ok(fichiers.length > 20, 'les fichiers de routes doivent être trouvés');

  const nues = [];
  for (const f of fichiers) {
    if (EXEMPTS[f]) continue;
    for (const r of routes(f)) {
      if (!/authorize\s*\(/.test(r.intergiciels)) {
        nues.push(`${f}  ${r.methode} ${r.chemin}`);
      }
    }
  }

  assert.deepEqual(
    nues,
    [],
    'routes sans contrôle de rôle — ouvertes à tout utilisateur authentifié :\n  ' +
      nues.join('\n  ')
  );
});

test('les exemptions sont justifiées, et rares', () => {
  // Une exemption qui s'accumule est une porte qu'on oublie d'avoir ouverte.
  assert.ok(Object.keys(EXEMPTS).length <= 3, 'trop d’exemptions');
  for (const [f, raison] of Object.entries(EXEMPTS)) {
    assert.ok(fs.existsSync(path.join(DOSSIER, f)), `${f} n’existe plus`);
    assert.ok(raison.length > 10, `${f} : la raison doit être écrite`);
  }
});

test('transit et tableau de bord sont couverts — la régression trouvée en audit', () => {
  for (const [fichier, attendu] of [['transit.js', 6], ['dashboard.js', 2]]) {
    const r = routes(fichier);
    assert.equal(r.length, attendu, `${fichier} : ${attendu} routes attendues`);
    for (const route of r) {
      assert.match(
        route.intergiciels,
        /authorize\s*\(/,
        `${fichier} ${route.methode} ${route.chemin} sans authorize`
      );
    }
  }
});

test('le module demandé par authorize existe dans la matrice', () => {
  // Un module mal orthographié ne lève pas : roleHasPermission renvoie faux, et
  // la route devient inaccessible à tous sauf aux rôles en « * ». Silencieux,
  // et découvert par un utilisateur bloqué.
  const rbac = fs.readFileSync(path.join(DOSSIER, '..', 'middleware', 'rbac.js'), 'utf8');
  const connus = new Set(
    (rbac.match(/^\s{4}([a-z_]+):/gm) || []).map((s) => s.trim().replace(':', ''))
  );

  const inconnus = [];
  for (const f of fs.readdirSync(DOSSIER).filter((x) => x.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(DOSSIER, f), 'utf8');
    for (const m of source.matchAll(/authorize\(\s*'([a-z_]+)'\s*,\s*'([a-z]+)'/g)) {
      if (!connus.has(m[1])) inconnus.push(`${f} → '${m[1]}'`);
    }
  }
  assert.deepEqual(inconnus, [], 'modules absents de la matrice RBAC :\n  ' + inconnus.join('\n  '));
});

/* ── Suppression d'un véhicule : ce qui protège le grand livre ────────────── */

test('la suppression d’un véhicule refuse dès qu’il a laissé une trace', () => {
  // `ledger_entries.vehicle_id` n'a AUCUNE contrainte vers `vehicles` : la base
  // ne bloquerait pas la suppression. Elle laisserait les écritures de coût en
  // place, toujours comptées dans les totaux, rattachées à un véhicule
  // introuvable — et le grand livre étant en écriture seule, on ne pourrait plus
  // jamais les retirer. Le contrôle est donc dans le code, ou nulle part.
  const source = fs.readFileSync(path.join(DOSSIER, 'vehicles.js'), 'utf8');
  const bloc = source.slice(source.indexOf("router.delete('/:id'"));

  const controle = bloc.indexOf('ledgerEntry.count');
  const suppression = bloc.indexOf('vehicle.delete');
  assert.ok(controle > -1, 'les écritures doivent être comptées');
  assert.ok(suppression > -1, 'la suppression doit exister');
  assert.ok(controle < suppression, 'le contrôle doit précéder la suppression');

  assert.match(bloc, /invoice\.count/, 'les factures doivent bloquer aussi');
  assert.match(bloc, /statusCode: 409/, 'le refus doit être un conflit, pas une erreur serveur');
  // Un refus qui ne nomme pas ce qui bloque envoie chercher dans le code.
  assert.match(bloc, /traces/, 'le refus doit nommer ce qui bloque');
});

test('supprimer un véhicule est tracé au journal d’audit', () => {
  const source = fs.readFileSync(path.join(DOSSIER, 'vehicles.js'), 'utf8');
  const bloc = source.slice(source.indexOf("router.delete('/:id'"));
  assert.match(bloc, /req\.audit\(/);
  assert.match(bloc, /action: 'DELETE'/);
  // L'état avant est conservé : sans lui, la trace dit qu'on a supprimé sans
  // dire quoi.
  assert.match(bloc, /before: vehicle/);
});

test('la suppression d’un conteneur refuse dès qu’il a laissé une trace', () => {
  // L'ancienne version ne regardait que le statut : elle refusait tout ce qui
  // n'était pas EN_COURS et acceptait tout le reste. Or un conteneur EN_COURS
  // peut déjà porter des frais ventilés, donc des écritures — et
  // `ledger_entries.purchase_id` n'a aucune contrainte vers `purchases`.
  const source = fs.readFileSync(path.join(DOSSIER, 'purchases.js'), 'utf8');
  const bloc = source.slice(source.indexOf("router.delete('/:id'"));

  const controle = bloc.indexOf('ledgerEntry.count');
  const suppression = bloc.indexOf('purchase.delete');
  assert.ok(controle > -1, 'les écritures doivent être comptées');
  assert.ok(controle < suppression, 'le contrôle doit précéder la suppression');

  assert.match(bloc, /purchaseVehicle\.count/, 'les véhicules rattachés doivent bloquer');
  assert.match(bloc, /purchaseCost\.count/, 'les frais doivent bloquer');
  assert.match(bloc, /statusCode: 409/);
  assert.match(bloc, /traces/, 'le refus doit nommer ce qui bloque');
});

test('la suppression d’un conteneur ne détache plus les véhicules en silence', () => {
  // Un deleteMany sur la liaison faisait survivre les véhicules en leur retirant
  // la trace de leur arrivée — la seule chose qui rattache un châssis à sa caisse.
  const source = fs.readFileSync(path.join(DOSSIER, 'purchases.js'), 'utf8');
  const bloc = source.slice(source.indexOf("router.delete('/:id'"));
  assert.doesNotMatch(bloc, /purchaseVehicle\.deleteMany/);
});

test('le statut n’est plus le seul critère de suppression d’un conteneur', () => {
  // Un conteneur ARRIVÉ mais vide est parfaitement supprimable. Le statut ne dit
  // rien de la trace comptable.
  const source = fs.readFileSync(path.join(DOSSIER, 'purchases.js'), 'utf8');
  const bloc = source.slice(source.indexOf("router.delete('/:id'"));
  assert.doesNotMatch(bloc, /status !== 'EN_COURS'/);
});
