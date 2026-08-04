const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Starting full cleanup of products and orders data...");

  // 1. Delete order-related data
  const delSettlements = await prisma.sellerSettlement.deleteMany({});
  console.log(`Deleted ${delSettlements.count} seller settlements.`);

  const delOrderItems = await prisma.orderItem.deleteMany({});
  console.log(`Deleted ${delOrderItems.count} order items.`);

  const delOrderAddresses = await prisma.orderAddress.deleteMany({});
  console.log(`Deleted ${delOrderAddresses.count} order addresses.`);

  const delPayments = await prisma.payment.deleteMany({});
  console.log(`Deleted ${delPayments.count} payments.`);

  const delOrders = await prisma.order.deleteMany({});
  console.log(`Deleted ${delOrders.count} orders.`);

  // 2. Delete product-related data
  const delReviews = await prisma.review.deleteMany({});
  console.log(`Deleted ${delReviews.count} reviews.`);

  const delCartItems = await prisma.cartItem.deleteMany({});
  console.log(`Deleted ${delCartItems.count} cart items.`);

  const delInventoryAlerts = await prisma.inventoryAlert.deleteMany({});
  console.log(`Deleted ${delInventoryAlerts.count} inventory alerts.`);

  const delProductBatches = await prisma.productBatch.deleteMany({});
  console.log(`Deleted ${delProductBatches.count} product batches.`);

  const delWaitlist = await prisma.productWaitlist.deleteMany({});
  console.log(`Deleted ${delWaitlist.count} waitlist items.`);

  const delSellerOffers = await prisma.sellerOffer.deleteMany({});
  console.log(`Deleted ${delSellerOffers.count} seller offers.`);

  const delProductVariants = await prisma.productVariant.deleteMany({});
  console.log(`Deleted ${delProductVariants.count} product variants.`);

  const delCatalogProductImages = await prisma.catalogProductImage.deleteMany({});
  console.log(`Deleted ${delCatalogProductImages.count} catalog product images.`);

  const delCatalogProductVideos = await prisma.catalogProductVideo.deleteMany({});
  console.log(`Deleted ${delCatalogProductVideos.count} catalog product videos.`);

  const delCatalogProducts = await prisma.catalogProduct.deleteMany({});
  console.log(`Deleted ${delCatalogProducts.count} catalog products.`);

  const delProductSearchIndex = await prisma.productSearchIndex.deleteMany({});
  console.log(`Deleted ${delProductSearchIndex.count} product search indexes.`);

  const delProductAnalytics = await prisma.productAnalytics.deleteMany({});
  console.log(`Deleted ${delProductAnalytics.count} product analytics.`);

  console.log("Cleanup completed successfully!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
