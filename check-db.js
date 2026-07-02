const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.catalogProduct.findMany({
  orderBy: { updatedAt: 'desc' },
  take: 1,
  select: { name: true, sku: true, specifications: true }
}).then(console.log).catch(console.error).finally(() => prisma.$disconnect());
