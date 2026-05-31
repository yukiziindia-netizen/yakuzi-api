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

// 1. admin.service.ts
const adminPath = path.join(__dirname, 'src/modules/admin/admin.service.ts');
// Fix missing sellerOfferId
replaceInFile(adminPath, /catalogProductId:\s*string/g, 'sellerOfferId: string');
// Fix masterProduct select
replaceInFile(adminPath, /masterProduct:\s*\{/g, 'variant: { select: { catalogProduct: {');
replaceInFile(adminPath, /products:\s*\{/g, 'variants: { include: { sellerOffers: {');

// 2. categories.service.ts
const catPath = path.join(__dirname, 'src/modules/categories/categories.service.ts');
replaceInFile(catPath, /products:\s*true/g, 'catalogProducts: true');

// 3. custom-orders.service.ts
const customOrdersPath = path.join(__dirname, 'src/modules/custom-orders/custom-orders.service.ts');
replaceInFile(customOrdersPath, /\bproductId\b/g, 'catalogProductId');

// 4. orders.service.ts
const ordersPath = path.join(__dirname, 'src/modules/orders/orders.service.ts');
// Apply same as fix-orders.js but specifically fixing `product.` -> `sellerOffer.`
replaceInFile(ordersPath, /item\.product\b/g, 'item.sellerOffer');
replaceInFile(ordersPath, /cartItem\.product\b/g, 'cartItem.sellerOffer');
replaceInFile(ordersPath, /const product =/g, 'const sellerOffer =');
replaceInFile(ordersPath, /let product =/g, 'let sellerOffer =');
replaceInFile(ordersPath, /product\./g, 'sellerOffer.');

// 5. products.service.ts
const productsPath = path.join(__dirname, 'src/modules/products/products.service.ts');
replaceInFile(productsPath, /masterProduct:\s*\{/g, 'variant: { select: { catalogProduct: {');
replaceInFile(productsPath, /masterProductId/g, 'catalogProductId');

console.log('Fixed precision errors');
