const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

// The best way to fix these is to find the models and replace their properties line by line.

// 1. Completely remove ProductImage model (which I might have failed to remove because of whitespace)
schema = schema.replace(/model ProductImage \{[\s\S]*?\n\}\n/, '');

function updateModelField(modelName, oldField, newField) {
  const regex = new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, 'g');
  schema = schema.replace(regex, (match) => {
    let replaced = match.replace(new RegExp(`\\b${oldField}\\b`, 'g'), newField);
    return replaced;
  });
}

// 2. CartItem: replace productId with sellerOfferId
updateModelField('CartItem', 'productId', 'sellerOfferId');

// 3. OrderItem: replace productId with sellerOfferId
updateModelField('OrderItem', 'productId', 'sellerOfferId');

// 4. Review: replace productId with catalogProductId
updateModelField('Review', 'productId', 'catalogProductId');

// 5. ProductBatch: replace productId with sellerOfferId
updateModelField('ProductBatch', 'productId', 'sellerOfferId');

// 6. InventoryAlert: replace productId with sellerOfferId
updateModelField('InventoryAlert', 'productId', 'sellerOfferId');

// 7. ProductSearchIndex: replace productId with catalogProductId
updateModelField('ProductSearchIndex', 'productId', 'catalogProductId');

// 8. ProductAnalytics: replace productId with catalogProductId
updateModelField('ProductAnalytics', 'productId', 'catalogProductId');

// 9. MarketingProduct: replace productId with catalogProductId
updateModelField('MarketingProduct', 'productId', 'catalogProductId');

// Also need to fix CustomOrder which references productId
// CustomOrder: replace productId with catalogProductId? 
// Wait, CustomOrder has productId referencing MasterProduct (now CatalogProduct).
// So it needs to be catalogProductId.
updateModelField('CustomOrder', 'productId', 'catalogProductId');

// Ensure that "productId" no longer exists anywhere in SellerOffer-related index except the ones we changed.
// Let's do a global replace of "productId" to "sellerOfferId" in any index, except for those models that use catalogProductId
const modelsWithCatalogProductId = ['Review', 'ProductSearchIndex', 'ProductAnalytics', 'MarketingProduct', 'CustomOrder'];

// Let's just fix indices manually inside the string because the above updateModelField handles it nicely for the whole block!
// Wait, `updateModelField` uses `\bproductId\b` which will also replace `productId` in `@@index([productId])` to `@@index([sellerOfferId])` or `@@index([catalogProductId])` correctly because it scopes by model!
// Let's test if there are any trailing productId's left in the file.
// We can just log them to be safe.

fs.writeFileSync(schemaPath, schema);
