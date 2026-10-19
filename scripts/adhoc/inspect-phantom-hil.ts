import "dotenv/config";
import { db } from "../../server/database_service.js";
import { approvalRequests } from "../../shared/schema/index.js";
import { sql, inArray, gt, and } from "drizzle-orm";

/**
 * Inspect the suspect tools (think_step, Industrial Forge, resume_mission,
 * ARCHIVE_ASSET) that create approval rows with no decisions and no org.
 * Dump a few samples so we can see what's writing them and what the rows
 * look like.
 */
async function main() {
    const phantomTools = ["think_step", "Industrial Forge", "resume_mission", "ARCHIVE_ASSET"];
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const tool of phantomTools) {
        const rows = await db.select({
            id: approvalRequests.id,
            executionId: approvalRequests.executionId,
            jobId: approvalRequests.jobId,
            status: approvalRequests.status,
            approverType: approvalRequests.approverType,
            approverId: approvalRequests.approverId,
            approverEmail: approvalRequests.approverEmail,
            organizationId: approvalRequests.organizationId,
            missionId: approvalRequests.missionId,
            decisionAt: approvalRequests.decisionAt,
            createdAt: approvalRequests.createdAt,
            comments: approvalRequests.comments,
            modifiedOutput: approvalRequests.modifiedOutput,
        })
            .from(approvalRequests)
            .where(and(
                sql`${approvalRequests.modifiedOutput}->>'tool' = ${tool}`,
                gt(approvalRequests.createdAt, cutoff),
            ))
            .orderBy(sql`${approvalRequests.createdAt} DESC`)
            .limit(3);

        console.log(`\n========== ${tool} (showing ${rows.length} most recent) ==========`);
        for (const r of rows) {
            const mo = (r.modifiedOutput ?? {}) as any;
            console.log(`#${r.id}  status=${r.status}  org=${r.organizationId ?? '-'}  job=${r.jobId ?? '-'}  mission=${r.missionId ?? '-'}`);
            console.log(`  executionId  : ${r.executionId}`);
            console.log(`  approverType : ${r.approverType}  approverId=${r.approverId}  approverEmail=${r.approverEmail}`);
            console.log(`  decisionAt   : ${r.decisionAt?.toISOString() ?? '(none)'}`);
            console.log(`  createdAt    : ${r.createdAt?.toISOString()}`);
            console.log(`  risk         : ${mo?.risk ?? '?'}`);
            console.log(`  goal         : ${(mo?.goal ?? '').slice(0, 120)}`);
            console.log(`  description  : ${(mo?.description ?? '').slice(0, 120)}`);
            console.log(`  moltSessionId: ${mo?.moltSessionId ?? '(none)'}`);
            console.log("");
        }
    }

    // Lifetime stats — are these tools EVER getting decisions?
    console.log("\n========== Lifetime decision rate per phantom tool ==========");
    for (const tool of phantomTools) {
        const all = await db.select({
            status: approvalRequests.status,
            count: sql<number>`count(*)`.mapWith(Number),
        })
            .from(approvalRequests)
            .where(sql`${approvalRequests.modifiedOutput}->>'tool' = ${tool}`)
            .groupBy(approvalRequests.status);
        console.log(`${tool}: ${all.map(a => `${a.status}=${a.count}`).join(', ')}`);
    }

    process.exit(0);
}

main().catch(e => { console.error("[FAIL]", e); process.exit(1); });
