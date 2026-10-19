import "dotenv/config";
import pg from 'pg';
const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  const cycleRes = await client.query('SELECT id, name FROM operational_cycles WHERE id = 202');
  console.log("Cycle:", cycleRes.rows);

  const mRes = await client.query('SELECT id, name, cycle_id FROM missions WHERE cycle_id = 202');
  console.log("Missions:", mRes.rows);

  if (mRes.rows.length > 0) {
    for (const m of mRes.rows) {
      const runs = await client.query('SELECT id, name, mission_id FROM mission_runs WHERE mission_id = $1', [m.id]);
      console.log(`Runs for mission ${m.id}:`, runs.rows);

      const binds = await client.query('SELECT id, app_id, mission_id FROM mission_app_bindings WHERE mission_id = $1', [m.id]);
      console.log(`Bindings for mission ${m.id}:`, binds.rows);
    }
  }

  await client.end();
  process.exit(0);
}
main().catch(console.error);
