/**
 * Prediction Studio actions taken directly inside a crew room: creating the
 * prediction job on a card someone approved.
 *
 * The same shape as Flow Studio's (crew-flow-studio.service.ts), and the same
 * reasoning. Creating is reached from HERE and nowhere else — it is not a tool,
 * so no model can decide mid-conversation to put a job into an organization.
 *
 * This is the first path that creates a JOB from a room. `create_job` is
 * deliberately absent from CREW's tool surface: a room can list jobs and nothing
 * more. What makes this acceptable is the same gate Flow Studio uses for
 * pipelines — a card a person read, an approval string anchored to the whole
 * message, and the draft taken from room history rather than re-read from the
 * request. The job is created inactive and runs only when something calls it.
 */

import type { AgentCardRecord } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import {
    decidePredictionStudioAction,
    findPredictionJobProposal,
    PREDICTION_INFERENCE_RESULT,
    type PredictionJobProposal,
} from "@shared/prediction-studio-crew.js";
import { postTurn } from "./crew-form-studio.service.js";
import type { RoundContext } from "./crew-round-context.js";

const logger = createLogger("CrewPredictionStudio");

export async function runDirectPredictionStudioAction(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    if (!card) return false;
    const action = decidePredictionStudioAction(ctx.message);
    if (action.kind !== "create") return false;
    return createPredictionJob(ctx, card, action.proposalId);
}

async function createPredictionJob(ctx: RoundContext, card: AgentCardRecord, proposalId: string): Promise<boolean> {
    const found = findPredictionJobProposal(ctx.priorTurns as never, proposalId);
    if (!found) {
        await postTurn(ctx, card, {
            content: "I can't find that draft in this room any more. Ask again and I'll draft it fresh.",
        });
        return true;
    }
    if (found.created) {
        await postTurn(ctx, card, { content: `That draft has already been created — the job "${found.proposal.name}" exists.` });
        return true;
    }

    const proposal: PredictionJobProposal = found.proposal;
    try {
        const { jobService } = await import("@domain/jobs/job.service.js");

        const job = await jobService.create(
            {
                name: proposal.name,
                description: proposal.instruction,
                type: "prediction_inference",
                config: proposal.config,
                // Created dormant. A job that starts active would begin running on
                // whatever schedule or pipeline picks it up, which is not what
                // pressing Create on a card asks for.
                isActive: false,
            } as never,
            {
                userId: ctx.userId,
                organizationId: ctx.orgId,
                isAdmin: false,
                isSuperAdmin: false,
                isOrgAdmin: false,
            } as never,
        );

        await postTurn(ctx, card, {
            content:
                `"${proposal.name}" exists now as a prediction_inference job. It computes a kinematic trajectory ` +
                `estimate — no model is loaded — and it is inactive until something runs it.`,
            // Doubles as the record that this draft was used: findPredictionJobProposal
            // reads it to stop a second press creating a twin.
            artifact: {
                tool: "propose_prediction_job",
                payload: {
                    type: PREDICTION_INFERENCE_RESULT,
                    proposalId: proposal.proposalId,
                    jobId: (job as { id: number }).id,
                    name: proposal.name,
                },
            } as never,
        });
        return true;
    } catch (error: any) {
        logger.warn(`Creating prediction job draft ${proposalId} failed: ${error?.message ?? error}`);
        await postTurn(ctx, card, {
            content: `That job could not be created: ${error?.message ?? "no reason was given"}.`,
        });
        return true;
    }
}
