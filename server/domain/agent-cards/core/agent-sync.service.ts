/**
 * Agent Sync Service
 * Reads existing agents from the jobs table (type: ai_agent | agent_ai) and
 * creates corresponding agent_cards records for the organization.
 *
 * Deduplication: checks by lower(name) + orgId before inserting.
 * Model binding: resolves the org's first active LLM provider.
 * Capabilities: derived from job config (specialties, allowedTools, goal).
 */

import { db } from "@server/database_service.js";
import { and, eq, sql, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import {
    agentCards,
    jobs,
    type AgentCardRecord,
    type TopicCategory,
    type IntentCategory,
} from "@shared/schema/index.js";
import { llmProviders } from "@shared/schema/ai/llm-router.js";
import { sanitizeAgentTools } from "./agent-card.service.js";

const logger = createLogger("AgentSyncService");

/** Job types that represent AI agents in the platform. */
const AGENT_JOB_TYPES = ["ai_agent", "agent_ai", "form_agent", "dispatcher", "computer_use", "selenium"] as const;

/**
 * Maps an agent's persona string to a personaType suitable for agent cards.
 */
function mapPersonaType(persona: string | undefined): string {
    if (!persona || persona === "generic") return "general";
    return persona;
}

/**
 * Derives capabilities from the AI agent job config.
 * Combines specialties, allowedTools, and goal keywords.
 */
function deriveCapabilities(config: any): string[] {
    const caps: string[] = [];

    // Pull specialties directly
    if (Array.isArray(config?.specialties)) {
        caps.push(...config.specialties);
    }

    // If we have allowed tools, those represent capabilities
    if (Array.isArray(config?.allowedTools) && config.allowedTools.length > 0) {
        // Add first few tools as capabilities (they describe what the agent can do)
        const toolCaps = config.allowedTools
            .slice(0, 5)
            .map((t: string) => t.replace(/_/g, " "));
        caps.push(...toolCaps);
    }

    // Derive from goal if still empty
    if (caps.length === 0 && config?.goal) {
        caps.push(config.goal.slice(0, 80));
    }

    // Ensure at least one capability (required by schema validation)
    if (caps.length === 0) {
        caps.push("general assistance");
    }

    // Deduplicate and limit
    return [...new Set(caps)].slice(0, 20);
}

/**
 * Infers topic affinities from job name and description.
 */
function inferTopicAffinities(name: string, description: string | null): TopicCategory[] {
    const text = `${name} ${description || ""}`.toLowerCase();
    const affinities: TopicCategory[] = [];

    if (/code|develop|program|debug|software|engineer/i.test(text)) affinities.push("Code");
    if (/real\s*estate|property|housing|mortgage/i.test(text)) affinities.push("Real Estate");
    if (/legal|law|compliance|regulation|contract/i.test(text)) affinities.push("Legal");
    if (/media|video|image|creative|design|photo/i.test(text)) affinities.push("Media");
    if (/financ|money|budget|invest|account|bank/i.test(text)) affinities.push("Finance");
    if (/health|medical|patient|clinical|wellness/i.test(text)) affinities.push("Health");

    if (affinities.length === 0) affinities.push("General");

    return affinities;
}

/**
 * Infers intent affinities from job config and metadata.
 */
function inferIntentAffinities(config: any, name: string): IntentCategory[] {
    const intents: IntentCategory[] = [];
    const text = `${name} ${config?.goal || ""}`.toLowerCase();

    if (/image|generat|draw|illustrat|render/i.test(text)) intents.push("Image Generation");
    if (/video|animat|record/i.test(text)) intents.push("Video");
    if (/code|execut|run|script|program/i.test(text)) intents.push("Code Execution");
    if (/analy|research|report|data|insight/i.test(text)) intents.push("Analysis");
    if (/alert|monitor|notif|warn/i.test(text)) intents.push("Alert");
    if (/search|find|look|retriev/i.test(text)) intents.push("Search");

    if (intents.length === 0) intents.push("Chat");

    return intents;
}

export interface SyncResult {
    synced: number;
    skipped: number;
    errors: string[];
    cards: AgentCardRecord[];
}

export class AgentSyncService {
    /**
     * Synchronize existing agent jobs into agent_cards for the given organization.
     *
     * 1. Queries all active ai_agent/agent_ai jobs for the org
     * 2. For each, checks if an agent_card already exists (by lower(name) + orgId)
     * 3. If not, creates one with mapped properties
     *
     * @param orgId - Organization ID to sync agents for
     * @returns SyncResult with counts and created cards
     */
    async syncForOrganization(orgId: number): Promise<SyncResult> {
        logger.info(`Starting agent sync for organization ${orgId}`);

        const result: SyncResult = { synced: 0, skipped: 0, errors: [], cards: [] };

        // 1. Fetch all agent jobs for this org (active or not — if they show on the Agents page, sync them)
        // Keep this projection deliberately narrow. Agent sync only needs the
        // card-facing fields, and selecting the entire jobs table makes this
        // endpoint fail when a legacy database is still catching up on an
        // unrelated jobs column.
        const agentJobProjection = {
            name: jobs.name,
            description: jobs.description,
            config: jobs.config,
        };

        let agentJobs = await db
            .select(agentJobProjection)
            .from(jobs)
            .where(
                and(
                    eq(jobs.organizationId, orgId),
                    inArray(jobs.type, [...AGENT_JOB_TYPES]),
                )
            );

        // If no agents found for the selected org, try org 1 (default org where agents typically live)
        if (agentJobs.length === 0 && orgId !== 1) {
            logger.info(`No agents in org ${orgId}, falling back to org 1`);
            agentJobs = await db
                .select(agentJobProjection)
                .from(jobs)
                .where(
                    and(
                        eq(jobs.organizationId, 1),
                        inArray(jobs.type, [...AGENT_JOB_TYPES]),
                    )
                );
        }

        if (agentJobs.length === 0) {
            logger.info(`No agent jobs found for org ${orgId}, nothing to sync`);
            return result;
        }

        logger.info(`Found ${agentJobs.length} agent jobs to potentially sync for org ${orgId}`);

        // 2. Find existing agent card names for this org (for deduplication)
        const existingCards = await db
            .select({ name: agentCards.name })
            .from(agentCards)
            .where(eq(agentCards.organizationId, orgId));

        const existingNames = new Set(
            existingCards.map((c) => c.name.toLowerCase())
        );

        // 3. Resolve the org's default LLM provider for model binding
        const [defaultProvider] = await db
            .select({ id: llmProviders.id })
            .from(llmProviders)
            .where(eq(llmProviders.isActive, true))
            .limit(1);

        const defaultProviderId = defaultProvider?.id ?? null;

        // 4. Process each agent job
        for (const job of agentJobs) {
            const cardName = job.name.slice(0, 100); // Respect varchar(100) limit

            // Skip if already exists
            if (existingNames.has(cardName.toLowerCase())) {
                logger.debug(`Skipping "${cardName}" — already exists as agent card`);
                result.skipped++;
                continue;
            }

            try {
                const config = job.config as any;
                const capabilities = deriveCapabilities(config);
                const personaType = mapPersonaType(config?.persona);
                const description = (job.description || config?.goal || `Agent: ${job.name}`)
                    .slice(0, 500);
                const topicAffinities = inferTopicAffinities(job.name, job.description);
                const intentAffinities = inferIntentAffinities(config, job.name);

                // Resolve provider from job config if available
                let providerId = defaultProviderId;
                if (config?.provider) {
                    const [matchedProvider] = await db
                        .select({ id: llmProviders.id })
                        .from(llmProviders)
                        .where(
                            and(
                                eq(llmProviders.isActive, true),
                                sql`lower(${llmProviders.name}) = lower(${config.provider})`,
                            )
                        )
                        .limit(1);
                    if (matchedProvider) {
                        providerId = matchedProvider.id;
                    }
                }

                const [created] = await db
                    .insert(agentCards)
                    .values({
                        organizationId: orgId,
                        name: cardName,
                        description,
                        personaType,
                        modelBindingProviderId: providerId,
                        modelBindingModelId: null,
                        capabilities,
                        tools: sanitizeAgentTools(Array.isArray(config?.allowedTools) ? config.allowedTools : []) ?? [],
                        topicAffinities,
                        intentAffinities,
                        enabled: true,
                        isDefault: false,
                    })
                    .returning();

                result.cards.push(created);
                result.synced++;
                existingNames.add(cardName.toLowerCase()); // prevent duplicates within batch
                logger.info(`Synced agent card "${created.name}" (id=${created.id}) for org ${orgId}`);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                // Handle unique constraint violation gracefully (race condition)
                if (msg.includes("agent_cards_org_lower_name_unique")) {
                    result.skipped++;
                    logger.debug(`Skipping "${cardName}" — concurrent insert detected`);
                } else {
                    result.errors.push(`Failed to sync "${cardName}": ${msg}`);
                    logger.error(`Failed to sync agent "${cardName}" for org ${orgId}: ${msg}`);
                }
            }
        }

        logger.info(
            `Agent sync complete for org ${orgId}: ${result.synced} synced, ${result.skipped} skipped, ${result.errors.length} errors`
        );
        return result;
    }
}

export const agentSyncService = new AgentSyncService();
