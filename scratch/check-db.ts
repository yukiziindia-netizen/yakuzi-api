import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const latestMaster = await prisma.catalogProduct.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  console.log('Latest MasterProduct:', latestMaster?.name, latestMaster?.createdAt);

  const latestProduct = await prisma.sellerOffer.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  console.log('Latest Product listing:', latestProduct?.name, latestProduct?.createdAt);
}

main().catch(console.error).finally(() => prisma.$disconnect());
