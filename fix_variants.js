const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find all SellerOffers that are linked to a catalogProduct via name but have no variantId
  const offers = await prisma.sellerOffer.findMany({
    where: { variantId: null },
  });

  for (const offer of offers) {
    const master = await prisma.catalogProduct.findFirst({
      where: { name: offer.name },
      include: { productVariants: true }
    });

    if (master) {
      let variantId = null;
      if (master.productVariants.length > 0) {
        variantId = master.productVariants[0].id;
      } else {
        const newVariant = await prisma.productVariant.create({
          data: {
            catalogProductId: master.id,
            name: 'Default',
            options: {},
          }
        });
        variantId = newVariant.id;
      }

      await prisma.sellerOffer.update({
        where: { id: offer.id },
        data: { variantId }
      });
      console.log(`Updated offer ${offer.name} with variantId ${variantId}`);
    } else {
      // It might be a seller-specific named variant like "Naruto 1 - Variant"
      // Wait, let's just search by slug matching or try to find a master that it belongs to
      const potentialMasters = await prisma.catalogProduct.findMany();
      for (const m of potentialMasters) {
        if (offer.name.startsWith(m.name)) {
           let variantName = offer.name.replace(m.name, '').replace(' - ', '').trim();
           if (!variantName) variantName = 'Default';
           
           let matchedVariant = await prisma.productVariant.findFirst({
              where: { catalogProductId: m.id, name: variantName }
           });
           
           if (!matchedVariant) {
             matchedVariant = await prisma.productVariant.create({
               data: {
                 catalogProductId: m.id,
                 name: variantName,
                 options: {},
               }
             });
           }
           
           await prisma.sellerOffer.update({
             where: { id: offer.id },
             data: { variantId: matchedVariant.id }
           });
           console.log(`Updated offer ${offer.name} with variantId ${matchedVariant.id}`);
           break;
        }
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
