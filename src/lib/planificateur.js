/**
 * Planificateur — ce qui appuie sur le bouton.
 *
 * Le moteur d'alertes et le générateur de rapports existaient, testés, mais
 * personne ne les déclenchait : il fallait un POST manuel. En ligne, le panneau
 * d'alertes serait resté figé sur les anomalies du jour de la mise en service,
 * et aucun rapport quotidien, hebdomadaire ou mensuel ne serait sorti. C'est
 * précisément ce que le client appelle « gestion intelligente ».
 *
 * UNE SEULE DATE DE RÉFÉRENCE : LA VEILLE.
 *
 * Un rapport quotidien produit à 3 h du matin le 15 doit couvrir le 14, pas un
 * 15 qui vient de commencer. En prenant la veille comme référence, les bornes
 * de période font le reste, sans cas particulier :
 *
 *   · QUOTIDIEN     → hier ;
 *   · HEBDOMADAIRE  → lancé un lundi, la veille est dimanche, donc la semaine
 *                     lundi-dimanche qui vient de se terminer ;
 *   · MENSUEL       → lancé le 1er, la veille est le dernier jour du mois
 *                     précédent, donc le mois écoulé.
 *
 * TOUT EST CALCULÉ EN UTC, comme les bornes de période. Le Bénin est à UTC+1
 * sans heure d'été : une exécution à 02 h UTC tombe à 03 h locales, largement
 * après la clôture de la journée qu'on rapporte.
 *
 * MULTI-SOCIÉTÉS PAR CONCEPTION.
 *
 * La tâche parcourt les sociétés et s'exécute DANS le contexte de chacune.
 * L'échec de l'une n'arrête pas les autres : un client dont les données
 * bloquent une règle ne doit pas priver les autres de leurs alertes.
 */

const { prisma } = require('./prisma');
const { runAsSystem } = require('./context');
const { runAll, ensureRules } = require('./alerts');
const { generateReport } = require('./reports');
const { logger } = require('./logger');

const log = logger('planificateur');

/** Veille de `maintenant`, à minuit UTC. */
function veille(maintenant = new Date()) {
  const d = new Date(maintenant);
  const hier = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  hier.setUTCDate(hier.getUTCDate() - 1);
  return hier;
}

/**
 * Périodicités dues pour une exécution donnée.
 *
 * Le quotidien est toujours dû. L'hebdomadaire ne l'est qu'un lundi, le mensuel
 * qu'un premier du mois — sinon on régénérerait chaque nuit un rapport de
 * période incomplète, qui écraserait le précédent.
 */
function periodicitesDues(maintenant = new Date()) {
  const d = new Date(maintenant);
  const dues = ['QUOTIDIEN'];
  if (d.getUTCDay() === 1) dues.push('HEBDOMADAIRE');
  if (d.getUTCDate() === 1) dues.push('MENSUEL');
  return dues;
}

/** Sociétés à traiter. Hors périmètre : la liste ne dépend d'aucune d'elles. */
async function societes() {
  return runAsSystem(null, async () => {
    return prisma.company.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } });
  });
}

/**
 * Traite une société : alertes, puis rapports dus.
 *
 * Ne lève jamais. Chaque sous-tâche est isolée : une règle d'alerte en échec ne
 * doit pas empêcher le rapport de sortir, et l'inverse non plus.
 */
async function traiterSociete(societe, maintenant, periodicites) {
  const resultat = { companyId: societe.id, nom: societe.name, alertes: null, rapports: [], erreurs: [] };
  const ref = veille(maintenant);

  await runAsSystem(societe.id, async () => {
    // Les règles par défaut sont installées si elles manquent : une société
    // créée entre deux exécutions ne reste pas sans surveillance.
    try {
      await ensureRules();
      resultat.alertes = await runAll();
    } catch (err) {
      resultat.erreurs.push({ tache: 'alertes', message: err.message });
      log.error('évaluation des alertes en échec', { companyId: societe.id, err });
    }

    for (const p of periodicites) {
      try {
        const rapport = await generateReport(p, ref);
        resultat.rapports.push({ periodicite: p, id: Number(rapport.id), statut: rapport.status });
      } catch (err) {
        // Un rapport déjà approuvé n'est pas écrasé : ce n'est pas un échec,
        // c'est la garantie qui joue son rôle.
        const approuve = /approuvé/.test(err.message);
        if (approuve) {
          resultat.rapports.push({ periodicite: p, ignore: 'déjà approuvé' });
        } else {
          resultat.erreurs.push({ tache: `rapport ${p}`, message: err.message });
          log.error('génération de rapport en échec', { companyId: societe.id, p, err });
        }
      }
    }
  });

  return resultat;
}

/**
 * Exécution complète. Retourne un compte rendu, ne lève que si la liste des
 * sociétés est elle-même inaccessible.
 */
/**
 * Budget de temps, sous la limite d'exécution de la plateforme.
 *
 * Une fonction serverless tuée en vol ne dit rien : ni ce qu'elle a fait, ni ce
 * qu'il restait. En s'arrêtant AVANT la limite, la tâche rend un compte rendu
 * qui nomme les sociétés non traitées — on sait quoi relancer.
 *
 * Repère de coût : le traitement d'une société enchaîne quelque quatre cents
 * requêtes. Colocalisée avec la base, chacune coûte une poignée de
 * millisecondes ; depuis un poste distant, cent cinquante. C'est la latence qui
 * décide, pas le calcul.
 */
const BUDGET_MS = Number(process.env.CRON_BUDGET_MS || 45000);

async function executer(maintenant = new Date()) {
  const debut = Date.now();
  const periodicites = periodicitesDues(maintenant);
  const liste = await societes();

  const resultats = [];
  const reportees = [];
  for (const s of liste) {
    // Le budget est vérifié AVANT d'engager une société, jamais au milieu :
    // une société est traitée entièrement ou pas du tout.
    if (resultats.length && Date.now() - debut > BUDGET_MS) {
      reportees.push({ companyId: s.id, nom: s.name });
      continue;
    }
    resultats.push(await traiterSociete(s, maintenant, periodicites));
  }

  if (reportees.length) {
    log.warn('budget de temps atteint, sociétés reportées', {
      traitees: resultats.length,
      reportees: reportees.length,
      dureeMs: Date.now() - debut,
    });
  }

  const compteRendu = {
    execute: new Date(maintenant).toISOString(),
    referencePeriode: veille(maintenant).toISOString().slice(0, 10),
    periodicites,
    societes: resultats.length,
    rapports: resultats.reduce((s, r) => s + r.rapports.length, 0),
    anomaliesOuvertes: resultats.reduce((s, r) => s + (r.alertes?.ouvertes ?? 0), 0),
    anomaliesResolues: resultats.reduce((s, r) => s + (r.alertes?.resolues ?? 0), 0),
    erreurs: resultats.reduce((s, r) => s + r.erreurs.length, 0),
    /** Sociétés non traitées faute de temps — vides en fonctionnement normal. */
    reportees,
    dureeMs: Date.now() - debut,
    detail: resultats,
  };

  log.info('planification exécutée', {
    societes: compteRendu.societes,
    periodicites: periodicites.join(','),
    rapports: compteRendu.rapports,
    erreurs: compteRendu.erreurs,
    dureeMs: compteRendu.dureeMs,
  });

  return compteRendu;
}

module.exports = { executer, periodicitesDues, veille, traiterSociete };
