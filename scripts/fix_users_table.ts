import 'dotenv/config';
import pg from 'pg';

async function fixUsersTable() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('Connecting to database...');
        const client = await pool.connect();
        
        try {
            console.log('Checking for missing columns in users table...');
            const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
            const existingColumns = res.rows.map(r => r.column_name);
            
            if (!existingColumns.includes('slack_handle')) {
                console.log('Adding slack_handle column to users table...');
                await client.query('ALTER TABLE users ADD COLUMN slack_handle text');
                console.log('Successfully added slack_handle column.');
            } else {
                console.log('slack_handle column already exists.');
            }

            // Check if any other columns are missing from the schema definition
            // Schema has: id, username, password, email, first_name, last_name, default_org_id, 
            // quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, 
            // alert_filters, slack_handle, privacy_policy_accepted, privacy_policy_version, 
            // tos_accepted, tos_version, legal_accepted_at
            
            const schemaColumns = [
                'id', 'username', 'password', 'email', 'first_name', 'last_name', 'default_org_id',
                'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end', 'quiet_hours_timezone',
                'alert_filters', 'slack_handle', 'privacy_policy_accepted', 'privacy_policy_version',
                'tos_accepted', 'tos_version', 'legal_accepted_at'
            ];

            for (const col of schemaColumns) {
                if (!existingColumns.includes(col) && col !== 'slack_handle') {
                    console.log(`Warning: Column ${col} is in schema but missing in DB!`);
                    // We could add it here if needed, but let's see if there are any others.
                }
            }

        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error('Error fixing users table:', err.message);
    } finally {
        await pool.end();
    }
}

fixUsersTable();
