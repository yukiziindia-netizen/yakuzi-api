const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function round2(n) { return Math.round(n * 100) / 100; }

function calculatePricing(mrp, gstPercent, discountInput) {
  const basePrice = mrp;
  let discountPercent = 0;
  let buy = discountInput.buy ?? 1;
  let get = discountInput.get ?? 0;
  const type = String(discountInput.type || 'none').toLowerCase();
  
  const isTaxIncluded = discountInput.isTaxIncluded ?? false;
  const shippingCharge = discountInput.shippingCharges ?? 0;
  const shippingGstPercent = discountInput.shippingGstPercent ?? 18;
  let shippingTotal = shippingCharge;
  let shippingGstAmount = 0;
  
  if (isTaxIncluded) {
     shippingGstAmount = round2(shippingCharge - (shippingCharge / (1 + shippingGstPercent / 100)));
     shippingTotal = shippingCharge;
  } else {
     shippingGstAmount = round2(shippingCharge * (shippingGstPercent / 100));
     shippingTotal = round2(shippingCharge + shippingGstAmount);
  }

  const grossProduct = isTaxIncluded ? basePrice : round2(basePrice + (basePrice * gstPercent / 100));
  const grossTotal = round2(grossProduct + shippingTotal);

  let discountAmount = 0;
  switch (type) {
    case 'ptr_discount':
    case 'ptr_discount_and_same_product_bonus':
    case 'ptr_discount_and_different_product_bonus':
      discountPercent = discountInput.discountPercent ?? 0;
      discountAmount = round2(grossTotal * (discountPercent / 100));
      break;
  }

  const discountedGrossProduct = round2(grossProduct - (grossProduct * (discountPercent / 100)));
  const discountedShipping = round2(shippingTotal - (shippingTotal * (discountPercent / 100)));
  const finalCustomerPayable = round2(discountedGrossProduct + discountedShipping);

  return { finalCustomerPayable };
}

async function run() {
  const offers = await prisma.sellerOffer.findMany();
  for (const offer of offers) {
    const resolvedDiscountType = offer.discountType || (offer.discountMeta?.discountPercent ? 'PTR_DISCOUNT' : 'none');
    const result = calculatePricing(Number(offer.mrp || 0), Number(offer.gstPercent || 0), {
      type: resolvedDiscountType === 'PTR_DISCOUNT' ? 'ptr_discount' : String(resolvedDiscountType).toLowerCase(),
      discountPercent: offer.discountMeta?.discountPercent,
      specialPrice: offer.discountMeta?.specialPrice,
      shippingCharges: Number(offer.finalShippingPrice ?? offer.shippingCharges ?? 0),
      shippingGstPercent: 0,
      isTaxIncluded: Boolean(offer.isTaxIncluded),
    });
    
    if (Number(offer.finalCustomerPayable) !== result.finalCustomerPayable) {
      await prisma.sellerOffer.update({
        where: { id: offer.id },
        data: { finalCustomerPayable: result.finalCustomerPayable }
      });
      console.log(`Updated offer ${offer.id}: ${offer.finalCustomerPayable} -> ${result.finalCustomerPayable}`);
    }
  }
  await prisma.$disconnect();
}

run();
