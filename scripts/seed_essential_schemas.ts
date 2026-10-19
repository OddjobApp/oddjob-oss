import "dotenv/config";
import { db } from "../server/db/index.js";
import { graphSchemaDefs, orgs } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";

async function main() {
    console.log("Seeding essential graph schemas...");

    // Seed Global Schema (organizationId: null)
    const globalExisting = await db.select().from(graphSchemaDefs).where(sql`${graphSchemaDefs.name} = 'General Knowledge' AND ${graphSchemaDefs.organizationId} IS NULL`).limit(1);

    if (globalExisting.length === 0) {
        console.log("Creating Global 'General Knowledge' schema...");
        await db.insert(graphSchemaDefs).values({
            name: "General Knowledge",
            description: "Standard schema for general purpose entity extraction (Global)",
            mappings: [],
            organizationId: null,
            createdBy: "system"
        });
        console.log("✅ Global 'General Knowledge' schema created.");
    } else {
        console.log("Global 'General Knowledge' schema already exists.");
    }

    // Also ensure org-specific one exists for Acme Corp if it's the default
    const [firstOrg] = await db.select().from(orgs).limit(1);
    if (firstOrg) {
        const orgExisting = await db.select().from(graphSchemaDefs).where(sql`${graphSchemaDefs.name} = 'General Knowledge' AND ${graphSchemaDefs.organizationId} = ${firstOrg.id}`).limit(1);
        if (orgExisting.length === 0) {
            console.log(`Creating 'General Knowledge' schema for org ${firstOrg.id}...`);
            await db.insert(graphSchemaDefs).values({
                name: "General Knowledge",
                description: "Standard schema for general purpose entity extraction",
                mappings: [],
                organizationId: firstOrg.id,
                createdBy: "system"
            });
            console.log("✅ Org-specific 'General Knowledge' schema created.");
        }
    }

    process.exit(0);
}

main().catch(console.error);
