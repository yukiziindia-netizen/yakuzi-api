const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

// 1. Delete ProductImage
schema = schema.replace(/model ProductImage \{[\s\S]*?@@map\("product_images"\)\n\}/, '');

// 2. CartItem -> SellerOffer
schema = schema.replace(
  /productId String\n  quantity/g,
  'sellerOfferId String\n  quantity'
);
schema = schema.replace(
  /product   Product  @relation\(fields: \[productId\], references: \[id\], onDelete: Cascade\)/g,
  'sellerOffer SellerOffer @relation(fields: [sellerOfferId], references: [id], onDelete: Cascade)'
);
schema = schema.replace(/@@unique\(\[cartId, productId\]\)/g, '@@unique([cartId, sellerOfferId])');
schema = schema.replace(/@@index\(\[productId\]\)/g, '@@index([sellerOfferId])');

// 3. OrderItem -> SellerOffer
schema = schema.replace(
  /productId  String\n  sellerId/g,
  'sellerOfferId  String\n  sellerId'
);
schema = schema.replace(
  /product    Product           @relation\(fields: \[productId\], references: \[id\]\)/g,
  'sellerOffer SellerOffer @relation(fields: [sellerOfferId], references: [id])'
);

// 4. Review -> CatalogProduct
schema = schema.replace(
  /productId String\n  rating/g,
  'catalogProductId String\n  rating'
);
schema = schema.replace(
  /product   Product  @relation\(fields: \[productId\], references: \[id\], onDelete: Cascade\)/g,
  'catalogProduct CatalogProduct @relation(fields: [catalogProductId], references: [id], onDelete: Cascade)'
);
schema = schema.replace(/@@unique\(\[userId, productId\]\)/g, '@@unique([userId, catalogProductId])');

// 5. InventoryAlert -> SellerOffer
schema = schema.replace(
  /productId String\n  batchId/g,
  'sellerOfferId String\n  batchId'
);
schema = schema.replace(
  /product   Product       @relation\(fields: \[productId\], references: \[id\], onDelete: Cascade\)/g,
  'sellerOffer SellerOffer @relation(fields: [sellerOfferId], references: [id], onDelete: Cascade)'
);

// 6. ProductSearchIndex -> CatalogProduct
schema = schema.replace(
  /productId           String   @unique\n  name/g,
  'catalogProductId    String   @unique\n  name'
);
schema = schema.replace(
  /product             Product  @relation\(fields: \[productId\], references: \[id\], onDelete: Cascade\)/g,
  'catalogProduct CatalogProduct @relation(fields: [catalogProductId], references: [id], onDelete: Cascade)'
);

// 7. ProductAnalytics -> CatalogProduct
schema = schema.replace(
  /productId   String    @unique\n  views/g,
  'catalogProductId String @unique\n  views'
);
schema = schema.replace(
  /product     Product   @relation\(fields: \[productId\], references: \[id\], onDelete: Cascade\)/g,
  'catalogProduct CatalogProduct @relation(fields: [catalogProductId], references: [id], onDelete: Cascade)'
);

// 8. ProductBatch -> SellerOffer
schema = schema.replace(
  /productId       String\n  batchNumber/g,
  'sellerOfferId String\n  batchNumber'
);
schema = schema.replace(
  /product         Product          @relation\(fields: \[productId\], references: \[id\], onDelete: Cascade\)/g,
  'sellerOffer SellerOffer @relation(fields: [sellerOfferId], references: [id], onDelete: Cascade)'
);
schema = schema.replace(/@@index\(\[productId, batchNumber\]\)/g, '@@index([sellerOfferId, batchNumber])');

// 9. MarketingProduct -> CatalogProduct
schema = schema.replace(
  /productId String\n  slot/g,
  'catalogProductId String\n  slot'
);
schema = schema.replace(
  /product   Product       @relation\(fields: \[productId\], references: \[id\], onDelete: Cascade\)/g,
  'catalogProduct CatalogProduct @relation(fields: [catalogProductId], references: [id], onDelete: Cascade)'
);

// Update relation in CatalogProduct itself.
// Since Review, ProductSearchIndex, ProductAnalytics, MarketingProduct now point to CatalogProduct,
// we need to add them to CatalogProduct model.
schema = schema.replace(
  /variants            ProductVariant\[\]/,
  'variants            ProductVariant[]\n  reviews             Review[]\n  searchIndex         ProductSearchIndex?\n  analytics           ProductAnalytics?\n  marketingProducts   MarketingProduct[]'
);

fs.writeFileSync(schemaPath, schema);
