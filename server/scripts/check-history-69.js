import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function checkHistory(wgId) {
    const client = await pool.connect();
    try {
        const histRes = await client.query('SELECT * FROM workgroup_blackboard_history WHERE workgroup_id = $1 ORDER BY created_at DESC', [wgId]);
        console.log(`--- WG ${wgId} HISTORY (${histRes.rows.length} items) ---`);
        histRes.rows.forEach(h => {
            console.log(`ID: ${h.id} | Date: ${h.created_at.toISOString()} | By: ${h.changed_by} | Reason: ${h.change_reason}`);
            // console.log(`Content: ${JSON.stringify(h.blackboard).substring(0, 100)}...`);
        });

        const missionsRes = await client.query('SELECT id, name, status FROM missions WHERE workgroup_id = $1', [wgId]);
        console.log(`\n--- MISSIONS for WG ${wgId} ---`);
        missionsRes.rows.forEach(m => console.log(`ID: ${m.id} | Name: ${m.name} | Status: ${m.status}`));

    } finally {
        client.release();
        await pool.end();
    }
}

checkHistory(69);
