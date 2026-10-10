/**
 * Règles de garde sur les comptes utilisateurs.
 *
 * Ce module ne touche ni à la base ni à Express : il décide seulement si une
 * modification de compte est permise, et ce que le journal d'audit doit en
 * dire. C'est là que ces règles pouvaient être testées sans base de données,
 * comme le reste du projet.
 *
 * Trois pièges que ces gardes ferment :
 *
 *   1. L'auto-locks. Un administrateur qui se rétrograde ou se désactive lui-
 *      même perd l'accès à l'écran qui aurait permis de réparer.
 *   2. La société sans administrateur. Seul le rôle ADMIN ouvre la gestion des
 *      comptes : le dernier administrateur actif d'une société ne peut pas
 *      disparaître, sinon plus personne ne peut en créer un.
 *   3. L'ascension. `PLATFORM_ADMIN` est l'éditeur de la plateforme : il peut
 *      opérer sur la société de n'importe quel client. Il ne s'attribue pas
 *      depuis cette API, et un gérant ne remonte ni ne descend un éditeur.
 */

const { Prisma } = require('@prisma/client');

/**
 * Tous les rôles de l'enum Prisma `UserRole`, lus dans le schéma.
 *
 * On ne les recopie pas : une liste à la main, c'est exactement comme le
 * frontend en tient une autre — la troisième dérive un jour, silencieusement.
 * Le schéma est l'autorité, `Prisma.dmmf` est le même objet dont se sert
 * lib/prisma.js pour déduire les modèles multi-sociétés.
 */
const TOUS_ROLES = (
  Prisma.dmmf.datamodel.enums.find((e) => e.name === 'UserRole')?.values ?? []
).map((v) => v.name);

/**
 * Rôles que cette API ne sait pas attribuer, et pourquoi.
 *
 *   - PLATFORM_ADMIN : l'éditeur de la plateforme peut opérer sur la société de
 *     n'importe quel client. Il ne se donne que par un acte d'exploitation, pas
 *     par un gérant depuis son interface ;
 *   - PARTNER : le rôle reste inerte tant que le filtrage par tiers n'existe
 *     pas (voir ROLE_PERMISSIONS dans middleware/rbac.js). Attribuer un accès
 *     qui n'ouvre rien, c'est faire croire à un transitaire qu'il est connecté
 *     à son espace.
 */
const ROLES_NON_ATTRIBUABLES = new Set(['PLATFORM_ADMIN', 'PARTNER']);

const ROLES_ATTRIBUABLES = TOUS_ROLES.filter((r) => !ROLES_NON_ATTRIBUABLES.has(r));

const ROLE_EDITEUR = 'PLATFORM_ADMIN';
const ROLE_ADMINISTRATEUR = 'ADMIN';

/**
 * Une modification de compte est-elle permise ?
 *
 * @param {object} params
 * @param {{ id: number, role: string }} params.acteur  le compte qui agit
 * @param {{ id: number, role: string, isActive: boolean }} params.cible
 *        le compte modifié, TEL QU'IL EST en base
 * @param {string} [params.roleDemande] nouveau rôle demandé
 * @param {boolean} [params.desactivation] demande de désactivation
 * @param {number} [params.administrateursActifs] administrateurs actifs de la
 *        société, cible comprise
 * @returns {{ status: number|null, message: string|null }} `status` nul quand
 *          tout est permis ; sinon le code HTTP à renvoyer et son motif.
 */
function verifierModification({
  acteur,
  cible,
  roleDemande,
  desactivation,
  administrateursActifs,
}) {
  const refuse = (status, message) => ({ status, message });

  // 1. Un rôle que l'API ne sait pas attribuer n'est pas une demande.
  if (roleDemande !== undefined && !ROLES_ATTRIBUABLES.includes(roleDemande)) {
    return refuse(400, `Rôle invalide : ${roleDemande}. Valeurs acceptées : ${ROLES_ATTRIBUABLES.join(', ')}`);
  }

  // 2. L'éditeur de la plateforme n'est pas à la main des gérants.
  if (cible.role === ROLE_EDITEUR && acteur.role !== ROLE_EDITEUR) {
    return refuse(403, 'Les comptes de l’éditeur de la plateforme ne se modifient que par l’éditeur.');
  }

  const changeRole = roleDemande !== undefined && roleDemande !== cible.role;

  // 3. On ne se ferme pas la porte derrière soi.
  if (acteur.id === cible.id && changeRole) {
    return refuse(400, 'On ne modifie pas son propre rôle. Confiez cette tâche à un autre administrateur.');
  }
  if (acteur.id === cible.id && desactivation) {
    return refuse(400, 'On ne se désactive pas soi-même : la session courante en dépend.');
  }

  // 4. La société doit conserver au moins un administrateur actif.
  const perdUnAdministrateur =
    cible.role === ROLE_ADMINISTRATEUR && (changeRole || desactivation);
  if (perdUnAdministrateur && administrateursActifs <= 1) {
    return refuse(400, 'Ce compte est le seul administrateur actif de la société. Nommez d’abord un successeur.');
  }

  return { status: null, message: null };
}

/**
 * Ce qui a changé, en français, pour le journal d'audit.
 *
 * Le journal stocke `before` et `after` en JSONB : une lecture brute exposerait
 * des dates de modification et des clés techniques, et noierait l'information.
 * On ne résume ici que les champs qui décident d'un accès — le mot de passe et
 * le secret 2FA n'y arrivent jamais, déjà masqués à l'écriture par
 * `sanitize()` dans lib/prisma.js.
 */
const CHAMPS_JOURNALISABLES = {
  role: { libelle: 'rôle', traduit: (v) => v },
  isActive: { libelle: 'statut', traduit: (v) => (v ? 'actif' : 'désactivé') },
  firstName: { libelle: 'prénom', traduit: (v) => v ?? '—' },
  lastName: { libelle: 'nom', traduit: (v) => v ?? '—' },
  partnerId: {
    libelle: 'tiers rattaché',
    traduit: (v) => (v == null ? 'aucun' : `#${v}`),
  },
};

function resumerChangement(before, after) {
  if (!after) return [];
  const avant = before || {};
  const creation = !before;
  const changements = [];

  for (const [champ, { libelle, traduit }] of Object.entries(CHAMPS_JOURNALISABLES)) {
    if (!(champ in after)) continue;
    const nouvelleValeur = after[champ];
    const ancienneValeur = avant[champ];
    if (nouvelleValeur === ancienneValeur) continue;
    // À la création, l'identité du compte est déjà dans sa ligne : seul ce qui
    // décide d'un accès mérite d'être répété.
    if (creation) {
      if (champ === 'role') changements.push(`rôle : ${traduit(nouvelleValeur)}`);
      else if (champ === 'partnerId' && nouvelleValeur != null) {
        changements.push(`tiers rattaché : ${traduit(nouvelleValeur)}`);
      }
      continue;
    }
    changements.push(
      `${libelle} : ${traduit(ancienneValeur)} → ${traduit(nouvelleValeur)}`
    );
  }

  return changements;
}

module.exports = {
  TOUS_ROLES,
  ROLES_ATTRIBUABLES,
  ROLE_EDITEUR,
  ROLE_ADMINISTRATEUR,
  verifierModification,
  resumerChangement,
};
