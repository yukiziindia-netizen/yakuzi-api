const fs = require('fs');
const txt = fs.readFileSync('d:/Projects/yukizi/yakuzi-api/src/modules/admin/admin.service.ts', 'utf8');
const index = txt.indexOf("async getAllProducts");
if (index !== -1) {
  console.log(txt.substring(index, index + 1500));
} else {
  console.log('Not found');
}
