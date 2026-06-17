import { PrismaClient, SellerOffer, Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { categories } from './seed-data/categories';

const prisma = new PrismaClient();

const SALT_ROUNDS = 10;

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 1. SEED CATEGORIES & SUB-CATEGORIES
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function seedCategories() {
  console.log('ðŸ“ Seeding categories & sub-categories...');

  for (const cat of categories) {
    const created = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: {
        name: cat.name,
        slug: cat.slug,
        subCategories: {
          createMany: {
            data: cat.subCategories,
            skipDuplicates: true,
          },
        },
      },
    });
    console.log(`   âœ… ${created.name}`);
  }

  const categoryCount = await prisma.category.count();
  const subCategoryCount = await prisma.subCategory.count();
  console.log(`   â†’ ${categoryCount} categories, ${subCategoryCount} sub-categories\n`);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 2. SEED ADMIN USER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function seedAdmin() {
  console.log('ðŸ‘¤ Seeding admin user...');

  const adminPassword = await hashPassword('Admin@123');

  const admin = await prisma.user.upsert({
    where: { phone: '9999999999' },
    update: {},
    create: {
      phone: '9999999999',
      email: 'admin@yukizi.com',
      password: adminPassword,
      role: Role.ADMIN,
      status: UserStatus.APPROVED,
      adminProfile: {
        create: {
          displayName: 'Super Admin',
          department: 'Platform Operations',
        },
      },
    },
  });
  console.log(`   âœ… Admin: ${admin.phone} (${admin.id})\n`);

  return admin;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 3. SEED DEMO SELLER + PRODUCTS + BATCH
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function seedDemoSeller() {
  console.log('ðŸª Seeding demo seller...');

  const sellerPassword = await hashPassword('Seller@123');

  const sellerUser = await prisma.user.upsert({
    where: { phone: '8888888888' },
    update: {},
    create: {
      phone: '8888888888',
      email: 'seller@yukizi.com',
      password: sellerPassword,
      role: Role.SELLER,
      status: UserStatus.APPROVED,
      sellerProfile: {
        create: {
          companyName: 'Yukizi Distributor',
          gstNumber: '07AAACA1234A1Z5',
          panNumber: 'ABCDE1234F',
          drugLicenseNumber: 'DL-2026-001234',
          drugLicenseUrl: 'https://placeholder.yukizi.com/license/demo.pdf',
          address: '42, Netaji Subhash Marg, Daryaganj',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110002',
          verificationStatus: 'VERIFIED',
          rating: 4.5,
        },
      },
    },
    include: { sellerProfile: true },
  });
  console.log(`   âœ… Seller: ${sellerUser.phone} â€” ${sellerUser.sellerProfile?.companyName}`);

  const sellerId = sellerUser.sellerProfile!.id;

  // Fetch category/subcategory IDs for products
  const pharmaCategory = await prisma.category.findUnique({
    where: { slug: 'pharmaceuticals' },
  });
  const antibioticsSub = await prisma.subCategory.findFirst({
    where: { slug: 'antibiotics', categoryId: pharmaCategory!.id },
  });
  const painReliefSub = await prisma.subCategory.findFirst({
    where: { slug: 'pain-relief', categoryId: pharmaCategory!.id },
  });
  const vitaminsSub = await prisma.subCategory.findFirst({
    where: { slug: 'vitamins-supplements', categoryId: pharmaCategory!.id },
  });

  if (!pharmaCategory || !antibioticsSub || !painReliefSub || !vitaminsSub) {
    console.log('   âš ï¸  Skipping products â€” categories not found. Run categories seed first.');
    return;
  }

  // â”€â”€ Demo Products â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  console.log('ðŸ’Š Seeding demo products...');

  const demoProducts = [
    {
      name: 'Amoxicillin 500mg',
      manufacturer: 'Cipla Ltd.',

      description: 'Broad-spectrum antibiotic used for bacterial infections. Strip of 10 capsules.',
      mrp: 85.0,
      gstPercent: 12.0,
      minimumOrderQuantity: 10,
      maximumOrderQuantity: 5000,
      categoryId: pharmaCategory.id,
      subCategoryId: antibioticsSub.id,
      sellerId,
    },
    {
      name: 'Paracetamol 650mg',
      manufacturer: 'Sun Pharmaceutical',

      description: 'Antipyretic and analgesic for fever and mild to moderate pain. Strip of 15 tablets.',
      mrp: 30.0,
      gstPercent: 12.0,
      minimumOrderQuantity: 20,
      maximumOrderQuantity: 10000,
      categoryId: pharmaCategory.id,
      subCategoryId: painReliefSub.id,
      sellerId,
    },
    {
      name: 'Becosules Capsules',
      manufacturer: 'Pfizer Ltd.',

      description: 'Multivitamin supplement for daily nutritional support. Strip of 20 capsules.',
      mrp: 42.0,
      gstPercent: 5.0,
      minimumOrderQuantity: 10,
      maximumOrderQuantity: 8000,
      categoryId: pharmaCategory.id,
      subCategoryId: vitaminsSub.id,
      sellerId,
    },
  ];

  const createdProducts: SellerOffer[] = [];

  for (const prod of demoProducts) {
    // Use findFirst + create to avoid upsert without a unique constraint on name
    const existing = await prisma.sellerOffer.findFirst({
      where: { name: prod.name, sellerId: prod.sellerId, deletedAt: null },
    });

    if (existing) {
      console.log(`   â†©ï¸  ${prod.name} (already exists)`);
      createdProducts.push(existing);
    } else {
      const created = await prisma.sellerOffer.create({ data: prod });
      console.log(`   âœ… ${created.name} â€” â‚¹${created.mrp}`);
      createdProducts.push(created);
    }
  }

  // â”€â”€ SellerOffer Batches â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  console.log('ðŸ“¦ Seeding product batches...');

  const sixMonthsLater = new Date();
  sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);

  const oneYearLater = new Date();
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

  const twoYearsLater = new Date();
  twoYearsLater.setFullYear(twoYearsLater.getFullYear() + 2);

  const batches = [
    {
      sellerOfferId: createdProducts[0].id,
      batchNumber: 'BATCH-AMX-2026-A',
      expiryDate: oneYearLater,
      stock: 5000,
    },
    {
      sellerOfferId: createdProducts[0].id,
      batchNumber: 'BATCH-AMX-2026-B',
      expiryDate: twoYearsLater,
      stock: 3000,
    },
    {
      sellerOfferId: createdProducts[1].id,
      batchNumber: 'BATCH-PCM-2026-A',
      expiryDate: twoYearsLater,
      stock: 10000,
    },
    {
      sellerOfferId: createdProducts[2].id,
      batchNumber: 'BATCH-BCS-2026-A',
      expiryDate: sixMonthsLater,
      stock: 2000,
    },
  ];

  for (const batch of batches) {
    const existing = await prisma.productBatch.findFirst({
      where: { batchNumber: batch.batchNumber, sellerOfferId: batch.sellerOfferId },
    });

    if (existing) {
      console.log(`   â†©ï¸  ${batch.batchNumber} (already exists)`);
    } else {
      await prisma.productBatch.create({ data: batch });
      console.log(`   âœ… ${batch.batchNumber} â€” stock: ${batch.stock}`);
    }
  }

  console.log('');
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 4. SEED DEMO BUYER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function seedDemoBuyer() {
  console.log('ðŸ›ï¸  Seeding demo buyer...');

  const buyerPassword = await hashPassword('Buyer@123');

  const buyerUser = await prisma.user.upsert({
    where: { phone: '7777777777' },
    update: {},
    create: {
      phone: '7777777777',
      email: 'buyer@yukizi.com',
      password: buyerPassword,
      role: Role.BUYER,
      status: UserStatus.APPROVED,
      buyerProfile: {
        create: {
          legalName: 'Yukizi Pharmacy Store',
          gstNumber: '07AAAAA0000A1Z5',
          panNumber: 'AAAAA0000A',
          drugLicenseNumber: 'DL-2026-BUYER',
          drugLicenseUrl: 'https://placeholder.yukizi.com/license/buyer-demo.pdf',
          address: 'Shop No. 5, Medical Market, Chembur',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400071',
        },
      },
    },
    include: { buyerProfile: true },
  });
  console.log(`   âœ… Buyer: ${buyerUser.phone} â€” ${buyerUser.buyerProfile?.legalName}\n`);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MAIN
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main() {
  console.log('ðŸŒ± Seeding yukizi database...\n');

  await seedCategories();
  await seedAdmin();
  await seedDemoSeller();
  await seedDemoBuyer();

  console.log('â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
  console.log('ðŸ“¦ Seed complete!');

  const counts = {
    categories: await prisma.category.count(),
    subCategories: await prisma.subCategory.count(),
    users: await prisma.user.count(),
    products: await prisma.sellerOffer.count(),
    batches: await prisma.productBatch.count(),
  };

  console.log(`   Categories:      ${counts.categories}`);
  console.log(`   Sub-categories:  ${counts.subCategories}`);
  console.log(`   Users:           ${counts.users}`);
  console.log(`   Products:        ${counts.products}`);
  console.log(`   SellerOffer Batches: ${counts.batches}`);
  console.log('â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n');
}

main()
  .catch((e) => {
    console.error('âŒ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
