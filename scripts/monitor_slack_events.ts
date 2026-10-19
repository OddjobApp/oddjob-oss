import 'dotenv/config';
import { SocketModeClient } from '@slack/socket-mode';
import { createLogger } from '../server/utils/logger.js';

const logger = createLogger("SlackMonitor");

async function monitorSlack() {
    const appToken = process.env.SLACK_APP_TOKEN;
    if (!appToken) {
        console.error('❌ SLACK_APP_TOKEN missing in .env');
        return;
    }

    console.log('Starting Slack Socket Mode Monitor...');
    const socketClient = new SocketModeClient({ appToken });

    socketClient.on('app_mention', async ({ event, ack }) => {
        await ack();
        console.log(`\n[EVENT] app_mention: From ${event.user} in ${event.channel}`);
        console.log(`Text: "${event.text}"`);
    });

    socketClient.on('message', async ({ event, ack }) => {
        await ack();
        console.log(`\n[EVENT] message: From ${event.user} in ${event.channel} (${event.channel_type})`);
        console.log(`Text: "${event.text}"`);
    });

    await socketClient.start();
    console.log('✅ Monitor ACTIVE. Waiting for events... (Press Ctrl+C to stop)');
}

monitorSlack();
