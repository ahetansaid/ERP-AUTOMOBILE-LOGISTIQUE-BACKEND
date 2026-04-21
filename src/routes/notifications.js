const express = require('express');
const { prisma } = require('../lib/prisma');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

function parseIntParam(val, fallback, min = 1, max = 500) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// GET /notifications — scope tenant + utilisateur
router.get('/', authorize('notifications', 'read'), async (req, res) => {
  try {
    const limit = parseIntParam(req.query.limit, 100, 1, 500);
    const onlyUnread = req.query.unread === 'true';
    const userId = req.user?.id;

    const where = {
      ...req.tenantWhere(),
      // Inclut les notifs ciblant ce user OU les notifs "broadcast" (userId null) de la société
      OR: userId
        ? [{ userId }, { userId: null }]
        : [{ userId: null }],
      ...(onlyUnread ? { read: false } : {}),
    };

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.notification.count({
        where: {
          ...req.tenantWhere(),
          read: false,
          OR: userId
            ? [{ userId }, { userId: null }]
            : [{ userId: null }],
        },
      }),
    ]);

    return res.status(200).json({
      notifications: items,
      unreadCount,
      pagination: {},
    });
  } catch (err) {
    console.error('[notifications.list]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// PATCH /notifications/:id/read — marque une notification comme lue
router.patch('/:id/read', authorize('notifications', 'update'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const userId = req.user?.id;

    const notif = await prisma.notification.findFirst({
      where: {
        id,
        ...req.tenantWhere(),
        OR: userId ? [{ userId }, { userId: null }] : [{ userId: null }],
      },
    });
    if (!notif) {
      return res
        .status(404)
        .json({ message: 'Notification introuvable', statusCode: 404 });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { read: true },
    });
    return res.status(200).json(updated);
  } catch (err) {
    console.error('[notifications.markRead]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// POST /notifications/read-all — marque toutes les notifs de l'utilisateur comme lues
router.post('/read-all', authorize('notifications', 'update'), async (req, res) => {
  try {
    const userId = req.user?.id;
    const result = await prisma.notification.updateMany({
      where: {
        ...req.tenantWhere(),
        read: false,
        OR: userId ? [{ userId }, { userId: null }] : [{ userId: null }],
      },
      data: { read: true },
    });
    return res.status(200).json({ updated: result.count });
  } catch (err) {
    console.error('[notifications.readAll]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

// DELETE /notifications/:id
router.delete('/:id', authorize('notifications', 'delete'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID invalide', statusCode: 400 });
    }
    const userId = req.user?.id;

    const notif = await prisma.notification.findFirst({
      where: {
        id,
        ...req.tenantWhere(),
        OR: userId ? [{ userId }, { userId: null }] : [{ userId: null }],
      },
      select: { id: true },
    });
    if (!notif) {
      return res
        .status(404)
        .json({ message: 'Notification introuvable', statusCode: 404 });
    }
    await prisma.notification.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    console.error('[notifications.delete]', err);
    return res.status(500).json({ message: 'Erreur serveur', statusCode: 500 });
  }
});

module.exports = router;
