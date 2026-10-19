
import "dotenv/config";
import { db } from "./server/db/index.js";
import { saasConnectors } from "./shared/schema/index.js";

async function checkConnectors() {
    try {
        console.log("--- SaaS Connectors In Database ---");
        const connectors = await db.select().from(saasConnectors);
        if (connectors.length === 0) {
            console.log("No connectors found in saas_connectors table.");
        } else {
            console.table(connectors.map(c => ({
                id: c.id,
                orgId: c.orgId,
                platform: c.platform,
                status: c.status,
                updatedAt: c.updatedAt
            })));
        }
    } catch (e) {
        console.error("Database check failed:", e);
    }
    process.exit(0);
}

checkConnectors();
