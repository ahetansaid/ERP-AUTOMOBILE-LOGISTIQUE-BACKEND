/**
 * Recherche universelle et dossier 360°.
 *
 * Une seule barre : on tape un VIN partiel, un conteneur, un navire, un numéro
 * de facture ou un nom de prestataire, et on ouvre le dossier correspondant.
 */

const express = require('express');
const { search, rebuildIndex } = require('../lib/search');
const { getDossier, DOSSIER_TYPES } = require('../lib/dossier');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

// GET /search?q=852354
router.get('/', authorize('dashboard', 'read'), async (req, res) => {
  try {
    const q = String(req.query.q || '');
    if (!q.trim()) return res.status(200).json({ results: [], query: q });
    const limit = Math.min(Number(req.query.limit) || 12, 50);
    return res.status(200).json({ query: q, results: await search(q, { limit }) });
  } catch (err) {
    if (String(err.message || '').startsWith('[search]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[search.query]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * POST /search/rebuild — reconstruit l'index de la société.
 * À lancer une fois après la migration : les entités antérieures n'ont jamais
 * traversé l'extension, elles ne sont donc pas encore indexées.
 */
router.post('/rebuild', authorize('settings', 'update'), async (req, res) => {
  try {
    return res.status(200).json({ indexed: await rebuildIndex() });
  } catch (err) {
    console.error('[search.rebuild]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// GET /search/dossier/:type/:id
router.get('/dossier/:type/:id', authorize('dashboard', 'read'), async (req, res) => {
  try {
    const { type, id } = req.params;
    if (!DOSSIER_TYPES.includes(type)) {
      return res.status(400).json({
        message: `Type inconnu : ${type}. Disponibles : ${DOSSIER_TYPES.join(', ')}`,
        statusCode: 400,
      });
    }
    if (!Number.isInteger(Number(id))) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const dossier = await getDossier(type, id);
    if (!dossier) {
      return res.status(404).json({ message: 'Dossier introuvable', statusCode: 404 });
    }
    return res.status(200).json(dossier);
  } catch (err) {
    if (String(err.message || '').startsWith('[dossier]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[search.dossier]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
