import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sellerOffers = await prisma.sellerOffer.findMany({
    take: 3
  });
  console.log('Seller Offers:', sellerOffers.map(p => p.name));

  if (sellerOffers.length > 0) {
    for (const offer of sellerOffers) {
      // Check if catalog product already exists for this slug
      const slug = offer.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
      let cp = await prisma.catalogProduct.findFirst({ where: { slug } });
      
      if (!cp) {
        // Create catalog product for this offer
        cp = await prisma.catalogProduct.create({
          data: {
            name: offer.name,
            slug,
            manufacturer: offer.manufacturer,
            chemicalComposition: offer.chemicalComposition || 'Unknown',
            mrp: offer.mrp,
            categoryId: offer.categoryId,
            subCategoryId: offer.subCategoryId,
            isActive: true
          }
        });
        
        // Link offer to variant
        const pv = await prisma.productVariant.create({
          data: {
            catalogProductId: cp.id,
            name: offer.name,
            sku: 'SKU-' + cp.id.substring(0, 8),
            options: [],
          }
        });
        await prisma.sellerOffer.update({
          where: { id: offer.id },
          data: { variantId: pv.id }
        });
      }

      // Check if it's already in marketing products
      const existingMarketing = await prisma.marketingProduct.findFirst({
        where: { catalogProductId: cp.id, slot: 'HOMEPAGE_CAROUSEL' }
      });
      
      if (!existingMarketing) {
        await prisma.marketingProduct.create({
          data: {
            catalogProductId: cp.id,
            slot: 'HOMEPAGE_CAROUSEL',
            active: true,
            priority: 10
          }
        });
        console.log('Added ' + cp.name + ' to homepage carousel.');
      } else {
        console.log(cp.name + ' already in homepage carousel.');
      }
    }
    console.log('Done!');
  } else {
    console.log('No products found in DB!');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
