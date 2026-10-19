import "dotenv/config";
import { db } from "../../server/database_service.js";
import { approvalRequests } from "../../shared/schema/index.js";
import { sql, and, eq, gt } from "drizzle-orm";

/**
 * Audit: distribution of tools flowing through HIL approvals over the
 * last 30 days. Helps decide which tools deserve allow-list auto-approval.
 *
 * For each tool group we report:
 *   - total requests (lifetime if no signal of recent activity)
 *   - currently pending
 *   - approved (signal of low-friction)
 *   - rejected (signal of high-stakes / legitimate gate)
 *   - distinct executions (dedupes the retry storms)
 *   - approval_rate = approved / (approved + rejected)
 *
 * High volume + low rejection rate = good auto-approve candidate.
 * Low volume + high rejection rate = leave alone (genuine human gate).
 */
async function main() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await db.select({
        tool: sql<string>`COALESCE(${approvalRequests.modifiedOutput}->>'tool', 'unknown')`,
        status: approvalRequests.status,
        executionId: approvalRequests.executionId,
        riskLevel: sql<string>`COALESCE(${approvalRequests.modifiedOutput}->>'risk', 'unknown')`,
        organizationId: approvalRequests.organizationId,
    })
        .from(approvalRequests)
        .where(gt(approvalRequests.createdAt, cutoff));

    type Stats = { total: number; pending: number; approved: number; rejected: number; execs: Set<string>; risks: Set<string>; orgs: Set<number> };
    const byTool = new Map<string, Stats>();
    for (const r of rows) {
        const s = byTool.get(r.tool) ?? { total: 0, pending: 0, approved: 0, rejected: 0, execs: new Set(), risks: new Set(), orgs: new Set() };
        s.total++;
        if (r.status === "pending") s.pending++;
        if (r.status === "approved") s.approved++;
        if (r.status === "rejected") s.rejected++;
        s.execs.add(r.executionId);
        s.risks.add(r.riskLevel);
        if (r.organizationId != null) s.orgs.add(r.organizationId);
        byTool.set(r.tool, s);
    }

    const sorted = [...byTool.entries()].sort((a, b) => b[1].total - a[1].total);

    console.log(`\n=== HIL tool frequency (last 30 days, ${rows.length} requests across ${byTool.size} tools) ===\n`);
    console.log("tool".padEnd(40), "total".padStart(7), "pend".padStart(6), "appr".padStart(6), "rejt".padStart(6), "execs".padStart(7), "appr%".padStart(7), "orgs".padStart(5), "risk");
    console.log("-".repeat(110));
    for (const [tool, s] of sorted) {
        const decided = s.approved + s.rejected;
        const apprRate = decided > 0 ? `${Math.round((s.approved / decided) * 100)}%` : "-";
        console.log(
            tool.slice(0, 40).padEnd(40),
            String(s.total).padStart(7),
            String(s.pending).padStart(6),
            String(s.approved).padStart(6),
            String(s.rejected).padStart(6),
            String(s.execs.size).padStart(7),
            apprRate.padStart(7),
            String(s.orgs.size).padStart(5),
            [...s.risks].join(","),
        );
    }
    process.exit(0);
}

main().catch(e => { console.error("[FAIL]", e); process.exit(1); });
