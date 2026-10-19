import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { llmModels, llmProviders } from "@shared/schema/ai/llm-router.js";
import { agentCards } from "@shared/schema/agent-cards.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { requireOrgId, type OrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import {
    diffAgent,
    isConsequentialTool,
    type AgentChangeProposal,
    type AgentDefinition,
    type AgentRunCost,
} from "@shared/agent-studio.js";
import { agentCardService } from "./agent-card.service.js";
import { assessAgent } from "./agent-readiness.service.js";

const logger = createLogger("AgentStudio");

/**
 * Agent Studio: drafting an agent from a sentence, and applying the draft.
 *
 * The draft is never written. It is returned as a card with a diff, a price and its
 * cautions, and applying it is a second, explicit act — the same bargain Media Studio
 * and Form Studio strike, and a stronger one here because what an agent may DO is part
 * of the thing being approved.
 *
 * Nothing in here calls a model to decide what an agent may reach: a proposal only ever
 * offers tools the room already has, and every grant is spelled out on the card.
 */

/** A typical exchange, for pricing: enough to be honest, not a promise about any one run. */
const TYPICAL_INPUT_TOKENS = 4_000;
const TYPICAL_OUTPUT_TOKENS = 800;

export interface AgentStudioContext extends OrgContext {}

export interface ProposeAgentInput {
    /** What the person asked for, in their words. */
    instruction: string;
    /** The agent being changed. Absent means the proposal creates one. */
    agentId?: number;
    /** A draft the caller already has (from the bots interpreter, or an edited card). */
    draft?: Partial<AgentDefinition>;
}

const EMPTY: AgentDefinition = {
    name: "",
    description: "",
    personaType: "specialist",
    legend: null,
    soulArchetype: null,
    modelBindingProviderId: null,
    modelBindingModelId: null,
    tools: [],
    capabilities: [],
    topicAffinities: [],
    intentAffinities: [],
};

function definitionOf(row: typeof agentCards.$inferSelect): AgentDefinition {
    return {
        name: row.name,
        description: row.description,
        personaType: row.personaType,
        legend: row.legend,
        soulArchetype: row.soulArchetype,
        modelBindingProviderId: row.modelBindingProviderId,
        modelBindingModelId: row.modelBindingModelId,
        tools: (row.tools as string[]) ?? [],
        capabilities: (row.capabilities as string[]) ?? [],
        topicAffinities: (row.topicAffinities as string[]) ?? [],
        intentAffinities: (row.intentAffinities as string[]) ?? [],
        oceanTraits: row.oceanTraits as AgentDefinition["oceanTraits"],
        enabled: row.enabled,
    };
}

export class AgentStudioService {
    /**
     * The agent as it stands, or null for one that does not exist yet.
     *
     * Disabled counts as absent: mounting lists enabled agents only and the studio
     * reads the same list, so a draftable-but-invisible agent would be a change nobody
     * could see. Re-enabling stays a deliberate act on the card itself (PATCH), not a
     * side effect of a studio proposal.
     */
    private async existing(ctx: AgentStudioContext, agentId?: number): Promise<typeof agentCards.$inferSelect | null> {
        if (!agentId) return null;
        const org = requireOrgId(ctx);
        const [row] = await db.select().from(agentCards)
            .where(and(eq(agentCards.id, agentId), eq(agentCards.organizationId, org), eq(agentCards.enabled, true)))
            .limit(1);
        if (!row) throw new NotFoundError("Agent not found in this organization.");
        return row;
    }

    /**
     * What one exchange with this agent costs, from the model it is bound to.
     *
     * Said as a number where the platform knows the price and as a reason where it does
     * not, because "free" and "we have no idea" are different things and an agent's
     * running cost is the part people are least able to guess.
     */
    async costOf(ctx: AgentStudioContext, definition: AgentDefinition): Promise<AgentRunCost> {
        const org = requireOrgId(ctx);
        if (!definition.modelBindingModelId) {
            return { model: null, centsPerRun: null, note: "No model is bound yet, so it runs on the room's default." };
        }
        const [model] = await db.select({
            displayName: llmModels.displayName,
            modelId: llmModels.modelId,
            inputCostPer1k: llmModels.inputCostPer1k,
            outputCostPer1k: llmModels.outputCostPer1k,
            organizationId: llmModels.organizationId,
            providerName: llmProviders.name,
        })
            .from(llmModels)
            .leftJoin(llmProviders, eq(llmProviders.id, llmModels.providerId))
            .where(eq(llmModels.id, definition.modelBindingModelId))
            .limit(1);

        if (!model) return { model: null, centsPerRun: null, note: "The model it is bound to no longer exists." };
        // A model row can be platform-wide (null org) or an organization's own. Another
        // tenant's model is not a model this agent may be bound to.
        if (model.organizationId !== null && model.organizationId !== org) {
            throw new BadRequestError("That model belongs to another organization.");
        }

        const name = model.displayName || model.modelId;
        if (model.inputCostPer1k == null || model.outputCostPer1k == null) {
            return { model: name, centsPerRun: null, note: "This model has no price recorded, so a run cannot be costed." };
        }
        const dollars =
            (TYPICAL_INPUT_TOKENS / 1000) * model.inputCostPer1k +
            (TYPICAL_OUTPUT_TOKENS / 1000) * model.outputCostPer1k;
        return { model: name, centsPerRun: Math.round(dollars * 100 * 100) / 100 };
    }

