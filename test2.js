const fs = require('fs');
const txt = fs.readFileSync('d:/Projects/yukizi/yakuzi-api/src/modules/admin/admin.controller.ts', 'utf8');
const index = txt.indexOf("@Get('products')");
if (index !== -1) {
  console.log(txt.substring(index, index + 500));
} else {
  console.log('Not found');
}
