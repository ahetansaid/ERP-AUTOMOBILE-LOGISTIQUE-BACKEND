const express = require('express');
const bcrypt = require('bcrypt');
const { prisma } = require('../lib/prisma');
const { toSnake } = require('../lib/serialize');
const { authorize } = require('../middleware/rbac');
const router = express.Router();

// Doit rester synchronisé avec l'enum UserRole (prisma/schema.prisma) et avec
// le type UserRole du frontend (src/types/index.ts). Sans ce garde-fou, un rôle
// inconnu remonte en erreur Prisma opaque (500) au lieu d'un 400 explicite.
// PLATFORM_ADMIN est volontairement absent : il ne s'attribue pas via l'API.
const USER_ROLES = [
  'ADMIN',
  'MANAGER',
  'SALES',
  'ACCOUNTING',
  'WORKSHOP',
  'LOGISTICS',
  'USER',
  'READ_ONLY',
];

router.get('/', authorize('users', 'read'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { ...req.tenantWhere() },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
    return res.status(200).json({ users: toSnake(users), pagination: {} });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

router.post('/', authorize('users', 'create'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.email || !b.password) return res.status(400).json({ message: 'email et password requis', statusCode: 400 });
    if (typeof b.password !== 'string' || b.password.length < 8) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 8 caractères', statusCode: 400 });
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
        email: b.email,
        password: hash,
        firstName: b.firstName || null,
        lastName: b.lastName || null,
        role,
        companyId: req.companyId ?? null,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
    });
    return res.status(201).json(toSnake(created));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
