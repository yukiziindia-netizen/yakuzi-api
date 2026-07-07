import { PrismaClient } from '@prisma/client'; 
const prisma = new PrismaClient(); 
async function run() { 
  const res = await prisma.catalogProduct.deleteMany(); 
  console.log("Deleted " + res.count + " products."); 
} 
run();
