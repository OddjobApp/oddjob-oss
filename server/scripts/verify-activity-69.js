import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function verifyActivity(wgId) {
    const client = await pool.connect();
    try {
        console.log(`--- Monitoring WG ${wgId} Activity (Last 5 Minutes) ---`);
        const now = new Date();
        const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000);

        // 1. Check Blackboard History
        const histRes = await client.query(
            'SELECT * FROM workgroup_blackboard_history WHERE workgroup_id = $1 AND created_at > $2 ORDER BY created_at DESC',
            [wgId, fiveMinsAgo]
        );
        console.log(`\nNew Blackboard History: ${histRes.rows.length} entries`);
        histRes.rows.forEach(h => {
            console.log(`- [${h.created_at.toISOString()}] ${h.changed_by} | Reason: ${h.change_reason}`);
        });

        // 2. Check Agent Chat Messages
        const chatRes = await client.query(
            'SELECT * FROM agent_chat_messages WHERE workgroup_id = $1 AND created_at > $2 ORDER BY created_at DESC',
            [wgId, fiveMinsAgo]
        );
        console.log(`\nNew Agent Chat Messages: ${chatRes.rows.length} entries`);
        chatRes.rows.forEach(c => {
            console.log(`- [${c.created_at.toISOString()}] Role: ${c.role} | Content: ${c.content.substring(0, 50)}...`);
        });

        // 3. Current Blackboard State
        const wgRes = await client.query('SELECT blackboard FROM workgroups WHERE id = $1', [wgId]);
        const bb = wgRes.rows[0]?.blackboard || {};
        console.log(`\nCurrent lastAgentResponse: ${JSON.stringify(bb.lastAgentResponse, null, 2)}`);

    } finally {
        client.release();
        await pool.end();
    }
}

const targetWgId = 69;
verifyActivity(targetWgId);
