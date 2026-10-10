/**
 * Garde des comptes utilisateurs.
 *
 * Ce que ces tests protègent, c'est la porte. Un compte, c'est à la fois un
 * accès et une trace : se rétrograder soi-même, éteindre le seul administrateur
 * de la société ou attribuer `PLATFORM_ADMIN` depuis l'interface produisent tous
 * le même résultat — un système dont plus personne n'a la main, ou dont quelqu'un
 * l'a en trop.
 *
 * Aucune de ces trois erreurs n'est bruyante : elles se découvrent le jour où
 * on en a besoin. D'où le test, sur une fonction pure, sans base de données.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TOUS_ROLES,
  ROLES_ATTRIBUABLES,
  verifierModification,
  resumerChangement,
} = require('../src/lib/accounts');

const moi = { id: 1, role: 'ADMIN' };
const admin = { id: 2, role: 'ADMIN', isActive: true };

test('les rôles attribuables sont lus dans le schéma, pas recopiés', () => {
  // Trois listes à la main (schéma, backend, frontend) finissent toujours par
  // diverger. Ici la source est le DMMF Prisma : le schéma NE PEUT pas être en
  // retard sur lui-même.
  assert.ok(TOUS_ROLES.includes('PLATFORM_ADMIN'), 'le schéma doit définir l’éditeur');
  assert.ok(TOUS_ROLES.includes('PARTNER'), 'le schéma doit définir l’accès externe');

  assert.deepEqual(
    ROLES_ATTRIBUABLES,
    TOUS_ROLES.filter((r) => r !== 'PLATFORM_ADMIN' && r !== 'PARTNER')
  );
});

test('PLATFORM_ADMIN et PARTNER ne s’attribuent pas depuis l’API', () => {
  for (const role of ['PLATFORM_ADMIN', 'PARTNER']) {
    const garde = verifierModification({
      acteur: moi,
      cible: admin,
      roleDemande: role,
    });
    assert.equal(garde.status, 400, `${role} doit être refusé`);
    assert.match(garde.message, /Valeurs acceptées/);
  }
});

test('on ne se rétrograde pas soi-même', () => {
  const garde = verifierModification({
    acteur: moi,
    cible: { id: 1, role: 'ADMIN', isActive: true },
    roleDemande: 'READ_ONLY',
    administrateursActifs: 3,
  });
  assert.equal(garde.status, 400);
  assert.match(garde.message, /propre rôle/);
});

test('on ne se désactive pas soi-même', () => {
  const garde = verifierModification({
    acteur: moi,
    cible: { id: 1, role: 'ADMIN', isActive: true },
    desactivation: true,
    administrateursActifs: 3,
  });
  assert.equal(garde.status, 400);
  assert.match(garde.message, /désactive pas soi-même/);
});

test('le dernier administrateur actif de la société ne disparaît pas', () => {
  // Seul ADMIN ouvre /utilisateurs : après lui, plus personne pour en nommer un.
  for (const modification of [
    { roleDemande: 'MANAGER' },
    { desactivation: true },
  ]) {
    const garde = verifierModification({
      acteur: { id: 9, role: 'ADMIN' },
      cible: { id: 2, role: 'ADMIN', isActive: true },
      administrateursActifs: 1,
      ...modification,
    });
    assert.equal(garde.status, 400, JSON.stringify(modification));
    assert.match(garde.message, /seul administrateur/);
  }

  // Deux administrateurs : le départ de l'un ne ferme rien.
  const ok = verifierModification({
    acteur: { id: 9, role: 'ADMIN' },
    cible: { id: 2, role: 'ADMIN', isActive: true },
    desactivation: true,
    administrateursActifs: 2,
  });
  assert.equal(ok.status, null);
});

test('un gérant ne remonte ni ne descend un compte de l’éditeur', () => {
  const editeur = { id: 7, role: 'PLATFORM_ADMIN', isActive: true };

  const garde = verifierModification({ acteur: moi, cible: editeur, desactivation: true });
  assert.equal(garde.status, 403);

  // L'éditeur, lui, garde la main sur ses propres comptes.
  const pair = verifierModification({
    acteur: { id: 8, role: 'PLATFORM_ADMIN' },
    cible: editeur,
    desactivation: true,
  });
  assert.equal(pair.status, null);
});

test('une modification ordinaire passe', () => {
  const garde = verifierModification({
    acteur: moi,
    cible: admin,
    roleDemande: 'ACCOUNTING',
    administrateursActifs: 2,
  });
  assert.equal(garde.status, null);
  assert.equal(garde.message, null);

  // Changer un prénom sans toucher au rôle n'est pas une promotion.
  const identite = verifierModification({ acteur: moi, cible: admin });
  assert.equal(identite.status, null);
});

/* ── Lecture du journal d'audit ───────────────────────────────────────────── */

