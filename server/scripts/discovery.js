import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function discover() {
    const client = await pool.connect();
    try {
        console.log("--- WORKGROUPS ---");
        const wgs = await client.query('SELECT id, name FROM workgroups ORDER BY id DESC LIMIT 5');
        wgs.rows.forEach(w => console.log(`WG ${w.id}: ${w.name}`));

        console.log("\n--- RECENT MISSIONS ---");
        const ms = await client.query('SELECT id, name, workgroup_id, status FROM missions ORDER BY id DESC LIMIT 10');
        ms.rows.forEach(m => console.log(`Mission ${m.id}: ${m.name} (WG: ${m.workgroup_id}, Status: ${m.status})`));

        console.log("\n--- WG 69 SPECIFIC ---");
        const wg69 = await client.query('SELECT id, name, blackboard FROM workgroups WHERE id = 69');
        if (wg69.rows[0]) {
            console.log(`WG 69 Name: ${wg69.rows[0].name}`);
            console.log(`WG 69 Blackboard Keys: ${Object.keys(wg69.rows[0].blackboard || {})}`);
        } else {
            console.log("WG 69 NOT FOUND");
        }

    } finally {
        client.release();
        await pool.end();
    }
}

discover();
