/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    proposalRows: [] as any[],
    directRows: { rows: [] as any[] },
    blockedRows: { rows: [] as any[] },
    executeCalls: 0,
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({ where: () => Promise.resolve(state.proposalRows) }),
        }),
        execute: () => {
            state.executeCalls++;
            // Calls in order: direct-send fan-out, blocked fan-out, work types.
            return Promise.resolve(
                state.executeCalls === 1 ? state.directRows
                : state.executeCalls === 2 ? state.blockedRows
                : { rows: [] },
            );
        },
    },
}));

import { outboundAnalyticsService } from "../core/outbound-analytics.service.js";

describe("outboundAnalyticsService.summary", () => {
    beforeEach(() => {
        state.executeCalls = 0;
        state.proposalRows = [
            { status: "approved", channel: "email", agentCardId: 7, sendSent: true },
            { status: "approved", channel: "slack", agentCardId: 7, sendSent: false },
            { status: "rejected", channel: "email", agentCardId: 9, sendSent: null },
            { status: "pending", channel: "email", agentCardId: 7, sendSent: null },
        ];
        state.directRows = {
            rows: [
                { agentCardId: 7, tool: "send_email", outcome: "ok", count: "3" },
                { agentCardId: 9, tool: "slack_post_message", outcome: "ok", count: "1" },
                { agentCardId: 7, tool: "send_email", outcome: "failed", count: "2" },
            ],
        };
        state.blockedRows = { rows: [{ agentCardId: 7, count: "2" }] };
    });

    it("buckets delivered sends, card-reviewed sends, and blocked attempts", async () => {
        const s = await outboundAnalyticsService.summary(291);
        expect(s.totals).toEqual({
            fullyAutomated: 4,   // 3 emails + 1 slack post, ok:true
            semiAutomated: 3,    // sent + sendFailed + discarded — pending excluded
            blocked: 2,
            pendingReview: 1,
        });
        expect(s.proposals).toMatchObject({ total: 4, pending: 1, sent: 1, discarded: 1, sendFailed: 1 });
        expect(s.proposals.byChannel).toEqual({ email: 3, slack: 1 });
        // The two blocked attempts were counted in failures then moved out.
        expect(s.direct).toMatchObject({ sends: 4, failures: 0 });
        expect(s.direct.byTool).toEqual({ send_email: 5, slack_post_message: 1 });
    });

    it("groups automation levels per agent card", async () => {
        const s = await outboundAnalyticsService.summary(291);
        const agent7 = s.byAgent.find((a) => a.agentCardId === 7)!;
        const agent9 = s.byAgent.find((a) => a.agentCardId === 9)!;
        expect(agent7).toMatchObject({ fullyAutomated: 3, semiAutomated: 2, blocked: 2 });
        expect(agent9).toMatchObject({ fullyAutomated: 1, semiAutomated: 1, blocked: 0 });
    });
});
