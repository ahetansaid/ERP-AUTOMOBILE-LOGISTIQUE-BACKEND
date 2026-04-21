/**
 * Seed — catalogue des permissions fines (table `permissions`).
 *
 * Usage :
 *   node prisma/seed.js
 *
 * Idempotent : peut être rejoué, ne duplique pas (upsert sur `code`).
 */

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
