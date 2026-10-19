import 'dotenv/config';
import pg from 'pg';

async function verifyDbState() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('Connecting to database...');
        const client = await pool.connect();
        
        try {
            // 1. Check users table columns
            const usersRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
            const usersCols = usersRes.rows.map(r => r.column_name);
            console.log('Users columns:', usersCols.join(', '));
            
            // 2. Check admin user
            const adminRes = await client.query("SELECT id, username, email FROM users WHERE email = 'admin@example.com'");
            console.log('Admin user found:', adminRes.rows.length > 0 ? 'Yes' : 'No');
            if (adminRes.rows.length > 0) {
                console.log('Admin details:', JSON.stringify(adminRes.rows[0]));
            }

            // 3. Check skills table columns
            const skillsRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'skills'");
            const skillsCols = skillsRes.rows.map(r => r.column_name);
            console.log('Skills columns:', skillsCols.join(', '));

        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error('Error verifying DB state:', err.message);
    } finally {
        await pool.end();
    }
}

verifyDbState();
