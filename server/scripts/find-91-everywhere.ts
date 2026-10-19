import { db } from "@server/database_service.js";
import { sql } from "drizzle-orm";

async function findValueEverywhere(value: number) {
  const tablesResult = await db.execute(sql`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND data_type IN ('integer', 'bigint', 'numeric')
  `);

  console.log(`Searching for value ${value} in all numeric columns...`);

  for (const row of tablesResult.rows) {
    const table = row.table_name;
    const column = row.column_name;
    
    try {
      const result = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM ${table} WHERE ${column} = ${value}`));
      const count = parseInt((result.rows[0] as any).count);
      if (count > 0) {
        console.log(`[FOUND] Table: ${table}, Column: ${column}, Count: ${count}`);
      }
    } catch (e) {
      // Skip errors for tables that might not exist or have weird issues
    }
  }
}

findValueEverywhere(91).catch(console.error).finally(() => process.exit(0));

