/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { asStudioDefinition, evaluateStudio } from "@shared/form-studio.js";
import { createFormStudioRuntime, type ActionRecord, type FormActionContext, type RuntimeDeps, type SubmissionRecord } from "./form-studio-runtime.js";

/**
 * The Phase 5 exit for feature beta validation: an open P0 records
 * GA_LAUNCH_BLOCKED, and the pipeline its rule declares runs only after a person
 * approves it.
 */

const ORG = 7;

const beta = asStudioDefinition({
    fields: [
        { key: "p0_blocking_bugs_open", label: "Open P0 bugs", type: "number" },
        { key: "launch_notes", label: "Notes", type: "text" },
    ],
    studio: {
        version: 2,
        pages: [{ id: "gates", title: "Launch gates" }],
        decisionRules: [
            { id: "hard_stop", when: "p0_blocking_bugs_open > 0", status: "GA_LAUNCH_BLOCKED", actions: ["open_incident", "tell_pm"] },
        ],
        defaultStatus: "PROCEED_TO_GENERAL_AVAILABILITY",
        actions: [
            { id: "open_incident", label: "Open the launch-block incident", type: "start_pipeline", pipelineId: 41 },
            { id: "tell_pm", label: "Tell the PM", type: "notify", channel: "email", to: "pm@example.com", message: "GA is blocked." },
        ],
        dataset: { datasetId: 12 },
    },
});

function fakeDeps(overrides: Partial<RuntimeDeps> = {}) {
    const responses = new Map<number, { id: number; data: Record<string, unknown>; runtime: SubmissionRecord | null }>();
    let approvalId = 100;
    const deps: RuntimeDeps & { responses: typeof responses } = {
        responses,
        addDatasetItem: vi.fn(async () => ({ itemId: 900 })),
        pipelineInOrg: vi.fn(async (pipelineId: number, organizationId: number) => pipelineId === 41 && organizationId === ORG),
        formOwner: vi.fn(async () => ({ id: "owner-1", email: "owner@example.com" })),
        createApproval: vi.fn(async () => ({ id: ++approvalId })),
        publishEvent: vi.fn(async () => undefined),
        loadResponse: vi.fn(async (responseId: number) => responses.get(responseId) ?? null),
        saveSubmission: vi.fn(async (responseId: number, _org: number, record: SubmissionRecord) => {
            const existing = responses.get(responseId);
            if (existing) existing.runtime = record;
        }),
        saveAction: vi.fn(async (responseId: number, _org: number, actionId: string, record: ActionRecord) => {
            const existing = responses.get(responseId);
            if (existing?.runtime) existing.runtime.actions[actionId] = record;
        }),
        startPipeline: vi.fn(async () => ({ success: true, executionId: 5501 })),
        sendNotification: vi.fn(async () => undefined),
        now: () => new Date("2026-09-12T12:00:00Z"),
        ...overrides,
    };
    return deps;
}

async function submit(deps: ReturnType<typeof fakeDeps>, inputs: Record<string, unknown>, definition = beta) {
    const { values, decision } = evaluateStudio(definition, inputs, true);
    deps.responses.set(3001, { id: 3001, data: values, runtime: null });
    const runtime = createFormStudioRuntime(deps);
    const record = await runtime.afterSubmit({
        form: { id: 55, name: "Beta validation", organizationId: ORG, createdBy: "owner-1" },
        releaseNumber: 2,
        definition,
        responseId: 3001,
        values,
        decision,
    });
    return { runtime, record, decision, values };
}

const approvalFor = (deps: ReturnType<typeof fakeDeps>, actionId: string) => {
    const call = (deps.createApproval as any).mock.calls.find(([input]: any[]) => input.context.actionId === actionId);
    return { id: (deps.createApproval as any).mock.results[(deps.createApproval as any).mock.calls.indexOf(call)].value, context: call[0].context as FormActionContext };
};

describe("submitting a response", () => {
    it("records GA_LAUNCH_BLOCKED, asks for approval, and starts nothing", async () => {
        const deps = fakeDeps();
        const { record, decision } = await submit(deps, { p0_blocking_bugs_open: 1 });

        expect(decision).toMatchObject({ state: "decided", status: "GA_LAUNCH_BLOCKED" });
        expect(record.actions.open_incident).toMatchObject({ status: "awaiting_approval", approvalId: expect.any(Number) });
        expect(record.actions.tell_pm).toMatchObject({ status: "awaiting_approval" });
        expect(deps.createApproval).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: ORG,
            executionId: "form_response:3001:open_incident",
            approverId: "owner-1",
            approverEmail: "owner@example.com",
            context: expect.objectContaining({ kind: "form_action", pipelineId: 41, status: "GA_LAUNCH_BLOCKED", responseId: 3001 }),
        }));
        expect(deps.startPipeline).not.toHaveBeenCalled();
        expect(deps.sendNotification).not.toHaveBeenCalled();
    });

    it("writes the answers to the form's dataset, with where they came from kept apart", async () => {
        const deps = fakeDeps();
        const { record } = await submit(deps, { p0_blocking_bugs_open: 1, launch_notes: "crash on login" });
        expect(deps.addDatasetItem).toHaveBeenCalledWith({
            organizationId: ORG,
            datasetId: 12,
            data: expect.objectContaining({ p0_blocking_bugs_open: 1, launch_notes: "crash on login" }),
            rawData: { formStudio: { formId: 55, releaseNumber: 2, responseId: 3001, status: "GA_LAUNCH_BLOCKED" } },
        });
        expect(record.dataset).toEqual({ datasetId: 12, status: "recorded", itemId: 900 });
    });

    it("keeps the response when the dataset or the event fails, and says what failed", async () => {
        const deps = fakeDeps({
            addDatasetItem: vi.fn(async () => { throw new Error("Dataset not found"); }),
            publishEvent: vi.fn(async () => { throw new Error("Redis down"); }),
        });
        const { record } = await submit(deps, { p0_blocking_bugs_open: 0 });
        expect(record.dataset).toEqual({ datasetId: 12, status: "failed", error: "Dataset not found" });
        expect(record.event).toEqual({ status: "failed", error: "Redis down" });
        expect(deps.saveSubmission).toHaveBeenCalledWith(3001, ORG, record);
    });

    it("raises no approvals when no rule fired an action", async () => {
        const deps = fakeDeps();
        const { record, decision } = await submit(deps, { p0_blocking_bugs_open: 0 });
        expect(decision).toMatchObject({ status: "PROCEED_TO_GENERAL_AVAILABILITY" });
        expect(record.actions).toEqual({});
        expect(deps.createApproval).not.toHaveBeenCalled();
        expect(deps.publishEvent).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ status: "PROCEED_TO_GENERAL_AVAILABILITY", responseId: 3001 }) }));
    });

    it("refuses a pipeline that is not in the organization, without raising an approval for it", async () => {
        const deps = fakeDeps({ pipelineInOrg: vi.fn(async () => false) });
        const { record } = await submit(deps, { p0_blocking_bugs_open: 2 });
        expect(record.actions.open_incident).toMatchObject({ status: "failed", error: "Pipeline #41 is not in this organization." });
        expect((deps.createApproval as any).mock.calls.map(([input]: any[]) => input.context.actionId)).toEqual(["tell_pm"]);
    });
});

