import 'dotenv/config';
import pg from 'pg';

async function fixAllMissingColumns() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('Connecting to database...');
        const client = await pool.connect();
        
        try {
            // 1. Check skills table
            console.log('Checking skills table...');
            const skillsRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'skills'");
            const skillsCols = skillsRes.rows.map(r => r.column_name);
            if (!skillsCols.includes('organization_id')) {
                console.log('Adding organization_id to skills...');
                await client.query('ALTER TABLE skills ADD COLUMN organization_id integer');
            }

            // 2. Check apps table
            console.log('Checking apps table...');
            const appsRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'apps'");
            const appsCols = appsRes.rows.map(r => r.column_name);
            if (!appsCols.includes('reference_asset_ids')) {
                console.log('Adding reference_asset_ids to apps...');
                await client.query('ALTER TABLE apps ADD COLUMN reference_asset_ids integer[] DEFAULT ARRAY[]::integer[]');
            }

            console.log('✅ All surgical fixes applied.');
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error('Error during surgical fix:', err.message);
    } finally {
        await pool.end();
    }
}

fixAllMissingColumns();
