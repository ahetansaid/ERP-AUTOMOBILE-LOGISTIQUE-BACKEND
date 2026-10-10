/**
 * Gestion des comptes utilisateurs.
 *
 * « Être un tiers » et « avoir un accès » sont deux choses différentes (voir
 * lib/partners.js) : cette page n'ouvre le second que pour les humains de la
 * société. Tout ce qui décide d'un accès — créer, changer un rôle, éteindre un
 * compte — est rendu ici, et nulle part ailleurs.
 *
 * Les règles de garde vivent dans lib/accounts.js, hors d'Express et de Prisma,
 * pour être testées sans base.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const { prisma } = require('../lib/prisma');
const { toSnake } = require('../lib/serialize');
const { authorize } = require('../middleware/rbac');
const { sendMail } = require('../lib/mailer');
const {
  TOUS_ROLES,
  ROLES_ATTRIBUABLES,
  ROLE_ADMINISTRATEUR,
  verifierModification,
  resumerChangement,
} = require('../lib/accounts');

const router = express.Router();

// Les rôles attribuables sont lus dans le schéma (lib/accounts.js) : rien à
// recopier ici, et un rôle inconnu remonte en 400 explicite plutôt qu'en erreur
// Prisma opaque (500).
const USER_ROLES = ROLES_ATTRIBUABLES;

const CHAMPS_LISTE = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  twoFaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  companyId: true,
  partnerId: true,
};

// GET /users — liste, filtrable par rôle, statut et texte libre.
router.get('/', authorize('users', 'read'), async (req, res) => {
  try {
    const where = {};
    const { q, role, active } = req.query;

    if (role) {
      const roleDemande = String(role).toUpperCase();
      if (!TOUS_ROLES.includes(roleDemande)) {
        return res.status(400).json({
          message: `Rôle inconnu : ${roleDemande}`,
          statusCode: 400,
        });
      }
      where.role = roleDemande;
    }
    if (active === 'false') where.isActive = false;
    else if (active === 'true') where.isActive = true;

    if (q) {
      const texte = String(q);
      where.OR = [
        { email: { contains: texte, mode: 'insensitive' } },
        { firstName: { contains: texte, mode: 'insensitive' } },
        { lastName: { contains: texte, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 200,
      select: { ...CHAMPS_LISTE, partner: { select: { id: true, name: true } } },
    });

    return res.status(200).json({ users: toSnake(users) });
  } catch (e) {
    console.error('[users.list]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * GET /users/journal — les actes qui ont changé un accès.
 *
 * `AuditLog` est déjà alimenté automatiquement par l'extension Prisma sur toute
 * écriture ; il manquait seulement une fenêtre dessus pour les comptes. Les
 * colonnes `before` / `after` ne sortent pas telles quelles : elles sont
 * résumées en français, et le mot de passe comme le secret 2FA y ont été masqués
 * à l'écriture (voir `sanitize` dans lib/prisma.js).
 */
