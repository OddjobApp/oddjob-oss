import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/oddjob'
});

async function run() {
    try {
        await client.connect();
        const res = await client.query('SELECT id, role, content FROM agent_chat_messages ORDER BY id DESC LIMIT 5');
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error executing query', err.stack);
    } finally {
        await client.end();
    }
}

run();
