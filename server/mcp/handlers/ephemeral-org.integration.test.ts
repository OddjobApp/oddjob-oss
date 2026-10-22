/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { contactIntentStates, engagementLogs } from "@shared/schema/index.js";
import { ensureFixtureOrgs } from "../../../tests/helpers/fixture-orgs.js";
import { handleGetUserIntent } from "./ephemeral.js";

/**
 * Visitor intent states were keyed only by browser fingerprint. Two
 * organizations share a fingerprint here — the worst case — and each sees only
 * its own visitor; a caller with no organization sees nothing.
 */
const ORG_A = 9701;
const ORG_B = 9702;
const FINGERPRINT = `fp-${randomUUID()}`;
const CANARY = `route-${randomUUID()}`;

describe("visitor intent state is per organization", () => {
    beforeAll(async () => {
        await ensureFixtureOrgs([[ORG_A, "Intent A"], [ORG_B, "Intent B"]]);
        await db.insert(contactIntentStates).values([
            { organizationId: ORG_A, userFingerprint: FINGERPRINT, stateVector: "S", confidence: 0.9, routePath: "/a" },
            { organizationId: ORG_B, userFingerprint: FINGERPRINT, stateVector: "E", confidence: 0.4, routePath: CANARY },
            { organizationId: null, userFingerprint: FINGERPRINT, stateVector: "R", confidence: 0.1, routePath: CANARY },
        ]);
        await db.insert(engagementLogs).values([
            { organizationId: ORG_B, userFingerprint: FINGERPRINT, strategyName: CANARY, userAction: "clicked" },
        ]);
    });

    afterAll(async () => {
        await db.delete(contactIntentStates).where(inArray(contactIntentStates.userFingerprint, [FINGERPRINT]));
        await db.delete(engagementLogs).where(inArray(engagementLogs.userFingerprint, [FINGERPRINT]));
    });

    it("returns only the caller's organization's state and engagements", async () => {
        const response: any = await handleGetUserIntent({ fingerprint: FINGERPRINT }, { organizationId: ORG_A } as any);
        const text = response.content[0].text as string;
        expect(text).toContain("S");
        expect(JSON.stringify(response)).toMatch(/vector[^,]*S/);
        expect(JSON.stringify(response)).not.toContain(CANARY);
    });

    it("refuses a caller with no organization", async () => {
        const result = JSON.stringify(await handleGetUserIntent({ fingerprint: FINGERPRINT }));
        expect(result).toContain("Organization context required");
        expect(result).not.toContain(CANARY);
    });
});
