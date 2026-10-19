import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  await client.connect();
  const res = await client.query('SELECT id, name, objective FROM operational_cycles ORDER BY id DESC LIMIT 5');
  console.log(res.rows);
  const mRes = await client.query('SELECT id, name FROM missions ORDER BY id DESC LIMIT 5');
  console.log(mRes.rows);
  await client.end();
}

main().catch(console.error);
