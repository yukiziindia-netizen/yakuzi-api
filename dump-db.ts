import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const offers = await prisma.sellerOffer.findMany({
    select: {
      id: true,
      name: true,
      mrp: true,
      discountType: true,
      discountMeta: true,
    }
  });
  console.log('--- Seller Offers ---');
  console.log(JSON.stringify(offers, null, 2));

  const catalog = await prisma.catalogProduct.findMany({
    select: {
      id: true,
      name: true,
      mrp: true,
    }
  });
  console.log('--- Catalog Products ---');
  console.log(JSON.stringify(catalog, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
