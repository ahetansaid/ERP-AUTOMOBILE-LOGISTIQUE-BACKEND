/**
 * Routes du grand livre.
 *
 * Le journal est en écriture seule : pas de PUT, pas de DELETE. La seule façon
 * de corriger est POST /ledger/:id/reverse, qui produit l'écriture inverse et
 * conserve l'originale.
 */

const express = require('express');
const { prisma } = require('../lib/prisma');
const { postEntry, reverseEntry } = require('../lib/ledger');
const {
  vehicleCost, allCashBalances, profitAndLoss,
} = require('../lib/costing');
const { reconcile } = require('../lib/reconciliation');
const { ensureDefaults } = require('../lib/defaults');
const { authorize } = require('../middleware/rbac');
const { analyser, serialiser, entetesTelechargement } = require('../lib/csv');
const importCaisse = require('../lib/importCaisse');

const router = express.Router();

const serialize = (e) => ({
  id: Number(e.id),
  entry_date: e.entryDate,
  nature: e.nature,
  label: e.label,
  amount: Number(e.amount),
  currency: e.currency,
  rate_applied: e.rateApplied != null ? Number(e.rateApplied) : null,
  amount_fcfa: Number(e.amountFcfa),
  vehicle_id: e.vehicleId,
  cash_account_id: e.cashAccountId,
  category_id: e.categoryId,
  reverses_id: e.reversesId != null ? Number(e.reversesId) : null,
  reversal_note: e.reversalNote ?? null,
  correlation_id: e.correlationId ?? null,
  created_at: e.createdAt,
});

