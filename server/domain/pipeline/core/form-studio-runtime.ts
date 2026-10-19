import type { StudioDefinition } from "@shared/form-studio.js";

/**
 * What happens after a Form Studio response is submitted, and after someone
 * decides on an action it raised.
 *
 * A submission writes a record to the form's dataset when it names one, turns
 * each action the decision rules fired into an approval request, and publishes a
 * `form_submitted` event that pipeline triggers can subscribe to. Nothing runs
 * on submission itself: an action starts its pipeline, or sends its message,
 * only when a person approves it, and a rejection is recorded on the response.
 *
 * Kept free of the database and services so the rules can be tested on their
 * own; form-studio-runtime.service.ts supplies the real dependencies.
 */

type StudioAction = StudioDefinition["studio"]["actions"][number];

export type ActionStatus = "awaiting_approval" | "started" | "sent" | "rejected" | "failed";

export interface ActionRecord {
    type: StudioAction["type"];
    label: string;
    status: ActionStatus;
    approvalId?: number;
    executionId?: number;
    decidedBy?: string | null;
    comments?: string | null;
    error?: string;
    at: string;
}

export interface SubmissionRecord {
    dataset?: { datasetId: number; status: "recorded"; itemId?: number } | { datasetId: number; status: "failed"; error: string };
    event?: { status: "published" } | { status: "failed"; error: string };
    actions: Record<string, ActionRecord>;
}

/** The proposal an approval request carries for a form action. */
export interface FormActionContext {
    kind: "form_action";
    formId: number;
    formName: string;
    responseId: number;
    releaseNumber: number;
    actionId: string;
    actionType: StudioAction["type"];
    actionLabel: string;
    pipelineId?: number;
    channel?: string;
    to?: string;
    message?: string;
    /** The status the decision rules reached, e.g. GA_LAUNCH_BLOCKED. */
    status: string;
    stepName: string;
    description: string;
    riskLevel: "medium";
    approverRole?: string;
}

export type SubmittedDecision =
    | { state: "decided"; status: string; ruleId: string | null; actions: string[] }
    | { state: string; [key: string]: unknown };

export interface RuntimeDeps {
    /** Must refuse a dataset that is not in the organization. */
    addDatasetItem(input: { organizationId: number; datasetId: number; data: Record<string, unknown>; rawData: Record<string, unknown> }): Promise<{ itemId?: number }>;
    pipelineInOrg(pipelineId: number, organizationId: number): Promise<boolean>;
    formOwner(createdBy: string | null): Promise<{ id: string | null; email: string | null }>;
    createApproval(input: { organizationId: number; executionId: string; approverId: string | null; approverEmail: string; context: FormActionContext }): Promise<{ id: number }>;
    publishEvent(input: { organizationId: number; formId: number; payload: Record<string, unknown> }): Promise<void>;
    loadResponse(responseId: number, organizationId: number): Promise<{ id: number; data: Record<string, unknown>; runtime: SubmissionRecord | null } | null>;
    saveSubmission(responseId: number, organizationId: number, record: SubmissionRecord): Promise<void>;
    saveAction(responseId: number, organizationId: number, actionId: string, record: ActionRecord): Promise<void>;
    startPipeline(input: { pipelineId: number; organizationId: number; userId: string; variables: Record<string, unknown> }): Promise<{ success: boolean; executionId?: number; error?: string }>;
    sendNotification(input: { channel: "email" | "slack"; target: string; subject: string; body: string }): Promise<void>;
    now(): Date;
}

export interface SubmittedResponse {
    form: { id: number; name: string; organizationId: number; createdBy: string | null };
    releaseNumber: number;
    definition: StudioDefinition;
    responseId: number;
    values: Record<string, unknown>;
    decision: SubmittedDecision;
}

