import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function check() {
    const client = await pool.connect();
    try {
        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
        const { rows: chat } = await client.query('SELECT COUNT(*) FROM agent_chat_messages WHERE workgroup_id = 69 AND created_at > $1', [fiveMinsAgo]);
        const { rows: hist } = await client.query('SELECT COUNT(*) FROM workgroup_blackboard_history WHERE workgroup_id = 69 AND created_at > $1', [fiveMinsAgo]);
        const { rows: lastMsg } = await client.query('SELECT role, content, created_at FROM agent_chat_messages WHERE workgroup_id = 69 ORDER BY created_at DESC LIMIT 1');

        process.stdout.write(`RESULTS_START\n`);
        process.stdout.write(`CHAT_COUNT: ${chat[0].count}\n`);
        process.stdout.write(`HIST_COUNT: ${hist[0].count}\n`);
        if (lastMsg[0]) {
            process.stdout.write(`LAST_MSG_ROLE: ${lastMsg[0].role}\n`);
            process.stdout.write(`LAST_MSG_TIME: ${lastMsg[0].created_at.toISOString()}\n`);
            process.stdout.write(`LAST_MSG_CONTENT: ${lastMsg[0].content.substring(0, 50)}\n`);
        }
        process.stdout.write(`RESULTS_END\n`);
    } finally {
        client.release();
        await pool.end();
    }
}
check();
