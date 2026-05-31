const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

// The ProductImage model was probably not matched exactly by my regex.
// Let's find where 'model ProductImage' starts and delete until '}'
const startIdx = schema.indexOf('model ProductImage {');
if (startIdx !== -1) {
  const endIdx = schema.indexOf('}', startIdx);
  if (endIdx !== -1) {
    schema = schema.substring(0, startIdx) + schema.substring(endIdx + 1);
  }
}

// Same for CatalogProduct having products Product[]
schema = schema.replace(/products\s+Product\[\]/g, '');

fs.writeFileSync(schemaPath, schema);
