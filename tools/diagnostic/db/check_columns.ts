
import "dotenv/config";
import { pool } from "./server/db/index.js";

async function checkColumns(tableName: string) {
  console.log(`\nChecking columns for table: ${tableName}`);
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1
    `, [tableName]);
    console.log(`Found ${res.rows.length} columns:`);
    res.rows.forEach(row => console.log(` - ${row.column_name} (${row.data_type})`));
  } catch (err) {
    console.error(`Error checking columns for ${tableName}:`, err);
  }
}

async function run() {
  await checkColumns('jobs');
  await checkColumns('pipeline_step_executions');
  await checkColumns('pipeline_executions');
  process.exit(0);
}

run();
