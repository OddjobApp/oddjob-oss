import { and, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { approvalRequests, pipelines, pipelineSteps } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PipelineRunProposals");

/**
 * An agent asking for a pipeline to run, behind a human approval.
 *
 * run_pipeline starts a run at once and is admin-only, so a CREW agent could
 * only describe a run and hope someone started it. A proposal is a pending
 * approval carrying the pipeline and its inputs; approving it is what starts
 * the run. Everything the run uses is read from the stored request, never
 * from the approver's modifiedOutput, so an edit at approval time cannot
 * point it at a different pipeline or change its inputs.
 */
export interface PipelineRunRequest {
    kind: "pipeline_run";
    pipelineId: number;
    pipelineName: string;
    inputData: Record<string, unknown>;
    reason: string;
    sessionKey: string | null;
    description: string;
    stepName: string;
    riskLevel: "medium";
}

export type PipelineRunDecisionOutcome =
    | { handled: false }
    | { handled: true; success: true; status: "rejected" | "started" }
    | { handled: true; success: false; status: "failed"; error: string };

export interface PipelineRunProposalDeps {
    /** The pipeline, only when it belongs to the organization. */
    findPipeline(pipelineId: number, organizationId: number): Promise<{ id: number; name: string; stepCount: number } | null>;
    findPipelineByName(name: string, organizationId: number): Promise<{ id: number; name: string; stepCount: number } | null>;
    validateInputs(pipelineId: number, inputs: Record<string, unknown>): Promise<string[]>;
    requestApproval(input: { organizationId: number; executionId: string; approverId?: string; approverEmail?: string; context: PipelineRunRequest }): Promise<{ id: number }>;
    /** Runs to completion; the decision does not wait for it. */
    runPipeline(input: { pipelineId: number; userId: string; variables: Record<string, unknown> }): Promise<{ success: boolean; executionId?: number; error?: string }>;
    recordOutcome(approvalId: number, organizationId: number, outcome: Record<string, unknown>): Promise<void>;
    now(): Date;
}

export class PipelineRunProposalError extends Error {}

export function createPipelineRunProposals(deps: PipelineRunProposalDeps) {
    return {
        async propose(
            input: { pipelineId?: number; pipelineName?: string; inputData?: Record<string, unknown>; reason: string; sessionKey?: string | null },
            requester: { organizationId: number; userId: string | null; email: string | null; isOrgAdmin: boolean },
        ) {
            const pipeline = input.pipelineId != null
                ? await deps.findPipeline(input.pipelineId, requester.organizationId)
                : input.pipelineName ? await deps.findPipelineByName(input.pipelineName, requester.organizationId) : null;
            if (!pipeline) {
                throw new PipelineRunProposalError(input.pipelineId != null || input.pipelineName
                    ? `Pipeline ${input.pipelineId ?? `"${input.pipelineName}"`} not found in this organization.`
                    : "Name the pipeline to run (pipelineId or pipelineName).");
            }
            if (pipeline.stepCount === 0) throw new PipelineRunProposalError(`Pipeline "${pipeline.name}" has no steps, so there is nothing to run.`);

            const inputData = input.inputData ?? {};
            const invalid = await deps.validateInputs(pipeline.id, inputData);
            if (invalid.length) throw new PipelineRunProposalError(`Inputs for "${pipeline.name}" are invalid:\n${invalid.map((line) => `- ${line}`).join("\n")}`);

            const at = deps.now();
            const request: PipelineRunRequest = {
                kind: "pipeline_run", pipelineId: pipeline.id, pipelineName: pipeline.name, inputData,
                reason: input.reason, sessionKey: input.sessionKey ?? null,
                description: `Run the pipeline "${pipeline.name}".`, stepName: pipeline.name, riskLevel: "medium",
            };
            // Running a pipeline is admin-only (run_pipeline), so a requester who is not an
            // org admin is not made the designated approver of their own run. The id ends in
            // a letter and a timestamp: the Decision Inbox reads ":<digits>" as a mission
            // run, and approval resumption reads trailing digits as a pipeline step.
            const approval = await deps.requestApproval({
                organizationId: requester.organizationId,
                executionId: `pipeline_run:${pipeline.id}:t${at.getTime()}`,
                ...(requester.isOrgAdmin && requester.userId ? { approverId: requester.userId } : {}),
                ...(requester.isOrgAdmin && requester.email ? { approverEmail: requester.email } : {}),
                context: request,
            });
            return { approvalId: approval.id, request };
        },

        /** Called by approvalService.processDecision with the stored request. */
        async onRunDecision(
            request: { id: number; organizationId: number | null; modifiedOutput: unknown },
            decision: "approved" | "rejected",
            decider: { userId: string; email: string | null; adminRole?: { isOrgAdmin?: boolean; isSuperAdmin?: boolean; organizationId?: number | null } | null },
        ): Promise<PipelineRunDecisionOutcome> {
            const run = request.modifiedOutput as PipelineRunRequest | null;
            if (run?.kind !== "pipeline_run" || request.organizationId == null) return { handled: false };
            const organizationId = request.organizationId;
            const decidedAt = deps.now().toISOString();

            const fail = async (error: string): Promise<PipelineRunDecisionOutcome> => {
                await deps.recordOutcome(request.id, organizationId, { state: "failed", error, decidedBy: decider.email, decidedAt });
                return { handled: true, success: false, status: "failed", error };
            };

            if (decision === "rejected") {
                await deps.recordOutcome(request.id, organizationId, { state: "rejected", decidedBy: decider.email, decidedAt });
                return { handled: true, success: true, status: "rejected" };
            }
            const role = decider.adminRole;
            if (!role?.isSuperAdmin && !(role?.isOrgAdmin && role.organizationId === organizationId)) {
                return fail("Running a pipeline needs an org admin's approval.");
            }
            // The pipeline may have been deleted or moved since the proposal.
            const pipeline = await deps.findPipeline(run.pipelineId, organizationId);
            if (!pipeline) return fail(`Pipeline ${run.pipelineId} no longer exists in this organization.`);

            await deps.recordOutcome(request.id, organizationId, { state: "running", decidedBy: decider.email, decidedAt });
            // A run can take minutes; the approver is not held for it. Its result is written
            // to the approval, and to pipeline_executions, where list_recent_executions reads it.
            void deps.runPipeline({ pipelineId: run.pipelineId, userId: decider.userId, variables: run.inputData ?? {} })
                .then((result) => deps.recordOutcome(request.id, organizationId, {
                    // A pre-flight failure reports executionId -1: no run row exists.
                    state: result.success ? "succeeded" : "failed",
                    executionId: result.executionId != null && result.executionId > 0 ? result.executionId : null,
                    ...(result.success ? {} : { error: result.error ?? "The run failed." }),
                    decidedBy: decider.email, decidedAt, finishedAt: deps.now().toISOString(),
                }))
                .catch((error) => logger.error(`Pipeline run for approval ${request.id} failed to record:`, error?.message ?? error));
            return { handled: true, success: true, status: "started" };
        },
    };
}

async function pipelineSummary(where: ReturnType<typeof and>) {
    const [row] = await db.select({
        id: pipelines.id, name: pipelines.name,
        stepCount: sql<number>`(select count(*)::int from ${pipelineSteps} where ${pipelineSteps.pipelineId} = ${pipelines.id})`,
    }).from(pipelines).where(where).limit(1);
    return row ? { id: row.id, name: row.name, stepCount: Number(row.stepCount) } : null;
}

export const pipelineRunProposals = createPipelineRunProposals({
    findPipeline: (pipelineId, organizationId) =>
        pipelineSummary(and(eq(pipelines.id, pipelineId), eq(pipelines.organizationId, organizationId))),
    findPipelineByName: (name, organizationId) =>
        pipelineSummary(and(eq(pipelines.name, name), eq(pipelines.organizationId, organizationId))),
    async validateInputs(pipelineId, inputs) {
        const { InputValidationService } = await import("@domain/core/input-validation.service.js");
        const result = await InputValidationService.validateInputs(pipelineId, inputs as Record<string, any>);
        return result.isValid ? [] : result.errors.map((e: any) => `${e.field}: ${e.message}`);
    },
    async requestApproval({ organizationId, executionId, approverId, approverEmail, context }) {
        const { approvalService } = await import("@domain/integrations/core/approval.service.js");
        const request = await approvalService.createApprovalRequest({
            executionId, approverType: "internal", approverId, approverEmail, status: "pending", organizationId, context,
        });
        return { id: request.id };
    },
    async runPipeline({ pipelineId, userId, variables }) {
        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
        const result = await pipelineExecutor.executePipeline(pipelineId, userId, null, null, variables);
        return { success: Boolean(result?.success), executionId: result?.executionId, error: result?.error };
    },
    async recordOutcome(approvalId, organizationId, outcome) {
        await db.update(approvalRequests)
            .set({ modifiedOutput: sql`jsonb_set(coalesce(${approvalRequests.modifiedOutput}, '{}'::jsonb), '{outcome}', ${JSON.stringify(outcome)}::jsonb, true)` })
            .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.organizationId, organizationId)));
    },
    now: () => new Date(),
});
