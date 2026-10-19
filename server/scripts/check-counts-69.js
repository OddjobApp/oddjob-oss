import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function checkCounts(wgId) {
    const client = await pool.connect();
    try {
        const hist = await client.query('SELECT COUNT(*) FROM workgroup_blackboard_history WHERE workgroup_id = $1', [wgId]);
        const chat = await client.query('SELECT COUNT(*) FROM agent_chat_messages WHERE workgroup_id = $1', [wgId]);
        const mission = await client.query('SELECT id, status, pipeline_execution_id FROM missions WHERE workgroup_id = $1', [wgId]);

        console.log(`WG ${wgId} Counts:`);
        console.log(`- Blackboard History: ${hist.rows[0].count}`);
        console.log(`- Agent Chat Messages: ${chat.rows[0].count}`);
        console.log(`- Missions: ${mission.rows.length}`);
        mission.rows.forEach(m => {
            console.log(`  - Mission ${m.id}: Status=${m.status}, Pipeline=${m.pipeline_execution_id}`);
        });
    } finally {
        client.release();
        await pool.end();
    }
}

checkCounts(69);
