const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      email: {
        contains: 'demopharma'
      }
    }
  });

  for (const user of users) {
    const newEmail = user.email.replace(/demopharma/i, 'yukizi');
    await prisma.user.update({
      where: { id: user.id },
      data: { email: newEmail }
    });
    console.log(`Updated user ${user.id} email to ${newEmail}`);
  }

  const sellerProfiles = await prisma.sellerProfile.findMany({
    where: {
      companyName: { contains: 'Demo Pharma Distributor' }
    }
  });

  for (const p of sellerProfiles) {
    await prisma.sellerProfile.update({
      where: { id: p.id },
      data: { companyName: p.companyName.replace(/Demo Pharma Distributor/i, 'Yukizi Distributor') }
    });
    console.log(`Updated seller profile ${p.id} companyName to Yukizi Distributor`);
  }

  const buyerProfiles = await prisma.buyerProfile.findMany({
    where: {
      legalName: { contains: 'Demo Pharmacy Store' }
    }
  });

  for (const p of buyerProfiles) {
    await prisma.buyerProfile.update({
      where: { id: p.id },
      data: { legalName: p.legalName.replace(/Demo Pharmacy Store/i, 'Yukizi Pharmacy Store') }
    });
    console.log(`Updated buyer profile ${p.id} legalName to Yukizi Pharmacy Store`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
