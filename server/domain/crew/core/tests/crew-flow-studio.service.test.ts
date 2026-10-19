/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The created-flow turn: creating the pipeline is the act a person approved;
 * registering the workflow draft rides along but must never fail the create.
 */

const h = vi.hoisted(() => ({
    postTurn: vi.fn(),
    createPipeline: vi.fn(),
    createFromPipeline: vi.fn(),
}));

vi.mock("../crew-form-studio.service.js", () => ({ postTurn: h.postTurn }));
vi.mock("@domain/pipeline/core/pipeline.service.js", () => ({
    pipelineService: { create: h.createPipeline },
}));
vi.mock("@domain/pipeline/core/workflow-lifecycle.service.js", () => ({
    workflowLifecycleService: { createFromPipeline: h.createFromPipeline },
}));

import { runDirectFlowStudioAction } from "../crew-flow-studio.service.js";
import { FLOW_CREATE_PROPOSAL, FLOW_CREATED } from "@shared/flow-studio-crew.js";

const proposal = {
    type: FLOW_CREATE_PROPOSAL,
    proposalId: "flownew_12345678",
    name: "Lead triage",
    instruction: "Score then notify",
    steps: [{ jobId: 5, jobName: "Score lead", jobType: "ai_agent" }],
    summary: ["Score lead"],
    checks: [],
};

function ctx(overrides: Record<string, unknown> = {}) {
    return {
        orgId: 7,
        userId: "user-1",
        projectId: 12,
        message: 'Create flow "flownew_12345678".',
        priorTurns: [{ artifacts: [{ tool: "propose_flow", payload: proposal }] }],
        ...overrides,
    } as any;
}

const card = { id: 1 } as any;

beforeEach(() => {
    vi.clearAllMocks();
    h.createPipeline.mockResolvedValue({ id: 100 });
    h.createFromPipeline.mockResolvedValue({ id: 55 });
    h.postTurn.mockResolvedValue(undefined);
});

function postedPayload() {
    const call = h.postTurn.mock.calls[0];
    return call?.[2]?.artifact?.payload;
}

describe("createFlowFromProposal", () => {
    it("registers a workflow draft and records its id in the FLOW_CREATED artifact", async () => {
        const handled = await runDirectFlowStudioAction(ctx(), card);
        expect(handled).toBe(true);
        expect(h.createFromPipeline).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 7 }),
            expect.objectContaining({ pipelineId: 100, projectId: 12, title: "Lead triage" }),
        );
        expect(postedPayload()).toMatchObject({ type: FLOW_CREATED, pipelineId: 100, workflowId: 55 });
        expect(h.postTurn.mock.calls[0][2].content).toContain("workflow draft in this project");
    });

    it("still posts FLOW_CREATED when workflow registration fails", async () => {
        h.createFromPipeline.mockRejectedValue(new Error("no workflows table"));
        const handled = await runDirectFlowStudioAction(ctx(), card);
        expect(handled).toBe(true);
        const payload = postedPayload();
        expect(payload).toMatchObject({ type: FLOW_CREATED, pipelineId: 100 });
        expect(payload.workflowId).toBeUndefined();
        expect(h.postTurn.mock.calls[0][2].content).not.toContain("workflow draft");
    });
});
