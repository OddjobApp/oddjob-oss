import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import pg from 'pg';

async function joinAndPost() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const res = await pool.query("SELECT credentials FROM saas_connectors WHERE platform = 'slack' AND status = 'connected' LIMIT 1");
        if (res.rows.length === 0) return;

        const botToken = res.rows[0].credentials.bot_token;
        const client = new WebClient(botToken);

        const channelId = 'C0AE7431ARG'; // #all-oddjob
        console.log(`Attempting to join #${channelId}...`);
        
        try {
            await client.conversations.join({ channel: channelId });
            console.log('Joined successfully.');
        } catch (err: any) {
            console.warn('Could not join (might already be in or private):', err.message);
        }

        console.log(`Posting to #${channelId}...`);
        await client.chat.postMessage({
            channel: channelId,
            text: "?? **Oddjob Broadcast Verification**\n\nI am verifying my connection to this channel. Please reply if you see this!"
        });
        console.log('✅ Message posted successfully!');

    } catch (err: any) {
        console.error('❌ Error:', err.message);
    } finally {
        await pool.end();
    }
}

joinAndPost();
