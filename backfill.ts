import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function calculateFinalCustomerPayable(
  mrp: number,
  finalShipping: number,
  discountType: string | null,
  discountMeta: any,
): number {
  const grossTotal = mrp + finalShipping;
  let discountPercent = 0;

  const type = discountType || (discountMeta?.discountPercent ? 'PTR_DISCOUNT' : 'none');

  if (
    type === 'PTR_DISCOUNT' ||
    type === 'PTR_PLUS_SAME_PRODUCT_BONUS' ||
    type === 'PTR_PLUS_DIFFERENT_PRODUCT_BONUS'
  ) {
    discountPercent = discountMeta?.discountPercent ?? 0;
  } else if (type === 'SPECIAL_PRICE') {
    const specialPrice = discountMeta?.specialPrice ?? mrp;
    return specialPrice + finalShipping;
  }

  const discountAmount = Math.round((grossTotal * discountPercent) / 100);
  return grossTotal - discountAmount;
}

async function run() {
  const offers = await prisma.sellerOffer.findMany();
  console.log(`Found ${offers.length} offers to update`);
  let updated = 0;
  for (const offer of offers) {
    const finalCustomerPayable = calculateFinalCustomerPayable(
      Number(offer.mrp),
      Number(offer.finalShippingPrice ?? offer.shippingCharges ?? 0),
      offer.discountType,
      offer.discountMeta
    );
    await prisma.sellerOffer.update({
      where: { id: offer.id },
      data: { finalCustomerPayable }
    });
    updated++;
  }
  console.log(`Backfill complete! Updated ${updated} offers.`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
