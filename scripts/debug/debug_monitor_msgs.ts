
import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5433/oddjob',
});

async function run() {
    try {
        await client.connect();
        console.log("Checking for recent Monitor Messages...");

        const res = await client.query(`
            SELECT id, job_id, user_id, role, content, created_at, metadata
            FROM agent_chat_messages
            WHERE created_at > NOW() - INTERVAL '15 minutes'
            AND metadata->>'isMonitorUpdate' = 'true'
            ORDER BY id DESC
        `);

        if (res.rows.length > 0) {
            console.log("Found Monitor Messages:");
            res.rows.forEach(row => {
                console.log(`[${row.id}] Job: ${row.job_id} | User: ${row.user_id} | Content: ${row.content.substring(0, 50)}...`);
            });
        } else {
            console.log("No monitor messages found in the last 15 minutes.");
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await client.end();
    }
}

run();
