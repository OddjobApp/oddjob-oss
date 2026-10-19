// @ts-nocheck

import "dotenv/config";
import { db } from "../../server/database_service.js";
import { credentials } from "@domain/tools/v1/capabilities/system.js";
import { desc } from "drizzle-orm";

async function main() {
    console.log("Listing all credentials...");
    try {
        const creds = await db.select().from(credentials).orderBy(desc(credentials.createdAt));
        console.table(creds.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            envVar: c.envVarName
        })));

        console.log("\nDetails:");
        creds.forEach(c => {
            console.log(`[${c.id}] ${c.name} (${c.type})`);
            if (c.metadata) console.log("Metadata:", JSON.stringify(c.metadata, null, 2));
        });
    } catch (e) {
        console.error("Error listing credentials:", e);
    }
    process.exit(0);
}

main().catch(console.error);
