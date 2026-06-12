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
 *   SEED_ADMIN_PASSWORD (défaut: Admin123!)
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { prisma } = require('../src/lib/prisma');

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
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';

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
    console.log(`✅ Admin créé : ${email} — mot de passe : ${password}`);
  } else {
    if (!existingAdmin.companyId) {
      await prisma.user.update({ where: { email }, data: { companyId: company.id } });
    }
    console.log(`ℹ️  Admin existant : ${email} (mot de passe inchangé).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
