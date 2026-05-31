const fs = require('fs');
const path = require('path');

const adminPath = path.join(__dirname, 'src/modules/admin/admin.service.ts');
let content = fs.readFileSync(adminPath, 'utf8');

// Replace prisma client accessors
content = content.replace(/prisma\.product\b/g, 'prisma.sellerOffer');
content = content.replace(/prisma\.masterProduct\b/g, 'prisma.catalogProduct');
content = content.replace(/prisma\.masterProductImage\b/g, 'prisma.catalogProductImage');

// Replace WhereInput types
content = content.replace(/\bProductWhereInput\b/g, 'SellerOfferWhereInput');
content = content.replace(/\bMasterProductWhereInput\b/g, 'CatalogProductWhereInput');

// Replace relations in OrderItem
content = content.replace(/product:\s*true/g, 'sellerOffer: true');
content = content.replace(/product:\s*\{/g, 'sellerOffer: {');

// Replace MarketingProduct fields
// MarketingProduct doesn't have `product` or `productId`, it has `catalogProduct` and `catalogProductId`
content = content.replace(/productId\s*:/g, 'catalogProductId:');

fs.writeFileSync(adminPath, content);
console.log('Safely refactored admin.service.ts');
