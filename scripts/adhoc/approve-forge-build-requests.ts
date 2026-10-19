import "dotenv/config";
import { db } from "../../server/database_service.js";
import { approvalRequests } from "../../shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { approvalService } from "../../server/domain/integrations/core/approval.service.js";

/**
 * Bulk-approve pending FORGE_BUILD_CONTAINER requests, deduped by executionId.
 *
 * For each distinct executionId:
 *   - Newest pending row -> approved via approvalService.processDecision
 *     (fires Redis notify + mission resumption + knowledge capture)
 *   - Older pending siblings -> rejected with reason 'superseded'
 *
 * Calls processDecision as userId='1' (system bypass) so the
 * designated-approver check passes.
 *
 * Use the matching find-forge-build-approvals.ts to audit first.
 */
async function main() {
    const rows = await db.select({
        id: approvalRequests.id,
        executionId: approvalRequests.executionId,
        organizationId: approvalRequests.organizationId,
        createdAt: approvalRequests.createdAt,
    })
        .from(approvalRequests)
        .where(and(
            eq(approvalRequests.status, "pending"),
            sql`${approvalRequests.modifiedOutput}->>'tool' = 'FORGE_BUILD_CONTAINER'`,
        ))
        .orderBy(approvalRequests.createdAt);

    if (rows.length === 0) {
        console.log("No pending FORGE_BUILD_CONTAINER approvals. Nothing to do.");
        process.exit(0);
    }

    // Group by executionId; pick newest per group
    const byExec = new Map<string, typeof rows>();
    for (const r of rows) {
        const arr = byExec.get(r.executionId) ?? [];
        arr.push(r);
        byExec.set(r.executionId, arr);
    }

    const winners: number[] = [];
    const losers: number[] = [];
    for (const [, group] of byExec) {
        // Already ordered ASC by createdAt; last is newest
        const newest = group[group.length - 1];
        winners.push(newest.id);
        for (const r of group) if (r.id !== newest.id) losers.push(r.id);
    }

    console.log(`\nGroups: ${byExec.size}`);
    console.log(`Will approve: ${winners.length}  -> ${winners.join(", ")}`);
    console.log(`Will reject as superseded: ${losers.length}  -> ${losers.join(", ")}`);
    console.log("");

    // Approve newest per group
    let approved = 0;
    let approveFailed = 0;
    for (const id of winners) {
        try {
            await approvalService.processDecision(
                id,
                { decision: "approved", comments: "Auto-approved: trusted FORGE_BUILD_CONTAINER batch (admin command)" },
                "1", // system bypass
                "system",
                { isSuperAdmin: true, organizationId: 0 },
            );
            console.log(`  ✓ approved #${id}`);
            approved++;
        } catch (err: any) {
            console.log(`  ✗ approve #${id} failed: ${err.message}`);
            approveFailed++;
        }
    }

    // Reject losers
    let rejected = 0;
    let rejectFailed = 0;
    for (const id of losers) {
        try {
            await approvalService.processDecision(
                id,
                { decision: "rejected", comments: "Superseded by approved sibling (same executionId)" },
                "1",
                "system",
                { isSuperAdmin: true, organizationId: 0 },
            );
            console.log(`  ✓ rejected (superseded) #${id}`);
            rejected++;
        } catch (err: any) {
            console.log(`  ✗ reject #${id} failed: ${err.message}`);
            rejectFailed++;
        }
    }

    console.log(`\nSummary: approved=${approved}/${winners.length}  rejected=${rejected}/${losers.length}  errors=${approveFailed + rejectFailed}`);
    process.exit((approveFailed + rejectFailed) > 0 ? 1 : 0);
}

main().catch(e => { console.error("[FAIL]", e); process.exit(1); });
