import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const totalCatalog = await prisma.catalogProduct.count();
  const activeCatalog = await prisma.catalogProduct.count({ where: { isActive: true } });
  
  const totalOffers = await prisma.sellerOffer.count();
  const activeOffers = await prisma.sellerOffer.count({ where: { isActive: true } });
  const activeApprovedOffers = await prisma.sellerOffer.count({ where: { isActive: true, approvalStatus: 'APPROVED' } });

  console.log(`Total Catalog Products: ${totalCatalog}`);
  console.log(`Active Catalog Products: ${activeCatalog}`);
  
  console.log(`Total Seller Offers: ${totalOffers}`);
  console.log(`Active Seller Offers: ${activeOffers}`);
  console.log(`Active & Approved Seller Offers: ${activeApprovedOffers}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
