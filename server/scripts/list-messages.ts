import { db } from "../database_service.js";
import { agentRunSteps } from "../../shared/schema/index.js";
import { desc, like } from "drizzle-orm";

async function main() {
    console.log("\n--- LATEST FAILED OBSERVATIONS ---");
    const steps = await db.select()
        .from(agentRunSteps)
        .where(like(agentRunSteps.content, "%Error triggering pipeline%"))
        .orderBy(desc(agentRunSteps.id))
        .limit(5);
    console.log(JSON.stringify(steps.map(s => ({
        id: s.id,
        runId: s.runId,
        type: s.type,
        content: s.content,
        createdAt: s.createdAt
    })), null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
