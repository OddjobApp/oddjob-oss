import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/oddjob'
});

async function run() {
    try {
        await client.connect();
        const res = await client.query(`
      SELECT j.config->>'allowedTools' as allowed_tools
      FROM agent_deployments a
      JOIN jobs j ON a.job_id = j.id
      WHERE a.slug = 'qa-dispatch'
    `);
        console.log(JSON.stringify(res.rows[0], null, 2));
    } catch (err) {
        console.error('Error executing query', err.stack);
    } finally {
        await client.end();
    }
}

run();