    /**
     * Draft an agent, or a change to one, as a card with a diff. Writes nothing.
     */
    async propose(ctx: AgentStudioContext, input: ProposeAgentInput): Promise<AgentChangeProposal> {
        const instruction = input.instruction?.trim();
        if (!instruction) throw new BadRequestError("Say what the agent should do.");

        const row = await this.existing(ctx, input.agentId);
        const before = row ? definitionOf(row) : null;
        const after: AgentDefinition = {
            ...(before ?? EMPTY),
            ...(input.draft ?? {}),
            // Lists are replaced wholesale when given, never merged silently: a proposal
            // that quietly kept a tool the draft dropped would grant by omission.
            tools: input.draft?.tools ?? before?.tools ?? [],
            capabilities: input.draft?.capabilities ?? before?.capabilities ?? [],
            topicAffinities: input.draft?.topicAffinities ?? before?.topicAffinities ?? [],
            intentAffinities: input.draft?.intentAffinities ?? before?.intentAffinities ?? [],
        };
        if (!after.name.trim()) after.name = instruction.slice(0, 60);
        if (!after.description.trim()) after.description = instruction.slice(0, 480);
        if (after.capabilities.length === 0) after.capabilities = ["general"];

        const changes = diffAgent(before, after);
        if (changes.length === 0) {
            throw new BadRequestError(`"${after.name}" already works that way; nothing would change.`);
        }

        const cost = await this.costOf(ctx, after);
        const cautions: string[] = [];
        if (!after.modelBindingModelId) cautions.push("No model is bound, so this agent runs on whatever the room defaults to.");
        if (cost.centsPerRun === null && cost.model) cautions.push(cost.note ?? "This model has no price recorded.");
        const consequential = after.tools.filter(isConsequentialTool);
        if (consequential.length) {
            cautions.push(`It will be able to act outside the platform: ${consequential.join(", ")}. Every one of those still passes the governor's gate.`);
        }
        if (!before) cautions.push("Applying this creates the agent. It does nothing until a room or a schedule calls it.");

        // What it will still need, asked as questions rather than assumed. A tool is
        // never added here: the card offers, the person grants.
        const readiness = assessAgent(instruction, after);
        for (const gap of readiness.gaps) {
            if (gap.severity === "critical" && !cautions.includes(gap.message)) cautions.push(gap.message);
        }

        return {
            proposalId: `agent_${randomUUID().replace(/-/g, "")}`,
            ...(row ? { agentId: row.id } : {}),
            agentName: after.name,
            instruction,
            changes,
            cost,
            cautions,
            definition: after,
            readiness,
        };
    }

    /**
     * Apply a drafted agent: create it, or change the one it was drafted against.
     *
     * The proposal carries the whole definition, so applying is not a second
     * interpretation of the instruction — it writes exactly what was on the card.
     */
    async apply(ctx: AgentStudioContext, proposal: AgentChangeProposal): Promise<{ agentId: number; created: boolean }> {
        const org = requireOrgId(ctx);
        const definition = proposal?.definition;
        if (!definition?.name?.trim()) throw new BadRequestError("This proposal has no agent in it.");

        if (proposal.agentId) {
            const row = await this.existing(ctx, proposal.agentId);
            if (!row) throw new NotFoundError("Agent not found in this organization.");
            await agentCardService.update(org, proposal.agentId, {
                name: definition.name,
                description: definition.description,
                personaType: definition.personaType,
                legend: definition.legend ?? undefined,
                soulArchetype: definition.soulArchetype ?? undefined,
                modelBindingProviderId: definition.modelBindingProviderId ?? undefined,
                modelBindingModelId: definition.modelBindingModelId ?? undefined,
                tools: definition.tools,
                capabilities: definition.capabilities,
                topicAffinities: definition.topicAffinities as never,
                intentAffinities: definition.intentAffinities as never,
                ...(definition.oceanTraits ? { oceanTraits: definition.oceanTraits } : {}),
            } as never);
            logger.info(`Applied agent change to ${proposal.agentId} for org ${org}`);
            return { agentId: proposal.agentId, created: false };
        }

        const created = await agentCardService.create(org, {
            name: definition.name,
            description: definition.description,
            personaType: definition.personaType,
            legend: definition.legend ?? undefined,
            soulArchetype: definition.soulArchetype ?? undefined,
            modelBindingProviderId: definition.modelBindingProviderId ?? undefined,
            modelBindingModelId: definition.modelBindingModelId ?? undefined,
            tools: definition.tools,
            capabilities: definition.capabilities,
            topicAffinities: definition.topicAffinities as never,
            intentAffinities: definition.intentAffinities as never,
            ...(definition.oceanTraits ? { oceanTraits: definition.oceanTraits } : {}),
        } as never);
        logger.info(`Created agent ${created.id} from a studio proposal for org ${org}`);
        return { agentId: created.id, created: true };
    }
}

export const agentStudioService = new AgentStudioService();
