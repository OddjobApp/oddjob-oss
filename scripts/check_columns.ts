
import { pool } from "../server/db/index.js";

async function checkColumns() {
  const tables = ['mission_runs', 'missions', 'pipeline_executions', 'pipeline_step_executions'];
  for (const table of tables) {
    console.log(`--- COLUMNS FOR ${table} ---`);
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1
      ORDER BY ordinal_position;
    `, [table]);
    res.rows.forEach(row => {
      console.log(`${row.column_name}: ${row.data_type}`);
    });
    console.log("\n");
  }
  process.exit(0);
}

checkColumns().catch(err => {
  console.error(err);
  process.exit(1);
});
