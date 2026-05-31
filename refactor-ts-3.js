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

const basePath = path.join(__dirname, 'src', 'modules');

// 1. Fix ProductAnalytics and ProductSearchIndex
['products/services/analytics.service.ts', 'products/services/search-index.service.ts', 'reviews/reviews.service.ts'].forEach(rel => {
  const file = path.join(basePath, rel);
  replaceInFile(file, /\bsellerOfferId\b/g, 'catalogProductId');
});

// 2. Fix CustomOrders
replaceInFile(path.join(basePath, 'custom-orders/custom-orders.service.ts'), /\bsellerOfferId\b/g, 'catalogProductId');

// 3. Admin Service
replaceInFile(path.join(basePath, 'admin/admin.service.ts'), /masterProduct: /g, 'catalogProduct: ');
replaceInFile(path.join(basePath, 'admin/admin.service.ts'), /images: true,?/g, ''); // Remove images from SellerOffer queries
replaceInFile(path.join(basePath, 'admin/admin.service.ts'), /product: /g, 'sellerOffer: '); 
replaceInFile(path.join(basePath, 'admin/admin.service.ts'), /products: /g, ''); 

// 4. Products Service
replaceInFile(path.join(basePath, 'products/products.service.ts'), /images: true,?/g, '');
replaceInFile(path.join(basePath, 'products/products.service.ts'), /prisma\.productImage/g, 'prisma.catalogProductImage');
replaceInFile(path.join(basePath, 'products/products.service.ts'), /products: /g, '');

// 5. Cart Service
// cartId_productId -> cartId_sellerOfferId was done, but let's check review
replaceInFile(path.join(basePath, 'reviews/reviews.service.ts'), /userId_sellerOfferId/g, 'userId_catalogProductId');

// 6. Fix `items` error in Cart
// The issue is `items` missing. This is because TS doesn't recognize it if include failed. It failed because `product: true` was there. It should be `sellerOffer: true`.
// Actually we ran a replace for this already. Let's see what's left.
replaceInFile(path.join(basePath, 'orders/orders.service.ts'), /product:/g, 'sellerOffer:');

// seed.ts
const seedPath = path.join(__dirname, 'prisma', 'seed.ts');
replaceInFile(seedPath, /product: /g, 'sellerOffer: ');

