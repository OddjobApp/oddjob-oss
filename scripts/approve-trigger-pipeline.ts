/**
 * One-off script: find all pending approval_requests where the tool is
 * 'trigger_pipeline' and set their status to 'approved'.
 *
 * Run from project root with: npx tsx scripts/approve-trigger-pipeline.ts
 */
import { db } from "../server/database_service.js";
import { approvalRequests } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    // Fetch all pending requests
    const pending = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.status, "pending"));

    // Filter to trigger_pipeline — the tool name lives in different places
    // depending on how the request was created:
    //   • r.toolName (direct tool approvals)
    //   • r.modifiedOutput->>'tool' (MOLT/decision-router proposals)
    const pipelineRequests = pending.filter((r: any) => {
        const toolName = r.toolName;
        const outputTool = (r.modifiedOutput as any)?.tool;
        return toolName === "trigger_pipeline" || outputTool === "trigger_pipeline";
    });

    if (pipelineRequests.length === 0) {
        console.log("✅ No pending trigger_pipeline approval requests found.");
        process.exit(0);
    }

    console.log(`Found ${pipelineRequests.length} pending trigger_pipeline approval request(s):`);
    for (const req of pipelineRequests) {
        console.log(`  • ID ${req.id} | jobId=${req.jobId} | created=${req.createdAt}`);
    }

    // Approve them all
    for (const req of pipelineRequests) {
        await db
            .update(approvalRequests)
            .set({
                status: "approved",
                decisionAt: new Date(),
                comments: "Bulk auto-approved: trigger_pipeline is now policy-approved",
            })
            .where(eq(approvalRequests.id, req.id));
        console.log(`  ✅ Approved request ID ${req.id}`);
    }

    console.log(`\nDone — ${pipelineRequests.length} request(s) approved.`);
    process.exit(0);
}

main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
});
