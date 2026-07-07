const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find all ProductVariants with the name 'Default'
  const defaultVariants = await prisma.productVariant.findMany({
    where: { name: 'Default' },
    include: { sellerOffers: true },
  });

  console.log(`Found ${defaultVariants.length} 'Default' variants.`);

  for (const variant of defaultVariants) {
    if (variant.sellerOffers.length > 0) {
      console.log(`Updating ${variant.sellerOffers.length} seller offers for variant ${variant.id}`);
      
      // Update all seller offers to point directly to the catalogProduct and clear variantId
      await prisma.sellerOffer.updateMany({
        where: { variantId: variant.id },
        data: {
          catalogProductId: variant.catalogProductId,
          variantId: null,
        },
      });
    }

    // Delete the variant
    await prisma.productVariant.delete({
      where: { id: variant.id },
    });
    console.log(`Deleted 'Default' variant ${variant.id}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
