import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        deletedAt: null,
      },
      include: {
        category: true,
        subCategory: true,
        batches: { where: { stock: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
        seller: { select: { companyName: true, city: true, state: true, rating: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    console.log("Success! Found", products.length, "products.");
  } catch (error) {
    console.error("Error executing query:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
