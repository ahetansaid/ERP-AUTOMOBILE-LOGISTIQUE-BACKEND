/**
 * Installation guidée.
 *
 * Un seul geste — choisir son profil — suffit à rendre la plateforme
 * opérationnelle. Le reste des étapes se coche tout seul au fil de l'usage :
 * elles sont vérifiées sur les données réelles, pas sur des drapeaux.
 */

const express = require('express');
const { applyPreset, listPresets, installationStatus } = require('../lib/presets');
const { rebuildIndex } = require('../lib/search');
const { ensureRules } = require('../lib/alerts');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

// GET /installation — état d'avancement
router.get('/', authorize('settings', 'read'), async (req, res) => {
  try {
    return res.status(200).json({
      ...(await installationStatus()),
      modeles: listPresets(),
    });
  } catch (err) {
    console.error('[installation.status]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /installation/modele { code }
router.post('/modele', authorize('settings', 'update'), async (req, res) => {
  try {
    const code = String(req.body?.code || '').toUpperCase();
    const resultat = await applyPreset(code);
    // Les règles de la bibliothèque absentes du modèle sont ajoutées désactivées :
    // le client peut les découvrir sans être noyé sous les alertes.
    await ensureRules();
    return res.status(200).json({ ...resultat, etat: await installationStatus() });
  } catch (err) {
    if (String(err.message || '').startsWith('[presets]')) {
      return res.status(400).json({ message: err.message, statusCode: 400 });
    }
    console.error('[installation.modele]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * POST /installation/finaliser
 * Reconstruit l'index de recherche. Indispensable après une reprise de données :
 * les entités importées n'ont jamais traversé l'extension Prisma.
 */
router.post('/finaliser', authorize('settings', 'update'), async (req, res) => {
  try {
    const indexed = await rebuildIndex();
    return res.status(200).json({ indexed, etat: await installationStatus() });
  } catch (err) {
    console.error('[installation.finaliser]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
