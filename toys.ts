import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing old products and categories...');
  await prisma.marketingProduct.deleteMany();
  await prisma.productBatch.deleteMany();
  await prisma.sellerOffer.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.catalogProduct.deleteMany();
  await prisma.subCategory.deleteMany();
  await prisma.category.deleteMany();
  
  console.log('Creating new Toy categories...');
  const cat = await prisma.category.create({
    data: {
      name: 'Toys & Collectibles',
      slug: 'toys-and-collectibles',
      subCategories: {
        createMany: {
          data: [
            { name: 'Action Figures', slug: 'action-figures' },
            { name: 'Stickers', slug: 'stickers' },
            { name: 'Trading Cards', slug: 'trading-cards' }
          ]
        }
      }
    },
    include: { subCategories: true }
  });

  // Get a seller to own these products
  let seller = await prisma.sellerProfile.findFirst();
  if (!seller) {
    console.log('No seller found, cannot create products.');
    return;
  }

  const toys = [
    {
      name: 'Goku Super Saiyan Action Figure',
      manufacturer: 'Bandai Namco',
      desc: 'High quality 6-inch Goku action figure with interchangeable hands and face plates.',
      price: 1500,
      sub: 'action-figures'
    },
    {
      name: 'Naruto Chibi Sticker Pack',
      manufacturer: 'Anime Merch Co.',
      desc: 'Pack of 50 waterproof vinyl stickers featuring Naruto characters in chibi style.',
      price: 250,
      sub: 'stickers'
    },
    {
      name: 'Pokemon TCG Booster Box',
      manufacturer: 'Nintendo',
      desc: 'Contains 36 booster packs. Gotta catch em all!',
      price: 4500,
      sub: 'trading-cards'
    }
  ];

  console.log('Creating Toy products...');
  for (const t of toys) {
    const subCat = cat.subCategories.find(s => s.slug === t.sub);
    const slug = t.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
    
    // Create Catalog Product
    const cp = await prisma.catalogProduct.create({
      data: {
        name: t.name,
        slug,
        manufacturer: t.manufacturer,

        description: t.desc,
        mrp: t.price,
        gstPercent: 18,
        categoryId: cat.id,
        subCategoryId: subCat!.id,
        isActive: true
      }
    });

    // Create Product Variant
    const pv = await prisma.productVariant.create({
      data: {
        catalogProductId: cp.id,
        name: t.name,
        sku: 'SKU-' + cp.id.substring(0, 8),
        options: []
      }
    });

    // Create Seller Offer
    const offer = await prisma.sellerOffer.create({
      data: {
        sellerId: seller.id,
        variantId: pv.id,
        name: t.name,
        manufacturer: t.manufacturer,

        description: t.desc,
        mrp: t.price,
        gstPercent: 18,
        categoryId: cat.id,
        subCategoryId: subCat!.id,
        isActive: true
      }
    });

    // Create Batch for stock
    await prisma.productBatch.create({
      data: {
        sellerOfferId: offer.id,
        batchNumber: 'DEFAULT',
        stock: 100,
        expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 5))
      }
    });

    // Add to Homepage Carousel
    await prisma.marketingProduct.create({
      data: {
        catalogProductId: cp.id,
        slot: 'HOMEPAGE_CAROUSEL',
        active: true,
        priority: 10
      }
    });
    console.log(`✅ Added ${t.name} to homepage carousel!`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
