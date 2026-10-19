import { describe, it, expect } from "vitest";

import type { CapabilityGapEvent, CapabilityGapFailureClass } from "@shared/schema/capabilities/index.js";
import {
    parseToolName,
    buildGapSignature,
    signatureKey,
    normalizeCapabilityGaps,
} from "./capability-gap-normalizer.service.js";

let seq = 0;
function ev(over: Partial<CapabilityGapEvent> = {}): CapabilityGapEvent {
    seq += 1;
    return {
        id: seq,
        organizationId: 42,
        projectId: null,
        missionId: null,
        runRef: `execution:${seq}`,
        runRefSource: "execution",
        actorUserHash: `user-${seq}`,
        requestedToolName: "jira_create_issue",
        canonicalToolName: null,
        failureClass: "missing" as CapabilityGapFailureClass,
        registryHit: false,
        allotmentHit: false,
        occurredAt: new Date("2026-08-20T10:00:00Z"),
        ...over,
    } as CapabilityGapEvent;
}

describe("parseToolName", () => {
    it("splits system, verb and object", () => {
        expect(parseToolName("jira_create_issue")).toEqual({
            system: "jira", verb: "create", object: "issue", parsed: true,
        });
    });

    it("handles a name with no system prefix", () => {
        expect(parseToolName("send_email")).toMatchObject({ verb: "send", object: "email", parsed: true });
    });

    it("finds a verb that is not the first token", () => {
        expect(parseToolName("knowledge_search_documents")).toMatchObject({
            verb: "search", object: "knowledge_documents", parsed: true,
        });
    });

    // Guessing "first token is the verb" would make `jira` a verb and merge
    // every Jira gap into one signature.
    it("does not invent a verb when none is recognised", () => {
        const p = parseToolName("frobnicate_widget");
        expect(p.parsed).toBe(false);
        expect(p.verb).toBe("unknown");
        expect(p.object).toBe("frobnicate_widget");
    });

    it("is insensitive to separator style and case", () => {
        const a = parseToolName("Jira-Create-Issue");
        const b = parseToolName("jira_create_issue");
        expect(a).toEqual(b);
    });

    it("survives an empty name", () => {
        expect(parseToolName("").parsed).toBe(false);
    });
});

describe("signatureKey", () => {
    const base = buildGapSignature(ev());

    it("is stable for the same signature", () => {
        expect(signatureKey(base)).toBe(signatureKey({ ...base }));
    });

    it("ignores property order", () => {
        const reordered = {
            failureClass: base.failureClass,
            requiredVerb: base.requiredVerb,
            intendedOutcome: base.intendedOutcome,
            requiredObject: base.requiredObject,
            targetSystem: base.targetSystem,
        };
        expect(signatureKey(reordered as any)).toBe(signatureKey(base));
    });

    // The distinction the whole classification exists to preserve.
    it("separates the same tool failing for different reasons", () => {
        const missing = buildGapSignature(ev({ failureClass: "missing" }));
        const unavailable = buildGapSignature(ev({ failureClass: "unavailable" }));
        expect(signatureKey(missing)).not.toBe(signatureKey(unavailable));
    });

    it("separates different verbs on the same object", () => {
        expect(signatureKey(buildGapSignature(ev({ requestedToolName: "jira_create_issue" }))))
            .not.toBe(signatureKey(buildGapSignature(ev({ requestedToolName: "jira_delete_issue" }))));
    });
});