test('le résumé nomme ce qui décide d’un accès, et rien d’autre', () => {
  const avant = { role: 'ADMIN', isActive: true, firstName: 'Rita', lastName: 'Sossou' };
  const apres = { ...avant, role: 'MANAGER' };

  assert.deepEqual(resumerChangement(avant, apres), ['rôle : ADMIN → MANAGER']);
  assert.deepEqual(resumerChangement(avant, { ...avant, isActive: false }), [
    'statut : actif → désactivé',
  ]);
  assert.deepEqual(resumerChangement(avant, { ...avant, firstName: 'Rita Ade' }), [
    'prénom : Rita → Rita Ade',
  ]);

  // Rien de changé, rien à journaliser : un journal rempli de « (aucun) » est un
  // journal qu'on ne lit plus.
  assert.deepEqual(resumerChangement(avant, avant), []);
});

test('le mot de passe et le secret 2FA ne remontent jamais dans le journal', () => {
  // `sanitize()` les masque à l'écriture ; le résumé ne doit pas, de lui-même,
  // faire sortir une colonne sensible d'un `after` complet.
  const apres = {
    role: 'ADMIN',
    isActive: true,
    password: '$2b$12$secret',
    twoFaSecret: 'JBSWY3DP',
    updatedAt: new Date('2026-10-09'),
  };
  const resume = resumerChangement({ role: 'ADMIN', isActive: true }, apres);
  assert.deepEqual(resume, []);
});

test('une création énonce le rôle, pas l’identité déjà visible', () => {
  const apres = { role: 'SALES', isActive: true, firstName: 'Karim', lastName: 'Diarra' };
  assert.deepEqual(resumerChangement(null, apres), ['rôle : SALES']);

  // Un accès externe rattaché à un tiers se signale : c'est la raison d'être
  // du compte.
  assert.deepEqual(resumerChangement(null, { ...apres, partnerId: 4 }), [
    'rôle : SALES',
    'tiers rattaché : #4',
  ]);
});

test('la route du journal ne fait pas sortir le JSON brut', async () => {
  // Le résumé est produit côté serveur : `before` / `after` en JSONB ne doivent
  // jamais se retrouver exposés tels quels à l'interface.
  const { appeler, ecrits, envois, restaurer } = chargerRoute({
    journal: [
      {
        id: BigInt('9007199254740993'),
        createdAt: new Date('2026-10-09T08:00:00Z'),
        action: 'UPDATE',
        resource: 'User',
        resourceId: 2,
        userId: 1,
        before: { role: 'ADMIN', isActive: true, password: '$2b$12$hash' },
        after: { role: 'MANAGER', isActive: true, password: '$2b$12$hash' },
      },
    ],
  });

  try {
    const reponse = await appeler('GET', '/journal');
    assert.equal(reponse.statut, 200);
    const [ligne] = reponse.corps.journal;

    // Identifiant BigInt : un Number au-delà de 2^53 aurait perdu des chiffres.
    assert.equal(ligne.id, '9007199254740993');
    assert.deepEqual(ligne.changements, ['rôle : ADMIN → MANAGER']);
    assert.equal(ligne.compte, 'Rita Sossou');
    assert.equal(ligne.acteur, 'Karim Diarra');
    assert.ok(!JSON.stringify(reponse.corps).includes('$2b$'), 'le hash est sorti');
    assert.deepEqual(ecrits, []);
    assert.deepEqual(envois, []);
  } finally {
    restaurer();
  }
});

/* ── Faux client, vraie route ─────────────────────────────────────────────── */

