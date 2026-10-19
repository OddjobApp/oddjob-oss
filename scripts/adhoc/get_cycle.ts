import { Client } from 'pg';

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/oddjob'
  });
  await client.connect();
  const res = await client.query('SELECT id FROM operational_cycles WHERE org_id = 291 ORDER BY created_at DESC LIMIT 1');
  console.log("CYCLE_ID=" + res.rows[0]?.id);
  await client.end();
}

main().catch(console.error);
