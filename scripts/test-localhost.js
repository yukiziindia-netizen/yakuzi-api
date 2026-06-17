const { Client } = require('pg');

async function testLocalhost() {
  const url = "postgresql://yukizi_admin:u28a74Zp1F28QjMnQSirzDHPZ88UoadS@127.0.0.1:5432/yukizi";
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    console.log("SUCCESS: Connected to RDS via localhost port forward!");
    const res = await client.query('SELECT current_database()');
    console.log("Database:", res.rows[0].current_database);
  } catch (err) {
    console.error("FAILED:", err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

testLocalhost();
