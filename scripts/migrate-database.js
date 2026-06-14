const { Client } = require('pg');

async function migrate() {
  const oldUrl = "postgresql://neondb_owner:npg_eSi7dfx9zRuY@ep-shy-morning-ao18ji7y-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
  const newUrl = "postgresql://yukizi_admin:u28a74Zp1F28QjMnQSirzDHPZ88UoadS@yukizi-production-postgres.c708m08w68tr.ap-south-1.rds.amazonaws.com:5432/yukizi";

  const source = new Client({ connectionString: oldUrl });
  const target = new Client({ connectionString: newUrl });

  try {
    await source.connect();
    await target.connect();
    console.log("Connected to both databases.");

    // Disable FK checks on target temporarily
    await target.query(`SET session_replication_role = 'replica';`);
    console.log("Disabled foreign key checks on target database.");

    // Get all tables from public schema, excluding prisma migrations table
    const tablesRes = await source.query(`
      SELECT tablename 
      FROM pg_catalog.pg_tables 
      WHERE schemaname = 'public' 
      AND tablename != '_prisma_migrations';
    `);

    const tables = tablesRes.rows.map(r => r.tablename);
    console.log(`Found ${tables.length} tables to migrate.`);

    for (const table of tables) {
      console.log(`Migrating table: ${table}...`);
      
      // Get all rows
      const rowsRes = await source.query(`SELECT * FROM "${table}"`);
      const rows = rowsRes.rows;
      
      if (rows.length === 0) {
        console.log(`  Skipped ${table} (0 rows).`);
        continue;
      }

      // Get columns
      const columns = Object.keys(rows[0]);
      
      // First, clear the target table to avoid duplicate key errors if resuming
      await target.query(`DELETE FROM "${table}"`);
      
      // Batch insert
      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        
        let valueStrings = [];
        let flatValues = [];
        let paramIndex = 1;
        
        for (const row of batch) {
          let rowValues = [];
          for (const col of columns) {
            rowValues.push(`$${paramIndex++}`);
            flatValues.push(row[col]);
          }
          valueStrings.push(`(${rowValues.join(', ')})`);
        }
        
        const insertQuery = `
          INSERT INTO "${table}" ("${columns.join('", "')}") 
          VALUES ${valueStrings.join(', ')}
        `;
        
        await target.query(insertQuery, flatValues);
      }
      console.log(`  Migrated ${rows.length} rows for ${table}.`);
    }

    // Reset session_replication_role
    await target.query(`SET session_replication_role = 'origin';`);
    console.log("Re-enabled foreign key checks. Migration completed successfully.");

  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

migrate();
