
import { db } from "../server/database_service.js";
import { saasConnectors } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const connectors = await db.select().from(saasConnectors).where(eq(saasConnectors.platform, 'slack'));
    console.log('SLACK CONNECTORS:', JSON.stringify(connectors, null, 2));
    process.exit(0);
}

main().catch(console.error);
