const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

function updateModelField(modelName, oldField, newField) {
  const regex = new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, 'g');
  schema = schema.replace(regex, (match) => {
    return match.replace(new RegExp(`\\b${oldField}\\b`, 'g'), newField);
  });
}

function updateModelName(oldName, newName) {
  schema = schema.replace(new RegExp(`model ${oldName} \\{`, 'g'), `model ${newName} {`);
}

// 1. Rename MasterProduct -> CatalogProduct
updateModelName('MasterProduct', 'CatalogProduct');
schema = schema.replace(/\bMasterProduct\b/g, 'CatalogProduct');
schema = schema.replace(/\bmasterProduct\b/g, 'catalogProduct');
schema = schema.replace(/\bmaster_products\b/g, 'catalog_products');

// Rename MasterProductImage -> CatalogProductImage
updateModelName('MasterProductImage', 'CatalogProductImage');
schema = schema.replace(/\bMasterProductImage\b/g, 'CatalogProductImage');
schema = schema.replace(/\bmaster_product_images\b/g, 'catalog_product_images');

// 2. Add ThirdCategory and ProductVariant, CatalogProductVideo
schema = schema.replace(
  /model SubCategory \{([\s\S]*?)\}/,
  (match, p1) => {
    let replaced = match;
    if (!replaced.includes('thirdCategories ThirdCategory[]')) {
      replaced = replaced.replace('category       Category', 'thirdCategories ThirdCategory[]\n  category       Category');
    }
    return replaced;
  }
);

// Modify CatalogProduct properties
const catalogProductRegex = /model CatalogProduct \{([\s\S]*?)@@map\("catalog_products"\)\n\}/;
schema = schema.replace(catalogProductRegex, (match, p1) => {
  let body = p1;
  body = body.replace(/subCategoryId\s+String/, 'subCategoryId       String\n  thirdCategoryId     String?');
  body = body.replace(/description\s+String\?/, 'description         String?\n  specification       Json?\n  tags                String[]');
  body = body.replace(/subCategory\s+SubCategory\s+@relation\(fields: \[subCategoryId\], references: \[id\]\)/,
    'subCategory         SubCategory          @relation(fields: [subCategoryId], references: [id])\n  thirdCategory       ThirdCategory?       @relation(fields: [thirdCategoryId], references: [id])');
  body = body.replace(/images\s+CatalogProductImage\[\]/, 'images              CatalogProductImage[]\n  videos              CatalogProductVideo[]\n  variants            ProductVariant[]\n  reviews             Review[]\n  searchIndex         ProductSearchIndex?\n  analytics           ProductAnalytics?\n  marketingProducts   MarketingProduct[]');
  body = body.replace(/id\s+String\s+@id @default\(uuid\(\)\)/, 'id                  String               @id @default(uuid())\n  sku                 String?              @unique');
  return `model CatalogProduct {${body}@@map("catalog_products")\n}`;
});

// 3. Rename Product -> SellerOffer
updateModelName('Product', 'SellerOffer');
schema = schema.replace(/@@map\("products"\)/g, '@@map("seller_offers")');

// Replace "products Product[]" with "sellerOffers SellerOffer[]" in SellerProfile and Category
updateModelField('SellerProfile', 'products', 'sellerOffers');
schema = schema.replace(/sellerOffers\s+Product\[\]/g, 'sellerOffers SellerOffer[]');
updateModelField('Category', 'products', 'sellerOffers');
schema = schema.replace(/sellerOffers\s+Product\[\]/g, 'sellerOffers SellerOffer[]');
updateModelField('SubCategory', 'products', 'sellerOffers');
schema = schema.replace(/sellerOffers\s+Product\[\]/g, 'sellerOffers SellerOffer[]');

// Remove ProductImage model completely
schema = schema.replace(/model ProductImage \{[\s\S]*?\n\}\n/, '');

// Update references to Product (now SellerOffer or CatalogProduct)

// Models that should reference SellerOffer (the actual thing being sold)
const sellerOfferRefs = ['CartItem', 'OrderItem', 'ProductBatch', 'InventoryAlert'];
for (const model of sellerOfferRefs) {
  updateModelField(model, 'Product', 'SellerOffer');
  updateModelField(model, 'product', 'sellerOffer');
  updateModelField(model, 'productId', 'sellerOfferId');
}

// Models that should reference CatalogProduct (the master catalog item)
const catalogRefs = ['Review', 'ProductSearchIndex', 'ProductAnalytics', 'MarketingProduct'];
for (const model of catalogRefs) {
  updateModelField(model, 'Product', 'CatalogProduct');
  updateModelField(model, 'product', 'catalogProduct');
  updateModelField(model, 'productId', 'catalogProductId');
}

// CustomOrder references MasterProduct (now CatalogProduct)
updateModelField('CustomOrder', 'productId', 'catalogProductId');

// Add the new models
const thirdCategoryStr = `
model ThirdCategory {
  id             String          @id @default(uuid())
  name           String
  slug           String
  subCategoryId  String
  createdAt      DateTime        @default(now())
  catalogProducts CatalogProduct[]
  subCategory    SubCategory     @relation(fields: [subCategoryId], references: [id], onDelete: Cascade)

  @@unique([slug, subCategoryId])
  @@index([subCategoryId])
  @@map("third_categories")
}
`;

const videoAndVariantStr = `
model CatalogProductVideo {
  id               String         @id @default(uuid())
  catalogProductId String
  url              String
  createdAt        DateTime       @default(now())
  catalogProduct   CatalogProduct @relation(fields: [catalogProductId], references: [id], onDelete: Cascade)

  @@index([catalogProductId])
  @@map("catalog_product_videos")
}

model ProductVariant {
  id               String         @id @default(uuid())
  catalogProductId String
  name             String
  sku              String?        @unique
  options          Json
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  catalogProduct   CatalogProduct @relation(fields: [catalogProductId], references: [id], onDelete: Cascade)
  sellerOffers     SellerOffer[]

  @@index([catalogProductId])
  @@index([sku])
  @@map("product_variants")
}
`;

schema += '\n' + thirdCategoryStr + '\n' + videoAndVariantStr;

// Wait, the SellerOffer still has a relation to CatalogProduct?
// Let's modify SellerOffer to point to ProductVariant.
// In the schema, it was:
//  catalogProductId String?
//  catalogProduct CatalogProduct? @relation(fields: [catalogProductId], ...)
// We want to replace it with variantId.
updateModelField('SellerOffer', 'catalogProductId', 'variantId');
updateModelField('SellerOffer', 'catalogProduct', 'variant');
updateModelField('SellerOffer', 'CatalogProduct', 'ProductVariant');
updateModelField('SellerOffer', 'masterProductId', 'variantId');
updateModelField('SellerOffer', 'masterProduct', 'variant');
updateModelField('SellerOffer', 'MasterProduct', 'ProductVariant');

// In SellerOffer, we want to remove the direct category references (categoryId, subCategoryId) 
// since those are on the CatalogProduct.
// Or we can leave them for now to avoid breaking too many things. But to properly normalize, they should be removed.
// Let's just do a clean pass formatting.

fs.writeFileSync(schemaPath, schema);
