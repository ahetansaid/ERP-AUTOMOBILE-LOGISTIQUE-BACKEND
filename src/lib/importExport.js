/**
 * Routes d'export et d'import, montées de la même façon pour toute entité.
 *
 * POURQUOI FACTORISER
 *
 * Les véhicules et la caisse ont chacun leur route écrite à la main. Écrire la
 * troisième et la quatrième à l'identique, c'est quatre endroits où oublier le
 * tour à blanc — et l'oublier une fois suffit à écrire des lignes fausses dans
 * un registre qui ne s'efface pas.
 *
 * Ici, le mode à blanc n'est pas une option qu'on pense à brancher : il est le
 * chemin par défaut du code, et `?valider=1` est la seule sortie.
 *
 * CE QUE CHAQUE ENTITÉ FOURNIT
 *
 *   colonnes   l'ordre du fichier — l'export produit exactement celui-ci, et
 *              c'est ce qui fait de l'export le modèle d'import
 *   exporter   (req) → lignes prêtes à sérialiser
 *   preparer   (lignes, tenantWhere) → { valides, refus }, sans rien écrire
 *   ecrire     (valides, req) → ce qui a été créé
 *   apercu     (v) → la ligne telle qu'on la montre avant validation
 *
 * L'export et l'import partagent donc leurs colonnes par construction : elles
 * ne peuvent pas diverger.
 */

const { analyser, serialiser, entetesTelechargement } = require('./csv');

/**
 * @param {import('express').Router} router
 * @param {object} spec
 */
function monterImportExport(router, spec) {
  // Nombre de routes déjà posées : sert à retrouver les nôtres pour les
  // remonter en tête (voir la fin de la fonction).
  const avant = router.stack.length;

  const {
    authorize,
    module: moduleRbac,
    nom,
    colonnes,
    obligatoires = [],
    exporter,
    preparer,
    ecrire,
    apercu = (v) => v.apercu ?? v,
  } = spec;

  /**
   * GET /export — les données en CSV, et le modèle d'import.
   *
   * `?modele=1` renvoie les seules en-têtes, pour partir d'un fichier vide.
   * L'ordre de résolution est réglé en fin de fonction, pas ici.
   */
  router.get('/export', authorize(moduleRbac, 'read'), async (req, res) => {
    try {
      const modele = String(req.query.modele || '') === '1';
      const lignes = modele ? [] : await exporter(req);
      const jour = new Date().toISOString().slice(0, 10);
      entetesTelechargement(res, modele ? `modele-${nom}.csv` : `${nom}-${jour}.csv`);
      return res.send(serialiser(lignes, colonnes));
    } catch (err) {
      console.error(`[${nom}.export]`, err);
      return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
    }
  });

  /**
   * POST /import — création en masse.
   *
   * À blanc par défaut. `?valider=1` pour écrire.
   */
  router.post('/import', authorize(moduleRbac, 'create'), async (req, res) => {
    try {
      const contenu = req.file?.buffer
        ? req.file.buffer.toString('utf8')
        : String((req.body || {}).csv || '');
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

      const manquantes = obligatoires.filter((c) => !entetes.includes(c));
      if (manquantes.length) {
        return res.status(400).json({
          message:
            `Colonne obligatoire absente : ${manquantes.join(', ')}. ` +
            `Colonnes attendues : ${colonnes.join(', ')}.`,
          statusCode: 400,
          entetesLues: entetes,
        });
      }

      const { valides, refus } = await preparer(lignes, req.tenantWhere(), req);
      const valider = String(req.query.valider || '') === '1';

      if (!valider) {
        return res.status(200).json({
          mode: 'a-blanc',
          message:
            `${valides.length} ligne(s) seraient créées, ${refus.length} refusée(s). ` +
            'Rien n’a été écrit. Relancez avec ?valider=1 pour appliquer.',
          lus: lignes.length,
          creables: valides.length,
          refuses: refus.length,
          apercu: valides.slice(0, 15).map((v) => ({ ligne: v.ligne, ...apercu(v) })),
          refus,
        });
      }

      const crees = await ecrire(valides, req);
      return res.status(201).json({
        mode: 'applique',
        message: `${Array.isArray(crees) ? crees.length : crees.total} ligne(s) créée(s), ${refus.length} refusée(s).`,
        lus: lignes.length,
        crees,
        refuses: refus.length,
        refus,
      });
    } catch (err) {
      // Les garde-fous métier sont des erreurs de saisie, pas des pannes.
      if (/^\[(ledger|storage|tenant)\]/.test(String(err.message || ''))) {
        return res.status(400).json({ message: err.message, statusCode: 400 });
      }
      console.error(`[${nom}.import]`, err);
      return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
    }
  });

  /*
   * Nos deux routes sont remontées EN TÊTE de la pile.
   *
   * Express résout dans l'ordre de déclaration : `/export` déclaré après
   * `/:id` serait capturé par lui, `Number('export')` donnerait NaN, et la
   * route répondrait « ID invalide » au lieu du fichier. Le piège s'est déjà
   * refermé une fois sur les véhicules.
   *
   * Plutôt que d'exiger de chaque appelant qu'il pense à placer l'appel avant
   * ses routes paramétrées — ce qu'on oubliera —, on corrige l'ordre ici, une
   * fois. L'entité n'a plus rien à savoir.
   */
  const nouvelles = router.stack.splice(avant);
  router.stack.unshift(...nouvelles);
}

module.exports = { monterImportExport };
