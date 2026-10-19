/**
 * Applying a studio contribution an agent proposed and a person approved.
 *
 * `propose_studio_contribution` posts a card; the card's Apply button sends
 * `Apply contribution "<id>".` as an ordinary room message. This file is the
 * only consumer of that message — the same shape as Form Studio's apply path:
 * the payload comes from the card's artifact, the message is only the approval.
 *
 * The chained `applyAction` runs as a registry call that no agent can reach on
 * its own — the tool list offered to a model never includes it, so the only way
 * it executes is a person pressing Apply on a card that is actually in the room.
 */

import {
    parseContributionApply,
    findContributionProposal,
} from "@shared/studio-contribution.js";
import type { AgentCardRecord } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import type { RoundContext } from "./crew-round-context.js";
import { crewToolsService } from "./crew-tools.service.js";
import { postTurn, registryTool, toolContext } from "./crew-form-studio.service.js";
import { STUDIO_DESTRUCTIVE_ACTIONS } from './crew-studio-tools.js';

const logger = createLogger("CrewContribution");

/** Tool calls a proposal may chain. Everything else is refused, card or not. */
function applyActionAllowed(tool: string, def: { adminOnly?: boolean; superAdminOnly?: boolean; riskLevel?: string } | undefined, approvedDestructive = false): boolean {
    if (!def) return false;
    if (def.adminOnly || def.superAdminOnly) return false;
    if (def.riskLevel === "high" && !approvedDestructive) return false;
    // No recursion — a proposal cannot approve another proposal.
    if (tool === "apply_studio_contribution" || tool === "propose_studio_contribution") return false;
    return true;
}

/**
 * Handle `Apply contribution "<id>".` — and nothing else. Returns false for any
 * other message so the round falls through to the speakers.
 */
export async function runDirectContributionApply(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    if (!card) return false;
    const parsed = parseContributionApply(ctx.message);
    if (!parsed) return false;

    const found = findContributionProposal(ctx.priorTurns as any, parsed.proposalId);
    if (!found) {
        await postTurn(ctx, card, { content: "That contribution isn't in this room, so there is nothing to apply." });
        return true;
    }
    if (found.applied) {
        await postTurn(ctx, card, { content: `That contribution to "${found.proposal.targetLabel}" has already been applied.` });
        return true;
    }

    const { proposal } = found;
    if (!proposal.applyAction) {
        await postTurn(ctx, card, { content: `The contribution to "${proposal.targetLabel}" has no executable change attached, so it was not applied.` });
        return true;
    }

    // The downstream call the card carries, if it carries one. The tool must
    // exist in the registry and stay inside the lines the room already draws —
    // no admin tools or chained proposals; high-risk calls require an exact
    // match to the curated destructive action and the approved resource ID.
    let chained: { tool: string; args: Record<string, unknown> } | null = null;
    if (proposal.applyAction) {
        const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
        const def = getAgentTools()[proposal.applyAction.tool];
        const destructive = Object.hasOwn(STUDIO_DESTRUCTIVE_ACTIONS, proposal.applyAction.tool)
            ? STUDIO_DESTRUCTIVE_ACTIONS[proposal.applyAction.tool] : undefined;
        const approvedDestructive = Boolean(destructive && destructive.studio === proposal.targetStudio &&
            proposal.targetId !== undefined && proposal.applyAction.args[destructive.idField] === proposal.targetId);
        if ((destructive && !approvedDestructive) || !applyActionAllowed(proposal.applyAction.tool, def, approvedDestructive)) {
            await postTurn(ctx, card, {
                content: `The contribution to "${proposal.targetLabel}" names a call ("${proposal.applyAction.tool}") this room cannot make, so it was not applied.`,
            });
            return true;
        }
        chained = approvedDestructive
            ? { tool: proposal.applyAction.tool, args: { ...proposal.applyAction.args, userConfirmed: true } }
            : proposal.applyAction;
    }

    const allowed = await registryTool("apply_studio_contribution", "declared-agent-tool");
    if (!allowed) return false;

    const context = toolContext(ctx);

    // The chained call first — the marker only makes sense once the change it
    // stands for has happened. A failed chain leaves the card unapplied, so the
    // person can see the failure and decide rather than finding a marker that
    // says "applied" over a change that never ran.
    let chainRecord = null;
    if (chained) {
        const chainAllowed = await registryTool(chained.tool, "declared-agent-tool");
        if (!chainAllowed) {
            await postTurn(ctx, card, { content: `The contribution to "${proposal.targetLabel}" could not resolve its change tool, so it was not applied.` });
            return true;
        }
        if (chainAllowed) {
            const result = await crewToolsService.execute(chained.tool, chained.args, chainAllowed, context);
            ctx.cost.toolCalls++;
            chainRecord = result.record;
            if (!result.record.ok) {
                await postTurn(ctx, card, {
                    content: `The contribution to "${proposal.targetLabel}" was approved, but the change failed: ${result.record.error ?? result.output}`,
                    record: result.record,
                });
                return true;
            }
        }
    }

    const { record, output, artifact } = await crewToolsService.execute(
        "apply_studio_contribution",
        { proposalId: proposal.proposalId },
        allowed,
        context,
    );
    ctx.cost.toolCalls++;

    await postTurn(ctx, card, {
        content: record.ok
            ? `Applied the contribution to "${proposal.targetLabel}".`
            : `The contribution was not applied: ${record.error ?? output}`,
        artifact,
        record: chainRecord ?? record,
    });
    return true;
}
