
import { SocketModeClient } from "@slack/socket-mode";
import { LogLevel } from "@slack/logger";
import { db } from "../server/database_service.js";
import { saasConnectors } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Starting Debug Slack Socket Listener...");
    
    const [connector] = await db.select().from(saasConnectors).where(eq(saasConnectors.id, 4)).limit(1);
    if (!connector) throw new Error("Connector 4 not found");
    
    const creds = connector.credentials as any;
    const appToken = creds.app_token;
    
    console.log(`Connecting with App Token: ${appToken.substring(0, 10)}...`);
    
    const socketClient = new SocketModeClient({ 
        appToken,
        logLevel: LogLevel.DEBUG
    });

    socketClient.on('app_mention', async ({ event, ack }) => {
        await ack();
        console.log('EVENT [app_mention]:', JSON.stringify(event, null, 2));
    });

    socketClient.on('message', async ({ event, ack }) => {
        await ack();
        console.log('EVENT [message]:', JSON.stringify(event, null, 2));
    });

    socketClient.on('connecting', () => console.log('Connecting...'));
    socketClient.on('connected', () => console.log('Connected!'));
    socketClient.on('authenticated', (auth) => console.log('Authenticated:', JSON.stringify(auth, null, 2)));
    socketClient.on('error', (err) => console.error('Error:', err));

    await socketClient.start();
    console.log("Waiting for events...");
}

main().catch(console.error);
