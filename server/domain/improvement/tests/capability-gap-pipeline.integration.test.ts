/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";

import { requireTestDatabaseUrl } from "../../../../tests/configure-test-environment.js";
import * as schema from "@shared/schema/index.js";
import { normalizeCapabilityGaps } from "../core/capability-gap-normalizer.service.js";
import { prioritizeGap } from "../core/capability-gap-prioritizer-v2.service.js";

/**
 * The one thing the unit tests cannot cover: that the chain works against the
 * REAL schema.
 *
 * Everything upstream is pure and already tested with hand-built objects. What
 * that proves nothing about is whether the columns exist, whether Drizzle maps
 * them the way the code assumes, and whether a row written by the emitter reads
 * back as the normalizer expects. A camelCase/snake_case mismatch or a renamed
 * column fails here and nowhere else.
 *
 * Runs against the pinned test database; `requireTestDatabaseUrl` refuses
 * anything that is not one, so this can never touch development data.
 */

describe("capability-gap pipeline against the real schema", () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzle>;
    let orgId: number;
    const runTag = `gap_pipeline_${Date.now()}`;

    beforeAll(async () => {
        pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 3 });
        db = drizzle(pool, { schema });

        const [org] = await db
            .insert(schema.orgs)
            .values({ name: `Gap Pipeline ${Date.now()}`, slug: runTag } as any)
            .returning();
        orgId = (org as any).id ?? (org as any).orgId;

        const occurredAt = new Date("2026-08-20T10:00:00Z");
        await db.insert(schema.capabilityGapEvents).values([
            // Same signature, same run, three times — must count as ONE run.
            { organizationId: orgId, runRef: "execution:1", runRefSource: "execution", actorUserHash: "hash-a",
              requestedToolName: "jira_create_issue", failureClass: "missing", registryHit: false, allotmentHit: false, occurredAt },
            { organizationId: orgId, runRef: "execution:1", runRefSource: "execution", actorUserHash: "hash-a",
              requestedToolName: "jira_create_issue", failureClass: "missing", registryHit: false, allotmentHit: false, occurredAt },
            { organizationId: orgId, runRef: "execution:1", runRefSource: "execution", actorUserHash: "hash-a",
              requestedToolName: "jira_create_issue", failureClass: "missing", registryHit: false, allotmentHit: false, occurredAt },
            // Same signature, a second run and a second user.
            { organizationId: orgId, runRef: "execution:2", runRefSource: "execution", actorUserHash: "hash-b",
              requestedToolName: "jira_create_issue", failureClass: "missing", registryHit: false, allotmentHit: false, occurredAt },
            // A real tool outside the allotment — must NOT become a capability candidate.
            { organizationId: orgId, runRef: "execution:3", runRefSource: "execution", actorUserHash: "hash-c",
              requestedToolName: "file_write", canonicalToolName: "file_write", failureClass: "unavailable",
              registryHit: true, allotmentHit: false, occurredAt },
            // No run identity and no actor — excluded from both counts, reported.
            { organizationId: orgId, runRef: null, runRefSource: null, actorUserHash: null,
              requestedToolName: "jira_create_issue", failureClass: "missing", registryHit: false, allotmentHit: false, occurredAt },
        ] as any);
    }, 60_000);

    afterAll(async () => {
        if (!pool) return;
        await db.delete(schema.capabilityGapEvents).where(eq(schema.capabilityGapEvents.organizationId, orgId));
        await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
        await pool.end();
    }, 30_000);

    async function loadEvents() {
        return db
            .select()
            .from(schema.capabilityGapEvents)
            .where(eq(schema.capabilityGapEvents.organizationId, orgId));
    }

    it("reads back every column the normalizer depends on", async () => {
        const events = await loadEvents();
        expect(events).toHaveLength(6);

        const sample = events.find(e => e.requestedToolName === "file_write")!;
        // Explicitly asserting the mapped names, because a snake_case/camelCase
        // mismatch would silently surface as undefined and score as "unknown".
        expect(sample.failureClass).toBe("unavailable");
        expect(sample.registryHit).toBe(true);
        expect(sample.allotmentHit).toBe(false);
        expect(sample.canonicalToolName).toBe("file_write");
        expect(sample.runRefSource).toBe("execution");
        expect(sample.occurredAt).toBeInstanceOf(Date);
    });

    it("deduplicates by run, not by event", async () => {
        const report = normalizeCapabilityGaps(await loadEvents());
        const jira = report.capabilityGaps.find(g => g.signature.targetSystem === "jira")!;

        expect(jira.eventCount).toBe(5);        // 3 + 1 + 1 unattributed
        expect(jira.uniqueAffectedRuns).toBe(2); // execution:1 and execution:2
        expect(jira.uniqueAffectedUsers).toBe(2);
        expect(jira.eventsWithoutRunIdentity).toBe(1);
        expect(jira.eventsWithoutActor).toBe(1);
    });

    it("keeps the allotment gap out of capability candidates", async () => {
        const report = normalizeCapabilityGaps(await loadEvents());
        expect(report.capabilityGaps.map(g => g.signature.intendedOutcome)).not.toContain("file_write");
        expect(report.allotmentGaps).toHaveLength(1);
        expect(report.allotmentGaps[0].signature.intendedOutcome).toBe("file_write");
    });

    it("produces a provisional score with the missing terms named", async () => {
        const report = normalizeCapabilityGaps(await loadEvents());
        const jira = report.capabilityGaps.find(g => g.signature.targetSystem === "jira")!;

        const scored = prioritizeGap(jira, { status: "available", maxScore: 0.1 }, { riskReviewed: true });
        expect(scored.scoreState).toBe("provisional");
        expect(scored.score).not.toBeNull();
        expect(scored.outstanding).toEqual(
            expect.arrayContaining(["workaround_cost_score", "strategic_score"]),
        );
    });

    it("withholds when the duplicate check could not run", async () => {
        const report = normalizeCapabilityGaps(await loadEvents());
        const jira = report.capabilityGaps.find(g => g.signature.targetSystem === "jira")!;

        const scored = prioritizeGap(jira, { status: "unavailable" }, { riskReviewed: true });
        expect(scored.scoreState).toBe("withheld");
        expect(scored.score).toBeNull();
    });

    it("scopes reads to the organization", async () => {
        const other = await db
            .select()
            .from(schema.capabilityGapEvents)
            .where(and(
                eq(schema.capabilityGapEvents.organizationId, orgId + 999_999),
            ));
        expect(other).toHaveLength(0);
    });
});
