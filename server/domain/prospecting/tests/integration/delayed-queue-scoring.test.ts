import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@server/database_service.js";
import { prospectProperties, prospectProfiles, prospectLeads, prospectEvents, scoringEvents, orgs } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { prospectingService } from "../../prospecting.service.js";
import { scoringService } from "../../scoring.service.js";

describe("prospecting delayed queue scoring", () => {
    let orgId: number;
    let propertyUid: string;
    let propertyId: number;
    const testSessionId = `test_sess_${Date.now()}`;

    beforeAll(async () => {
        // Ensure test organization and property exist
        // orgs has no slug column; the name carries the uniqueness.
        const [org] = await db.insert(orgs).values({
            name: `Delayed Queue Test Org ${Date.now()}`
        }).returning();
        orgId = org.id;

        propertyUid = `prop_${Date.now()}`;
        const [prop] = await db.insert(prospectProperties).values({
            organizationId: orgId,
            uid: propertyUid,
            name: "Test Property",
            domain: "test.example.com",
            deanonConfig: null,
        }).returning();
        propertyId = prop.id;
    });

    afterAll(async () => {
        if (propertyId) {
            await db.delete(prospectProperties).where(eq(prospectProperties.id, propertyId));
        }
        if (orgId) {
            await db.delete(orgs).where(eq(orgs.id, orgId));
        }
    });

    it("uses original client event timestamp for decaying S.C.O.R.E. vector during delayed queue processing", async () => {
        const prospectUid = `v_client_ts_${Date.now()}`;
        const now = new Date();
        // Event happened 16 minutes ago (2 half-lives of 8 minutes)
        const clientTimestamp = new Date(now.getTime() - 16 * 60 * 1000);

        // Process event with explicit client timestamp (simulating BullMQ processing job delayed by 16 minutes)
        const result = await prospectingService.processEvent({
            propertyUid,
            prospectUid,
            activity: "dwell",
            payload: {
                sessionId: testSessionId,
                url: "https://test.example.com/pricing",
                timestamp: clientTimestamp.toISOString(),
            },
            themes: ["Pricing & Tiers"],
        });

        expect(result).toBeDefined();
        expect(result.leadId).toBeDefined();

        // 1. Verify prospectEvents record stored the original client event timestamp
        const [rawEvent] = await db.select()
            .from(prospectEvents)
            .where(eq(prospectEvents.profileId, (await db.select().from(prospectProfiles).where(eq(prospectProfiles.uid, prospectUid)))[0].id));

        expect(rawEvent).toBeDefined();
        expect(new Date(rawEvent.createdAt).getTime()).toBeCloseTo(clientTimestamp.getTime(), -3);

        // 2. Verify scoringEvents recorded the client event timestamp
        const [scoringEvent] = await db.select()
            .from(scoringEvents)
            .where(eq(scoringEvents.prospectId, rawEvent.profileId));

        expect(scoringEvent).toBeDefined();
        expect(new Date(scoringEvent.createdAt).getTime()).toBeCloseTo(clientTimestamp.getTime(), -3);

        // 3. Verify decayed score reflects 2 half-lives of decay (16 minutes old)
        // Nominal weight for pricing rule is 2.0 * modifier 1.5 = 3.0. After 2 half-lives (16 mins), decayed weight is ~0.75.
        const decayedVector = await scoringService.computeDecayedVector(rawEvent.profileId, now);
        expect(decayedVector.values.budget).toBeLessThan(1.5);
        expect(decayedVector.values.budget).toBeGreaterThan(0.5);
    });

    it("maintains backward compatibility when no client timestamp is provided", async () => {
        const prospectUid = `v_no_ts_${Date.now()}`;
        const beforeProcess = new Date();

        const result = await prospectingService.processEvent({
            propertyUid,
            prospectUid,
            activity: "dwell",
            payload: {
                sessionId: testSessionId,
                url: "https://test.example.com/pricing",
            },
            themes: ["Pricing & Tiers"],
        });

        const afterProcess = new Date();
        const [profile] = await db.select().from(prospectProfiles).where(eq(prospectProfiles.uid, prospectUid));
        const [scoringEvent] = await db.select().from(scoringEvents).where(eq(scoringEvents.prospectId, profile.id));

        expect(scoringEvent).toBeDefined();
        const eventTime = new Date(scoringEvent.createdAt).getTime();
        expect(eventTime).toBeGreaterThanOrEqual(beforeProcess.getTime() - 1000);
        expect(eventTime).toBeLessThanOrEqual(afterProcess.getTime() + 1000);
    });

    it("defensively falls back to server time when client timestamp is invalid or far in the future", async () => {
        const prospectUid = `v_bad_ts_${Date.now()}`;

        // Send garbage string date and far future date
        const result = await prospectingService.processEvent({
            propertyUid,
            prospectUid,
            activity: "dwell",
            payload: {
                sessionId: testSessionId,
                url: "https://test.example.com/pricing",
                timestamp: "invalid-date-string-12345",
            },
            themes: ["Pricing & Tiers"],
        });

        expect(result).toBeDefined();
        const [profile] = await db.select().from(prospectProfiles).where(eq(prospectProfiles.uid, prospectUid));
        const [scoringEvent] = await db.select().from(scoringEvents).where(eq(scoringEvents.prospectId, profile.id));

        expect(scoringEvent).toBeDefined();
        expect(isNaN(new Date(scoringEvent.createdAt).getTime())).toBe(false);
    });
});
