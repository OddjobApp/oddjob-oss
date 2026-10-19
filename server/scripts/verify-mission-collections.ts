
import "dotenv/config";
import { missionService } from "@domain/mission/core/mission.service.js";
import { db } from "@server/database_service.js";
import { orgs, jobs, jobCollections, jobCollectionItems } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function verify() {
    console.log("--- Starting Mission Collections Verification ---");

    const uniqueId = Math.random().toString(36).substring(7);
    const orgName = `Collections Test Org ${uniqueId}`;
    const missionName = `Test Mission ${uniqueId}`;

    // 1. Setup mock org
    const [org] = await db.insert(orgs).values({
        name: orgName,
    }).returning();

    // 2. Setup mock jobs
    console.log("Creating mock agents...");
    const [agent1] = await db.insert(jobs).values({
        name: `Agent 1 ${uniqueId}`,
        type: "ai_agent",
        tool: "google_search",
        organizationId: org.id,
        createdBy: "system",
        config: {}
    }).returning() as any[];

    const [agent2] = await db.insert(jobs).values({
        name: `Agent 2 ${uniqueId}`,
        type: "ai_agent",
        tool: "python",
        organizationId: org.id,
        createdBy: "system",
        config: {}
    }).returning() as any[];

    // 3. Create Mission
    console.log(`Creating mission: ${missionName}...`);
    const mission = await (missionService as any).createMission({
        name: missionName,
        objective: "Test automatic collection creation with tools.",
        organizationId: org.id,
        createdBy: "system",
    } as any, [
        { entityType: "job", entityId: agent1.id, role: "Researcher" },
        { entityType: "job", entityId: agent2.id, role: "Analyst" }
    ] as any);

    // 4. Verify Collection
    console.log("Verifying Activity Collection...");
    const [collection] = await db.select()
        .from(jobCollections)
        .where(and(
            eq(jobCollections.name, missionName),
            eq(jobCollections.organizationId, org.id)
        ))
        .limit(1);

    if (!collection) {
        console.error("FAILED: No collection created with mission name");
    } else {
        console.log(`SUCCESS: Collection created: ${collection.name}`);
        console.log(`Description: ${collection.description}`);

        if (collection.description?.includes("google_search") && collection.description?.includes("python")) {
            console.log("SUCCESS: Capabilities correctly summarized in description");
        } else {
            console.warn("WARNING: Capabilities missing from description");
        }

        const items = await db.select().from(jobCollectionItems).where(eq(jobCollectionItems.collectionId, collection.id));
        const itemJobIds = items.map(i => i.jobId);

        if (itemJobIds.includes(agent1.id) && itemJobIds.includes(agent2.id)) {
            console.log("SUCCESS: Collection contains both agents");
        } else {
            console.error(`FAILED: Collection items mismatch. Expected [${agent1.id}, ${agent2.id}], got [${itemJobIds.join(", ")}]`);
        }
    }

    console.log("\n--- Verification Complete ---");
    process.exit(0);
}

verify();

