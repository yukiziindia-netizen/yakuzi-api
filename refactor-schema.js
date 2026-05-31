const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

// The easiest way to safely update this is to use regexes carefully, or to just parse and rewrite it.
// We have the full text. Let's do string replacement for the models.

// Add ThirdCategory to SubCategory
schema = schema.replace(
  /products\s+Product\[\]\n\s+category\s+Category/g,
  'products       Product[]\n  thirdCategories ThirdCategory[]\n  category       Category'
);

schema = schema.replace(
  /model SubCategory \{([\s\S]*?)\}/,
  `model SubCategory {$1}`
);
if (!schema.includes('thirdCategories ThirdCategory[]')) {
  schema = schema.replace('category       Category', 'thirdCategories ThirdCategory[]\n  category       Category');
}

// Rename MasterProduct -> CatalogProduct
schema = schema.replace(/MasterProduct/g, 'CatalogProduct');
schema = schema.replace(/masterProduct/g, 'catalogProduct');
schema = schema.replace(/master_products/g, 'catalog_products');
schema = schema.replace(/master_product_images/g, 'catalog_product_images');

// Now, update CatalogProduct to have tags, specification, videos, variants, and thirdCategoryId
const oldCatalogProductRegex = /model CatalogProduct \{([\s\S]*?)@@map\("catalog_products"\)\n\}/;
const oldCatalogProductMatch = schema.match(oldCatalogProductRegex);

if (oldCatalogProductMatch) {
  let catalogProductBody = oldCatalogProductMatch[1];
  // Add thirdCategoryId
  catalogProductBody = catalogProductBody.replace(
    /subCategoryId\s+String/,
    'subCategoryId       String\n  thirdCategoryId     String?'
  );
  // Add specification and tags
  catalogProductBody = catalogProductBody.replace(
    /description\s+String\?/,
    'description         String?\n  specification       Json?\n  tags                String[]'
  );
  // Add thirdCategory relation
  catalogProductBody = catalogProductBody.replace(
    /subCategory\s+SubCategory\s+@relation\(fields: \[subCategoryId\], references: \[id\]\)/,
    'subCategory         SubCategory          @relation(fields: [subCategoryId], references: [id])\n  thirdCategory       ThirdCategory?       @relation(fields: [thirdCategoryId], references: [id])'
  );
  // Add variants and videos to relations
  catalogProductBody = catalogProductBody.replace(
    /images\s+CatalogProductImage\[\]/,
    'images              CatalogProductImage[]\n  videos              CatalogProductVideo[]\n  variants            ProductVariant[]'
  );
  // Add sku
  catalogProductBody = catalogProductBody.replace(
    /id\s+String\s+@id @default\(uuid\(\)\)/,
    'id                  String               @id @default(uuid())\n  sku                 String?              @unique'
  );
  
  schema = schema.replace(oldCatalogProductRegex, `model CatalogProduct {${catalogProductBody}@@map("catalog_products")\n}`);
}


// Rename Product to SellerOffer
// Before renaming every "Product" which is dangerous (ProductImage, ProductBatch etc.),
// let's do targeted replacements.
schema = schema.replace(/model Product \{/g, 'model SellerOffer {');
schema = schema.replace(/@@map\("products"\)/g, '@@map("seller_offers")');
// In SellerProfile: `products Product[]` -> `sellerOffers SellerOffer[]`
schema = schema.replace(/products\s+Product\[\]/g, 'sellerOffers SellerOffer[]');
// In Category: `products Product[]` -> `sellerOffers SellerOffer[]`
// Wait, Category/SubCategory relations: SellerOffer should probably just relate to Variant, not Category.
// For now let's just rename correctly to get it to compile.

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

fs.writeFileSync(schemaPath, schema);
