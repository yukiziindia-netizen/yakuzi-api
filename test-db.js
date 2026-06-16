const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
// We can't easily instantiate OrdersService without Nest.js DI. Let's just run the exact query it uses.
async function main() {
  const userId = '708de6d8-2e40-42f5-8225-c422eeb328d4'; // from previous script output
  const orderId = '815c99d7-2f2b-4a6d-83ad-3aad1145a4f6';
  
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          sellerOffer: {
            select: {
              id: true,
              name: true,
              manufacturer: true,
              mrp: true,
              gstPercent: true,
              variant: {
                select: {
                  catalogProduct: {
                    select: {
                      images: {
                        select: { url: true }
                      }
                    }
                  }
                }
              }
            },
          },
          seller: {
            select: {
              id: true,
              companyName: true,
              city: true,
              state: true,
              rating: true,
            },
          },
        },
      },
    },
  });
  console.dir(order, { depth: null });
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
