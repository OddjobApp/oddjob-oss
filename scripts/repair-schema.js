
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ override: true });

async function repair() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    
    try {
        console.log('--- Applying surgical repairs ---');
        
        // 1. Add cost_usd to mission_runs
        console.log('Adding cost_usd to mission_runs...');
        await client.query(`
            ALTER TABLE mission_runs 
            ADD COLUMN IF NOT EXISTS cost_usd numeric(10, 4) DEFAULT '0';
        `);
        
        // 2. Add other missing columns detected if any (surgical list)
        // Note: Based on inspection, mission_runs is mostly okay except cost_usd.
        
        console.log('✅ Surgical repairs completed.');
    } catch (err) {
        console.error('❌ Repair failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

repair();
