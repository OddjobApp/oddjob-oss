
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ override: true });

async function inspect() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    
    try {
        console.log('--- mission_runs columns ---');
        const runs = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'mission_runs'
        `);
        console.table(runs.rows);

        console.log('--- admin_roles columns ---');
        const roles = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'admin_roles'
        `);
        console.table(roles.rows);
    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

inspect();
