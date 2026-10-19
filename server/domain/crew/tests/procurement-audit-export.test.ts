import { describe, it, expect } from "vitest";
import { buildCrewRoomAuditBundle, renderAuditReportHtml, attestAuditReport } from "../../mission/core/mission-audit-report.js";

describe("Procurement-Grade Audit Export (O1)", () => {
    it("builds a cryptographically chained SHA-256 audit bundle from CREW room turns", () => {
        const mockSession = {
            id: 88,
            key: "crew-incident-postmortem-88",
            title: "Database Outage Postmortem",
            organizationId: 10,
            mode: "investigate",
        };

        const mockTurns = [
            {
                id: 1,
                turnIndex: 1,
                agentName: "SRE",
                content: "Investigating connection leak in auth pool.",
                createdAt: "2026-08-28T07:00:00Z",
                artifacts: [{ tool: "pin_forensic_event" }],
            },
            {
                id: 2,
                turnIndex: 2,
                agentName: "DBAdmin",
                content: "Proposing connection pool drain and schema restart.",
                createdAt: "2026-08-28T07:02:00Z",
                artifacts: [
                    {
                        tool: "request_governance_approval",
                        payload: {
                            checkpoint: {
                                actionTitle: "Drain Connection Pool",
                                status: "approved",
                                riskTier: "high",
                                requestedBy: "DBAdmin",
                            },
                        },
                    },
                ],
            },
        ];

        const bundle = buildCrewRoomAuditBundle(mockSession, mockTurns, [], "proj-alpha");

        expect(bundle.schemaVersion).toBe("oddjob.audit.v2");
        expect(bundle.roomId).toBe(88);
        expect(bundle.provenance.level).toBe("procurement-grade");
        expect(bundle.provenance.governanceStandards).toContain("EU_AI_ACT_ART_12");
        expect(bundle.metrics.totalTurns).toBe(2);
        expect(bundle.metrics.humanSignOffsApproved).toBe(1);
        expect(bundle.metrics.totalToolInvocations).toBe(2);
        expect(bundle.integrity.algorithm).toBe("sha256");
        expect(bundle.integrity.headHash).toMatch(/^[a-f0-9]{64}$/);
        expect(bundle.timeline.events.length).toBeGreaterThanOrEqual(3);

        // Verify each event has a chained SHA-256 payloadHash
        for (const evt of bundle.timeline.events) {
            expect(evt.payloadHash).toMatch(/^[a-f0-9]{64}$/);
        }
    });

    it("renders printable executive HTML compliance report with metrics and hash box", () => {
        const mockSession = {
            id: 99,
            key: "crew-arch-review-99",
            title: "Architecture RFC Review",
            organizationId: 10,
        };

        const bundle = buildCrewRoomAuditBundle(mockSession, [], []);
        const html = renderAuditReportHtml(bundle);

        expect(html).toContain("<!doctype html>");
        expect(html).toContain("Procurement AI Governance & Audit Report");
        expect(html).toContain("Architecture RFC Review");
        expect(html).toContain("SHA-256 Head Hash:");
        expect(html).toContain("EU_AI_ACT_ART_12");
    });
});
