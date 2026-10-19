import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
    STUDIO_CONTRIBUTION_PROPOSAL,
    STUDIO_CONTRIBUTION_APPLIED,
    applyContributionMessage,
} from "@shared/studio-contribution.js";

/**
 * `Apply contribution "id"` was a dead message: the card sent it, no consumer
 * existed, and the chained applyAction ran nowhere. runDirectContributionApply
 * is the handler that makes the card honest — these tests pin the gate:
 * nothing runs without the exact message, nothing runs twice, and the chained
 * call cannot reach a tool a person did not see on the card.
 */

const posted: any[] = [];
const executed: Array<{ tool: string; args: any }> = [];

const REGISTRY: Record<string, any> = {
    form_archive: { name: 'form_archive', riskLevel: 'high', parameters: z.object({ formId: z.number(), userConfirmed: z.literal(true) }), execute: async () => '' },
    apply_studio_contribution: {
        name: "apply_studio_contribution",
        idempotency: "none",
        riskLevel: "medium",
        label: "Apply",
        group: "StudioCollaboration",
        description: "test",
        parameters: z.object({ proposalId: z.string() }),
        execute: async () => "",
    },
    add_flow_step: {
        name: "add_flow_step",
        idempotency: "none",
        riskLevel: "medium",
        label: "Add step",
        group: "Flow",
        description: "test",
        parameters: z.object({ pipelineId: z.number() }),
        execute: async () => "",
    },
    admin_wipe: {
        name: "admin_wipe",
        idempotency: "none",
        riskLevel: "high",
        adminOnly: true,
        label: "Wipe",
        group: "Admin",
        description: "test",
        parameters: z.object({}),
        execute: async () => "",
    },
};

vi.mock("../crew-form-studio.service.js", async () => {
    const actual = await vi.importActual<any>("../crew-form-studio.service.js");
    return {
        ...actual,
        postTurn: async (_ctx: any, _card: any, opts: any) => {
            posted.push(opts);
            return true;
        },
        toolContext: () => ({ organizationId: 291 }),
    };
});

vi.mock("../crew-tools.service.js", async () => {
    const actual = await vi.importActual<any>("../crew-tools.service.js");
    return {
        ...actual,
        crewToolsService: {
            execute: async (tool: string, args: any) => {
                executed.push({ tool, args });
                if (tool === "add_flow_step" && args.pipelineId === -1) {
                    return {
                        record: { name: tool, ok: false, ms: 1, error: "no such pipeline" },
                        output: "Error: no such pipeline",
                        artifact: null,
                    };
                }
                return {
                    record: { name: tool, ok: true, ms: 1 },
                    output: tool === "apply_studio_contribution"
                        ? JSON.stringify({ type: STUDIO_CONTRIBUTION_APPLIED, proposalId: args.proposalId, appliedAt: "now" })
                        : "{}",
                    artifact: tool === "apply_studio_contribution"
                        ? { tool, payload: { type: STUDIO_CONTRIBUTION_APPLIED, proposalId: args.proposalId, appliedAt: "now" } }
                        : null,
                };
            },
        },
    };
});

vi.mock("@domain/tools/v1/capabilities/index.js", () => ({
    getAgentTools: () => REGISTRY,
}));

import { runDirectContributionApply } from "../crew-contribution.service.js";

const CARD: any = { id: 7, name: "Flow Architect" };

function ctx(message: string, priorTurns: any[] = []) {
    return {
        message,
        priorTurns,
        orgId: 291,
        sessionKey: "crew-test",
        session: { id: 55 },
        projectId: 9,
        projectKey: "TEST",
        userId: "u1",
        round: 3,
        topic: "t",
        intent: "i",
        replyTarget: 0,
        roundTurns: [],
        cost: { toolCalls: 0, modelCalls: 0, generationMs: 0 },
    } as any;
}

function proposalTurn(overrides: Record<string, unknown> = {}) {
    return {
        id: 10,
        artifacts: [{
            tool: "propose_studio_contribution",
            payload: {
                type: STUDIO_CONTRIBUTION_PROPOSAL,
                proposalId: "contrib_abc123def456",
                targetStudio: "flow",
                targetLabel: "Loan Triage",
                rationale: "coverage",
                diff: [{ label: "Add step", description: "score the lead" }],
                ...overrides,
            },
        }],
    };
}

