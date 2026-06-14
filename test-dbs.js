const { Client } = require('pg');

async function testConnection(name, connectionString) {
  const client = new Client({ connectionString });
  try {
    console.log(`Connecting to ${name}...`);
    await client.connect();
    const res = await client.query('SELECT current_database(), count(*) from "User"'); // Assuming Prisma uses "User" table
    console.log(`[SUCCESS] ${name}: DB=${res.rows[0].current_database}, Users=${res.rows[0].count}`);
  } catch (err) {
    if (err.message.includes('"User"')) {
       console.log(`[PARTIAL SUCCESS] ${name} connected but "User" table missing.`);
    } else {
       console.error(`[FAILED] ${name}: ${err.message}`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const neon = "postgresql://neondb_owner:npg_eSi7dfx9zRuY@ep-shy-morning-ao18ji7y-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
  const rds = "postgresql://yukizi_admin:u28a74Zp1F28QjMnQSirzDHPZ88UoadS@yukizi-production-postgres.c708m08w68tr.ap-south-1.rds.amazonaws.com:5432/yukizi";
  
  await testConnection('NeonDB', neon);
  await testConnection('AWS RDS', rds);
}

main();
