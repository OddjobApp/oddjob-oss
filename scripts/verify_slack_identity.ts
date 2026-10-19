import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import pg from 'pg';

async function verifyAppId() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const res = await pool.query("SELECT credentials FROM saas_connectors WHERE platform = 'slack' AND status = 'connected' LIMIT 1");
        if (res.rows.length === 0) return;

        const botToken = res.rows[0].credentials.bot_token;
        const client = new WebClient(botToken);

        console.log('Verifying App Identity...');
        
        // auth.test gives us the user_id and bot_id
        const auth = await client.auth.test();
        console.log(`Bot User ID: ${auth.user_id}`);
        console.log(`Bot ID: ${auth.bot_id}`);
        
        // Try to get app info if possible
        // Note: Many apps don't have permission for this, but we can try
        try {
            const teamInfo = await client.team.info();
            console.log(`Team Name: ${teamInfo.team?.name}`);
            console.log(`Team Domain: ${teamInfo.team?.domain}.slack.com`);
        } catch (e) {
            console.log('Could not fetch team info.');
        }

    } catch (err: any) {
        console.error('❌ Error:', err.message);
    } finally {
        await pool.end();
    }
}

verifyAppId();
