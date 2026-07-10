import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Starting to clear order data...");
  
  try {
    const deletedSettlements = await prisma.sellerSettlement.deleteMany({});
    console.log(`Deleted ${deletedSettlements.count} seller settlements.`);
    
    const deletedPayments = await prisma.payment.deleteMany({});
    console.log(`Deleted ${deletedPayments.count} payments.`);
    
    const deletedItems = await prisma.orderItem.deleteMany({});
    console.log(`Deleted ${deletedItems.count} order items.`);
    
    const deletedAddresses = await prisma.orderAddress.deleteMany({});
    console.log(`Deleted ${deletedAddresses.count} order addresses.`);
    
    const deletedOrders = await prisma.order.deleteMany({});
    console.log(`Deleted ${deletedOrders.count} orders.`);
    
    console.log("Successfully cleared all order data.");
  } catch (error) {
    console.error("Error clearing orders:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