// GET /ledger — journal filtrable
router.get('/', authorize('treasury', 'read'), async (req, res) => {
  try {
    const where = {};
    if (req.query.vehicleId) where.vehicleId = Number(req.query.vehicleId);
    if (req.query.cashAccountId) where.cashAccountId = Number(req.query.cashAccountId);
    if (req.query.nature) where.nature = String(req.query.nature).toUpperCase();
    if (req.query.from || req.query.to) {
      where.entryDate = {};
      if (req.query.from) where.entryDate.gte = new Date(String(req.query.from));
      if (req.query.to) where.entryDate.lte = new Date(String(req.query.to));
    }

    const take = Math.min(Number(req.query.limit) || 200, 1000);
    const entries = await prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      take,
    });
    const agg = await prisma.ledgerEntry.aggregate({
      where,
      _sum: { amountFcfa: true },
      _count: { _all: true },
    });

    return res.status(200).json({
      entries: entries.map(serialize),
      total: agg._count._all,
      sum_fcfa: agg._sum.amountFcfa != null ? Number(agg._sum.amountFcfa) : 0,
    });
  } catch (err) {
    console.error('[ledger.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /ledger — saisie manuelle
router.post('/', authorize('treasury', 'create'), async (req, res) => {
  try {
    const created = await postEntry(req.body || {});
    return res.status(201).json(serialize(created));
  } catch (err) {
    // Les garde-fous du service (nature sans véhicule, montant nul, taux
    // manquant) sont des erreurs de saisie : 400, pas 500.
    if (String(err.message || '').startsWith('[ledger]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[ledger.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /ledger/:id/reverse — contre-passation
router.post('/:id/reverse', authorize('treasury', 'update'), async (req, res) => {
  try {
    const created = await reverseEntry(req.params.id, req.body?.note);
    return res.status(201).json(serialize(created));
  } catch (err) {
    if (String(err.message || '').startsWith('[ledger]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[ledger.reverse]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /ledger/vehicle/:id/cost — coût de revient décomposé
router.get('/vehicle/:id/cost', authorize('vehicles', 'read'), async (req, res) => {
  try {
    return res.status(200).json(await vehicleCost(req.params.id));
  } catch (err) {
    console.error('[ledger.vehicleCost]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /ledger/balances — soldes de trésorerie, calculés
router.get('/balances', authorize('treasury', 'read'), async (req, res) => {
  try {
    return res.status(200).json(await allCashBalances(req.query.asOf));
  } catch (err) {
    console.error('[ledger.balances]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * GET /ledger/reconciliation — ancien registre contre grand livre
 *
 * Rapport de la période de double écriture. Tant que `concordant` est faux,
 * l'ancienne table reste la référence et la coupure n'est pas autorisée.
 */
router.get('/reconciliation', authorize('reports', 'read'), async (req, res) => {
  try {
    return res.status(200).json(await reconcile(req.query.from, req.query.to));
  } catch (err) {
    console.error('[ledger.reconciliation]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /ledger/resultat — compte de résultat, hors mouvements de bilan
router.get('/resultat', authorize('reports', 'read'), async (req, res) => {
  try {
    return res.status(200).json(await profitAndLoss(req.query.from, req.query.to));
  } catch (err) {
    console.error('[ledger.pnl]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// --------------------------------------------------------------------------
// Référentiels : comptes de trésorerie et catégories
// --------------------------------------------------------------------------

router.get('/cash-accounts', authorize('treasury', 'read'), async (req, res) => {
  try {
    const rows = await prisma.cashAccount.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return res.status(200).json({ accounts: rows });
  } catch (err) {
    console.error('[ledger.accounts]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/cash-accounts', authorize('settings', 'update'), async (req, res) => {
  try {
    const { label, nature, currency } = req.body || {};
    if (!label || !String(label).trim()) {
      return res.status(400).json({ message: 'Libellé requis', statusCode: 400 });
    }
    const created = await prisma.cashAccount.create({
      data: {
        label: String(label).trim().slice(0, 120),
        nature: nature || 'CAISSE',
        currency: (currency || 'FCFA').toUpperCase().slice(0, 10),
      },
    });
    return res.status(201).json(created);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Ce compte existe déjà', statusCode: 409 });
    }
    console.error('[ledger.accounts.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /ledger/defaults — installe le preset métier pour la société courante
router.post('/defaults', authorize('settings', 'update'), async (req, res) => {
  try {
    return res.status(200).json(await ensureDefaults());
  } catch (err) {
    console.error('[ledger.defaults]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.get('/categories', authorize('settings', 'read'), async (req, res) => {
  try {
    const rows = await prisma.costCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return res.status(200).json({ categories: rows });
  } catch (err) {
    console.error('[ledger.categories]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/categories', authorize('settings', 'update'), async (req, res) => {
  try {
    const { label, nature } = req.body || {};
    if (!label || !nature) {
      return res
        .status(400)
        .json({ message: 'Libellé et nature requis', statusCode: 400 });
    }
    // La nature est validée par l'enum Prisma : un libellé libre ne peut pas
    // introduire une catégorie que le calcul ne saurait pas classer.
    const created = await prisma.costCategory.create({
      data: { label: String(label).trim().slice(0, 120), nature },
    });
    return res.status(201).json(created);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Cette catégorie existe déjà', statusCode: 409 });
    }
    if (err.code === 'P2003' || String(err.message).includes('Invalid value')) {
      return res.status(400).json({ message: 'Nature invalide', statusCode: 400 });
    }
    console.error('[ledger.categories.create]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * GET /ledger/export — le grand livre en CSV.
 *
 * Le fichier produit est AUSSI le modèle d'import : mêmes colonnes, même ordre.
 * `?modele=1` renvoie les seules en-têtes. `?du=&au=` borne la période.
 *
 * Les montants sortent en POSITIF avec un sens explicite, comme ils entrent :
 * un fichier où les dépenses seraient négatives se ferait recopier à l'envers
 * au premier aller-retour.
 */
router.get('/export', authorize('treasury', 'read'), async (req, res) => {
  try {
    const modele = String(req.query.modele || '') === '1';
    const where = { ...req.tenantWhere() };
    if (req.query.du || req.query.au) {
      where.entryDate = {};
      if (req.query.du) where.entryDate.gte = new Date(String(req.query.du));
      if (req.query.au) where.entryDate.lte = new Date(String(req.query.au));
    }

    const brutes = modele
      ? []
      : await prisma.ledgerEntry.findMany({
          where,
          include: { partner: true, cashAccount: true },
          orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
          take: 20000,
        });

    /*
     * `ledger_entries.vehicle_id` n'a volontairement aucune relation Prisma —
     * le grand livre ne dépend de rien pour rester intact. Les châssis sont
     * donc résolus en UNE requête, puis rattachés par identifiant : une requête
     * par ligne ferait vingt mille allers-retours sur un export complet.
     */
    const idsVehicules = [...new Set(brutes.map((e) => e.vehicleId).filter(Boolean))];
    const chassisParId = new Map(
      idsVehicules.length
        ? (
            await prisma.vehicle.findMany({
              where: { id: { in: idsVehicules } },
              select: { id: true, vin: true },
            })
          ).map((v) => [v.id, v.vin ?? ''])
        : []
    );

    const lignes = brutes.map((e) => {
          const m = Number(e.amountFcfa);
          // Le libellé porte « bénéficiaire — description ». On le redécoupe
          // pour que l'export retrouve les colonnes d'origine.
          const [avant, ...reste] = String(e.label).split(' — ');
          const aBeneficiaire = reste.length > 0;
          return {
            date: e.entryDate.toISOString().slice(0, 10),
            beneficiaire: e.partner?.name ?? (aBeneficiaire ? avant : ''),
            description: aBeneficiaire ? reste.join(' — ') : e.label,
            montant: Math.abs(m),
            sens: m < 0 ? 'sortie' : 'entree',
            nature: e.nature,
            chassis: e.vehicleId ? chassisParId.get(e.vehicleId) ?? '' : '',
            compte: e.cashAccount?.label ?? '',
          };
    });

    const jour = new Date().toISOString().slice(0, 10);
    entetesTelechargement(res, modele ? 'modele-caisse.csv' : `grand-livre-${jour}.csv`);
    return res.send(serialiser(lignes, importCaisse.COLONNES));
  } catch (err) {
    console.error('[ledger.export]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * POST /ledger/import — écritures de caisse en masse.
 *
 * Body : { csv: "<contenu>" }. Query : `?valider=1` pour écrire.
 *
 * À BLANC PAR DÉFAUT, et c'est le seul import qui touche le grand livre : une
 * ligne fausse ne se corrige pas, elle se contre-passe. Le tour à blanc est la
 * seule occasion de se tromper sans conséquence.
 */
router.post('/import', authorize('treasury', 'create'), async (req, res) => {
  try {
    const contenu = String((req.body || {}).csv || '');
    if (!contenu.trim()) {
      return res.status(400).json({
        message: 'Aucun contenu CSV reçu (champ « csv »).',
        statusCode: 400,
      });
    }

    const { entetes, lignes } = analyser(contenu);
    if (!lignes.length) {
      return res.status(400).json({
        message: 'Le fichier ne contient aucune ligne de données.',
        statusCode: 400,
        entetesLues: entetes,
      });
    }
    const manquantes = ['date', 'montant'].filter((c) => !entetes.includes(c));
    if (manquantes.length) {
      return res.status(400).json({
        message:
          `Colonne obligatoire absente : ${manquantes.join(', ')}. ` +
          `Colonnes attendues : ${importCaisse.COLONNES.join(', ')}.`,
        statusCode: 400,
        entetesLues: entetes,
      });
    }

    const { valides, refus } = await importCaisse.preparer(lignes, req.tenantWhere());
    const valider = String(req.query.valider || '') === '1';
    const somme = valides.reduce((s, v) => s + v.apercu.montant, 0);
    const proposees = valides.filter((v) => v.natureProposee).length;

    if (!valider) {
      return res.status(200).json({
        mode: 'a-blanc',
        message:
          `${valides.length} écriture(s) seraient créées, ${refus.length} refusée(s). ` +
          'Rien n’a été écrit. Relancez avec ?valider=1 pour appliquer.',
        lus: lignes.length,
        creables: valides.length,
        refuses: refus.length,
        effetSurLeSolde: somme,
        naturesProposees: proposees,
        avertissement:
          proposees > 0
            ? `${proposees} ligne(s) n’indiquent pas de nature : elle a été déduite du libellé. Vérifiez l’aperçu avant d’appliquer.`
            : null,
        apercu: valides.slice(0, 15).map((v) => ({ ligne: v.ligne, ...v.apercu, natureProposee: v.natureProposee })),
        refus,
      });
    }

    const { ecrites, tiers } = await importCaisse.ecrire(valides);
    return res.status(201).json({
      mode: 'applique',
      message: `${ecrites.length} écriture(s) créée(s), ${refus.length} refusée(s).`,
      lus: lignes.length,
      ecrites: ecrites.length,
      tiers,
      effetSurLeSolde: somme,
      refuses: refus.length,
      refus,
      identifiants: ecrites.map((e) => e.id),
    });
  } catch (err) {
    if (String(err.message || '').startsWith('[ledger]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[ledger.import]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
