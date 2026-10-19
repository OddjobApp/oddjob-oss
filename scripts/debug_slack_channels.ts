import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import pg from 'pg';

async function debugSlackChannels() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const res = await pool.query("SELECT credentials FROM saas_connectors WHERE platform = 'slack' AND status = 'connected' LIMIT 1");
        if (res.rows.length === 0) {
            console.error('❌ No Slack connector.');
            return;
        }

        const botToken = res.rows[0].credentials.bot_token;
        const client = new WebClient(botToken);

        console.log('--- Slack Debug Info ---');
        const auth = await client.auth.test();
        console.log(`Bot ID: ${auth.bot_id}`);
        console.log(`User: ${auth.user}`);
        console.log(`Team: ${auth.team} (ID: ${auth.team_id})`);

        console.log('\nFetching Channels bot is IN...');
        const channelsRes = await client.conversations.list({ 
            types: 'public_channel,private_channel', 
            limit: 100 
        });
        
        const channels = channelsRes.channels || [];
        for (const channel of channels) {
            console.log(`- #${channel.name} (${channel.id}) [is_member: ${channel.is_member}, num_members: ${channel.num_members}]`);
        }

    } catch (err: any) {
        console.error('❌ Error:', err.message);
    } finally {
        await pool.end();
    }
}

debugSlackChannels();
