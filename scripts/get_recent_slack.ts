import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import pg from 'pg';

async function getRecentSlackMessage() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const res = await pool.query("SELECT credentials FROM saas_connectors WHERE platform = 'slack' AND status = 'connected' LIMIT 1");
        if (res.rows.length === 0) return;

        const botToken = res.rows[0].credentials.bot_token;
        const client = new WebClient(botToken);

        const channelId = 'C0AE7431ARG'; // #all-oddjob
        console.log(`Fetching history for #${channelId}...`);
        
        const history = await client.conversations.history({
            channel: channelId,
            limit: 5
        });

        const messages = history.messages || [];
        if (messages.length > 0) {
            console.log('\n--- Recent Messages ---');
            for (const msg of messages) {
                const time = new Date(parseFloat(msg.ts as string) * 1000).toLocaleString();
                console.log(`[${time}] ${msg.user || 'System'}: ${msg.text}`);
            }
        } else {
            console.log('No messages found.');
        }

    } catch (err: any) {
        console.error('❌ Error:', err.message);
    } finally {
        await pool.end();
    }
}

getRecentSlackMessage();
