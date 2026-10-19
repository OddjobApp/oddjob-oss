/**
 * Agent Studio actions taken directly inside a crew room: opening the studio, and
 * applying an agent someone approved on a card.
 *
 * The same shape as Form Studio's (crew-form-studio.service.ts). What a message does is
 * decided by decideAgentStudioAction, a pure function over the message; this file only
 * carries it out.
 *
 * Applying is reached from HERE and nowhere else. It is not a tool, so no model can
 * decide mid-conversation to create an agent or widen what an existing one may do — the
 * card a person read is the only thing that can grant a permission.
 */

import type { AgentCardRecord } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import {
    decideAgentStudioAction,
    findAgentProposal,
    mountedAgentStudio,
    agentReferenceFromMessage,
    agentStudioViewFromMessage,
    AGENT_STUDIO_POD,
    type AgentChangeProposal,
} from "@shared/agent-studio.js";
import { crewToolsService } from "./crew-tools.service.js";
import { postTurn, toolContext } from "./crew-form-studio.service.js";
import type { RoundContext } from "./crew-round-context.js";

const logger = createLogger("CrewAgentStudio");

export async function runDirectAgentStudioAction(ctx: RoundContext, card?: AgentCardRecord): Promise<boolean> {
    if (!card) return false;
    const action = decideAgentStudioAction(ctx.message);
    switch (action.kind) {
        case "apply":
            return applyAgentProposal(ctx, card, action.proposalId);
        case "mount":
            return mountAgentStudio(ctx, card);
        default:
            return false;
    }
}

/** Open the studio on the agent the message names, or on the one already open. */
async function mountAgentStudio(ctx: RoundContext, card: AgentCardRecord): Promise<boolean> {
    const availableTools = ctx.prefetch.toolsMap.get(card.id) ?? [];
    if (!availableTools.some((tool) => tool.definition.name === "mount_agent_studio")) return false;

    const open = mountedAgentStudio(ctx.priorTurns as any);
    const reference = agentReferenceFromMessage(ctx.message);
    const view = agentStudioViewFromMessage(ctx.message);
    const params = {
        ...(reference ? { agentName: reference } : open?.agentId ? { agentId: open.agentId } : {}),
        ...(view ? { view } : {}),
    };
    const first = await crewToolsService.execute("mount_agent_studio", params, availableTools, toolContext(ctx));
    ctx.cost.toolCalls++;
    const { record, output, artifact } = first;
    if (!record.ok) return false;

    if (!artifact) {
        await postTurn(ctx, card, { content: output, record });
        return true;
    }
    const props = (artifact.payload as { props?: { agentName?: string } })?.props ?? {};
    await postTurn(ctx, card, {
        content: props.agentName
            ? `Agent Studio is open on "${props.agentName}". Tell me what it should do differently and I'll show you the change — what it would be able to do, and what a run costs — before anything is saved.`
            : "Agent Studio is open on a new agent. Describe what it should do and I'll draft it, with what it would be able to do and what a run costs, before anything is created.",
        artifact,
        record,
    });
    return true;
}

/**
 * Apply the agent on a card someone approved.
 *
 * The proposal is read back from the room's own history rather than from the message, so
 * what is applied is the definition that was on screen — not a re-interpretation of the
 * instruction, which could differ from what the person read and agreed to.
 */
async function applyAgentProposal(ctx: RoundContext, card: AgentCardRecord, proposalId: string): Promise<boolean> {
    const found = findAgentProposal(ctx.priorTurns as any, proposalId);
    if (!found) {
        await postTurn(ctx, card, { content: "I can't find that draft in this room any more. Ask again and I'll draft it fresh." });
        return true;
    }
    if (found.applied) {
        await postTurn(ctx, card, { content: `That draft has already been applied — "${found.proposal.agentName}" exists.` });
        return true;
    }

    const proposal: AgentChangeProposal = found.proposal;
    try {
        const { agentStudioService } = await import("@domain/agent-cards/core/agent-studio.service.js");
        const result = await agentStudioService.apply(
            { userId: ctx.userId, organizationId: ctx.orgId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false } as never,
            proposal,
        );

        const grants = proposal.changes.filter((line) => line.kind === "grant");
        const reach = grants.filter((line) => line.consequential).map((line) => line.after).filter(Boolean);
        await postTurn(ctx, card, {
            content:
                (result.created ? `"${proposal.agentName}" exists now.` : `"${proposal.agentName}" is updated.`) +
                (reach.length ? ` It can act outside the platform with ${reach.join(", ")}; each of those still passes the governor's gate.` : "") +
                " It does nothing until a room or a schedule calls it.",
            // The studio pod doubles as the record that this draft was applied — see
            // findAgentProposal, which reads it to stop a second Apply creating a twin.
            artifact: {
                tool: "mount_agent_studio",
                payload: {
                    type: AGENT_STUDIO_POD,
                    proposalId: proposal.proposalId,
                    props: { agentId: result.agentId, agentName: proposal.agentName, view: "identity" },
                },
            } as never,
        });
        return true;
    } catch (error: any) {
        logger.warn(`Applying agent draft ${proposalId} failed: ${error?.message ?? error}`);
        await postTurn(ctx, card, { content: `That agent could not be saved: ${error?.message ?? "no reason was given"}.` });
        return true;
    }
}
