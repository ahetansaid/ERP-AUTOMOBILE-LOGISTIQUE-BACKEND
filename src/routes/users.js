const express = require('express');
const bcrypt = require('bcrypt');
const { prisma } = require('../lib/prisma');
const { toSnake } = require('../lib/serialize');
const { authorize } = require('../middleware/rbac');
const router = express.Router();

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
    const hash = await bcrypt.hash(b.password, 12);
    // companyId forcé au tenant courant (empêche la création cross-société).
    const created = await prisma.user.create({
      data: {
        email: b.email,
        password: hash,
        firstName: b.firstName || null,
        lastName: b.lastName || null,
        role: b.role || 'USER',
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
