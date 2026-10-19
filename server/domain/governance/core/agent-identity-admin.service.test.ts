// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("@server/database_service.js", () => ({ db: {} }));

import { clampLimit, summarizeAgentGovernance } from "./agent-identity-admin.service";

const NOW = new Date("2026-10-03T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const identity = (over: Record<string, unknown>) => ({
    id: "i", agentId: "a", displayName: "A", status: "active", riskLevel: "low", lastReviewedAt: daysAgo(1), ...over,
}) as any;
const event = (over: Record<string, unknown>) => ({
    id: "e", agentId: "a", tool: "t", action: "x", resource: "*", riskLevel: "low", decision: "allow", policyCodes: [], createdAt: NOW, ...over,
}) as any;

describe("clampLimit", () => {
    it.each([
        [undefined, 100], ["50", 50], [9999, 500], ["abc", 100], [0, 100], [-5, 100], [12.7, 12],
    ])("%s -> %s", (raw, expected) => {
        expect(clampLimit(raw, 100, 500)).toBe(expected);
    });
});

describe("summarizeAgentGovernance", () => {
    it("counts risk, suspension, stale reviews and decisions", () => {
        const summary = summarizeAgentGovernance(
            [
                identity({ id: "1", riskLevel: "critical" }),
                identity({ id: "2", status: "suspended" }),
                identity({ id: "3", lastReviewedAt: daysAgo(45) }),
                identity({ id: "4", lastReviewedAt: null }),
                identity({ id: "5", status: "draft", lastReviewedAt: null }),
            ],
            [
                event({ decision: "deny", policyCodes: ["P1", "P2"] }),
                event({ decision: "deny", policyCodes: ["P1"] }),
                event({ decision: "require_approval" }),
            ],
            NOW,
        );

        expect(summary.metrics).toEqual({
            identities: 5,
            highRiskIdentities: 1,
            suspendedIdentities: 1,
            // Only ACTIVE identities queue for review; the draft is not stale.
            staleReviews: 2,
            deniedActions: 2,
            approvalRequired: 1,
            recentEvents: 3,
        });
        expect(summary.topPolicyCodes).toEqual([{ code: "P1", count: 2 }, { code: "P2", count: 1 }]);
        expect(summary.generatedAt).toBe(NOW.toISOString());
    });

    it("queues never-reviewed identities ahead of the oldest reviewed one", () => {
        const summary = summarizeAgentGovernance(
            [identity({ id: "old", lastReviewedAt: daysAgo(90) }), identity({ id: "never", lastReviewedAt: null })],
            [],
            NOW,
        );
        expect(summary.reviewQueue.map((r) => r.id)).toEqual(["never", "old"]);
    });
});
