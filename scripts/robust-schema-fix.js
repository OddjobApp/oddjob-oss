
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const { Pool } = pg;

async function applyFix() {
    if (!process.env.DATABASE_URL) {
        console.error("❌ DATABASE_URL not found in environment");
        return;
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    console.log("🛠️ Applying manual schema fix...");
    try {
        const client = await pool.connect();
        try {
            console.log("Adding public_token to rescue_sessions...");
            await client.query('ALTER TABLE rescue_sessions ADD COLUMN IF NOT EXISTS public_token text UNIQUE;');
            console.log("✅ Fixes applied successfully!");
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("❌ Error applying fix:", error);
    } finally {
        await pool.end();
    }
}

applyFix();
