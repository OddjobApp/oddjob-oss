/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@shared/schema/index.js";
import { requireTestDatabaseUrl } from "../../../../../tests/configure-test-environment.js";

vi.mock("@server/domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: { get: vi.fn(), set: vi.fn(), on: vi.fn() },
    redisManager: { isReady: () => true },
}));

/**
 * Covers the unknown→known conversion.
 *
 * The decayed S.C.O.R.E. vector is derived from `scoring_events` keyed by
 * prospect id, and `identify()` deletes the anonymous profile once merged. If
 * the contribution history is not moved across first, every pre-identification
 * signal is stranded on a deleted row and the score collapses to zero at the
 * exact moment a visitor becomes known.
 */
describe("prospecting identity merge", () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzle>;
    let orgId: number;
    let propertyId: number;
    const suffix = Date.now();
    const anonUid = `anon_${suffix}`;
    const knownUid = `known_${suffix}`;
    const userId = `user_${suffix}`;
    const createdProfileIds: number[] = [];

    beforeAll(async () => {
        // The outbox is written only while Kafka is enabled; this suite asserts on it.
        vi.stubEnv("KAFKA_ENABLED", "true");
        pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 5 });
        db = drizzle(pool, { schema });

        const [org] = await db.insert(schema.orgs).values({
            name: `Merge Test Org ${suffix}`,
        } as any).returning();
        orgId = org.id;

        const [property] = await db.insert(schema.prospectProperties).values({
            organizationId: orgId,
            uid: `prop_${suffix}`,
            name: "Merge Test Property",
        } as any).returning();
        propertyId = property.id;
    });

    afterAll(async () => {
        vi.unstubAllEnvs();
        if (createdProfileIds.length > 0) {
            await db.delete(schema.scoringEvents).where(inArray(schema.scoringEvents.prospectId, createdProfileIds));
            await db.delete(schema.prospectLeads).where(inArray(schema.prospectLeads.profileId, createdProfileIds));
            await db.delete(schema.prospectProfiles).where(inArray(schema.prospectProfiles.id, createdProfileIds));
        }
        await db.delete(schema.prospectProperties).where(eq(schema.prospectProperties.id, propertyId));
        await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
        await pool.end();
    });

    async function makeProfile(uid: string, withUserId?: string) {
        const [profile] = await db.insert(schema.prospectProfiles).values({
            organizationId: orgId,
            propertyId,
            uid,
            userId: withUserId,
            attributedThemes: [],
            attributedConcepts: [],
        } as any).returning();
        createdProfileIds.push(profile.id);

        await db.insert(schema.prospectLeads).values({
            organizationId: orgId,
            profileId: profile.id,
            bantScore: { S: 0, C: 0, O: 0, R: 0, E: 0 },
        } as any);

        return profile;
    }

    /** Record a scoring contribution the way scoring.service does. */
    async function addContribution(profileId: number, vector: string, increment: number) {
        await db.insert(schema.scoringEvents).values({
            sessionId: `sess_${suffix}`,
            eventType: "rule_match",
            prospectId: profileId,
            actionType: "scoring_increment",
            actionConfig: { ruleName: "test_rule", vector, increment },
            location: "https://example.test/pricing",
        } as any);
    }

    it("moves scoring contributions onto the authenticated profile", async () => {
        const anon = await makeProfile(anonUid);
        const known = await makeProfile(knownUid, userId);

        // Anonymous browsing built up real signal before identification.
        await addContribution(anon.id, "S", 4);
        await addContribution(anon.id, "C", 3);

        const { prospectingService } = await import("../../prospecting.service.js");
        await prospectingService.identify({
            propertyUid: `prop_${suffix}`,
            prospectUid: anonUid,
            userId,
            email: `${userId}@example.test`,
            metadata: {},
        } as any);

        const moved = await db
            .select()
            .from(schema.scoringEvents)
            .where(eq(schema.scoringEvents.prospectId, known.id));

        // Both anonymous contributions must now belong to the known profile.
        expect(moved.length).toBeGreaterThanOrEqual(2);

        const stranded = await db
            .select()
            .from(schema.scoringEvents)
            .where(eq(schema.scoringEvents.prospectId, anon.id));
        expect(stranded).toHaveLength(0);
    });

    it("preserves the pre-identification score rather than resetting it", async () => {
        const { scoringService } = await import("../../scoring.service.js");
        const [known] = await db
            .select()
            .from(schema.prospectProfiles)
            .where(eq(schema.prospectProfiles.uid, knownUid));

        const vector = await scoringService.computeDecayedVector(known.id);

        // Contributions were just written, so decay has barely applied — the
        // signal earned while anonymous must survive the conversion.
        // Prospect scoring is BANT: the seeded "S" and "C" are Budget and Authority.
        expect(vector.values.budget).toBeGreaterThan(0);
        expect(vector.values.authority).toBeGreaterThan(0);
        expect(vector.evidenceCount).toBeGreaterThanOrEqual(2);
    });

    it("deletes the anonymous profile after merging", async () => {
        const remaining = await db
            .select()
            .from(schema.prospectProfiles)
            .where(eq(schema.prospectProfiles.uid, anonUid));
        expect(remaining).toHaveLength(0);
    });

    it("enqueues an identity resolution event to the Kafka transactional outbox", async () => {
        const outboxEvents = await db
            .select()
            .from(schema.kafkaOutboxEvents)
            .where(eq(schema.kafkaOutboxEvents.partitionKey, `prospect:${knownUid}`));
        expect(outboxEvents.length).toBeGreaterThanOrEqual(1);
        const event = outboxEvents[0];
        expect(event.topic).toBe("spatial.signal.v1");
        expect((event.payload as any).payload.eventType).toBe("identity.resolved");
        expect((event.payload as any).payload.provenance.userId).toBe(userId);
    });
});
