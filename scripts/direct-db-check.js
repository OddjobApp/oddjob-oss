import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;

async function check() {
    console.log('--- Direct DB Check ---');
    console.log('DATABASE_URL:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@'));

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log('Connected to DB');

        const admin2Res = await client.query("SELECT * FROM users WHERE username = 'admin2'");
        console.log('Admin2 User:', JSON.stringify(admin2Res.rows, null, 2));

        if (admin2Res.rows.length > 0) {
            const rolesRes = await client.query('SELECT * FROM admin_roles WHERE user_id = $1', [admin2Res.rows[0].id]);
            console.log('Admin2 Roles:', JSON.stringify(rolesRes.rows, null, 2));
        } else {
            console.log('User admin2 NOT FOUND');
        }

        const orgsRes = await client.query('SELECT count(*) FROM orgs');
        console.log('Orgs count:', orgsRes.rows[0].count);

    } catch (err) {
        console.error('Connection error:', err.message);
    } finally {
        await client.end();
    }
}

check();
