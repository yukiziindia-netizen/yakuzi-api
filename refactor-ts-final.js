const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, searchRegex, replacement) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  let newContent = content.replace(searchRegex, replacement);
  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent);
  }
}

const srcPath = path.join(__dirname, 'src');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

// 1. Safe global replacements for Prisma calls and basic types
walkDir(srcPath, (file) => {
  if (!file.endsWith('.ts')) return;
  
  let content = fs.readFileSync(file, 'utf8');
  
  content = content.replace(/prisma\.product\b/g, 'prisma.sellerOffer');
  content = content.replace(/prisma\.masterProduct\b/g, 'prisma.catalogProduct');
  content = content.replace(/prisma\.masterProductImage\b/g, 'prisma.catalogProductImage');
  
  content = content.replace(/\bProductWhereInput\b/g, 'SellerOfferWhereInput');
  content = content.replace(/\bMasterProductWhereInput\b/g, 'CatalogProductWhereInput');
  content = content.replace(/\bProductSelect\b/g, 'SellerOfferSelect');
  content = content.replace(/\bMasterProductSelect\b/g, 'CatalogProductSelect');
  content = content.replace(/\bProductInclude\b/g, 'SellerOfferInclude');
  content = content.replace(/\bMasterProductInclude\b/g, 'CatalogProductInclude');
  
  // Replace references to productId in analytics, search, custom-orders, reviews
  // Wait, I will do this targeted.
  
  fs.writeFileSync(file, content);
});

// Seed file
replaceInFile(path.join(__dirname, 'prisma/seed.ts'), /prisma\.product\b/g, 'prisma.sellerOffer');
replaceInFile(path.join(__dirname, 'prisma/seed.ts'), /prisma\.masterProduct\b/g, 'prisma.catalogProduct');
replaceInFile(path.join(__dirname, 'prisma/seed.ts'), /productId:/g, 'sellerOfferId:');
replaceInFile(path.join(__dirname, 'prisma/seed.ts'), /product: \{/g, 'sellerOffer: {');

// Targeted replacements for relation changes
const adminPath = path.join(srcPath, 'modules/admin/admin.service.ts');
replaceInFile(adminPath, /product: true/g, 'sellerOffer: true');
replaceInFile(adminPath, /product:/g, 'sellerOffer:');
// Revert the MarketingProduct `product` which became `sellerOffer` above
replaceInFile(adminPath, /sellerOffer: {\n\s*select: {\n\s*id: true,\n\s*catalogProductId: true,\n\s*}/g, 'catalogProduct: {\n          select: {\n            id: true,\n            name: true,\n          }\n        }');
// Admin masterProduct select -> variant { catalogProduct }
replaceInFile(adminPath, /masterProduct:\s*true/g, 'variant: { include: { catalogProduct: true } }');
replaceInFile(adminPath, /masterProduct: {\n\s*select: { id: true, name: true, slug: true },\n\s*}/g, 'variant: { select: { catalogProduct: { select: { id: true, name: true, slug: true } } } }');
// remove images from SellerOffer queries
replaceInFile(adminPath, /images: { select: { id: true, url: true } },/g, '');
replaceInFile(adminPath, /images:\s*true,?/g, '');
replaceInFile(adminPath, /productId\s*:/g, 'catalogProductId:'); // Marketing product
replaceInFile(adminPath, /products: true/g, 'variants: { include: { sellerOffers: true } }'); // CatalogProductInclude

const cartPath = path.join(srcPath, 'modules/cart/cart.service.ts');
replaceInFile(cartPath, /product:/g, 'sellerOffer:');
replaceInFile(cartPath, /cartId_productId/g, 'cartId_sellerOfferId');
replaceInFile(cartPath, /images: { select: { id: true, url: true }, take: 1 },/g, '');
replaceInFile(cartPath, /item\.product/g, 'item.sellerOffer');
replaceInFile(cartPath, /const product = /g, 'const sellerOffer = ');
replaceInFile(cartPath, /if \(\!product\)/g, 'if (!sellerOffer)');

const ordersPath = path.join(srcPath, 'modules/orders/orders.service.ts');
replaceInFile(ordersPath, /product:/g, 'sellerOffer:');
replaceInFile(ordersPath, /item\.product/g, 'item.sellerOffer');

const analyticsPath = path.join(srcPath, 'modules/products/services/analytics.service.ts');
replaceInFile(analyticsPath, /productId:/g, 'catalogProductId:');

const searchIndexPath = path.join(srcPath, 'modules/products/services/search-index.service.ts');
replaceInFile(searchIndexPath, /productId:/g, 'catalogProductId:');

const reviewsPath = path.join(srcPath, 'modules/reviews/reviews.service.ts');
replaceInFile(reviewsPath, /productId:/g, 'catalogProductId:');
replaceInFile(reviewsPath, /userId_productId/g, 'userId_catalogProductId');

const customOrdersPath = path.join(srcPath, 'modules/custom-orders/custom-orders.service.ts');
replaceInFile(customOrdersPath, /productId:/g, 'catalogProductId:');
replaceInFile(customOrdersPath, /select: { catalogProductId: true },/g, 'select: { variant: { select: { catalogProductId: true } } },');
replaceInFile(customOrdersPath, /sellerProduct\?\.catalogProductId/g, 'sellerProduct?.variant?.catalogProductId');
replaceInFile(customOrdersPath, /sellerProduct\.catalogProductId/g, 'sellerProduct.variant.catalogProductId');

const customOrdersDtoPath = path.join(srcPath, 'modules/custom-orders/dto/create-custom-order.dto.ts');
replaceInFile(customOrdersDtoPath, /productId\?/g, 'catalogProductId?');

const productsServicePath = path.join(srcPath, 'modules/products/products.service.ts');
replaceInFile(productsServicePath, /images: true,?/g, '');
replaceInFile(productsServicePath, /products:/g, 'variants:');

console.log('Final TS Refactor script executed');
