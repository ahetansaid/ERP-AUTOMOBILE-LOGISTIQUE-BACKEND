/**
 * Archivage d'un véhicule.
 *
 * DÉCISION DE VISIBILITÉ, JAMAIS DE COMPTABILITÉ.
 *
 * Un véhicule archivé sort des listes, du tableau de bord, des alertes et du
 * rapport de stock. Ses écritures, elles, restent au grand livre et continuent
 * de compter dans le coût des ventes et la valeur du stock.
 *
 * Ce n'est pas un oubli, c'est le point. Si archiver retirait les coûts des
 * totaux, un simple drapeau permettrait de modifier les comptes sans laisser de
 * trace — exactement ce que le grand livre en écriture seule s'emploie à rendre
 * impossible. Pour qu'un coût cesse de compter, il faut le CONTRE-PASSER, et
 * cela s'écrit.
 *
 * Conséquence assumée : après un archivage, la valeur du stock peut dépasser ce
 * que le parc visible justifie. Cet écart est un SIGNAL, pas un défaut — il dit
 * qu'il reste de l'argent rattaché à un véhicule qu'on a choisi de ne plus voir.
 * Les listes exposent donc le nombre d'archivés plutôt que de le taire.
 *
 * Le filtre est nommé et partagé pour être trouvable : un test parcourt les
 * requêtes de véhicules et signale celles qui l'oublient là où il compte.
 */

/** À fusionner dans un `where` Prisma pour ne voir que le parc vivant. */
const NON_ARCHIVES = { archivedAt: null };

/** L'inverse — pour la vue « archivés ». */
const ARCHIVES = { archivedAt: { not: null } };

module.exports = { NON_ARCHIVES, ARCHIVES };
