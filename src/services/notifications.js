/**
 * Service notifications
 *
 * Centralise la création de notifications in-app pour les événements métier.
 * Fire-and-forget (ne bloque pas le flow appelant en cas d'erreur).
 *
 * Usage :
 *   notify({
 *     companyId,
 *     type: 'PAYMENT_DUE',
 *     title: 'Paiement reçu',
 *     message: `Reçu de ${amount} FCFA sur facture ${invoiceNumber}`,
 *     link: `/comptabilite/factures/${invoiceId}`,
 *     audience: 'company', // ou { userId }
 *   });
 */

const { prisma } = require('../lib/prisma');

async function notify({
  companyId = null,
  type = 'INFO',
  title,
  message,
  link = null,
  audience = 'company', // 'company' | 'admins' | { userId: number }
}) {
  try {
    // Audience explicite : un seul utilisateur
    if (audience && typeof audience === 'object' && audience.userId) {
      await prisma.notification.create({
        data: {
          userId: audience.userId,
          companyId,
          type,
          title: title?.slice(0, 255) ?? null,
          message: message ?? null,
          link: link?.slice(0, 500) ?? null,
        },
      });
      return;
    }

    // Audience "company" → tous les utilisateurs actifs de la société
    // Audience "admins" → ADMIN + MANAGER de la société
    const whereUsers = {
      isActive: true,
      ...(companyId ? { companyId } : {}),
      ...(audience === 'admins'
        ? { role: { in: ['ADMIN', 'MANAGER'] } }
        : {}),
    };

    const users = await prisma.user.findMany({
      where: whereUsers,
      select: { id: true },
    });

    if (!users.length) {
      // Fallback : créer une notif "company" (userId null) pour ne rien perdre
      await prisma.notification.create({
        data: {
          companyId,
          type,
          title: title?.slice(0, 255) ?? null,
          message: message ?? null,
          link: link?.slice(0, 500) ?? null,
        },
      });
      return;
    }

    await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        companyId,
        type,
        title: title?.slice(0, 255) ?? null,
        message: message ?? null,
        link: link?.slice(0, 500) ?? null,
      })),
    });
  } catch (err) {
    console.error('[notify]', err.message);
  }
}

module.exports = { notify };
