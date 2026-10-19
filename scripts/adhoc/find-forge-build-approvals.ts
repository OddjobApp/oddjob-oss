import "dotenv/config";
import { db } from "../../server/database_service.js";
import { approvalRequests } from "../../shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";

/**
 * Read-only audit: list pending approval requests whose modified_output.tool
 * equals 'FORGE_BUILD_CONTAINER'. No mutation — see approve-forge-build-requests.ts
 * for the matching approve script.
 */
async function main() {
    const rows = await db.select({
        id: approvalRequests.id,
        executionId: approvalRequests.executionId,
        jobId: approvalRequests.jobId,
        organizationId: approvalRequests.organizationId,
        missionId: approvalRequests.missionId,
        approverEmail: approvalRequests.approverEmail,
        createdAt: approvalRequests.createdAt,
        modifiedOutput: approvalRequests.modifiedOutput,
    })
        .from(approvalRequests)
        .where(and(
            eq(approvalRequests.status, "pending"),
            sql`${approvalRequests.modifiedOutput}->>'tool' = 'FORGE_BUILD_CONTAINER'`,
        ))
        .orderBy(approvalRequests.createdAt);

    console.log(`\n=== Pending FORGE_BUILD_CONTAINER approvals: ${rows.length} ===\n`);
    for (const r of rows) {
        const mo = (r.modifiedOutput ?? {}) as any;
        console.log(`#${r.id}  org=${r.organizationId ?? '-'}  job=${r.jobId ?? '-'}  exec=${r.executionId}`);
        console.log(`        slug=${mo?.params?.slug ?? '?'}  risk=${mo?.risk ?? '?'}  created=${r.createdAt?.toISOString() ?? '?'}`);
        console.log(`        approver=${r.approverEmail}`);
        console.log(`        goal=${(mo?.goal ?? '').slice(0, 100)}`);
        console.log("");
    }
    // Group counts so the user can spot anomalies (many for one org, etc).
    const byOrg = new Map<number | string, number>();
    for (const r of rows) {
        const k = r.organizationId ?? 'unknown';
        byOrg.set(k, (byOrg.get(k) ?? 0) + 1);
    }
    console.log(`Per-org breakdown:`);
    for (const [org, count] of [...byOrg.entries()].sort()) {
        console.log(`  org ${org}: ${count}`);
    }
    process.exit(0);
}

main().catch(e => { console.error("[FAIL]", e); process.exit(1); });
