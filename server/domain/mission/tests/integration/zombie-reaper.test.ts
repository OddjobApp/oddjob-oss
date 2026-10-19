/**
 * Zombie Reaper Integration Tests
 *
 * Verifies reapStaleActiveRuns() — the self-healing reaper the rolling-wave
 * concurrency gate uses so an orphaned 'active' run (stale heartbeat, wave job
 * gone) can't hold an org's concurrency slot forever.
 */

/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { missionRuns, orgs } from "@shared/schema/index.js";
import { eq, inArray, sql } from "drizzle-orm";
import { reapStaleActiveRuns } from "@domain/mission/infrastructure/mission-maintenance.js";

// Some test databases are schema-drifted (missionRuns without organization_id).
// This suite exercises org-scoped reaping, so skip cleanly where the column is
// absent rather than fail on unrelated infra drift. Runs fully against a schema
// that matches production (verified live).
const hasOrgColumn = await db
    .execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'mission_runs' AND column_name = 'organization_id' LIMIT 1`)
    .then((r: any) => (r.rowCount ?? r.rows?.length ?? 0) > 0)
    .catch(() => false);

describe.skipIf(!hasOrgColumn)("reapStaleActiveRuns (zombie reaper)", () => {
    let primaryOrg: number;
    let otherOrg: number | undefined;
    const createdIds: number[] = [];

    const mkRun = async (org: number, staleMinutes: number, name: string): Promise<number> => {
        const [r] = await db.insert(missionRuns).values({
            missionId: null,
            organizationId: org,
            name,
            status: "active",
            createdBy: "test_zombie_reaper",
            missionContext: { phase: "PLANNING" },
        } as any).returning({ id: missionRuns.id });
        if (staleMinutes > 0) {
            // Backdate the heartbeat to simulate an orphaned run.
            await db.execute(sql`UPDATE mission_runs SET updated_at = NOW() - make_interval(mins => ${staleMinutes}) WHERE id = ${r.id}`);
        }
        createdIds.push(r.id);
        return r.id;
    };

    const statusOf = async (id: number): Promise<string | undefined> =>
        (await db.select({ s: missionRuns.status }).from(missionRuns).where(eq(missionRuns.id, id)).limit(1))[0]?.s;

    beforeAll(async () => {
        const orgRows = await db.select({ id: orgs.id }).from(orgs).limit(5);
        expect(orgRows.length).toBeGreaterThan(0);
        primaryOrg = orgRows[0].id;
        otherOrg = orgRows.map((o) => o.id).find((id) => id !== primaryOrg);
    });

    afterAll(async () => {
        if (createdIds.length) await db.delete(missionRuns).where(inArray(missionRuns.id, createdIds));
    });

    it("reaps a stale, in-org, below-gate active run and marks the reason", async () => {
        const stale = await mkRun(primaryOrg, 120, "ZOMBIE-stale");
        const gate = stale + 1000;

        const { reapedIds } = await reapStaleActiveRuns({ orgId: primaryOrg, belowRunId: gate, staleMinutes: 30 });

        expect(reapedIds).toContain(stale);
        const [row] = await db.select().from(missionRuns).where(eq(missionRuns.id, stale)).limit(1);
        expect(row.status).toBe("failed");
        expect(row.failureReason).toMatch(/Stale job reaped/i);
    });

    it("spares a fresh run (recent heartbeat) — live long-planning runs are safe", async () => {
        const fresh = await mkRun(primaryOrg, 0, "ZOMBIE-fresh");
        const { reapedIds } = await reapStaleActiveRuns({ orgId: primaryOrg, belowRunId: fresh + 1000, staleMinutes: 30 });
        expect(reapedIds).not.toContain(fresh);
        expect(await statusOf(fresh)).toBe("active");
    });

    it("respects the belowRunId guard — does not reap the gating run or higher ids", async () => {
        const stale = await mkRun(primaryOrg, 120, "ZOMBIE-above-gate");
        // Gate AT the run's own id → it must be excluded (strictly-below only).
        const { reapedIds } = await reapStaleActiveRuns({ orgId: primaryOrg, belowRunId: stale, staleMinutes: 30 });
        expect(reapedIds).not.toContain(stale);
        expect(await statusOf(stale)).toBe("active");
    });

    it("is org-scoped — a stale run in another org is untouched", async () => {
        if (otherOrg == null) return; // single-org environment; nothing to assert
        const staleOther = await mkRun(otherOrg, 120, "ZOMBIE-other-org");
        await reapStaleActiveRuns({ orgId: primaryOrg, belowRunId: staleOther + 1000, staleMinutes: 30 });
        expect(await statusOf(staleOther)).toBe("active");
    });
});