describe("normalizeCapabilityGaps", () => {
    it("groups identical gaps into one signature", () => {
        const r = normalizeCapabilityGaps([ev(), ev(), ev()]);
        expect(r.capabilityGaps).toHaveLength(1);
        expect(r.capabilityGaps[0].eventCount).toBe(3);
    });

    // §6.5: two identical failures in one run count as ONE affected run.
    it("counts distinct runs, not events", () => {
        const r = normalizeCapabilityGaps([
            ev({ runRef: "execution:1" }),
            ev({ runRef: "execution:1" }),
            ev({ runRef: "execution:1" }),
            ev({ runRef: "execution:2" }),
        ]);
        expect(r.capabilityGaps[0].eventCount).toBe(4);
        expect(r.capabilityGaps[0].uniqueAffectedRuns).toBe(2);
    });

    it("excludes events with no run identity and reports them", () => {
        const r = normalizeCapabilityGaps([
            ev({ runRef: "execution:1" }),
            ev({ runRef: null }),
            ev({ runRef: null }),
        ]);
        expect(r.capabilityGaps[0].uniqueAffectedRuns).toBe(1);
        expect(r.capabilityGaps[0].eventsWithoutRunIdentity).toBe(2);
    });

    it("counts distinct users and excludes unattributed events", () => {
        const r = normalizeCapabilityGaps([
            ev({ actorUserHash: "a" }),
            ev({ actorUserHash: "a" }),
            ev({ actorUserHash: "b" }),
            ev({ actorUserHash: null }),
        ]);
        expect(r.capabilityGaps[0].uniqueAffectedUsers).toBe(2);
        expect(r.capabilityGaps[0].eventsWithoutActor).toBe(1);
    });

    describe("failure classes are routed apart", () => {
        // Feeding allotment problems into capability invention would propose
        // building tools that already exist.
        it("keeps 'missing' and 'unavailable' in separate buckets", () => {
            const r = normalizeCapabilityGaps([
                ev({ failureClass: "missing" }),
                ev({ failureClass: "unavailable", registryHit: true }),
            ]);
            expect(r.capabilityGaps).toHaveLength(1);
            expect(r.allotmentGaps).toHaveLength(1);
            expect(r.capabilityGaps[0].signature.failureClass).toBe("missing");
        });

        it("never lets an unavailable gap become a capability candidate", () => {
            const r = normalizeCapabilityGaps(
                Array.from({ length: 50 }, () => ev({ failureClass: "unavailable", registryHit: true })),
            );
            expect(r.capabilityGaps).toHaveLength(0);
            expect(r.allotmentGaps[0].eventCount).toBe(50);
        });

        it("buckets unauthorized and incompatible separately again", () => {
            const r = normalizeCapabilityGaps([
                ev({ failureClass: "unauthorized" }),
                ev({ failureClass: "incompatible" }),
            ]);
            expect(r.capabilityGaps).toHaveLength(0);
            expect(r.allotmentGaps).toHaveLength(0);
            expect(r.otherGaps).toHaveLength(2);
        });
    });

    // One tenant's execution gap must never merge into another's evidence.
    it("never merges signatures across organizations", () => {
        const r = normalizeCapabilityGaps([
            ev({ organizationId: 42 }),
            ev({ organizationId: 99 }),
        ]);
        expect(r.capabilityGaps).toHaveLength(2);
        expect(new Set(r.capabilityGaps.map(g => g.organizationId))).toEqual(new Set([42, 99]));
    });

    it("reports tool names that did not fit the convention", () => {
        const r = normalizeCapabilityGaps([ev({ requestedToolName: "frobnicate_widget" })]);
        expect(r.capabilityGaps[0].unparsedToolNames).toEqual(["frobnicate_widget"]);
    });

    it("records the observation window", () => {
        const r = normalizeCapabilityGaps([
            ev({ occurredAt: new Date("2026-08-01T00:00:00Z") }),
            ev({ occurredAt: new Date("2026-08-10T00:00:00Z") }),
        ]);
        expect(r.capabilityGaps[0].firstSeenAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
        expect(r.capabilityGaps[0].lastSeenAt.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    });

    it("ranks by affected runs, not raw event count", () => {
        const noisy = Array.from({ length: 20 }, () =>
            ev({ requestedToolName: "slack_send_message", runRef: "execution:same" }));
        const spread = Array.from({ length: 3 }, (_, i) =>
            ev({ requestedToolName: "jira_create_issue", runRef: `execution:r${i}` }));

        const r = normalizeCapabilityGaps([...noisy, ...spread]);
        expect(r.capabilityGaps[0].signature.targetSystem).toBe("jira");
        expect(r.capabilityGaps[0].uniqueAffectedRuns).toBe(3);
        expect(r.capabilityGaps[1].uniqueAffectedRuns).toBe(1);
    });

    it("handles an empty input", () => {
        const r = normalizeCapabilityGaps([]);
        expect(r).toMatchObject({ capabilityGaps: [], allotmentGaps: [], totalEvents: 0 });
    });
});
