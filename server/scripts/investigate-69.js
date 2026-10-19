import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function investigate(id) {
    console.log(`--- INVESTIGATING ID: ${id} ---`);
    const client = await pool.connect();
    try {
        // 1. Check if it's a Workgroup
        const wgRes = await client.query('SELECT * FROM workgroups WHERE id = $1', [id]);
        if (wgRes.rows.length > 0) {
            const wg = wgRes.rows[0];
            console.log(`\n[WORKGROUP ${id}] FOUND`);
            console.log(`Name: ${wg.name}`);
            console.log(`Blackboard Keys: ${Object.keys(wg.blackboard || {})}`);

            // Get Missions for this WG
            const missionsRes = await client.query('SELECT * FROM missions WHERE workgroup_id = $1 ORDER BY updated_at DESC', [id]);
            console.log(`\nFound ${missionsRes.rows.length} missions for this workgroup:`);
            missionsRes.rows.forEach(m => {
                console.log(`- Mission ${m.id}: ${m.name} (Status: ${m.status}, Updated: ${m.updated_at})`);
            });
        }

        // 2. Check if it's a Mission ID
        const mRes = await client.query('SELECT * FROM missions WHERE id = $1', [id]);
        if (mRes.rows.length > 0) {
            const m = mRes.rows[0];
            console.log(`\n[MISSION ${id}] FOUND`);
            console.log(`Name: ${m.name}`);
            console.log(`Status: ${m.status}`);
            console.log(`Workgroup ID: ${m.workgroup_id}`);
            console.log(`Mission Context Keys: ${Object.keys(m.mission_context || {})}`);

            // Check Checkpoints in history for this WG
            if (m.workgroup_id) {
                const histRes = await client.query('SELECT * FROM workgroup_blackboard_history WHERE workgroup_id = $1 ORDER BY created_at DESC LIMIT 5', [m.workgroup_id]);
                console.log(`\nRecent Blackboard History for WG ${m.workgroup_id}:`);
                histRes.rows.forEach(h => {
                    console.log(`- ${h.created_at.toISOString()} | By: ${h.changed_by} | Reason: ${h.change_reason}`);
                });

                // Check Agent Chat Messages
                const chatRes = await client.query('SELECT * FROM agent_chat_messages WHERE workgroup_id = $1 ORDER BY created_at DESC LIMIT 5', [m.workgroup_id]);
                console.log(`\nRecent Agent Chat Messages for WG ${m.workgroup_id}:`);
                chatRes.rows.forEach(c => {
                    console.log(`- ${c.created_at.toISOString()} | Role: ${c.role} | Content: ${c.content.substring(0, 50)}...`);
                });
            }
        }

        if (wgRes.rows.length === 0 && mRes.rows.length === 0) {
            console.log(`\nNothing found for ID ${id} in workgroups or missions.`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

const targetId = parseInt(process.argv[2]) || 69;
investigate(targetId);
