const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
  const softDeleted = await prisma.catalogProduct.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true, name: true, productVariants: { select: { id: true } } }
  });

  console.log('Found ' + softDeleted.length + ' soft-deleted products.');
  let deletedCount = 0;
  let failedCount = 0;

  for (const p of softDeleted) {
    try {
      if (p.productVariants.length > 0) {
        await prisma.sellerOffer.deleteMany({
          where: { variantId: { in: p.productVariants.map(v => v.id) } }
        });
      }
      await prisma.catalogProduct.delete({
        where: { id: p.id }
      });
      console.log('Deleted ' + p.name);
      deletedCount++;
    } catch (err) {
      if (err.code === 'P2003') {
        console.log('Skipped ' + p.name + ' (has active orders/constraints)');
        failedCount++;
      } else {
        console.error('Error on ' + p.name + ':', err);
      }
    }
  }
  console.log('Done. Deleted: ' + deletedCount + ', Skipped: ' + failedCount);
}

cleanup().catch(console.error).finally(() => prisma.$disconnect());
