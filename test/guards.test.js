/**
 * Garde-fous structurels.
 *
 * Ces tests vérifient les trois engagements du contrat de projet qui reposent
 * sur la structure plutôt que sur la discipline :
 *
 *   E5 — une société ne voit jamais les données d'une autre
 *   E3 — rien ne s'efface, tout se contre-passe
 *   E1 — rien de calculable n'est saisi
 *
 * Aucune base n'est nécessaire : les garde-fous se déclenchent AVANT toute
 * requête. C'est précisément ce qui les rend fiables.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { prisma, TENANT_MODELS, TENANT_BY_ID_MODELS } = require('../src/lib/prisma');
const { runAsSystem, runUnscoped, getContext } = require('../src/lib/context');
const { COST_NATURES, OFF_RESULT_NATURES, FIXED_RATES, postEntry } = require('../src/lib/ledger');

/* ── E5 — isolation entre sociétés ────────────────────────────────────────── */

test('tous les modèles métier sont protégés par le filtre société', () => {
  const attendus = [
    'Vehicle', 'Invoice', 'Receipt', 'Purchase', 'Client', 'Supplier',
    'Charge', 'WorkshopQuote', 'Proforma', 'TreasuryTransaction', 'Upload',
    'User', 'AuditLog', 'LedgerEntry', 'CashAccount', 'CostCategory',
    'Partner', 'SearchIndex', 'PurchaseCost', 'AlertRule', 'AlertEvent',
    // Company n'a pas de colonne companyId : elle est filtrée sur son propre
    // id. Sans elle dans cette liste, l'omission serait passée inaperçue —
    // c'est exactement ce qui s'était produit.
    'Company',
  ];
  const manquants = attendus.filter((m) => !TENANT_MODELS.has(m));
  assert.deepEqual(manquants, [], 'modèles non protégés');
});

test('une lecture hors contexte est refusée, pas servie', async () => {
  // Sans ce refus, une requête hors requête HTTP renverrait toutes les sociétés.
  await assert.rejects(
    () => prisma.vehicle.findMany(),
    /\[tenant\]/,
    'la lecture hors contexte doit échouer fermé'
  );
});

test('runAsSystem sans société est une échappatoire explicite', async () => {
  // Contrat documenté : un script d'administration passe runAsSystem(null) pour
  // opérer hors périmètre. Ce n'est pas un contournement accidentel — le seul
  // chemin implicite, celui d'une requête HTTP, reste fermé (test précédent).
  await runAsSystem(null, async () => {
    assert.equal(getContext().unscoped, true);
    assert.equal(getContext().companyId, null);
  });
});

test('runAsSystem avec société pose bien le périmètre', async () => {
  await runAsSystem(42, async () => {
    assert.equal(getContext().companyId, 42);
    assert.equal(getContext().unscoped, false);
  });
});

test('runUnscoped est un contournement explicite, jamais implicite', async () => {
  await runUnscoped(async () => {
    assert.equal(getContext().unscoped, true);
  });
  // Hors de ce bloc, le contournement ne persiste pas.
  assert.equal(getContext(), undefined);
});

/* ── E3 — écriture seule ──────────────────────────────────────────────────── */

test('le grand livre refuse toute modification', async () => {
  await assert.rejects(
    () => prisma.ledgerEntry.update({ where: { id: 1n }, data: { label: 'x' } }),
    /append-only/
  );
});

test('le grand livre refuse toute suppression', async () => {
  await assert.rejects(() => prisma.ledgerEntry.deleteMany({ where: {} }), /append-only/);
  await assert.rejects(
    () => prisma.ledgerEntry.delete({ where: { id: 1n } }),
    /append-only/
  );
});

test("le journal d'audit est lui aussi en écriture seule", async () => {
  await assert.rejects(
    () => prisma.auditLog.update({ where: { id: 1n }, data: {} }),
    /append-only/
  );
});

/* ── E1 — cohérence des écritures ─────────────────────────────────────────── */

test('une dépense imputable exige son véhicule', async () => {
  // Sans cette exigence, la dépense échapperait au coût de revient — le défaut
  // mesuré sur 61 % du parc dans les classeurs.
  await runAsSystem(1, async () => {
    for (const nature of COST_NATURES) {
      await assert.rejects(
        () => postEntry({ nature, label: 'test', amount: -1000 }),
        /vehicleId/,
        `la nature ${nature} doit exiger un véhicule`
      );
    }
  });
});

test('une écriture de montant nul est refusée', async () => {
  await runAsSystem(1, async () => {
    await assert.rejects(
      () => postEntry({ nature: 'CHARGE', label: 'test', amount: 0 }),
      /montant/
    );
  });
});

test('une écriture sans libellé est refusée', async () => {
  await runAsSystem(1, async () => {
    await assert.rejects(
      () => postEntry({ nature: 'CHARGE', label: '  ', amount: -100 }),
      /libellé/
    );
  });
});

test('une écriture hors contexte société est refusée', async () => {
  await assert.rejects(
    () => postEntry({ nature: 'CHARGE', label: 'test', amount: -100 }),
    /\[ledger\]/
  );
});

/* ── Natures et parités ───────────────────────────────────────────────────── */

