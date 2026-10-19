import 'dotenv/config';
import { taggingService } from "@domain/knowledge/core/tagging-service.js";
import { conceptService } from "@domain/knowledge/core/graph/concept-service.js";
import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Starting Final Graph Restoration...");
    const orgContext = { organizationId: 1, isAdmin: true, isOrgAdmin: true } as any;

    console.log("1. Discovering Top Topics...");
    try {
        const discovery = await taggingService.discoverTopTopics(orgContext);
        console.log("Discovery Result:", discovery);
    } catch (e) {
        console.error("Discovery Failed", e);
    }

    console.log("2. Auto-tagging All Documents...");
    try {
        await taggingService.autoTagAllDocuments(orgContext);
        console.log("Auto-tagging Complete.");
    } catch (e) {
        console.error("Auto-tagging Failed", e);
    }

    console.log("3. Auto-linking Topics to Concepts...");
    try {
        // We will call the underlying service method but wrap it or just use the service
        // Since we want to see what's happening, let's look at the implementation of autoLinkTopicsToConcepts
        const result = await conceptService.autoLinkTopicsToConcepts(orgContext);
        console.log("Auto-linkage Complete.");

        // Verify links now
        const links = await db.execute(sql`SELECT count(*) FROM knowledge_topic_concepts`);
        console.log("Verified Links in DB:", links.rows[0]);
    } catch (e) {
        console.error("Auto-linkage Failed", e);
    }

    console.log("Restoration Complete.");
    process.exit(0);
}

main();

