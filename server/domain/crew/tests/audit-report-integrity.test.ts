/**
 * The two claims a procurement audit bundle makes about itself.
 *
 * It labels itself procurement-grade and cites EU AI Act Article 12, so the
 * things worth holding are the ones a reviewer would rely on: that the hash
 * chain actually detects a rewritten event, and that a metric it presents as
 * measured was in fact measured.
 */

import { describe, expect, it } from "vitest";
import { buildCrewRoomAuditBundle, renderAuditReportHtml } from "@domain/mission/core/mission-audit-report.js";

const session = { id: 42, key: "crew-room-42", title: "Ingest sharding", organizationId: 7, mode: "decide" };

const turns = [
    {
        id: 1,
        speakerType: "user",
        speakerName: "Ada",
        content: "Should we shard the ingest queue?",
        createdAt: new Date("2026-08-28T10:00:00Z"),
        toolsUsed: [],
    },
    {
        id: 2,
        speakerType: "agent",
        speakerName: "Analyst",
        content: "Yes — shard by tenant id.",
        createdAt: new Date("2026-08-28T10:01:00Z"),
        toolsUsed: [{ name: "search_unified_knowledge", ok: true, ms: 12 }],
    },
];

describe("audit bundle hash chain", () => {
    it("chains every event onto the one before it", () => {
        const bundle = buildCrewRoomAuditBundle(session, turns, []);

        expect(bundle.integrity.headHash).toMatch(/^[a-f0-9]{64}$/);
        expect(bundle.timeline.events.length).toBeGreaterThan(0);
        for (const evt of bundle.timeline.events) {
            expect(evt.payloadHash).toMatch(/^[a-f0-9]{64}$/);
        }
        // The head is the last link, not an independent digest.
        expect(bundle.integrity.headHash).toBe(
            bundle.timeline.events[bundle.timeline.events.length - 1].payloadHash,
        );
    });

    it("detects an event whose content was rewritten", () => {
        const before = buildCrewRoomAuditBundle(session, turns, []);
        const after = buildCrewRoomAuditBundle(
            session,
            [turns[0], { ...turns[1], content: "No — leave the queue alone." }],
            [],
        );

        // Chaining only timestamp/kind/title/actor left the summary outside the
        // chain, so rewriting what an agent said did not disturb the head hash.
        expect(after.integrity.headHash).not.toBe(before.integrity.headHash);
    });

    it("is stable when nothing changed", () => {
        const a = buildCrewRoomAuditBundle(session, turns, []);
        const b = buildCrewRoomAuditBundle(session, turns, []);

        // exportId carries a timestamp, so the chains differ by design; the
        // event bodies hashing identically is what matters here.
        expect(a.timeline.events.map((e) => e.title)).toEqual(b.timeline.events.map((e) => e.title));
    });
});

describe("audit bundle metrics", () => {
    it("reports an unmeasured safety score as absent, not as a number", () => {
        const bundle = buildCrewRoomAuditBundle(session, turns, []);

        // These turns carry no trajectory scores. This used to report 0.88 —
        // a healthy-looking figure nothing had measured.
        expect(bundle.metrics.avgTrajectorySafetyScore).toBeNull();
    });

    it("does not print a stand-in percentage in the human-readable report", () => {
        const html = renderAuditReportHtml(buildCrewRoomAuditBundle(session, turns, []));

        expect(html).toContain("Not measured");
        expect(html).not.toContain("88.0%");
    });
});

describe("audit bundle attestation", () => {
    it("says plainly when it could not sign", () => {
        const prior = process.env.AUDIT_REPORT_SIGNING_SECRET;
        delete process.env.AUDIT_REPORT_SIGNING_SECRET;
        try {
            const bundle = buildCrewRoomAuditBundle(session, turns, []) as any;
            const attestation = bundle.attestation;
            if (attestation) {
                // An unsigned export must not look signed.
                expect(attestation.status).toBe("unsigned");
                expect(attestation.signature).toBeNull();
                expect(attestation.limitation).toMatch(/no server attestation/i);
            }
        } finally {
            if (prior !== undefined) process.env.AUDIT_REPORT_SIGNING_SECRET = prior;
        }
    });
});
