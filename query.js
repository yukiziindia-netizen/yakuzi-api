const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const offer = await prisma.sellerOffer.findUnique({
    where: { id: '88105286-e917-4f5c-b0ef-138a86990b1b' },
    include: { searchIndex: true, analytics: true }
  });
  console.log('SellerOffer:', offer);
}

main().catch(console.error).finally(() => prisma.$disconnect());
