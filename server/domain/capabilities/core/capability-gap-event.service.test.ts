import { describe, it, expect, vi, beforeEach } from "vitest";

import {
    classifyCapabilityGap,
    resolveRunRef,
    recordCapabilityGap,
    capabilityGapRejectionCount,
    resetCapabilityGapRejectionCount,
    hashActor,
} from "./capability-gap-event.service.js";

const inserted: any[] = [];

vi.mock("@server/database_service.js", () => ({
    db: {
        insert: () => ({
            values: async (v: any) => {
                inserted.push(v);
            },
        }),
    },
}));

beforeEach(() => {
    inserted.length = 0;
    resetCapabilityGapRejectionCount();
});

describe("classifyCapabilityGap", () => {
    // §6.5: "a permission denial is never presented as proof of a missing
    // capability". Both facts previously produced one identical string.
    it("classifies a registry miss as 'missing'", () => {
        expect(classifyCapabilityGap(false, false)).toBe("missing");
    });

    it("classifies a real tool outside the allotment as 'unavailable'", () => {
        expect(classifyCapabilityGap(true, false)).toBe("unavailable");
    });

    it("never returns 'missing' when the tool exists in the registry", () => {
        expect(classifyCapabilityGap(true, false)).not.toBe("missing");
        expect(classifyCapabilityGap(true, true)).not.toBe("missing");
    });
});

describe("resolveRunRef", () => {
    it("prefers the execution id — the most specific run identity", () => {
        expect(resolveRunRef({ organizationId: 1, executionId: 412, missionId: 88, traceId: "abc" }))
            .toEqual({ runRef: "execution:412", runRefSource: "execution" });
    });

    it("falls back to mission, then trace", () => {
        expect(resolveRunRef({ organizationId: 1, missionId: 88, traceId: "abc" }))
            .toEqual({ runRef: "mission:88", runRefSource: "mission" });
        expect(resolveRunRef({ organizationId: 1, traceId: "abc" }))
            .toEqual({ runRef: "trace:abc", runRefSource: "trace" });
    });

    // Jobs are keyed by name and reused across cycles, so a job id names a
    // definition rather than one execution of it.
    it("returns null rather than synthesising an id when no run identity exists", () => {
        expect(resolveRunRef({ organizationId: 1 })).toEqual({ runRef: null, runRefSource: null });
    });
});

describe("hashActor", () => {
    it("is stable for the same user, so distinct counts work", () => {
        expect(hashActor("u-1")).toBe(hashActor("u-1"));
    });

    it("differs between users", () => {
        expect(hashActor("u-1")).not.toBe(hashActor("u-2"));
    });

    // The id must not survive into telemetry.
    it("does not contain the original id", () => {
        expect(hashActor("alice@example.com")).not.toContain("alice");
    });

    // No user behind the call is a different fact from an unrecorded one.
    it.each([null, undefined, "", "   "])("returns null for %s rather than hashing a blank", (v) => {
        expect(hashActor(v as any)).toBeNull();
    });
});

describe("recordCapabilityGap", () => {
    const base = {
        organizationId: 42,
        requestedToolName: "jira_create_issue",
        registryHit: false,
        allotmentHit: false,
    };

    it("writes one event classed 'missing' for a nonexistent tool", async () => {
        await recordCapabilityGap({ ...base, executionId: 7 });
        expect(inserted).toHaveLength(1);
        expect(inserted[0]).toMatchObject({
            organizationId: 42,
            requestedToolName: "jira_create_issue",
            failureClass: "missing",
            registryHit: false,
            allotmentHit: false,
            runRef: "execution:7",
        });
    });

    it("writes 'unavailable' for a real tool outside the allotment", async () => {
        await recordCapabilityGap({
            ...base,
            registryHit: true,
            allotmentHit: false,
            canonicalToolName: "file_write",
            executionId: 7,
        });
        expect(inserted[0].failureClass).toBe("unavailable");
        expect(inserted[0].canonicalToolName).toBe("file_write");
    });

    it("emits one row per call, so ten failures in one run share one runRef", async () => {
        for (let i = 0; i < 10; i++) {
            await recordCapabilityGap({ ...base, executionId: 7 });
        }
        expect(inserted).toHaveLength(10);
        expect(new Set(inserted.map(r => r.runRef)).size).toBe(1);
    });

    it("stores the actor as a hash, never the raw id", async () => {
        await recordCapabilityGap({ ...base, userId: "alice@example.com", executionId: 7 });
        expect(inserted[0].actorUserHash).toBeTruthy();
        expect(inserted[0].actorUserHash).not.toContain("alice");
    });

    it("stores a null actor when no user was behind the call", async () => {
        await recordCapabilityGap({ ...base, executionId: 7 });
        expect(inserted[0].actorUserHash).toBeNull();
    });

    it("records a null runRef rather than inventing one", async () => {
        await recordCapabilityGap(base);
        expect(inserted[0].runRef).toBeNull();
        expect(inserted[0].runRefSource).toBeNull();
    });

    // Writing this under a default organization would put one tenant's
    // execution gap into another tenant's evidence.
    it.each([0, -1, null, undefined, "abc", NaN])(
        "drops the event and counts a rejection when the org is unresolvable (%s)",
        async (org) => {
            await recordCapabilityGap({ ...base, organizationId: org as any });
            expect(inserted).toHaveLength(0);
            expect(capabilityGapRejectionCount()).toBe(1);
        },
    );

    it("honours an explicit failure class for gaps raised outside the guard", async () => {
        await recordCapabilityGap({
            ...base,
            registryHit: true,
            allotmentHit: true,
            failureClassOverride: "unauthorized",
        });
        expect(inserted[0].failureClass).toBe("unauthorized");
    });

    it("never throws — a gap must not become an execution failure", async () => {
        await expect(
            recordCapabilityGap({ ...base, requestedToolName: null as any }),
        ).resolves.toBeUndefined();
    });
});