describe("deciding on an action", () => {
    it("starts the pipeline once, only after approval, with the response's answers", async () => {
        const deps = fakeDeps();
        const { runtime } = await submit(deps, { p0_blocking_bugs_open: 1 });
        const { context } = approvalFor(deps, "open_incident");
        const request = { id: 101, organizationId: ORG, modifiedOutput: context };

        const outcome = await runtime.onActionDecision(request, "approved", { userId: "u-9", email: "approver@example.com", comments: null });
        expect(outcome).toMatchObject({ handled: true, success: true, status: "started" });
        await (outcome as any).completion;

        expect(deps.startPipeline).toHaveBeenCalledTimes(1);
        expect(deps.startPipeline).toHaveBeenCalledWith({
            pipelineId: 41, organizationId: ORG, userId: "u-9",
            variables: { formResponse: expect.objectContaining({ formId: 55, responseId: 3001, actionId: "open_incident", status: "GA_LAUNCH_BLOCKED", values: expect.objectContaining({ p0_blocking_bugs_open: 1 }) }) },
        });
        expect(deps.responses.get(3001)!.runtime!.actions.open_incident).toMatchObject({ status: "started", executionId: 5501, decidedBy: "approver@example.com" });

        const again = await runtime.onActionDecision(request, "approved", { userId: "u-9", email: "approver@example.com", comments: null });
        expect(again).toMatchObject({ handled: true, alreadyDecided: true, status: "started" });
        expect(deps.startPipeline).toHaveBeenCalledTimes(1);
    });

    it("records a rejection on the response and starts nothing", async () => {
        const deps = fakeDeps();
        const { runtime } = await submit(deps, { p0_blocking_bugs_open: 1 });
        const { context } = approvalFor(deps, "open_incident");
        const outcome = await runtime.onActionDecision({ id: 101, organizationId: ORG, modifiedOutput: context }, "rejected", { userId: "u-9", email: null, comments: "Known flake, not a real P0" });
        expect(outcome).toMatchObject({ handled: true, status: "rejected" });
        expect(deps.startPipeline).not.toHaveBeenCalled();
        expect(deps.responses.get(3001)!.runtime!.actions.open_incident).toMatchObject({ status: "rejected", comments: "Known flake, not a real P0", decidedBy: "u-9" });
    });

    it("records a pipeline run that failed", async () => {
        const deps = fakeDeps({ startPipeline: vi.fn(async () => ({ success: false, executionId: 5502, error: "Step 2 failed" })) });
        const { runtime } = await submit(deps, { p0_blocking_bugs_open: 1 });
        const { context } = approvalFor(deps, "open_incident");
        const outcome = await runtime.onActionDecision({ id: 101, organizationId: ORG, modifiedOutput: context }, "approved", { userId: "u-9", email: null, comments: null });
        await (outcome as any).completion;
        expect(deps.responses.get(3001)!.runtime!.actions.open_incident).toMatchObject({ status: "failed", executionId: 5502, error: "Step 2 failed" });
    });

    it("sends an approved notification", async () => {
        const deps = fakeDeps();
        const { runtime } = await submit(deps, { p0_blocking_bugs_open: 1 });
        const { context } = approvalFor(deps, "tell_pm");
        const outcome = await runtime.onActionDecision({ id: 102, organizationId: ORG, modifiedOutput: context }, "approved", { userId: "u-9", email: null, comments: null });
        expect(outcome).toMatchObject({ status: "sent" });
        expect(deps.sendNotification).toHaveBeenCalledWith({ channel: "email", target: "pm@example.com", subject: "Beta validation: Tell the PM", body: "GA is blocked." });
    });

    it("leaves every other kind of approval alone", async () => {
        const runtime = createFormStudioRuntime(fakeDeps());
        expect(await runtime.onActionDecision({ id: 1, organizationId: ORG, modifiedOutput: { kind: "assembly_deployment" } }, "approved", { userId: "u", email: null, comments: null })).toEqual({ handled: false });
        expect(await runtime.onActionDecision({ id: 1, organizationId: ORG, modifiedOutput: null }, "approved", { userId: "u", email: null, comments: null })).toEqual({ handled: false });
    });
});