export type DecisionOutcome =
    | { handled: false }
    | { handled: true; success: boolean; status?: ActionStatus; error?: string; alreadyDecided?: boolean; completion?: Promise<void> };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createFormStudioRuntime(deps: RuntimeDeps) {
    const at = () => deps.now().toISOString();

    return {
        async afterSubmit(submitted: SubmittedResponse): Promise<SubmissionRecord> {
            const { form, definition, responseId, values, decision, releaseNumber } = submitted;
            const { studio } = definition;
            const organizationId = form.organizationId;
            const status = decision.state === "decided" ? String(decision.status) : null;
            const record: SubmissionRecord = { actions: {} };

            if (studio.dataset) {
                const { datasetId } = studio.dataset;
                try {
                    const { itemId } = await deps.addDatasetItem({
                        organizationId,
                        datasetId,
                        // The answers are the record. Where it came from travels beside them,
                        // so a dataset's own validation sees only the fields it defines.
                        data: { ...values },
                        rawData: { formStudio: { formId: form.id, releaseNumber, responseId, status } },
                    });
                    record.dataset = { datasetId, status: "recorded", ...(itemId ? { itemId } : {}) };
                } catch (error) {
                    record.dataset = { datasetId, status: "failed", error: messageOf(error) };
                }
            }

            if (decision.state === "decided" && Array.isArray(decision.actions) && decision.actions.length) {
                const owner = await deps.formOwner(form.createdBy);
                for (const actionId of decision.actions as string[]) {
                    const action = studio.actions.find((candidate) => candidate.id === actionId);
                    if (!action) {
                        record.actions[actionId] = { type: "notify", label: actionId, status: "failed", error: "A decision rule names an action this form does not define.", at: at() };
                        continue;
                    }
                    if (action.type === "start_pipeline" && !(await deps.pipelineInOrg(action.pipelineId, organizationId))) {
                        record.actions[action.id] = { type: action.type, label: action.label, status: "failed", error: `Pipeline #${action.pipelineId} is not in this organization.`, at: at() };
                        continue;
                    }
                    const context: FormActionContext = {
                        kind: "form_action",
                        formId: form.id,
                        formName: form.name,
                        responseId,
                        releaseNumber,
                        actionId: action.id,
                        actionType: action.type,
                        actionLabel: action.label,
                        ...(action.type === "start_pipeline"
                            ? { pipelineId: action.pipelineId, ...(action.approverRole ? { approverRole: action.approverRole } : {}) }
                            : { channel: action.channel, to: action.to, message: action.message }),
                        status: status ?? "",
                        stepName: `${form.name}: ${action.label}`,
                        description: action.type === "start_pipeline"
                            ? `Response #${responseId} to "${form.name}" reached ${status}. Approving starts pipeline #${action.pipelineId}.`
                            : `Response #${responseId} to "${form.name}" reached ${status}. Approving sends a ${action.channel} message to ${action.to}.`,
                        riskLevel: "medium",
                    };
                    try {
                        const approval = await deps.createApproval({
                            organizationId,
                            executionId: `form_response:${responseId}:${action.id}`,
                            approverId: owner.id,
                            // approval_requests.approver_email is required. Org admins see every
                            // request in the Decision Inbox, so an owner without an email is still reached.
                            approverEmail: owner.email ?? `form-owner:${owner.id ?? form.id}`,
                            context,
                        });
                        record.actions[action.id] = { type: action.type, label: action.label, status: "awaiting_approval", approvalId: approval.id, at: at() };
                    } catch (error) {
                        record.actions[action.id] = { type: action.type, label: action.label, status: "failed", error: messageOf(error), at: at() };
                    }
                }
            }

            try {
                await deps.publishEvent({
                    organizationId,
                    formId: form.id,
                    payload: { formId: form.id, formName: form.name, releaseNumber, responseId, status, values: { ...values } },
                });
                record.event = { status: "published" };
            } catch (error) {
                // The event only triggers other pipelines. Losing it must not lose the response.
                record.event = { status: "failed", error: messageOf(error) };
            }

            await deps.saveSubmission(responseId, organizationId, record);
            return record;
        },

        async onActionDecision(
            request: { id: number; organizationId: number | null; modifiedOutput: unknown },
            decision: "approved" | "rejected",
            by: { userId: string; email: string | null; comments: string | null },
        ): Promise<DecisionOutcome> {
            const meta = request.modifiedOutput as FormActionContext | null;
            if (meta?.kind !== "form_action") return { handled: false };
            const organizationId = request.organizationId;
            if (organizationId == null) return { handled: true, success: false, error: "The approval has no organization." };

            const response = await deps.loadResponse(meta.responseId, organizationId);
            if (!response) return { handled: true, success: false, error: "The response this action belongs to no longer exists." };

            const current = response.runtime?.actions?.[meta.actionId];
            if (current && current.status !== "awaiting_approval") {
                return { handled: true, success: true, status: current.status, alreadyDecided: true };
            }

            const base = { type: meta.actionType, label: meta.actionLabel, approvalId: request.id, decidedBy: by.email ?? by.userId };
            const save = async (record: ActionRecord) => {
                await deps.saveAction(meta.responseId, organizationId, meta.actionId, record);
                return record;
            };

            if (decision === "rejected") {
                await save({ ...base, status: "rejected", comments: by.comments, at: at() });
                return { handled: true, success: true, status: "rejected" };
            }

            if (meta.actionType === "start_pipeline") {
                // Checked again: the pipeline may have moved or been deleted since the request was raised.
                if (!meta.pipelineId || !(await deps.pipelineInOrg(meta.pipelineId, organizationId))) {
                    const error = `Pipeline #${meta.pipelineId} is not in this organization.`;
                    await save({ ...base, status: "failed", error, at: at() });
                    return { handled: true, success: false, status: "failed", error };
                }
                await save({ ...base, status: "started", at: at() });
                // A pipeline run can take minutes, so the decision returns now and the run's
                // outcome is written to the response when it finishes.
                const completion = deps.startPipeline({
                    pipelineId: meta.pipelineId,
                    organizationId,
                    userId: by.userId,
                    variables: {
                        formResponse: {
                            formId: meta.formId, formName: meta.formName, responseId: meta.responseId, releaseNumber: meta.releaseNumber,
                            actionId: meta.actionId, status: meta.status, values: response.data,
                        },
                    },
                })
                    .then(async (result) => {
                        await save(result.success
                            ? { ...base, status: "started", ...(result.executionId ? { executionId: result.executionId } : {}), at: at() }
                            : { ...base, status: "failed", ...(result.executionId ? { executionId: result.executionId } : {}), error: result.error ?? "The pipeline run failed.", at: at() });
                    })
                    .catch(async (error) => {
                        await save({ ...base, status: "failed", error: messageOf(error), at: at() }).catch(() => undefined);
                    });
                return { handled: true, success: true, status: "started", completion };
            }

            if (meta.channel !== "email" && meta.channel !== "slack") {
                const error = `${meta.channel ?? "This"} notifications cannot be sent yet.`;
                await save({ ...base, status: "failed", error, at: at() });
                return { handled: true, success: false, status: "failed", error };
            }
            try {
                await deps.sendNotification({ channel: meta.channel, target: meta.to ?? "", subject: meta.stepName, body: meta.message ?? meta.description });
                await save({ ...base, status: "sent", at: at() });
                return { handled: true, success: true, status: "sent" };
            } catch (error) {
                await save({ ...base, status: "failed", error: messageOf(error), at: at() });
                return { handled: true, success: false, status: "failed", error: messageOf(error) };
            }
        },
    };
}

export type FormStudioRuntime = ReturnType<typeof createFormStudioRuntime>;
