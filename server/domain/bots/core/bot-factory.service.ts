/**
 * BotFactoryService
 *
 * Bot Builder is intake, not a second agent writer. A blueprint becomes an
 * AgentDefinition draft, Agent Studio turns that draft into a reviewable
 * proposal, and only the reviewed proposal may be applied. Provisioning then
 * puts the applied card into its CREW room and mounts Agent Studio on it.
 */

import { createLogger } from "@server/utils/logger.js";
import { agentStudioService } from "@server/domain/agent-cards/core/agent-studio.service.js";
import { crewRepository } from "@server/domain/crew/core/crew-repository.js";
import { crewStreamService } from "@server/domain/crew/core/crew-stream.service.js";
import { ensureSession, seedCopilotMember } from "@server/domain/crew/core/crew-session.service.js";
import { BadRequestError, ConflictError, InternalServerError } from "@server/utils/errors.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { AGENT_STUDIO_POD, type AgentChangeProposal, type AgentDefinition } from "@shared/agent-studio.js";
import type { BotBlueprint, BotPersona } from "./bot-interpreter.service.js";
import { parseBotBlueprint } from "./bot-interpreter.service.js";

const logger = createLogger("BotFactoryService");

// ============================================================================
// TYPES
// ============================================================================

export interface BotCreationInput {
    instruction: string;
    blueprint: unknown;
    proposal: AgentChangeProposal;
}

export interface BotScheduleResult {
    expression: string;
    status: "not_provisioned";
    note: string;
}

export interface BotCreationResult {
    proposalId: string;
    agentCardId: number;
    agentCardName: string;
    /** Agent card API resource; there is no dedicated card detail page. */
    agentCardUrl: string;
    crewRoomKey: string;
    /** CREW room where Agent Studio is mounted on the applied card. */
    crewRoomUrl: string;
    agentStudioUrl: string;
    schedule?: BotScheduleResult;
}

interface AppliedProposal {
    key: string;
    promise: Promise<{ agentId: number; agentName: string; created: boolean }>;
}

// ============================================================================
// HELPERS
// ============================================================================

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "agent";
}

const SOUL_BY_PERSONA: Record<BotPersona, string> = {
    copilot: "Process Engineer",
    analyst: "Strategic Oracle",
    coder: "Process Engineer",
    researcher: "Knowledge Architect",
    general: "Process Engineer",
    "art-director": "Creative Catalyst",
    ghostwriter: "Creative Catalyst",
    devops: "Process Engineer",
};

const OCEAN_BY_PERSONA: Record<BotPersona, NonNullable<AgentDefinition["oceanTraits"]>> = {
    copilot: { o: 0.6, c: 0.8, e: 0.65, a: 0.75, n: 0.25 },
    analyst: { o: 0.55, c: 0.85, e: 0.4, a: 0.55, n: 0.2 },
    coder: { o: 0.6, c: 0.85, e: 0.35, a: 0.5, n: 0.2 },
    researcher: { o: 0.85, c: 0.75, e: 0.45, a: 0.55, n: 0.2 },
    general: { o: 0.6, c: 0.7, e: 0.55, a: 0.65, n: 0.25 },
    "art-director": { o: 0.9, c: 0.6, e: 0.65, a: 0.6, n: 0.25 },
    ghostwriter: { o: 0.8, c: 0.7, e: 0.5, a: 0.7, n: 0.25 },
    devops: { o: 0.5, c: 0.9, e: 0.35, a: 0.5, n: 0.15 },
};

/**
 * Integration labels are intent, not blanket authority. Read tools are granted
 * with the integration; write tools only when the user's own instruction asks
 * for that side effect.
 */
function resolveTools(blueprint: BotBlueprint, instruction: string): string[] {
    const tools = new Set<string>();
    const text = instruction.toLowerCase();

    for (const integration of blueprint.integrations) {
        switch (integration) {
            case "jira":
                tools.add("list_jira_projects");
                tools.add("jira_jql_search");
                if (/\b(create|file|open|raise|log)\b/.test(text)) tools.add("create_jira_issue");
                break;
            case "slack":
                tools.add("slack_post_message");
                break;
            case "github":
                tools.add("github_list_prs");
                tools.add("github_list_issues");
                tools.add("github_get_pr_reviews");
                if (/\b(create|file|open|raise|log)\b/.test(text)) tools.add("github_create_issue");
                break;
            case "gmail":
                tools.add("list_agentmail_threads");
                tools.add("get_agentmail_thread");
                if (/\b(send|email|mail|notify|report)\b/.test(text)) tools.add("send_agentmail");
                break;
        }
    }

    if (blueprint.schedule) tools.add("create_scheduled_job");
    if (/\b(search|research|find|knowledge|look\s*up)\b/.test(text)) tools.add("search_knowledge_graph");
    if (/\b(report|summary|summarise|summarize|document|write)\b/.test(text)) tools.add("create_document");
    if (/\b(browser|website|web\s*page|computer|desktop)\b/.test(text)) tools.add("computer_use_task");

    return [...tools].slice(0, 30);
}

