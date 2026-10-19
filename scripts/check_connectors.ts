
import { db } from "../server/database_service.js";
import { saasConnectors } from "../shared/schema/index.js";

async function main() {
    const connectors = await db.select().from(saasConnectors);
    console.log('CONNECTORS:', JSON.stringify(connectors, null, 2));
    process.exit(0);
}

main().catch(console.error);
