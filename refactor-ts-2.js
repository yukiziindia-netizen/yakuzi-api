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

  // Fix product includes and selects
  // Mostly we want to replace `product: ` with `sellerOffer: ` in CartItem and OrderItem includes
  // But doing a general `product:` might be risky. Let's do common patterns:
  content = content.replace(/product:\s*true/g, 'sellerOffer: true');
  content = content.replace(/product:\s*\{/g, 'sellerOffer: {');
  content = content.replace(/\.product\./g, '.sellerOffer.');
  content = content.replace(/\.product\?/g, '.sellerOffer?');
  content = content.replace(/masterProduct:\s*true/g, 'catalogProduct: true');
  content = content.replace(/masterProduct:\s*\{/g, 'catalogProduct: {');
  
  // Fix masterProductImage -> catalogProductImage
  content = content.replace(/prisma\.masterProductImage/g, 'prisma.catalogProductImage');

  // Specific query inputs
  content = content.replace(/cartId_productId/g, 'cartId_sellerOfferId');
  
  // Fix DTOs if they have productId
  content = content.replace(/productId\s*:/g, 'sellerOfferId:');
  
  if (content !== original) {
    fs.writeFileSync(filePath, content);
  }
});