function resolveTopics(blueprint: BotBlueprint): string[] {
    const topics = new Set<string>(["General"]);
    for (const integration of blueprint.integrations) {
        topics.add(integration === "gmail" ? "Email" : integration[0].toUpperCase() + integration.slice(1));
    }
    return [...topics].slice(0, 20);
}

function resolveIntents(blueprint: BotBlueprint): string[] {
    const intents = new Set<string>(["Chat"]);
    if (blueprint.schedule) intents.add("Alert");
    if (blueprint.integrations.length > 0 || blueprint.capabilities.some((capability) => /analy|report|search|research/i.test(capability))) {
        intents.add("Analysis");
    }
    return [...intents].slice(0, 20);
}

export function botDefinitionFromBlueprint(blueprint: BotBlueprint, instruction: string): AgentDefinition {
    return {
        name: blueprint.name,
        description: blueprint.description,
        personaType: blueprint.persona,
        legend: `Created through Bot Builder. ${blueprint.description} It works only within its granted permissions and asks for review before consequential work.`,
        soulArchetype: SOUL_BY_PERSONA[blueprint.persona],
        modelBindingProviderId: null,
        modelBindingModelId: null,
        tools: resolveTools(blueprint, instruction),
        capabilities: [...new Set(blueprint.capabilities)].slice(0, 20),
        topicAffinities: resolveTopics(blueprint),
        intentAffinities: resolveIntents(blueprint),
        oceanTraits: OCEAN_BY_PERSONA[blueprint.persona],
        enabled: true,
    };
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function reviewedProposal(proposal: AgentChangeProposal, expected: AgentDefinition, instruction: string): AgentChangeProposal {
    if (!proposal || typeof proposal !== "object") throw new BadRequestError("A reviewed Agent Studio proposal is required");
    if (typeof proposal.proposalId !== "string" || proposal.proposalId.trim().length === 0) {
        throw new BadRequestError("The reviewed proposal is missing proposalId");
    }
    if (proposal.agentId != null) {
        throw new BadRequestError("Bot Builder can only apply a new-agent proposal");
    }
    if (proposal.agentName !== expected.name) {
        throw new BadRequestError("The reviewed proposal does not match this blueprint");
    }
    if (proposal.instruction?.trim() !== instruction.trim()) {
        throw new BadRequestError("The reviewed proposal does not match the original instruction");
    }
    if (canonical(proposal.definition) !== canonical(expected)) {
        throw new BadRequestError("The proposal definition changed after review. Generate a fresh proposal.");
    }
    return proposal;
}

function proposalKey(instruction: string, blueprint: BotBlueprint, definition: AgentDefinition): string {
    return canonical({ instruction: instruction.trim(), blueprint, definition });
}

// ============================================================================
// SERVICE
// ============================================================================

export class BotFactoryService {
    private readonly applications = new Map<string, AppliedProposal>();
    private readonly provisions = new Map<string, Promise<BotCreationResult>>();

    /** Creates the Agent Studio review card without creating or changing an agent. */
    async propose(ctx: OrgContext, instruction: string, blueprintInput: unknown): Promise<AgentChangeProposal> {
        const blueprint = parseBotBlueprint(blueprintInput);
        const trimmed = instruction.trim();
        if (!trimmed) throw new BadRequestError("instruction is required");

        const proposal = await agentStudioService.propose(ctx, {
            instruction: trimmed,
            draft: botDefinitionFromBlueprint(blueprint, trimmed),
        });

        return {
            ...proposal,
            cautions: [
                ...proposal.cautions,
                ...(blueprint.schedule
                    ? [`Requested cadence "${blueprint.schedule}" is reviewed here, but scheduled execution is not provisioned by this flow yet.`]
                    : []),
            ],
        };
    }

    async create(ctx: OrgContext, input: BotCreationInput): Promise<BotCreationResult> {
        const orgId = ctx.organizationId;
        if (typeof orgId !== "number") throw new BadRequestError("Organization context is required");

        const instruction = input.instruction.trim();
        const blueprint = parseBotBlueprint(input.blueprint);
        const expected = botDefinitionFromBlueprint(blueprint, instruction);
        const proposal = reviewedProposal(input.proposal, expected, instruction);
        const proposalId = proposal.proposalId.trim();
        const key = proposalKey(instruction, blueprint, expected);

        const applied = await this.applyOnce(ctx, proposalId, key, proposal);
        const result = await this.provisionOnce(ctx, proposalId, applied, blueprint);
        logger.info("BotFactory: reviewed agent provisioned", { agentId: applied.agentId, roomKey: result.crewRoomKey, orgId });
        return result;
    }

    private async applyOnce(
        ctx: OrgContext,
        proposalId: string,
        key: string,
        proposal: AgentChangeProposal,
    ): Promise<{ agentId: number; agentName: string; created: boolean }> {
        const existing = this.applications.get(proposalId);
        if (existing) {
            if (existing.key !== key) throw new ConflictError("This proposal id was used for a different agent definition");
            return existing.promise;
        }

        const record: AppliedProposal = {
            key,
            promise: agentStudioService.apply(ctx, proposal).then((result) => ({
                agentId: result.agentId,
                agentName: proposal.agentName,
                created: result.created,
            })),
        };
        this.applications.set(proposalId, record);

        try {
            return await record.promise;
        } catch (error) {
            this.applications.delete(proposalId);
            throw error;
        }
    }

    private async provisionOnce(
        ctx: OrgContext,
        proposalId: string,
        applied: { agentId: number; agentName: string; created: boolean },
        blueprint: BotBlueprint,
    ): Promise<BotCreationResult> {
        const existing = this.provisions.get(proposalId);
        if (existing) return existing;

        const provision = this.provision(ctx, proposalId, applied, blueprint);
        this.provisions.set(proposalId, provision);
        try {
            return await provision;
        } catch (error) {
            this.provisions.delete(proposalId);
            throw error;
        }
    }

    private async provision(
        ctx: OrgContext,
        proposalId: string,
        applied: { agentId: number; agentName: string; created: boolean },
        blueprint: BotBlueprint,
    ): Promise<BotCreationResult> {
        const orgId = ctx.organizationId as number;
        const roomKey = `bot-${applied.agentId}-${slugify(applied.agentName)}`.slice(0, 80);
        const roomUrl = `/workspace/chat/${encodeURIComponent(roomKey)}`;

        try {
            const session = await ensureSession(orgId, roomKey, ctx.userId);
            await seedCopilotMember(orgId, session.id);
            const members = await crewRepository.addMembers(orgId, session.id, [applied.agentId]);
            if (!members.some((member) => member.id === applied.agentId)) {
                throw new InternalServerError(`Agent ${applied.agentId} is not enabled in this organization`);
            }

            const transcript = await crewRepository.getTranscript(session.id, 200);
            const mounted = transcript.some((turn) =>
                turn.artifacts?.some((artifact) =>
                    artifact.payload?.type === AGENT_STUDIO_POD && artifact.payload?.proposalId === proposalId
                )
            );

            if (!mounted) {
                const turn = await crewRepository.postTurn(orgId, session.id, {
                    speakerType: "supervisor",
                    speakerName: "Agent Studio",
                    userId: ctx.userId ?? null,
                    content: `Applied "${applied.agentName}" and opened it in Agent Studio.`,
                    artifacts: [{
                        tool: "agent_studio_apply",
                        payload: {
                            type: AGENT_STUDIO_POD,
                            proposalId,
                            props: {
                                agentId: applied.agentId,
                                agentName: applied.agentName,
                                view: "identity",
                            },
                        },
                    }],
                });
                if (turn) {
                    void crewStreamService.publish({
                        type: "turn-content",
                        organizationId: orgId,
                        sessionKey: session.sessionKey,
                        payload: { turn, round: 0 },
                    });
                }
            }

            return {
                proposalId,
                agentCardId: applied.agentId,
                agentCardName: applied.agentName,
                agentCardUrl: `/api/agent-cards/${applied.agentId}`,
                crewRoomKey: session.sessionKey,
                crewRoomUrl: roomUrl,
                agentStudioUrl: roomUrl,
                ...(blueprint.schedule
                    ? {
                        schedule: {
                            expression: blueprint.schedule,
                            status: "not_provisioned" as const,
                            note: "The cron was validated, but no schedule, job, or trigger was created; this bot is not running on that cadence yet.",
                        },
                    }
                    : {}),
            };
        } catch (error: any) {
            if (error instanceof BadRequestError || error instanceof ConflictError || error instanceof InternalServerError) throw error;
            logger.error("BotFactory: agent applied but room provisioning failed", { error, proposalId, agentId: applied.agentId });
            throw new InternalServerError(
                `Agent "${applied.agentName}" was applied, but its CREW room could not be provisioned. Retry the same proposal to continue without creating another agent. proposalId=${proposalId} agentId=${applied.agentId}`,
            );
        }
    }
}

export const botFactoryService = new BotFactoryService();
