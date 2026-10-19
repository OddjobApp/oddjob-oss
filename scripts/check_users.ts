import 'dotenv/config';
import pg from 'pg';

async function checkUsers() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('Connecting with:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@'));

        const countResult = await pool.query('SELECT COUNT(*) FROM users');
        console.log('\nTotal users:', countResult.rows[0].count);

        const adminResult = await pool.query("SELECT id, username, email FROM users WHERE username='admin'");
        console.log('\nAdmin user:', adminResult.rows);

    } catch (err: any) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

checkUsers();
