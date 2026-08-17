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
