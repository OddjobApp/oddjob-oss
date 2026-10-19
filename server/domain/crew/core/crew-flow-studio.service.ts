/**
 * Flow Studio actions taken directly inside a crew room: creating the flow on a
 * card someone approved.
 *
 * The same shape as Form Studio's (crew-form-studio.service.ts). What a message
 * does is decided by decideFlowStudioAction, a pure function over the message;
 * this file only carries it out.
 *
 * Creating is reached from HERE and nowhere else. It is not a tool, so no model
 * can decide mid-conversation to put a running automation into an organization —
 * the card a person read is the only thing that can.
 *
 * Drafting is not handled here at all: asking for a flow is a REQUEST, answered
 * by the room's speakers reaching for `propose_flow` after `list_jobs`.
 */

import type { AgentCardRecord } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import {
    decideFlowStudioAction,
    findFlowCreateProposal,
    FLOW_CREATED,
    type FlowCreateProposal,
} from "@shared/flow-studio-crew.js";
import { postTurn } from "./crew-form-studio.service.js";
import type { RoundContext } from "./crew-round-context.js";

const logger = createLogger("CrewFlowStudio");

export async function runDirectFlowStudioAction(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    if (!card) return false;
    const action = decideFlowStudioAction(ctx.message);
    if (action.kind !== "create") return false;
    return createFlowFromProposal(ctx, card, action.proposalId);
}

/**
 * Create the pipeline on a card someone approved.
 *
 * The draft is read back from the room's own history rather than from the
 * message, so what is created is what was on screen — not a re-reading of the
 * request, which could differ from what the person agreed to.
 */
async function createFlowFromProposal(ctx: RoundContext, card: AgentCardRecord, proposalId: string): Promise<boolean> {
    const found = findFlowCreateProposal(ctx.priorTurns as never, proposalId);
    if (!found) {
        await postTurn(ctx, card, {
            content: "I can't find that draft in this room any more. Ask again and I'll draft it fresh.",
        });
        return true;
    }
    if (found.created) {
        await postTurn(ctx, card, { content: `That draft has already been created — the flow "${found.proposal.name}" exists.` });
        return true;
    }

    const proposal: FlowCreateProposal = found.proposal;
    try {
        const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");

        const created = await pipelineService.create(
            {
                name: proposal.name,
                description: proposal.instruction,
                // Slice 1 builds flows a person starts. Schedules and webhooks carry
                // their own configuration and credentials, so they are their own step.
                triggerType: "manual",
                isActive: true,
                steps: proposal.steps.map((step, index) => ({
                    jobId: step.jobId,
                    order: index,
                    outputName: step.outputName,
                    conditionExpression: step.conditionExpression,
                    // insertSteps turns this into the stored display string; writing
                    // "Continue to Next" here would bypass that and drift from it.
                    onError: step.onError === "continue" ? "continue" : "stop",
                    // Left unset on purpose: an unset moduleType is what routes a step
                    // down the job path in pipeline-step-runner. "tool" and "forge" are
                    // the only other values the runner dispatches on.
                })),
            },
            {
                // Passed through, never defaulted to a made-up name.
                // pipeline_versions.created_by has an FK to users.id while
                // pipelines.created_by does not, so a creator string that is not
                // a real user still creates the flow but loses its initial
                // version snapshot into a logger.warn inside pipelineEngine.create.
                userId: ctx.userId,
                organizationId: ctx.orgId,
                isAdmin: false,
                isSuperAdmin: false,
                isOrgAdmin: false,
            } as never,
        );

        // Register the workflow draft over the new pipeline. This is additive to
        // flow creation: a failure here is logged, never reported to the room as
        // a failed create — the pipeline itself exists either way.
        let workflowId: number | undefined;
        try {
            const { workflowLifecycleService } = await import("@domain/pipeline/core/workflow-lifecycle.service.js");
            const workflow = await workflowLifecycleService.createFromPipeline(
                {
                    userId: ctx.userId ?? "system",
                    organizationId: ctx.orgId,
                    isAdmin: false,
                    isSuperAdmin: false,
                    isOrgAdmin: false,
                } as never,
                {
                    pipelineId: created.id,
                    projectId: ctx.projectId,
                    title: proposal.name,
                    description: proposal.instruction,
                },
            );
            workflowId = workflow.id;
        } catch (wfError: any) {
            logger.warn(`Registering workflow for flow draft ${proposalId} failed: ${wfError?.message ?? wfError}`);
        }

        const pauses = proposal.steps.some((step) => step.jobType === "human_approval");
        await postTurn(ctx, card, {
            content:
                `"${proposal.name}" exists now, with ${proposal.steps.length} step${proposal.steps.length === 1 ? "" : "s"}.` +
                (pauses ? " It pauses partway for an approval, and waits there until someone gives it." : "") +
                " It runs when someone starts it — nothing has run yet." +
                (workflowId != null
                    ? ctx.projectId != null
                        ? " It is saved as a workflow draft in this project; publish a release to make it operational."
                        : " It is saved as a workflow draft; publish a release to make it operational."
                    : ""),
            // This artifact doubles as the record that the draft was used: see
            // findFlowCreateProposal, which reads it to stop a second press
            // creating a twin.
            artifact: {
                tool: "propose_flow",
                payload: {
                    type: FLOW_CREATED,
                    proposalId: proposal.proposalId,
                    pipelineId: created.id,
                    workflowId,
                    name: proposal.name,
                    stepCount: proposal.steps.length,
                },
            } as never,
        });
        return true;
    } catch (error: any) {
        logger.warn(`Creating flow draft ${proposalId} failed: ${error?.message ?? error}`);
        await postTurn(ctx, card, {
            content: `That flow could not be created: ${error?.message ?? "no reason was given"}.`,
        });
        return true;
    }
}
