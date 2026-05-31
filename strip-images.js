const fs = require('fs');
const path = require('path');

const ordPath = path.join(__dirname, 'src/modules/orders/orders.service.ts');
let o_content = fs.readFileSync(ordPath, 'utf8');

o_content = o_content.replace(/images:\s*\{\s*select:\s*\{\s*url:\s*true\s*\},\s*take:\s*1\s*\},/g, '');

fs.writeFileSync(ordPath, o_content);
console.log('Stripped images from orders');
