const { Client } = require('pg');

async function testNeon() {
  const url = "postgresql://neondb_owner:npg_eSi7dfx9zRuY@ep-shy-morning-ao18ji7y-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    console.log("Connected to NeonDB!");
    const res = await client.query('SELECT count(*) from "User"');
    console.log("Users in NeonDB:", res.rows[0].count);
  } catch (err) {
    if (err.message.includes('"User" does not exist')) {
       console.log("Connected to NeonDB, but table User does not exist (it is empty).");
       
       // Try 'users'
       try {
           const res2 = await client.query('SELECT count(*) from "users"');
           console.log("Users (table 'users') in NeonDB:", res2.rows[0].count);
       } catch (err2) {
           console.log("table 'users' does not exist either.");
       }
    } else {
       console.error("NeonDB Error:", err.message);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

testNeon();
