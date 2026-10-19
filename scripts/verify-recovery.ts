// @ts-nocheck
import { db } from "../server/db/index.js";
import { missionRuns, agentDeployments } from "../shared/schema/index.js";
import { desc, eq, and } from "drizzle-orm";

async function verifyRecovery() {
    console.log("--- System Recovery Verification ---");

    // 1. Check Mission Runs
    const runs = await db.select().from(missionRuns).orderBy(desc(missionRuns.id)).limit(10);
    console.log(`\nLatest 10 Mission Runs:`);
    runs.forEach(r => {
        console.log(`  ID: ${r.id} | Status: ${r.status} | Job: ${r.jobId} | Updated: ${r.updatedAt}`);
    });

    // 2. Check Agent 81 specifically (Job 81)
    const [agent81] = await db.select().from(agentDeployments).where(eq(agentDeployments.slug, 'agent-81')).limit(1);
    if (agent81) {
       console.log(`\nAgent 81 Traits: ${JSON.stringify(agent81.personalityTraits)}`);
    }

    // 3. Check for any recent Soul Evolution events
    const { events } = await import("../shared/schema/index.js");
    const evolutionEvents = await db.select().from(events)
        .where(eq(events.type, 'soul_evolution'))
        .orderBy(desc(events.createdAt))
        .limit(5);
    
    console.log(`\nRecent Soul Evolution Events: ${evolutionEvents.length}`);
    evolutionEvents.forEach(e => {
        console.log(`  Event: ${e.id} | Context: ${JSON.stringify(e.context)} | Created: ${e.createdAt}`);
    });

    process.exit(0);
}

verifyRecovery().catch(err => {
    console.error(err);
    process.exit(1);
});
