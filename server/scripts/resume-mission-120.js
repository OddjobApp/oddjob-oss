import "dotenv/config";
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function resume() {
    const client = await pool.connect();
    try {
        const wgId = 69;
        const missionId = 120;
        const message = "Status check. Please proceed with the next step.";

        console.log(`--- Resuming Mission ${missionId} via Guidance ---`);

        // 1. Update Blackboard with new guidance (simulating AgentService.chat)
        await client.query(`
        UPDATE workgroup_blackboard_history 
        SET blackboard = jsonb_set(
            COALESCE(blackboard, '{}'::jsonb), 
            '{lastUserGuidance}', 
            $1
        )
        WHERE workgroup_id = $2
    `, [JSON.stringify({ content: message, timestamp: new Date().toISOString() }), wgId]);

        // 2. Also insert into agent_chat_messages to be realistic
        const userId = "56c39562-0219-4c5d-8446-3d8c188eab26";
        await client.query(`
        INSERT INTO agent_chat_messages (workgroup_id, role, content, created_at, user_id)
        VALUES ($1, 'user', $2, NOW(), $3)
    `, [wgId, message, userId]);

        console.log("Guidance injected. Monitoring for response...");

    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

resume();
