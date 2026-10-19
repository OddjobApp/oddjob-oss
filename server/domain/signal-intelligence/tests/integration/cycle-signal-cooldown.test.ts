/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@shared/schema/index.js";
import { requireTestDatabaseUrl } from "../../../../../tests/configure-test-environment.js";

// The service imports the dynamic mission queue, which calls getRedisOptions()
// at module load — so the mock must supply it or the import throws before any
// test runs. Spread the original so future exports do not silently vanish.
vi.mock("@domain/core/infrastructure/redis/redis-client.js", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    redis: { get: vi.fn(), set: vi.fn(), on: vi.fn() },
    redisManager: { isReady: () => true },
    getRedisOptions: () => ({ host: "127.0.0.1", port: 6379 }),
}));

/**
 * Cooldown is PER SUBJECT, and that is the whole point of these tests.
 *
 * It used to key on `subscription.lastDeliveredAt` alone, which made it a
 * fleet-wide mute: one vessel's signal silenced every other vessel on the same
 * subscription for the entire window, so a Rotterdam congestion signal could
 * swallow an unrelated Hormuz one. The failure mode is silence, which is the
 * hardest kind to notice.
 *
 * The property tests that previously covered this were written against the old
 * synchronous `lastDeliveredAt` contract and could not be repaired in place —
 * the current implementation is async and reads delivery rows joined to event
 * primitives, so only a real database can exercise it.
 */
describe("cycle signal cooldown (per subject)", () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzle>;
    let service: any;

    let orgId: number;
    let cycleId: number;
    let subscriptionId: number;
    const eventIds: string[] = [];
    const suffix = Date.now();

    /** Build an event primitive row; only `subjectId` varies per test. */
    async function makeEvent(subjectId: string | null): Promise<any> {
        const [row] = await db.insert(schema.eventPrimitives).values({
            organizationId: orgId,
            sourceEntryId: `src_${suffix}_${eventIds.length}`,
            eventType: "policy_change",
            targetSector: "Energy",
            jurisdiction: "US",
            severity: "High",
            sourceUrl: "https://example.test/a",
            extractionTimestamp: new Date(),
            confidenceScore: 0.9,
            contentHash: `hash_${suffix}_${eventIds.length}`,
            subjectId,
        } as any).returning();
        eventIds.push(row.id);
        return row;
    }

    /** Record a delivery at a chosen time, which is what cooldown reads. */
    async function recordDelivery(eventId: string, minutesAgo: number) {
        await db.insert(schema.cycleSignalDeliveries).values({
            organizationId: orgId,
            subscriptionId,
            cycleId,
            eventPrimitiveId: eventId,
            disposition: "context_only",
            deliveredAt: new Date(Date.now() - minutesAgo * 60_000),
        } as any);
    }

    const inCooldown = (cooldownMinutes: number, event: any) =>
        service.inCooldown({ id: subscriptionId, cooldownMinutes } as any, event);

    beforeAll(async () => {
        pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 5 });
        db = drizzle(pool, { schema });

        const [org] = await db.insert(schema.orgs).values({
            name: `Cooldown Test Org ${suffix}`,
        } as any).returning();
        orgId = org.id;

        const [cycle] = await db.insert(schema.operationalCycles).values({
            organizationId: orgId,
            name: `Cooldown Cycle ${suffix}`,
            objective: "cooldown integration",
            createdBy: "test",
        } as any).returning();
        cycleId = cycle.id;

        const [sub] = await db.insert(schema.cycleSignalSubscriptions).values({
            organizationId: orgId,
            cycleId,
            name: `Cooldown Sub ${suffix}`,
            createdBy: "test",
        } as any).returning();
        subscriptionId = sub.id;

        const { cycleSignalSubscriptionService } = await import("../../core/cycle-signal-subscription.service.js");
        service = cycleSignalSubscriptionService;
    });

    afterAll(async () => {
        await db.delete(schema.cycleSignalDeliveries).where(eq(schema.cycleSignalDeliveries.subscriptionId, subscriptionId));
        await db.delete(schema.cycleSignalSubscriptions).where(eq(schema.cycleSignalSubscriptions.id, subscriptionId));
        if (eventIds.length) {
            await db.delete(schema.eventPrimitives).where(inArray(schema.eventPrimitives.id, eventIds));
        }
        await db.delete(schema.operationalCycles).where(eq(schema.operationalCycles.id, cycleId));
        await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
        await pool.end();
    });

    it("is off when cooldown is unconfigured", async () => {
        const event = await makeEvent("vessel-a");
        await recordDelivery(event.id, 1);
        // Zero minutes short-circuits before any query.
        expect(await inCooldown(0, event)).toBe(false);
    });

    it("suppresses a repeat for the SAME subject inside the window", async () => {
        const event = await makeEvent("vessel-b");
        await recordDelivery(event.id, 1);

        const followUp = await makeEvent("vessel-b");
        expect(await inCooldown(10, followUp)).toBe(true);
    });

    it("does NOT suppress a DIFFERENT subject — the fleet-wide mute bug", async () => {
        const rotterdam = await makeEvent("vessel-rotterdam");
        await recordDelivery(rotterdam.id, 1);

        // Unrelated vessel, same subscription, same window. Under the old
        // lastDeliveredAt behaviour this was silenced.
        const hormuz = await makeEvent("vessel-hormuz");
        expect(await inCooldown(10, hormuz)).toBe(false);
    });

    it("releases once the window has passed", async () => {
        const event = await makeEvent("vessel-c");
        await recordDelivery(event.id, 60);

        const followUp = await makeEvent("vessel-c");
        expect(await inCooldown(10, followUp)).toBe(false);
    });

    it("keeps subject-less signals in their own shared bucket", async () => {
        const first = await makeEvent(null);
        await recordDelivery(first.id, 1);

        // Null subject matches null subject — the single-asset-feed behaviour.
        const second = await makeEvent(null);
        expect(await inCooldown(10, second)).toBe(true);

        // ...and must not be silenced by an identified vessel's delivery.
        const identified = await makeEvent("vessel-d");
        expect(await inCooldown(10, identified)).toBe(false);
    });
});
