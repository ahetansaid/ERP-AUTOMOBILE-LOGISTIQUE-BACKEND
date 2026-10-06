/**
 * Comptabilité générale — plan de comptes et balance SYSCOHADA.
 *
 * La comptabilité générale est une VUE du grand livre analytique, jamais une
 * seconde saisie. Ces routes ne créent rien et ne modifient rien : elles
 * projettent. Un mapping corrigé se rejoue sur tout l'historique.
 */

const express = require('express');
const { authorize } = require('../middleware/rbac');
const { PLAN, MAPPING_DEFAUT, verifier, balance } = require('../lib/syscohada');

const router = express.Router();

/** Le plan et le mapping en vigueur — ce que le comptable doit pouvoir relire. */
router.get('/plan', authorize('reports', 'read'), async (req, res) => {
  return res.status(200).json({
    plan: PLAN,
    mapping: MAPPING_DEFAUT,
    problemes: verifier(MAPPING_DEFAUT),
  });
});

/**
 * GET /comptabilite/balance?du=AAAA-MM-JJ&au=AAAA-MM-JJ
 *
 * Expose `nonProjetees` au même rang que les totaux, et c'est voulu : une
 * balance équilibrée dont la moitié des lignes manque reste une balance
 * fausse. Le chiffre qui compte n'est pas l'équilibre, c'est le taux de
 * projection.
 */
router.get('/balance', authorize('reports', 'read'), async (req, res) => {
  try {
    const du = typeof req.query.du === 'string' ? req.query.du : null;
    const au = typeof req.query.au === 'string' ? req.query.au : null;
    return res.status(200).json(await balance({ du, au }));
  } catch (e) {
    if (e.code === 'MAPPING_INVALIDE') {
      return res.status(409).json({ message: e.message, statusCode: 409, problemes: e.problemes });
    }
    console.error('[comptabilite.balance]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
