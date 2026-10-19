
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function fix() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    try {
        const client = await pool.connect();
        try {
            // Find a supervisor-type pipeline or just the default supervisor
            // Assuming entity_type 'pipeline' and entity_id 1 is the supervisor for now
            // or we check 'pipelines' table
            const pRes = await client.query("SELECT id FROM pipelines WHERE name LIKE '%Supervisor%' LIMIT 1;");
            const supervisorId = pRes.rows[0]?.id;

            if (!supervisorId) {
                console.error("Could not find Supervisor pipeline ID");
                return;
            }

            console.log(`Found Supervisor pipeline ID: ${supervisorId}`);

            await client.query(`
                INSERT INTO mission_members (mission_id, entity_type, entity_id, role, status)
                VALUES (68, 'pipeline', $1, 'primary_strategist', 'active')
                ON CONFLICT DO NOTHING;
            `, [supervisorId]);

            console.log("Supervisor added to Mission 68");
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error("Database error:", err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

fix();

