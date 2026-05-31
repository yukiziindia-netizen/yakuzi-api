const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const adminPath = path.join(__dirname, 'src/modules/admin/admin.service.ts');

execSync(`git checkout -- ${adminPath}`);

let content = fs.readFileSync(adminPath, 'utf8');

content = content.replace(/prisma\.product\b/g, 'prisma.sellerOffer');
content = content.replace(/prisma\.masterProduct\b/g, 'prisma.catalogProduct');
content = content.replace(/prisma\.masterProductImage\b/g, 'prisma.catalogProductImage');
content = content.replace(/\bProductWhereInput\b/g, 'SellerOfferWhereInput');
content = content.replace(/\bMasterProductWhereInput\b/g, 'CatalogProductWhereInput');
content = content.replace(/product:\s*true/g, 'sellerOffer: true');
content = content.replace(/product:\s*\{/g, 'sellerOffer: {');

// Fix MarketingProduct relation
content = content.replace(/sellerOffer: {\n\s*select: {\n\s*id: true,\n\s*catalogProductId: true,\n\s*}/g, 'catalogProduct: {\n          select: {\n            id: true,\n            name: true,\n          }\n        }');
// MarketingProduct where productId
content = content.replace(/productId\s*:/g, 'catalogProductId:');

// Fix images inside SellerOffer
content = content.replace(/images: { select: { id: true, url: true } },/g, '');
content = content.replace(/images:\s*true,?/g, '');

// FIX getSuggestionById products -> variants
content = content.replace(/products: {\n\s*select: { id: true, seller: { select: { companyName: true } }, mrp: true },\n\s*take: 10,\n\s*},/g, 
`variants: {
          include: {
            sellerOffers: {
              select: { id: true, seller: { select: { companyName: true } }, mrp: true },
              take: 10,
            }
          }
        },`);

// FIX masterProduct -> variant -> catalogProduct
content = content.replace(/masterProduct: {\n\s*select: {\n\s*id: true,\n\s*_count: { select: { products: true } },\n\s*},\n\s*},/g, 
`variant: { select: { catalogProduct: {
            select: {
              id: true,
              _count: { select: { variants: { include: { sellerOffers: true } } } }
            }
          } } },`);

// Enable/Disable Product
content = content.replace(/async disableProduct\(productId: string\)/g, 'async disableProduct(sellerOfferId: string)');
content = content.replace(/async enableProduct\(productId: string\)/g, 'async enableProduct(sellerOfferId: string)');
content = content.replace(/async softDeleteProduct\(productId: string\)/g, 'async softDeleteProduct(sellerOfferId: string)');
content = content.replace(/async approveProduct\(productId: string\)/g, 'async approveProduct(sellerOfferId: string)');
content = content.replace(/async rejectProduct\(productId: string, reason\?: string\)/g, 'async rejectProduct(sellerOfferId: string, reason?: string)');
content = content.replace(/async getProductById\(productId: string\)/g, 'async getProductById(sellerOfferId: string)');
content = content.replace(/\bproductId\b/g, 'sellerOfferId'); // catch others


fs.writeFileSync(adminPath, content);
console.log('Admin safely rewritten');
