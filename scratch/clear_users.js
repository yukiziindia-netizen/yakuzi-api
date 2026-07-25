const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const superAdminPhone = '9831864222';
  console.log(`Clearing all users except Super Admin (${superAdminPhone})...`);

  // Find all users except superAdminPhone
  const usersToDelete = await prisma.user.findMany({
    where: {
      phone: { not: superAdminPhone },
    },
    select: { id: true, phone: true, role: true },
  });

  console.log(`Found ${usersToDelete.length} users to delete.`);

  const userIds = usersToDelete.map((u) => u.id);

  if (userIds.length > 0) {
    // Delete dependent entities cleanly
    await prisma.$transaction([
      prisma.cartItem.deleteMany({ where: { cart: { userId: { in: userIds } } } }),
      prisma.cart.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.message.deleteMany({ where: { senderId: { in: userIds } } }),
      prisma.ticket.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.notificationBroadcast.deleteMany({ where: { adminId: { in: userIds } } }),
      prisma.productWaitlist.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.productRequest.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.review.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.customOrder.deleteMany({ where: { buyer: { userId: { in: userIds } } } }),
      prisma.sellerSettlement.deleteMany({ where: { seller: { userId: { in: userIds } } } }),
      prisma.orderItem.deleteMany({ where: { seller: { userId: { in: userIds } } } }),
      prisma.orderItem.deleteMany({ where: { order: { buyerId: { in: userIds } } } }),
      prisma.payment.deleteMany({ where: { order: { buyerId: { in: userIds } } } }),
      prisma.orderAddress.deleteMany({ where: { order: { buyerId: { in: userIds } } } }),
      prisma.order.deleteMany({ where: { buyerId: { in: userIds } } }),
      prisma.sellerOffer.deleteMany({ where: { seller: { userId: { in: userIds } } } }),
      prisma.buyerProfile.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.sellerProfile.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.adminProfile.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ], {
      timeout: 60000,
    });
  }

  // Double check Super Admin exists
  let superAdmin = await prisma.user.findFirst({
    where: { phone: superAdminPhone },
    include: { adminProfile: true },
  });

  if (!superAdmin) {
    console.log('Re-creating Super Admin 9831864222...');
    superAdmin = await prisma.user.create({
      data: {
        phone: superAdminPhone,
        role: 'ADMIN',
        status: 'APPROVED',
        adminProfile: {
          create: {
            displayName: 'Super Admin',
            permissions: 'ALL',
          },
        },
      },
      include: { adminProfile: true },
    });
  } else if (!superAdmin.adminProfile) {
    await prisma.adminProfile.create({
      data: {
        userId: superAdmin.id,
        displayName: 'Super Admin',
        permissions: 'ALL',
      },
    });
  }

  const remainingUsers = await prisma.user.findMany({
    select: { id: true, phone: true, role: true, status: true },
  });

  console.log('=== REMAINING USERS IN DATABASE ===');
  console.log(JSON.stringify(remainingUsers, null, 2));
}

main()
  .catch((err) => {
    console.error('Error clearing users:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
