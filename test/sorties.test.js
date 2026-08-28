/**
 * Les deux portes de sortie.
 *
 * Ce qu'on protège ici est une règle de gestion, pas un calcul : la porte
 * s'ouvre toujours, mais jamais en silence, et le solde du jour est figé. Les
 * trois propriétés qui comptent :
 *
 *   · un motif est exigé dès qu'il y a une réserve, et seulement là ;
 *   · le solde écrit est celui du moment, pas celui recalculé plus tard ;
 *   · une porte ne se franchit qu'une fois.
 *
 * Aucune base n'est nécessaire : les fonctions pures sont testées directement,
 * et `franchir` l'est contre un faux client Prisma. Ce qui est vérifié, c'est
 * la décision — pas la couche SQL, qui a ses propres garde-fous en base.
 *
 * Lancement : npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { statutSelonPaiement } = require('../src/lib/soldes');
const { jourUTC, JALONS, SORTIE_ATELIER, LIVRAISON_CLIENT } = require('../src/lib/sorties');

/* ── Statut d'une facture déduit de ses reçus ─────────────────────────────── */

test('le statut suit les reçus, et ANNULEE ne se laisse jamais écraser', () => {
  assert.equal(statutSelonPaiement(1000, 0, 'EMISE'), 'EMISE');
  assert.equal(statutSelonPaiement(1000, 400, 'EMISE'), 'PARTIELLEMENT_PAYEE');
  assert.equal(statutSelonPaiement(1000, 1000, 'PARTIELLEMENT_PAYEE'), 'PAYEE');

  // Un trop-perçu reste PAYEE : le solde ne devient pas négatif côté statut.
  assert.equal(statutSelonPaiement(1000, 1200, 'EMISE'), 'PAYEE');

  // Annuler est un choix humain. Le recalcul ne le défait pas — sans quoi un
  // reçu saisi par erreur ressusciterait une facture annulée.
  assert.equal(statutSelonPaiement(1000, 1000, 'ANNULEE'), 'ANNULEE');
  assert.equal(statutSelonPaiement(1000, 0, 'ANNULEE'), 'ANNULEE');
});

test("EN_RETARD n'est jamais posé par le paiement", () => {
  // C'est un état de temps, pas de paiement : le poser en base le figerait, et
  // une facture réglée le lendemain resterait en retard pour toujours.
  const tous = [0, 500, 1000, 1500].map((p) => statutSelonPaiement(1000, p, 'EMISE'));
  assert.ok(!tous.includes('EN_RETARD'));
});

/* ── Dates ────────────────────────────────────────────────────────────────── */

test('la date de sortie est ramenée à minuit UTC, et le 31 février est refusé', () => {
  const d = jourUTC('2026-08-27');
  assert.equal(d.toISOString(), '2026-08-27T00:00:00.000Z');

  // Sans contrôle, Date.UTC(2026, 1, 31) donne le 3 mars sans rien signaler.
  assert.equal(jourUTC('2026-02-31'), null);
  assert.equal(jourUTC('pas une date'), null);
  assert.equal(jourUTC(''), null);
});

/* ── Franchissement ───────────────────────────────────────────────────────── */

/**
 * Faux client Prisma : on n'observe que ce que `franchir` décide d'écrire.
 * Recharger le module à chaque test évite qu'un état fuie de l'un à l'autre.
 */
function chargerAvec({ etape = null, vehicule = { id: 7, status: 'DISPONIBLE' } } = {}) {
  const ecrits = [];
  const faux = {
    transitStep: {
      findFirst: async () => etape,
      create: async ({ data }) => {
        ecrits.push(data);
        return { id: 1, ...data };
      },
    },
    vehicle: {
      findFirst: async () => vehicule,
      update: async ({ data }) => {
        ecrits.push({ vehicleUpdate: data });
        return data;
      },
    },
    workshopQuote: { findMany: async () => [] },
    invoice: { findFirst: async () => null },
    receipt: { aggregate: async () => ({ _sum: { amount: 0 } }) },
  };

  const chemin = require.resolve('../src/lib/sorties');
  const cheminPrisma = require.resolve('../src/lib/prisma');
  const cheminSoldes = require.resolve('../src/lib/soldes');
  delete require.cache[chemin];
  delete require.cache[cheminSoldes];
  const prismaOriginal = require.cache[cheminPrisma];
  require.cache[cheminPrisma] = { id: cheminPrisma, loaded: true, exports: { prisma: faux } };

  const mod = require('../src/lib/sorties');
  const restaurer = () => {
    if (prismaOriginal) require.cache[cheminPrisma] = prismaOriginal;
    else delete require.cache[cheminPrisma];
    delete require.cache[chemin];
    delete require.cache[cheminSoldes];
  };
  return { mod, ecrits, restaurer };
}

