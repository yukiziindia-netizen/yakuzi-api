const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir(path.join(__dirname, 'src'), (filePath) => {
  if (!filePath.endsWith('.ts')) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // Prisma queries
  content = content.replace(/prisma\.product\./g, 'prisma.sellerOffer.');
  content = content.replace(/prisma\.masterProduct\./g, 'prisma.catalogProduct.');
  
  // Prisma types
  content = content.replace(/\bProductWhereInput\b/g, 'SellerOfferWhereInput');
  content = content.replace(/\bMasterProductWhereInput\b/g, 'CatalogProductWhereInput');
  
  content = content.replace(/\bProduct\b/g, 'SellerOffer');
  content = content.replace(/\bMasterProduct\b/g, 'CatalogProduct');

  // Fields
  content = content.replace(/\bproductId\b/g, 'sellerOfferId'); // Dangerous, might need manual check for review, etc.
  content = content.replace(/\bmasterProductId\b/g, 'catalogProductId');
  
  if (content !== original) {
    fs.writeFileSync(filePath, content);
  }
});

walkDir(path.join(__dirname, 'prisma'), (filePath) => {
  if (!filePath.endsWith('seed.ts')) return;
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/prisma\.product\./g, 'prisma.sellerOffer.');
  content = content.replace(/prisma\.masterProduct\./g, 'prisma.catalogProduct.');
  content = content.replace(/\bProduct\b/g, 'SellerOffer');
  content = content.replace(/\bMasterProduct\b/g, 'CatalogProduct');
  content = content.replace(/\bproductId\b/g, 'sellerOfferId');
  fs.writeFileSync(filePath, content);
});

console.log('Done basic TS refactor.');
