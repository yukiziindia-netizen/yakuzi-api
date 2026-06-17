const { Client } = require('pg');

async function testConnection() {
  const url = "postgresql://yukizi_admin:u28a74Zp1F28QjMnQSirzDHPZ88UoadS@yukizi-production-postgres.c708m08w68tr.ap-south-1.rds.amazonaws.com:5432/yukizi";
  
  console.log("Connecting to:", url);
  
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000 // 5 seconds timeout
  });
  
  try {
    await client.connect();
    console.log("SUCCESS! Connected to AWS RDS!");
  } catch (err) {
    console.error("ERROR CONNECTING:", err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

testConnection();