/**
 * La route est exécutée contre un faux Prisma : ce qu'on vérifie est la
 * DÉCISION (refuser avant d'écrire, répondre en snake_case, ne pas faire sortir
 * un secret), pas la couche SQL. `lib/accounts` reste le module réel — c'est
 * lui qui porte les règles.
 *
 * Le cache est remplacé puis restauré : un stub qui fuirait dans un autre
 * fichier de test ferait passer une erreur pour un succès.
 */
function chargerRoute({
  compte = { id: 2, role: 'ADMIN', isActive: true },
  administrateurs = 1,
  journal = [],
  erreurCreation = null,
} = {}) {
  const ecrits = [];
  const envois = [];

  const fauxPrisma = {
    user: {
      findFirst: async () => compte,
      findMany: async () => [
        { id: 1, email: 'karim@exemple.fr', firstName: 'Karim', lastName: 'Diarra' },
        { id: 2, email: 'rita@exemple.fr', firstName: 'Rita', lastName: 'Sossou' },
      ],
      count: async () => administrateurs,
      create: async ({ data }) => {
        if (erreurCreation) {
          const err = new Error('duplicate');
          err.code = erreurCreation;
          throw err;
        }
        ecrits.push({ create: data });
        // `select: CHAMPS_LISTE` dans la route : le hash, stocké lui, n'est
        // jamais dans l'objet renvoyé.
        return {
          id: 3,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
          isActive: true,
          twoFaEnabled: false,
          lastLoginAt: null,
          createdAt: new Date(),
          companyId: 1,
          partnerId: null,
        };
      },
      update: async ({ data }) => {
        ecrits.push({ update: data });
        return { id: compte.id, ...compte, ...data };
      },
    },
    auditLog: { findMany: async () => journal },
  };

  const fauxMailer = {
    sendMail: async (options) => {
      envois.push(options);
      return { status: 'SENT' };
    },
  };

  // `authorize` est laissé passer : la couverture des rôles est déjà vérifiée
  // route par route dans autorisations.test.js. Ce qui intéresse ici est ce que
  // la route fait APRÈS l'autorisation.
  const fauxRbac = { authorize: () => (req, res, next) => next() };
  const fauxBcrypt = { hash: async () => '$2b$12$hash' };

  const chemins = {
    prisma: require.resolve('../src/lib/prisma'),
    mailer: require.resolve('../src/lib/mailer'),
    rbac: require.resolve('../src/middleware/rbac'),
    bcrypt: require.resolve('bcrypt'),
    route: require.resolve('../src/routes/users'),
  };

  const originaux = new Map(
    Object.entries(chemins).map(([nom, chemin]) => [chemin, require.cache[chemin]])
  );
  const stubs = {
    [chemins.prisma]: { prisma: fauxPrisma },
    [chemins.mailer]: fauxMailer,
    [chemins.rbac]: fauxRbac,
    [chemins.bcrypt]: fauxBcrypt,
  };
  for (const [chemin, exports] of Object.entries(stubs)) {
    require.cache[chemin] = { id: chemin, loaded: true, exports };
  }
  delete require.cache[chemins.route];

  const routeur = require('../src/routes/users');

  /** Envoie une requête au premier intergiciel qui porte la méthode et le chemin. */
  async function appeler(methode, chemin, { corps, params = {}, query = {}, acteur } = {}) {
    const couche = routeur.stack.find(
      (l) => l.route && l.route.path === chemin && l.route.methods[methode.toLowerCase()]
    );
    if (!couche) throw new Error(`route ${methode} ${chemin} absente`);

    let statut = null;
    let corpsReponse = null;
    const res = {
      status(code) {
        statut = code;
        return this;
      },
      json(body) {
        corpsReponse = body;
        return this;
      },
    };
    const req = {
      body: corps ?? {},
      params,
      query,
      // Par défaut : un administrateur qui n'est pas le compte visé.
      user: acteur ?? { id: 1, role: 'ADMIN' },
      companyId: 1,
      tenantWhere: () => ({}),
    };

    for (const { handle } of couche.route.stack) {
      let passe = false;
      await handle(req, res, () => {
        passe = true;
      });
      if (!passe) break;
    }

    return { statut, corps: corpsReponse };
  }

  function restaurer() {
    for (const [chemin, original] of originaux) {
      if (original) require.cache[chemin] = original;
      else delete require.cache[chemin];
    }
    delete require.cache[chemins.route];
  }

  return { appeler, restaurer, ecrits, envois };
}

