const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      email: {
        contains: 'yukizi'
      }
    }
  });

  for (const user of users) {
    const newEmail = user.email.replace(/yukizi/i, 'yukizi');
    await prisma.user.update({
      where: { id: user.id },
      data: { email: newEmail }
    });
    console.log(`Updated user ${user.id} email to ${newEmail}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