router.get('/journal', authorize('users', 'read'), async (req, res) => {
  try {
    const lignes = await prisma.auditLog.findMany({
      where: { resource: 'User', action: { in: ['CREATE', 'UPDATE'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Noms des acteurs et des comptes concernés, en deux requêtes au lieu
    // d'une par ligne.
    const ids = new Set();
    for (const l of lignes) {
      if (l.userId != null) ids.add(l.userId);
      if (l.resourceId != null) ids.add(l.resourceId);
    }
    const nommés = await prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const parId = new Map(
      nommés.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      ])
    );

    return res.status(200).json({
      journal: lignes.map((l) => ({
        // Identifiant BigInt : la colonne ne passe pas telle quelle en JSON,
        // et un Number au-delà de 2^53 perdrait des chiffres.
        id: String(l.id),
        date: l.createdAt,
        type: l.action === 'CREATE' ? 'creation' : 'modification',
        acteur: l.userId != null ? parId.get(l.userId) ?? null : null,
        systeme: l.userId == null,
        compte_id: l.resourceId,
        compte: l.resourceId != null ? parId.get(l.resourceId) ?? null : null,
        changements: resumerChangement(l.before, l.after),
      })),
    });
  } catch (e) {
    console.error('[users.journal]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /users — création d'un compte.
router.post('/', authorize('users', 'create'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.email || !b.password) {
      return res
        .status(400)
        .json({ message: 'email et password requis', statusCode: 400 });
    }
    const email = String(b.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Adresse email invalide', statusCode: 400 });
    }
    if (typeof b.password !== 'string' || b.password.length < 8) {
      return res.status(400).json({
        message: 'Le mot de passe doit contenir au moins 8 caractères',
        statusCode: 400,
      });
    }
    const role = b.role || 'USER';
    if (!USER_ROLES.includes(role)) {
      return res.status(400).json({
        message: `Rôle invalide : ${role}. Valeurs acceptées : ${USER_ROLES.join(', ')}`,
        statusCode: 400,
      });
    }

    const hash = await bcrypt.hash(b.password, 12);
    // companyId forcé au tenant courant (empêche la création cross-société).
    const created = await prisma.user.create({
      data: {
        email,
        password: hash,
        firstName: b.firstName || null,
        lastName: b.lastName || null,
        role,
        companyId: req.companyId ?? null,
      },
      select: CHAMPS_LISTE,
    });

    // Le mot de passe ne voyage pas : l'expéditeur l'a transmis lui-même, par
    // un autre canal. Ce message annonce seulement que le compte existe.
    const base =
      process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:3000';
    sendMail({
      to: created.email,
      subject: 'Votre compte ParcAuto Manager est prêt',
      template: 'welcome',
      data: {
        userName: [created.firstName, created.lastName].filter(Boolean).join(' ') || null,
        loginUrl: `${base.replace(/\/$/, '')}/login`,
      },
      companyId: req.companyId ?? null,
      resource: 'users',
      resourceId: created.id,
    }).catch((err) => console.error('[users.welcome.mail]', err.message));

    return res.status(201).json(toSnake(created));
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({
        message: 'Cette adresse email porte déjà un compte',
        statusCode: 409,
      });
    }
    console.error('[users.create]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

/**
 * PATCH /users/:id — rôle, identité, activation.
 *
 * Pas de suppression : un compte qui a travaillé laisse des écritures au grand
 * livre, des factures et un nom dans le journal. On l'éteint (`is_active`), il
 * cesse de pouvoir se connecter et de rafraîchir sa session, il reste comptable
 * de ce qu'il a fait.
 *
 * La coupure prend effet au plus au renouvellement suivant, soit trente
 * minutes : le jeton d'accès en cours reste valide jusqu'à son expiration,
 * puisqu'aucune lecture en base ne vérifie l'état du compte à chaque requête.
 * (La table `sessions` n'est pas alimentée au login : révoquer ses lignes ne
 * couperait rien, et il ne faut pas confondre ce geste avec un mécanisme.)
 */
router.patch('/:id', authorize('users', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }

    const cible = await prisma.user.findFirst({
      where: { id },
      select: CHAMPS_LISTE,
    });
    if (!cible) {
      return res.status(404).json({ message: 'Utilisateur introuvable', statusCode: 404 });
    }

    const b = req.body || {};
    const demandeRole = b.role !== undefined ? String(b.role) : undefined;
    const demandeActivation =
      b.isActive !== undefined || b.is_active !== undefined
        ? !!(b.isActive ?? b.is_active)
        : undefined;

    // Le seul administrateur actif d'une société ne peut pas être effacé par
    // erreur : après lui, plus personne n'a accès à cet écran.
    const administrateursActifs =
      cible.role === ROLE_ADMINISTRATEUR && (demandeRole !== undefined || demandeActivation === false)
        ? await prisma.user.count({ where: { role: ROLE_ADMINISTRATEUR, isActive: true } })
        : undefined;

    const garde = verifierModification({
      acteur: { id: req.user.id, role: req.user.role },
      cible,
      roleDemande: demandeRole,
      desactivation: demandeActivation === false,
      administrateursActifs,
    });
    if (garde.status) {
      return res.status(garde.status).json({ message: garde.message, statusCode: garde.status });
    }

    const data = {};
    if (demandeRole !== undefined) data.role = demandeRole;
    if (demandeActivation !== undefined) data.isActive = demandeActivation;
    for (const champ of ['firstName', 'lastName']) {
      if (b[champ] !== undefined) data[champ] = String(b[champ] || '').trim().slice(0, 100) || null;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'Rien à modifier', statusCode: 400 });
    }

    const updated = await prisma.user.update({ where: { id }, data, select: CHAMPS_LISTE });

    return res.status(200).json({
      user: toSnake(updated),
      message:
        demandeActivation === false
          ? 'Compte désactivé : plus de connexion possible, et la session en cours tombe à son expiration.'
          : 'Compte mis à jour.',
    });
  } catch (e) {
    if (e.code === 'P2025') {
      return res.status(404).json({ message: 'Utilisateur introuvable', statusCode: 404 });
    }
    console.error('[users.update]', e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