describe("runDirectContributionApply", () => {
    beforeEach(() => {
        posted.splice(0);
        executed.splice(0);
    });

    it("ignores any message that is not the card's apply string", async () => {
        expect(await runDirectContributionApply(ctx("can you apply that change?"), CARD)).toBe(false);
        expect(await runDirectContributionApply(ctx('Apply contribution "contrib_abc123def456" please'), CARD)).toBe(false);
        expect(executed).toHaveLength(0);
    });

    it("answers clearly when the proposal is not in the room", async () => {
        const result = await runDirectContributionApply(
            ctx(applyContributionMessage("contrib_abc123def456"), []),
            CARD,
        );
        expect(result).toBe(true);
        expect(posted[0].content).toMatch(/isn't in this room/);
        expect(executed).toHaveLength(0);
    });

    it("runs the apply marker and the card's chained applyAction", async () => {
        const turns = [proposalTurn({ applyAction: { tool: "add_flow_step", args: { pipelineId: 42 } } })];
        const result = await runDirectContributionApply(
            ctx(applyContributionMessage("contrib_abc123def456"), turns),
            CARD,
        );

        expect(result).toBe(true);
        expect(executed.map((e) => e.tool)).toEqual(["add_flow_step", "apply_studio_contribution"]);
        expect(executed[0].args).toEqual({ pipelineId: 42 });
        expect(posted[0].content).toMatch(/Applied the contribution to "Loan Triage"/);
        expect(posted[0].artifact?.payload?.type).toBe(STUDIO_CONTRIBUTION_APPLIED);
    });

    it("is idempotent — an already-applied proposal does not run again", async () => {
        const turns = [
            proposalTurn(),
            { id: 11, artifacts: [{ tool: "apply_studio_contribution", payload: { type: STUDIO_CONTRIBUTION_APPLIED, proposalId: "contrib_abc123def456" } }] },
        ];
        const result = await runDirectContributionApply(
            ctx(applyContributionMessage("contrib_abc123def456"), turns),
            CARD,
        );
        expect(result).toBe(true);
        expect(posted[0].content).toMatch(/already been applied/);
        expect(executed).toHaveLength(0);
    });

    it("marks nothing applied when the chained call fails", async () => {
        const turns = [proposalTurn({ applyAction: { tool: "add_flow_step", args: { pipelineId: -1 } } })];
        const result = await runDirectContributionApply(
            ctx(applyContributionMessage("contrib_abc123def456"), turns),
            CARD,
        );

        expect(result).toBe(true);
        // The chain ran and failed; the marker was NOT written behind it.
        expect(executed.map((e) => e.tool)).toEqual(["add_flow_step"]);
        expect(posted[0].content).toMatch(/approved, but the change failed/);
    });

    it("does not mark a prose-only proposal applied", async () => {
        await runDirectContributionApply(ctx(applyContributionMessage("contrib_abc123def456"), [proposalTurn()]), CARD);
        expect(executed).toHaveLength(0);
        expect(posted[0].content).toMatch(/no executable change/);
    });

    it('confirms only the destructive resource explicitly approved on the card', async () => {
        const turns = [proposalTurn({ targetStudio: 'form', targetId: 42, applyAction: { tool: 'form_archive', args: { formId: 42 } } })];
        await runDirectContributionApply(ctx(applyContributionMessage('contrib_abc123def456'), turns), CARD);
        expect(executed[0]).toEqual({ tool: 'form_archive', args: { formId: 42, userConfirmed: true } });
    });

    it.each([{ targetStudio: 'media', targetId: 42 }, { targetStudio: 'form', targetId: 99 }, { targetStudio: 'form' }])('rejects mismatched destructive targets: %j', async (target) => {
        const turns = [proposalTurn({ ...target, applyAction: { tool: 'form_archive', args: { formId: 42, userConfirmed: true } } })];
        await runDirectContributionApply(ctx(applyContributionMessage('contrib_abc123def456'), turns), CARD);
        expect(executed).toHaveLength(0);
    });

    it("refuses a chained call to a tool outside the lines", async () => {
        const turns = [proposalTurn({ applyAction: { tool: "admin_wipe", args: {} } })];
        const result = await runDirectContributionApply(
            ctx(applyContributionMessage("contrib_abc123def456"), turns),
            CARD,
        );

        expect(result).toBe(true);
        expect(executed).toHaveLength(0);
        expect(posted[0].content).toMatch(/cannot make/);
    });

    it("refuses a chained call to a tool that does not exist", async () => {
        const turns = [proposalTurn({ applyAction: { tool: "delete_everything", args: {} } })];
        const result = await runDirectContributionApply(
            ctx(applyContributionMessage("contrib_abc123def456"), turns),
            CARD,
        );

        expect(result).toBe(true);
        expect(executed).toHaveLength(0);
        expect(posted[0].content).toMatch(/cannot make/);
    });
});
