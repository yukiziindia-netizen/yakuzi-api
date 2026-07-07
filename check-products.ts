import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const p = await prisma.catalogProduct.findUnique({
    where: { id: '79541502-2749-4982-8baf-82d5016da674' },
  });
  console.log('Product Naruto 1:', JSON.stringify(p, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
