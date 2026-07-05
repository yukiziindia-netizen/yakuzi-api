const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const andConditions = [];
      const where = {
        deletedAt: null,
        AND: andConditions.length > 0 ? andConditions : undefined,
      };

      const [total, items] = await Promise.all([
        prisma.catalogProduct.count({ where }),
        prisma.catalogProduct.findMany({
          where,
          include: {
            category: true,
            subCategory: true,
            images: true,
            productVariants: {
              include: {
                sellerOffers: {
                  where: { deletedAt: null },
                  include: {
                    seller: {
                      select: {
                        id: true,
                        companyName: true,
                        rating: true,
                        city: true,
                        state: true,
                      },
                    },
                    batches: { orderBy: { expiryDate: 'asc' } },
                  },
                  orderBy: { mrp: 'asc' },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 10,
        }),
      ]);
      console.log('Success', items.length);
  } catch (e) {
      console.log('Error', e.message);
  }
}
check();
