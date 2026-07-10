const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const offers = await prisma.sellerOffer.findMany({
    where: { name: { contains: 'Bleach' } }
  });
  console.log(offers.map(o => ({
    id: o.id,
    name: o.name,
    mrp: Number(o.mrp),
    finalCustomerPayable: Number(o.finalCustomerPayable),
    shippingCharges: Number(o.shippingCharges),
    finalShippingPrice: Number(o.finalShippingPrice),
    discountType: o.discountType,
    discountMeta: o.discountMeta,
    gstPercent: Number(o.gstPercent),
    isTaxIncluded: o.isTaxIncluded
  })));
  await prisma.$disconnect();
}
run();
