import { describe, it, expect, vi } from "vitest";
import { createPipelineRunProposals, PipelineRunProposalError, type PipelineRunProposalDeps } from "./pipeline-run-proposals.js";

const ORG = 7;
const PIPELINE = { id: 41, name: "Weekly churn report", stepCount: 3 };
const admin = { userId: "u-admin", email: "admin@example.com", adminRole: { isOrgAdmin: true, organizationId: ORG } };

function fakeDeps(overrides: Partial<PipelineRunProposalDeps> = {}) {
    let finish!: (value: { success: boolean; executionId?: number; error?: string }) => void;
    const deps = {
        findPipeline: vi.fn(async (id: number, org: number) => (id === PIPELINE.id && org === ORG ? PIPELINE : null)),
        findPipelineByName: vi.fn(async (name: string, org: number) => (name === PIPELINE.name && org === ORG ? PIPELINE : null)),
        validateInputs: vi.fn(async () => [] as string[]),
        requestApproval: vi.fn(async () => ({ id: 900 })),
        runPipeline: vi.fn(() => new Promise<{ success: boolean; executionId?: number; error?: string }>((resolve) => { finish = resolve; })),
        recordOutcome: vi.fn(async () => undefined),
        now: () => new Date("2026-10-10T12:00:00Z"),
        ...overrides,
    };
    return { deps, finish: (value: Parameters<typeof finish>[0]) => finish(value) };
}

const stored = (overrides: Record<string, unknown> = {}) => ({
    id: 900, organizationId: ORG,
    modifiedOutput: { kind: "pipeline_run", pipelineId: PIPELINE.id, pipelineName: PIPELINE.name, inputData: { week: "41" }, ...overrides },
});

describe("propose", () => {
    it("files a pending approval carrying the pipeline and its inputs", async () => {
        const { deps } = fakeDeps();
        const proposals = createPipelineRunProposals(deps);
        const { approvalId, request } = await proposals.propose(
            { pipelineId: 41, inputData: { week: "41" }, reason: "Monday review" },
            { organizationId: ORG, userId: "u-admin", email: null, isOrgAdmin: true },
        );
        expect(approvalId).toBe(900);
        expect(request).toMatchObject({ kind: "pipeline_run", pipelineId: 41, pipelineName: PIPELINE.name, inputData: { week: "41" } });
        const call = vi.mocked(deps.requestApproval).mock.calls[0][0] as any;
        expect(call.organizationId).toBe(ORG);
        // Ends in a letter plus timestamp so it is never read as a mission run or a step id.
        expect(call.executionId).toMatch(/^pipeline_run:41:t\d+$/);
        expect(call.approverId).toBe("u-admin");
    });

    it("does not make a non-admin requester the approver of their own run", async () => {
        const { deps } = fakeDeps();
        await createPipelineRunProposals(deps).propose(
            { pipelineId: 41, reason: "r" },
            { organizationId: ORG, userId: "u-member", email: "member@example.com", isOrgAdmin: false },
        );
        const call = vi.mocked(deps.requestApproval).mock.calls[0][0] as any;
        expect(call.approverId).toBeUndefined();
        expect(call.approverEmail).toBeUndefined();
    });

    it("refuses a pipeline outside the organization without filing anything", async () => {
        const { deps } = fakeDeps();
        await expect(createPipelineRunProposals(deps).propose(
            { pipelineId: 41, reason: "r" },
            { organizationId: 8, userId: "u", email: null, isOrgAdmin: true },
        )).rejects.toThrow(/not found in this organization/);
        expect(deps.validateInputs).not.toHaveBeenCalled();
        expect(deps.requestApproval).not.toHaveBeenCalled();
    });

    it("refuses invalid inputs and an empty pipeline", async () => {
        const invalid = fakeDeps({ validateInputs: vi.fn(async () => ["week: required"]) });
        await expect(createPipelineRunProposals(invalid.deps).propose(
            { pipelineName: PIPELINE.name, reason: "r" },
            { organizationId: ORG, userId: "u", email: null, isOrgAdmin: true },
        )).rejects.toThrow(PipelineRunProposalError);
        expect(invalid.deps.requestApproval).not.toHaveBeenCalled();

        const empty = fakeDeps({ findPipeline: vi.fn(async () => ({ ...PIPELINE, stepCount: 0 })) });
        await expect(createPipelineRunProposals(empty.deps).propose(
            { pipelineId: 41, reason: "r" },
            { organizationId: ORG, userId: "u", email: null, isOrgAdmin: true },
        )).rejects.toThrow(/no steps/);
    });
});

