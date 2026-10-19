
import 'dotenv/config';
import { db } from "@server/db/index.js";
import { orgSettings } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function enableKG() {
    try {
        const orgId = 5;

        // Check existing settings
        const existing = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, orgId)).limit(1);

        if (existing.length > 0) {
            console.log("Current settings:", existing[0]);

            // Update to enable KG
            await db.update(orgSettings)
                .set({
                    knowledgeGraphEnabled: true,
                    knowledgeStoreEnabled: true
                })
                .where(eq(orgSettings.organizationId, orgId));

            console.log("✅ Updated org settings to enable Knowledge Graph!");
        } else {
            // Create new settings
            await db.insert(orgSettings).values({
                organizationId: orgId,
                knowledgeGraphEnabled: true,
                knowledgeStoreEnabled: true,
            });

            console.log("✅ Created org settings with Knowledge Graph enabled!");
        }

    } catch (err) {
        console.error("Error:", err);
    }
    process.exit(0);
}

enableKG();