test('une garde refuse AVANT toute écriture', async () => {
  const { appeler, restaurer, ecrits } = chargerRoute({
    compte: { id: 1, role: 'ADMIN', isActive: true },
    administrateurs: 1,
  });
  try {
    // Le compte qui agit est aussi le compte visé : la garde tombe avant Prisma.
    const reponse = await appeler('PATCH', '/:id', {
      params: { id: '1' },
      corps: { isActive: false },
      acteur: { id: 1, role: 'ADMIN' },
    });
    assert.equal(reponse.statut, 400);
    assert.match(reponse.corps.message, /désactive pas soi-même/);
    assert.deepEqual(ecrits, [], 'rien n’a dû être écrit');
  } finally {
    restaurer();
  }
});

test('le dernier administrateur ne peut pas être rétrogradé par la route', async () => {
  const { appeler, restaurer, ecrits } = chargerRoute({
    compte: { id: 2, role: 'ADMIN', isActive: true },
    administrateurs: 1,
  });
  try {
    const reponse = await appeler('PATCH', '/:id', {
      params: { id: '2' },
      corps: { role: 'READ_ONLY' },
    });
    assert.equal(reponse.statut, 400);
    assert.match(reponse.corps.message, /seul administrateur/);
    assert.deepEqual(ecrits, []);
  } finally {
    restaurer();
  }
});

test('une rétrogradation acceptée écrit le rôle et répond en snake_case', async () => {
  const { appeler, restaurer, ecrits } = chargerRoute({
    compte: { id: 2, role: 'ADMIN', isActive: true },
    administrateurs: 2,
  });
  try {
    const reponse = await appeler('PATCH', '/:id', {
      params: { id: '2' },
      corps: { role: 'READ_ONLY' },
    });
    assert.equal(reponse.statut, 200);
    assert.deepEqual(ecrits, [{ update: { role: 'READ_ONLY' } }]);
    assert.equal(reponse.corps.user.role, 'READ_ONLY');
    assert.equal(reponse.corps.user.is_active, true);
    assert.ok(reponse.corps.message, 'la réponse dit ce qui vient de se passer');
  } finally {
    restaurer();
  }
});

test('l’email de bienvenue ne contient pas le mot de passe', async () => {
  const { appeler, restaurer, envois, ecrits } = chargerRoute();
  try {
    const reponse = await appeler('POST', '/', {
      corps: {
        email: 'Comptable@Exemple.Fr',
        password: 'un-mot-de-passe',
        firstName: 'Awa',
        role: 'ACCOUNTING',
      },
    });
    assert.equal(reponse.statut, 201);
    assert.equal(ecrits[0].create.email, 'comptable@exemple.fr', 'l’email est normalisé');
    assert.ok(!JSON.stringify(reponse.corps).includes('$2b$'), 'le hash est sorti dans la réponse');
    assert.equal(envois.length, 1);
    assert.equal(envois[0].template, 'welcome');
    assert.ok(!JSON.stringify(envois[0]).includes('un-mot-de-passe'), 'le mot de passe a fuité');
  } finally {
    restaurer();
  }
});

test('une adresse déjà prise répond 409, pas 500', async () => {
  const { appeler, restaurer, ecrits } = chargerRoute({ erreurCreation: 'P2002' });
  try {
    const reponse = await appeler('POST', '/', {
      corps: { email: 'prise@exemple.fr', password: 'un-mot-de-passe', role: 'USER' },
    });
    assert.equal(reponse.statut, 409);
    assert.match(reponse.corps.message, /déjà un compte/);
    assert.deepEqual(ecrits, []);
  } finally {
    restaurer();
  }
});

test('les champs non reconnus ne se transforment jamais en écriture', async () => {
  const { appeler, restaurer, ecrits } = chargerRoute({ administrateurs: 2 });
  try {
    const reponse = await appeler('PATCH', '/:id', {
      params: { id: '2' },
      // `role` absent, `password` et `companyId` non admis par cette route.
      corps: { password: 'nul', companyId: 99 },
    });
    assert.equal(reponse.statut, 400);
    assert.deepEqual(ecrits, [], 'aucune écriture sur un corps sans champ admis');
  } finally {
    restaurer();
  }
});
