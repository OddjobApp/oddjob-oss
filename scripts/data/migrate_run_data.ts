
import 'dotenv/config';
import { db } from "../../server/db/index.js";
import { pipelineExecutions, knowledgeNodes, knowledgeEdges } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    const runId = 287;
    const targetOrgId = 1; // Default "Acme Corp"

    console.log(`Migrating Run #${runId} and its data to OrgID ${targetOrgId}...`);

    // 1. Update Pipeline Execution
    await db
        .update(pipelineExecutions)
        .set({ organizationId: targetOrgId })
        .where(eq(pipelineExecutions.id, runId));

    console.log("- Updated Pipeline Execution Org.");

    // 2. Update Knowledge Nodes
    await db
        .update(knowledgeNodes)
        .set({ organizationId: targetOrgId })
        .where(eq(knowledgeNodes.pipelineExecutionId, runId));

    console.log("- Updated Knowledge Nodes Org.");

    // 3. Update Knowledge Edges
    await db
        .update(knowledgeEdges)
        .set({ organizationId: targetOrgId })
        .where(eq(knowledgeEdges.lastUpdatedByRunId, runId));

    console.log("- Updated Knowledge Edges Org.");

    console.log("Migration complete.");
    process.exit(0);
}

main().catch(console.error);
