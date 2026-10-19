
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  connectionString: 'postgres://postgres:postgres@localhost:5433/oddjob'
});
const query = process.argv[2];
try {
  const result = await pool.query(query);
  console.log(JSON.stringify(result.rows, null, 2));
} catch (err) {
  console.error(err);
} finally {
  await pool.end();
  process.exit(0);
}

