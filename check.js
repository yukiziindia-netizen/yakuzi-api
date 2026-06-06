const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 
async function main() { 
  const products = await prisma.catalogProduct.findMany({ 
    include: { productVariants: true }, 
    take: 5, 
    orderBy: { updatedAt: 'desc' } 
  }); 
  console.log(JSON.stringify(products, null, 2)); 
} 
main().catch(console.error).finally(() => prisma.$disconnect());