test("sans devis ni facture, la porte signale une réserve et exige un motif", async () => {
  const { mod, restaurer } = chargerAvec();
  try {
    const sansMotif = await mod.franchir({ vehicleId: 7, jalon: SORTIE_ATELIER });
    assert.equal(sansMotif.ok, false);
    assert.equal(sansMotif.code, 'MOTIF_REQUIS');
    // La réserve est NOMMÉE : sans cela l'utilisateur devine ce qu'on lui reproche.
    assert.ok(sansMotif.etat.reserves.length > 0);
  } finally {
    restaurer();
  }
});

test('un motif trop court ne vaut pas un motif', async () => {
  const { mod, restaurer } = chargerAvec();
  try {
    const r = await mod.franchir({ vehicleId: 7, jalon: SORTIE_ATELIER, motif: 'ok' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'MOTIF_REQUIS');
  } finally {
    restaurer();
  }
});

test('avec un motif, la porte s’ouvre et fige le solde du moment', async () => {
  const { mod, ecrits, restaurer } = chargerAvec();
  try {
    const r = await mod.franchir({
      vehicleId: 7,
      jalon: SORTIE_ATELIER,
      date: '2026-08-27',
      docRef: 'BS-2026-014',
      motif: "Sortie accordée par le gérant, devis du tôlier réglé en espèces hors plateforme",
    });
    assert.equal(r.ok, true);

    const etape = ecrits.find((e) => e.stepName === SORTIE_ATELIER);
    assert.ok(etape, 'le jalon doit être écrit');
    assert.equal(etape.docRef, 'BS-2026-014');
    assert.equal(etape.dateArrival.toISOString(), '2026-08-27T00:00:00.000Z');
    // Le solde est écrit, même à zéro : absent, on ne saurait pas s'il a été
    // constaté ou simplement oublié.
    assert.notEqual(etape.soldeGele, undefined);
    assert.ok(etape.motif.length >= 10);
  } finally {
    restaurer();
  }
});

test('une porte déjà franchie refuse le second passage', async () => {
  const { mod, restaurer } = chargerAvec({
    etape: { id: 3, dateArrival: '2026-08-01', soldeGele: 0, motif: null },
  });
  try {
    const r = await mod.franchir({
      vehicleId: 7,
      jalon: LIVRAISON_CLIENT,
      motif: 'un motif suffisamment long pour passer le contrôle',
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'DEJA_FRANCHIE');
    // Le message dit QUAND : sinon on cherche dans la chronologie.
    assert.match(r.message, /2026-08-01/);
  } finally {
    restaurer();
  }
});

test('la livraison pose LIVRE ; la sortie d’atelier ne pose aucun statut commercial', async () => {
  {
    const { mod, ecrits, restaurer } = chargerAvec();
    try {
      await mod.franchir({
        vehicleId: 7,
        jalon: LIVRAISON_CLIENT,
        motif: 'livraison sans facture, accord du gérant consigné au registre',
      });
      const maj = ecrits.find((e) => e.vehicleUpdate);
      assert.equal(maj.vehicleUpdate.status, 'LIVRE');
    } finally {
      restaurer();
    }
  }
  {
    // Le véhicule n'est PAS repassé DISPONIBLE de force : son statut commercial
    // ne regarde pas l'atelier. Seul le legacy EN_MAINTENANCE est nettoyé.
    const { mod, ecrits, restaurer } = chargerAvec({ vehicule: { id: 7, status: 'VENDU' } });
    try {
      await mod.franchir({
        vehicleId: 7,
        jalon: SORTIE_ATELIER,
        motif: 'aucun devis saisi, travaux réglés directement par le client',
      });
      assert.equal(ecrits.find((e) => e.vehicleUpdate), undefined);
    } finally {
      restaurer();
    }
  }
});

test('un véhicule encore marqué EN_MAINTENANCE revient en stock à la sortie', async () => {
  const { mod, ecrits, restaurer } = chargerAvec({
    vehicule: { id: 7, status: 'EN_MAINTENANCE' },
  });
  try {
    await mod.franchir({
      vehicleId: 7,
      jalon: SORTIE_ATELIER,
      motif: 'reprise de données : véhicule sorti sans devis enregistré',
    });
    const maj = ecrits.find((e) => e.vehicleUpdate);
    assert.equal(maj.vehicleUpdate.status, 'DISPONIBLE');
  } finally {
    restaurer();
  }
});

test('une porte inconnue est refusée avant toute lecture', async () => {
  const { mod, ecrits, restaurer } = chargerAvec();
  try {
    const r = await mod.franchir({ vehicleId: 7, jalon: 'SORTIE_IMAGINAIRE' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'JALON_INCONNU');
    assert.equal(ecrits.length, 0);
    assert.deepEqual(JALONS, [SORTIE_ATELIER, LIVRAISON_CLIENT]);
  } finally {
    restaurer();
  }
});
