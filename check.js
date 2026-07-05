const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const offers = await prisma.sellerOffer.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      mrp: true,
      gstPercent: true,
      discountType: true,
      discountMeta: true,
      shippingCharges: true,
    }
  });
  console.log(JSON.stringify(offers, null, 2));
  process.exit(0);
}
check();
