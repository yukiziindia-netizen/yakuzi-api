import { PrismaClient, OrderStatus, PaymentStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.order.count({
    where: {
      orderStatus: OrderStatus.DELIVERED,
      paymentStatus: PaymentStatus.SUCCESS,
    },
  });
  console.log('Orders (DELIVERED & SUCCESS):', count);

  const settlementCount = await prisma.sellerSettlement.count();
  console.log('Total Settlements:', settlementCount);

  const pendingSettlements = await prisma.sellerSettlement.findMany({
    take: 5,
    include: {
      orderItem: {
        include: {
          order: true
        }
      }
    }
  });
  console.log('Sample Settlements:', JSON.stringify(pendingSettlements, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
