const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

const floatFieldsToDecimal = [
  // Order
  ['totalAmount    Float', 'totalAmount    Decimal @db.Decimal(10, 2)'],
  
  // OrderItem
  ['unitPrice     Float', 'unitPrice     Decimal @db.Decimal(10, 2)'],
  ['totalPrice    Float', 'totalPrice    Decimal @db.Decimal(10, 2)'],
  
  // Payment
  ['amount             Float', 'amount             Decimal @db.Decimal(10, 2)'],
  
  // CartItem
  ['unitPrice     Float', 'unitPrice     Decimal @db.Decimal(10, 2)'],
  
  // SellerOffer
  ['mrp                  Float', 'mrp                  Decimal @db.Decimal(10, 2)'],
  ['gstPercent           Float', 'gstPercent           Decimal @db.Decimal(10, 2)'],
  ['shippingCharges      Float                 @default(0)', 'shippingCharges      Decimal               @default(0) @db.Decimal(10, 2)'],
  ['finalShippingPrice   Float?', 'finalShippingPrice   Decimal?              @db.Decimal(10, 2)'],
  
  // CatalogProduct
  ['mrp                  Float?', 'mrp                  Decimal? @db.Decimal(10, 2)'],
  ['gstPercent           Float?', 'gstPercent           Decimal? @db.Decimal(10, 2)'],
  ['shippingCharges      Float                 @default(0)', 'shippingCharges      Decimal               @default(0) @db.Decimal(10, 2)'],
  ['finalShippingPrice   Float?', 'finalShippingPrice   Decimal?              @db.Decimal(10, 2)'],
  ['commissionPercent    Float?', 'commissionPercent    Decimal? @db.Decimal(10, 2)'],
  ['fixedFee             Float?', 'fixedFee             Decimal? @db.Decimal(10, 2)'],
  ['commissionGstPercent Float?', 'commissionGstPercent Decimal? @db.Decimal(10, 2)'],
  ['fixedFeeGstPercent   Float?', 'fixedFeeGstPercent   Decimal? @db.Decimal(10, 2)'],
  ['shippingGstPercent   Float?', 'shippingGstPercent   Decimal? @db.Decimal(10, 2)'],
  
  // Category / SubCategory
  ['commissionPercent    Float?', 'commissionPercent    Decimal? @db.Decimal(10, 2)'],
  ['fixedFee             Float?', 'fixedFee             Decimal? @db.Decimal(10, 2)'],
  ['commissionGstPercent Float?', 'commissionGstPercent Decimal? @db.Decimal(10, 2)'],
];

floatFieldsToDecimal.forEach(([oldStr, newStr]) => {
  // Use regex to replace globally just in case, but be careful with exact matches
  schema = schema.split(oldStr).join(newStr);
});

// Add finalCustomerPayable to SellerOffer
const finalCustomerPayableField = '  finalCustomerPayable Decimal?              @db.Decimal(10, 2)\n';
if (!schema.includes('finalCustomerPayable')) {
  schema = schema.replace(
    /model SellerOffer \{[\s\S]*?finalShippingPrice[\s\S]*?\n/,
    (match) => match + finalCustomerPayableField
  );
}

fs.writeFileSync(schemaPath, schema);
console.log('Schema updated successfully.');