test('les natures de coût et hors résultat ne se recoupent pas', () => {
  const collision = COST_NATURES.filter((n) => OFF_RESULT_NATURES.includes(n));
  assert.deepEqual(collision, [], 'une nature ne peut pas être à la fois coût et hors résultat');
});

test('le règlement est hors résultat, sinon la vente compterait deux fois', () => {
  assert.ok(OFF_RESULT_NATURES.includes('REGLEMENT'));
  assert.ok(!COST_NATURES.includes('VENTE'));
});

test('les mouvements de bilan restent hors résultat', () => {
  for (const nature of ['FINANCEMENT', 'COMPTE_ASSOCIE', 'TRANSFERT']) {
    assert.ok(OFF_RESULT_NATURES.includes(nature), nature);
  }
});

test("la parité de l'euro est fixe et exacte", () => {
  // 655,957 est la parité officielle. La laisser saisir librement rouvrirait
  // l'écart constaté dans les classeurs (un transfert converti à 705).
  assert.equal(FIXED_RATES.EUR, 655.957);
  assert.equal(FIXED_RATES.FCFA, 1);
  assert.equal(FIXED_RATES.XOF, 1);
});

test("le dollar n'a pas de parité fixe : il doit être daté", () => {
  assert.equal(FIXED_RATES.USD, undefined);
});


/* ── Isolation des modèles clés par leur propre identifiant ───────────────── */

test('Company est filtrée sur son id, faute de colonne companyId', () => {
  assert.ok(TENANT_BY_ID_MODELS.has('Company'));
  assert.ok(
    TENANT_MODELS.has('Company'),
    'Company doit figurer dans les modèles protégés exposés'
  );
});

test('une lecture de société hors contexte est refusée', async () => {
  // Avant correction, prisma.company.findFirst() renvoyait la première société
  // de la base, toutes entreprises confondues.
  await assert.rejects(() => prisma.company.findFirst(), /\[tenant\]/);
});

test("créer une société depuis un contexte client est interdit", async () => {
  await runAsSystem(1, async () => {
    await assert.rejects(
      () => prisma.company.create({ data: { name: 'Société pirate' } }),
      /\[tenant\]/
    );
  });
});

/* ── Le rôle externe n'ouvre rien tant que le filtrage par tiers n'existe pas ── */

test("PARTNER n'accède à aucune donnée de la société", () => {
  const { ROLE_PERMISSIONS } = require('../src/middleware/rbac');
  const droits = ROLE_PERMISSIONS.PARTNER;
  // Ces modules exposent des données de toute la société : tant qu'aucun
  // filtre par tiers n'est écrit, les accorder serait une porte sans serrure.
  for (const module of ['dashboard', 'invoices', 'uploads', 'transit', 'vehicles', 'reports']) {
    assert.equal(
      droits[module],
      undefined,
      `PARTNER ne doit pas avoir accès à ${module} sans filtrage par tiers`
    );
  }
});

/* ── Le lien vers le frais est posé à l'insertion ─────────────────────────── */

test('postEntry accepte purchaseCostId — il ne peut plus être posé après coup', async () => {
  // La table étant en écriture seule, un UPDATE ultérieur est refusé par le
  // déclencheur PostgreSQL : le lien doit exister dès la création.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'lib', 'ledger.js'),
    'utf8'
  );
  assert.ok(
    source.includes('purchaseCostId: p.purchaseCostId'),
    'postEntry doit propager purchaseCostId'
  );

  const alloc = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'lib', 'allocation.js'),
    'utf8'
  );
  assert.ok(
    !/UPDATE\s+ledger_entries/i.test(alloc),
    'allocation.js ne doit plus tenter de modifier le grand livre'
  );
});

/* ── E3 — un audit doit désigner sa ressource ─────────────────────────────── */

const { idAuditable } = require('../src/lib/prisma');

test('un identifiant BigInt est auditable — c’est celui du grand livre', () => {
  // LedgerEntry et AlertEvent ont un identifiant BigInt. Le rejeter revenait à
  // écrire 1 249 audits pointant vers rien.
  assert.equal(idAuditable(1n), 1);
  assert.equal(idAuditable(1249n), 1249);
});

test('un identifiant entier reste inchangé', () => {
  assert.equal(idAuditable(42), 42);
  assert.equal(idAuditable(0), 0, 'zéro est un identifiant, pas une absence');
});

test('un identifiant hors capacité de la colonne est déclaré absent, jamais tronqué', () => {
  // resource_id est un entier signé : au-delà, un dépassement silencieux
  // désignerait la mauvaise ressource. Un trou déclaré vaut mieux.
  assert.equal(idAuditable(2147483648n), null);
  assert.equal(idAuditable(-1n), null);
  assert.equal(idAuditable(Number.MAX_SAFE_INTEGER + 2), null);
});

test('ce qui n’est pas un identifiant ne devient pas un identifiant', () => {
  assert.equal(idAuditable(undefined), null);
  assert.equal(idAuditable(null), null);
  assert.equal(idAuditable('42'), null);
  assert.equal(idAuditable({ in: [1, 2] }), null, 'un where composite ne désigne pas une ressource');
});
