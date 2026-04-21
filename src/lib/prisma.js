const { PrismaClient } = require('@prisma/client');

const logLevels =
  process.env.NODE_ENV === 'development'
    ? ['query', 'warn', 'error']
    : ['warn', 'error'];

const globalForPrisma = globalThis;
const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: logLevels,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

async function disconnect() {
  await prisma.$disconnect();
}

module.exports = { prisma, disconnect };
