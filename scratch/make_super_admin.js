const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const phone = '9831864222';
  console.log(`Checking user with phone ${phone}...`);

  let user = await prisma.user.findFirst({
    where: { phone },
    include: { adminProfile: true },
  });

  if (!user) {
    console.log(`User ${phone} not found. Creating new ADMIN user...`);
    user = await prisma.user.create({
      data: {
        phone,
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
    console.log('Created new Admin user:', user);
  } else {
    console.log(`Found existing user (Role: ${user.role}, Status: ${user.status}). Updating to ADMIN role & APPROVED status...`);
    
    // Update user role to ADMIN and status to APPROVED
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        role: 'ADMIN',
        status: 'APPROVED',
      },
      include: { adminProfile: true },
    });

    // Ensure AdminProfile exists
    if (!user.adminProfile) {
      console.log('Creating AdminProfile for existing user...');
      const adminProfile = await prisma.adminProfile.create({
        data: {
          userId: user.id,
          displayName: 'Super Admin',
          permissions: 'ALL',
        },
      });
      console.log('Created AdminProfile:', adminProfile);
    } else {
      console.log('Updating existing AdminProfile permissions...');
      const adminProfile = await prisma.adminProfile.update({
        where: { id: user.adminProfile.id },
        data: {
          permissions: 'ALL',
          displayName: user.adminProfile.displayName || 'Super Admin',
        },
      });
      console.log('Updated AdminProfile:', adminProfile);
    }
  }

  const finalUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { adminProfile: true },
  });

  console.log('=== SUCCESS ===');
  console.log('Super Admin User Details:');
  console.log(JSON.stringify(finalUser, null, 2));
}

main()
  .catch((err) => {
    console.error('Error setting super admin:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
