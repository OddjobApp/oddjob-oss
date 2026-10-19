import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import pg from 'pg';

async function sendSlackDM() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const res = await pool.query("SELECT credentials FROM saas_connectors WHERE platform = 'slack' AND status = 'connected' LIMIT 1");
        if (res.rows.length === 0) return;

        const botToken = res.rows[0].credentials.bot_token;
        const client = new WebClient(botToken);

        console.log('Fetching users...');
        const usersRes = await client.users.list({ limit: 20 });
        const users = (usersRes.members || []).filter(u => !u.is_bot && u.name !== 'slackbot');

        console.log('Human users found:');
        for (const user of users) {
            console.log(`- ${user.real_name} (@${user.name}) [ID: ${user.id}]`);
        }

        if (users.length > 0) {
            const targetUser = users[0];
            console.log(`\nSending DM to ${targetUser.real_name} (${targetUser.id})...`);
            
            if (targetUser.id) {
                await client.chat.postMessage({
                    channel: targetUser.id,
                    text: "?? **Oddjob Direct Verification**\n\nI am sending this DM to verify our connection. If you see this, the conversational bridge is working perfectly!",
                    blocks: [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "?? **Oddjob Direct Verification**\n\nI am sending this DM to verify our connection. The Socket Mode link is active and I'm ready for commands."
                            }
                        }
                    ]
                });
                console.log('✅ DM sent successfully!');
            } else {
                console.error('❌ Target user has no ID.');
            }
        } else {
            console.error('❌ No human users found to DM.');
        }

    } catch (err: any) {
        console.error('❌ Error:', err.message);
    } finally {
        await pool.end();
    }
}

sendSlackDM();