describe("onRunDecision", () => {
    it("ignores other approval kinds", async () => {
        const { deps } = fakeDeps();
        const proposals = createPipelineRunProposals(deps);
        expect(await proposals.onRunDecision({ id: 1, organizationId: ORG, modifiedOutput: { kind: "workflow_node_run" } }, "approved", admin)).toEqual({ handled: false });
        expect(await proposals.onRunDecision({ id: 1, organizationId: null, modifiedOutput: stored().modifiedOutput }, "approved", admin)).toEqual({ handled: false });
        expect(deps.runPipeline).not.toHaveBeenCalled();
    });

    it("records a rejection and runs nothing", async () => {
        const { deps } = fakeDeps();
        const outcome = await createPipelineRunProposals(deps).onRunDecision(stored(), "rejected", admin);
        expect(outcome).toEqual({ handled: true, success: true, status: "rejected" });
        expect(deps.runPipeline).not.toHaveBeenCalled();
        expect(deps.recordOutcome).toHaveBeenCalledWith(900, ORG, expect.objectContaining({ state: "rejected" }));
    });

    it("starts the stored run on approval without waiting for it, then records the result", async () => {
        const { deps, finish } = fakeDeps();
        const outcome = await createPipelineRunProposals(deps).onRunDecision(stored(), "approved", admin);
        expect(outcome).toEqual({ handled: true, success: true, status: "started" });
        expect(deps.runPipeline).toHaveBeenCalledWith({ pipelineId: 41, userId: "u-admin", variables: { week: "41" } });
        expect(deps.recordOutcome).toHaveBeenLastCalledWith(900, ORG, expect.objectContaining({ state: "running" }));

        finish({ success: true, executionId: 5501 });
        await vi.waitFor(() => expect(deps.recordOutcome).toHaveBeenLastCalledWith(900, ORG, expect.objectContaining({ state: "succeeded", executionId: 5501 })));
    });

    it("records a failed run, and no execution id when none was created", async () => {
        const { deps, finish } = fakeDeps();
        await createPipelineRunProposals(deps).onRunDecision(stored(), "approved", admin);
        finish({ success: false, executionId: -1, error: "Infrastructure Pre-flight Failure: redis" });
        await vi.waitFor(() => expect(deps.recordOutcome).toHaveBeenLastCalledWith(900, ORG, expect.objectContaining({
            state: "failed", executionId: null, error: "Infrastructure Pre-flight Failure: redis",
        })));
    });

    it("needs an admin of this organization to approve", async () => {
        const { deps } = fakeDeps();
        const proposals = createPipelineRunProposals(deps);
        for (const adminRole of [null, { isOrgAdmin: false, organizationId: ORG }, { isOrgAdmin: true, organizationId: 8 }]) {
            const outcome = await proposals.onRunDecision(stored(), "approved", { userId: "u", email: null, adminRole });
            expect(outcome).toMatchObject({ handled: true, success: false, status: "failed" });
        }
        expect(deps.runPipeline).not.toHaveBeenCalled();
    });

    it("refuses a pipeline that left the organization after it was proposed", async () => {
        const { deps } = fakeDeps({ findPipeline: vi.fn(async () => null) });
        const outcome = await createPipelineRunProposals(deps).onRunDecision(stored(), "approved", admin);
        expect(outcome).toMatchObject({ success: false, status: "failed", error: expect.stringMatching(/no longer exists/) });
        expect(deps.runPipeline).not.toHaveBeenCalled();
    });
});
