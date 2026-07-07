const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function fix() {
  const offers = await prisma.sellerOffer.findMany({ where: { variantId: null, approvalStatus: 'APPROVED' } });
  console.log('Found ' + offers.length + ' offers to fix');
  for (const product of offers) {
    const baseSlug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const uniqueSlug = baseSlug + '-' + Math.random().toString(36).substring(2, 8);
    const catalogProduct = await prisma.catalogProduct.create({
      data: {
        name: product.name,
        slug: uniqueSlug,
        manufacturer: product.manufacturer,
        sku: product.sku,
        serialNo: product.serialNo,
        specifications: product.specifications,
        description: product.description,
        mrp: product.mrp,
        gstPercent: product.gstPercent,
        isTaxIncluded: product.isTaxIncluded,
        shippingCharges: product.shippingCharges,
        finalShippingPrice: product.finalShippingPrice,
        categoryId: product.categoryId,
        subCategoryId: product.subCategoryId,
        productVariants: {
          create: {
            name: 'Default',
            sku: product.sku,
            serialNo: product.serialNo,
            options: {},
          }
        }
      },
      include: { productVariants: true }
    });
    await prisma.sellerOffer.update({
      where: { id: product.id },
      data: { variantId: catalogProduct.productVariants[0].id }
    });
    console.log('Fixed ' + product.name);
  }
}
fix().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
