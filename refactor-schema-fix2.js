const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

schema = schema.replace(/images\s+ProductImage\[\]\n/g, '');

fs.writeFileSync(schemaPath, schema);
