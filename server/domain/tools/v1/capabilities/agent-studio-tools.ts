import { z } from "zod";
import type { ToolContext, ToolDefinition } from "./types.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { requireToolOrgId } from "./org-context.js";
import { AGENT_CHANGE_PROPOSAL, AGENT_STUDIO_POD, AGENT_STUDIO_VIEWS } from "@shared/agent-studio.js";

/**
 * Agent Studio in a CREW room: open it on an agent, and draft one from a sentence.
 *
 * Drafting returns a CARD, never an agent. What an agent may do is part of what is being
 * approved — a tool is a permission — so the room proposes and a person applies, the same
 * bargain Form Studio and Media Studio strike. Applying is deliberately not offered to a
 * model at all: it is reached from the card the person is looking at.
 */

function toOrgContext(context: ToolContext): OrgContext {
    return {
        userId: (context as { userId?: string })?.userId ?? "agent",
        organizationId: requireToolOrgId(context),
        isAdmin: Boolean((context as { isAdmin?: boolean })?.isAdmin),
        isSuperAdmin: false,
        isOrgAdmin: Boolean((context as { isOrgAdmin?: boolean })?.isOrgAdmin),
    };
}

/** The agent a room means: by id, by exact name, else the longest name the text contains. */
export function resolveAgent<T extends { id: number; name: string }>(agents: T[], agentId?: number, reference?: string): T | null {
    if (agentId) return agents.find((agent) => agent.id === agentId) ?? null;
    const wanted = (reference ?? "").trim().toLowerCase();
    if (!wanted) return null;
    const exact = agents.find((agent) => agent.name.trim().toLowerCase() === wanted);
    if (exact) return exact;
    const contained = agents
        .filter((agent) => agent.name.trim().length >= 2 && wanted.includes(agent.name.trim().toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length);
    if (contained[0]) return contained[0];
    if (wanted.length >= 3) {
        const substring = agents
            .filter((agent) => agent.name.trim() && agent.name.trim().toLowerCase().includes(wanted))
            .sort((a, b) => a.name.length - b.name.length);
        if (substring[0]) return substring[0];
    }
    return null;
}

export const AGENT_STUDIO_TOOLS: Record<string, ToolDefinition> = {
    mount_agent_studio: {
        name: "mount_agent_studio",
        label: "Mount Agent Studio",
        group: "Agents",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Opens Agent Studio beside the CREW conversation on one of this organization's agents: what it is, the " +
            "model it runs on, the tools it may call, what it reads, and how it has performed. Pass agentId, or " +
            "agentName with the agent's name; with neither, it opens on a new draft. Mounting changes nothing — an " +
            "agent is changed by drafting with propose_agent and a person applying the card. Not for jobs or missions.",
        parameters: z.object({
            agentId: z.coerce.number().int().positive().optional().describe("Id of the agent to open"),
            agentName: z.string().max(2000).optional().describe("The agent's name, or text that contains it"),
            view: z.enum(AGENT_STUDIO_VIEWS).optional().default("identity").describe("Which studio tab to open on"),
        }),
        execute: async (params: { agentId?: number; agentName?: string; view?: (typeof AGENT_STUDIO_VIEWS)[number] }, context: ToolContext) => {
            const ctx = toOrgContext(context);
            const { agentCardService } = await import("@domain/agent-cards/core/agent-card.service.js");
            const agents = await agentCardService.list(ctx.organizationId as number);
            const match = resolveAgent(agents, params.agentId, params.agentName);

            if (!match && (params.agentId || params.agentName)) {
                // Naming what exists beats "not found": otherwise the next move is to invent one.
                const names = agents.map((agent) => agent.name).slice(0, 15);
                const asked = params.agentId ?? `"${(params.agentName ?? "").slice(0, 120)}"`;
                return (
                    `No agent in this organization matches ${asked}. ` +
                    (names.length
                        ? `Its agents are: ${names.join(", ")}. Say which one to open, or describe an agent to build one.`
                        : "It has no agents yet. Describe what you want one to do and the room will draft it.")
                );
            }

            return JSON.stringify({
                type: AGENT_STUDIO_POD,
                props: {
                    agentId: match?.id,
                    agentName: match?.name,
                    view: params.view ?? "identity",
                },
            });
        },
    },

    propose_agent: {
        name: "propose_agent",
        label: "Draft an agent",
        group: "Agents",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Drafts an agent from a description, or a change to an existing one, and shows it as a card the person " +
            "applies. Writes nothing: no agent is created and no permission is granted until they apply it. The card " +
            "says what the agent will be able to do, what a run will cost, and what it still needs — a tool it has " +
            "not been given, an approval policy, a model. Use this whenever someone asks for a bot, an assistant or " +
            "an agent that does something, rather than describing what you would build.",
        parameters: z.object({
            instruction: z.string().min(3).max(4000).describe("What the agent should do, in the person's own words"),
            agentId: z.coerce.number().int().positive().optional().describe("Id of an existing agent to change; omit to draft a new one"),
            name: z.string().max(100).optional().describe("A name for the agent, when the person gave one"),
            tools: z.array(z.string().max(120)).max(40).optional()
                .describe("Tools it should be able to call. Only include what the person asked for: every one is a permission they will see on the card"),
            topics: z.array(z.string().max(120)).max(40).optional().describe("Knowledge topics it should read"),
        }),
        execute: async (
            params: { instruction: string; agentId?: number; name?: string; tools?: string[]; topics?: string[] },
            context: ToolContext,
        ) => {
            const ctx = toOrgContext(context);
            const { agentStudioService } = await import("@domain/agent-cards/core/agent-studio.service.js");
            const proposal = await agentStudioService.propose(ctx, {
                instruction: params.instruction,
                agentId: params.agentId,
                draft: {
                    ...(params.name ? { name: params.name } : {}),
                    ...(params.tools ? { tools: params.tools } : {}),
                    ...(params.topics ? { topicAffinities: params.topics } : {}),
                },
            });
            return JSON.stringify({ type: AGENT_CHANGE_PROPOSAL, ...proposal });
        },
    },
};
