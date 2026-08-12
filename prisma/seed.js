/**
 * Seed — données initiales :
 *   - catalogue des permissions fines (table `permissions`)
 *   - société par défaut + utilisateur admin
 *
 * Usage :
 *   node prisma/seed.js   (ou : npm run seed)
 *
 * Idempotent : peut être rejoué sans créer de doublons.
 *
 * Identifiants admin configurables via l'environnement :
 *   SEED_ADMIN_EMAIL    (défaut: admin@parcauto.local)
 *   SEED_ADMIN_PASSWORD (obligatoire hors développement, 12 caractères minimum)
 *
 * Le mot de passe par défaut ne survit qu'en développement, et n'est jamais
 * affiché ailleurs : un compte ADMIN dont le mot de passe est publié dans le
 * dépôt ouvre toute la société à qui connaît l'URL.
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { prisma } = require('../src/lib/prisma');
const { runUnscoped } = require('../src/lib/context');

const MODULES = [
  'clients',
  'suppliers',
  'vehicles',
  'purchases',
  'invoices',
  'receipts',
  'charges',
  'workshop_quotes',
  'proformas',
  'transit',
  'treasury',
  'reports',
  'dashboard',
  'notifications',
  'users',
  'settings',
  'uploads',
];

const ACTIONS = ['create', 'read', 'update', 'delete', 'export'];

/** Mots de passe qui ont circulé dans la documentation ou les exemples. */
const MOTS_DE_PASSE_CONNUS = new Set([
  'Admin123!', 'admin', 'admin123', 'password', 'Password1', 'changeme',
]);

/**
 * Mot de passe de l'administrateur initial.
 *
 * En développement, le défaut reste commode. Partout ailleurs il est refusé :
 * un compte ADMIN est un accès complet à la société, et un mot de passe publié
 * dans un dépôt n'est pas un secret.
 */
function resoudreMotDePasse() {
  const fourni = process.env.SEED_ADMIN_PASSWORD;
  const dev = (process.env.NODE_ENV || 'development') === 'development';

  if (!fourni) {
    if (dev) return 'Admin123!';
    throw new Error(
      'SEED_ADMIN_PASSWORD est obligatoire hors développement. ' +
        'Génération : node -e "console.log(require(\'crypto\').randomBytes(18).toString(\'base64url\'))"'
    );
  }
  if (dev) return fourni;

  if (fourni.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD doit faire au moins 12 caractères.');
  }
  if (MOTS_DE_PASSE_CONNUS.has(fourni)) {
    throw new Error('SEED_ADMIN_PASSWORD figure parmi les mots de passe connus publiquement.');
  }
  return fourni;
}

async function main() {
  console.log('Seed des permissions…');

  let created = 0;
  let skipped = 0;

  for (const module of MODULES) {
    for (const action of ACTIONS) {
      const code = `${module}.${action}`;
      const res = await prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          module,
          action,
          description: `${action.toUpperCase()} sur ${module}`,
        },
      });
      if (res) {
        created += 1;
      } else {
        skipped += 1;
      }
    }
  }

  console.log(`✅ ${created} permissions upsertées (${skipped} inchangées).`);

  // --- Société par défaut + admin -----------------------------------------
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@parcauto.local';
  const password = resoudreMotDePasse();

  let company = await prisma.company.findFirst({ orderBy: { id: 'asc' } });
  if (!company) {
    company = await prisma.company.create({ data: { name: 'ParcAuto Principal' } });
    console.log(`✅ Société créée : id=${company.id} (${company.name}).`);
  } else {
    console.log(`ℹ️  Société existante : id=${company.id} (${company.name}).`);
  }

  const existingAdmin = await prisma.user.findUnique({ where: { email } });
  if (!existingAdmin) {
    const hash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        email,
        password: hash,
        firstName: 'Admin',
        lastName: 'ParcAuto',
        role: 'ADMIN',
        isActive: true,
        companyId: company.id,
      },
    });
    // Le mot de passe n'est affiché qu'en développement : ailleurs, la sortie
    // du seed finit dans les journaux de la plateforme d'hébergement.
    const dev = (process.env.NODE_ENV || 'development') === 'development';
    console.log(
      dev
        ? `✅ Admin créé : ${email} — mot de passe : ${password}`
        : `✅ Admin créé : ${email} — mot de passe : celui de SEED_ADMIN_PASSWORD.`
    );
  } else {
    if (!existingAdmin.companyId) {
      await prisma.user.update({ where: { email }, data: { companyId: company.id } });
    }
    console.log(`ℹ️  Admin existant : ${email} (mot de passe inchangé).`);
  }
}

// Hors requête HTTP, il n'y a pas de contexte société — et l'extension Prisma
// échoue fermé plutôt que de renvoyer les données de toutes les entreprises.
// Le seed crée précisément la première société : il opère donc hors périmètre,
// explicitement.
runUnscoped(main)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
