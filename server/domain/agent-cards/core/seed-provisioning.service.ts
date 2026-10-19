/**
 * Seed Provisioning Service
 * Atomically provisions default agent cards for new organizations.
 * Creates Coder, Analyst, and Media Creator cards with predefined
 * capabilities, topic affinities, and intent affinities.
 */

import { db } from "@server/database_service.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import {
    agentCards,
    type AgentCardRecord,
    type TopicCategory,
    type IntentCategory,
    type OceanTraitValues,
} from "@shared/schema/index.js";
import { COPILOT_PERSONA_TYPE, COPILOT_TOOLS } from "@shared/constants/agent-personas.js";
import { llmProviders } from "@shared/schema/ai/llm-router.js";

const logger = createLogger("SeedProvisioningService");

/**
 * Seed card definition used internally during provisioning.
 */
interface SeedCardDefinition {
    name: string;
    description: string;
    personaType: string;
    providerName: string; // e.g. 'anthropic', 'flux'
    capabilities: string[];
    tools: string[];
    topicAffinities: TopicCategory[];
    intentAffinities: IntentCategory[];
    isDefault: boolean;
    /** Set explicitly to bypass CrewPersonaService.inferArchetype's keyword rules. */
    soulArchetype?: string;
    /** Must not be flat 0.5 — SoulService.generateSoulPrompt emits nothing for that. */
    oceanTraits?: OceanTraitValues;
    legend?: string;
}

/**
 * The Copilot's card.
 *
 * Named separately because it is not just another specialist: it is the only
 * crew member that can see the platform it is running on, and the one the Crew
 * Room selects by default (see CREW_DEFAULT_CARD_NAME).
 *
 * The tools are what make it more than a persona. A crew agent's declared
 * `tools` list is a ceiling (CrewToolsService.resolveForCard), and synced cards
 * declare domain integrations, so before this no card in any org could answer
 * "open the SDLC Workbench" — the agent could only enumerate the universal
 * presentation tools and decline, which is exactly what it did.
 *
 * Every name below clears the crew's read-only gate:
 *   - render_app_surface is tier 2 (ARTIFACT_TOOLS) — it emits an
 *     `assistant_app` card, an ephemeral UI, not a write;
 *   - the rest pass the read-verb heuristic (`list_`, `search_`, `discover_`).
 *     Note list_recent_executions tokenises to "executions", NOT the blocked
 *     write token "execute".
 *
 * list_installed_apps is the pair to render_app_surface, not an extra: it is
 * what resolves a blueprint slug or a cycle app's routePath. Without it the
 * Copilot has to guess an href, and a guessed href is the launch bug this
 * platform has already shipped twice.
 */
const COPILOT_CARD: SeedCardDefinition = {
    name: "Copilot",
    description:
        "Platform copilot. Knows what is installed, running and available in this organization, " +
        "and launches blueprint, cycle and workbench apps directly into the conversation.",
    personaType: COPILOT_PERSONA_TYPE,
    providerName: "google",
    capabilities: [
        "app launch",
        "platform orientation",
        "capability discovery",
        "cycle and pipeline status",
    ],
    tools: [...COPILOT_TOOLS],
    // 'General' keeps it eligible in the rooms that have no obvious specialist;
    // 'Code' keeps it in the conversation on engineering topics without
    // outranking Coder, which also holds the Code Execution intent (2 pts to 1).
    topicAffinities: ["General", "Code"],
    intentAffinities: ["Chat", "Search"],
    isDefault: true,
    soulArchetype: "Lead Directive",
    oceanTraits: { o: 0.65, c: 0.8, e: 0.62, a: 0.72, n: 0.3 },
    legend:
        "I am the Copilot. I know what this organization has built, what is running right now, " +
        "and how to open it. When someone needs an app rather than an answer, I put it in front of them " +
        "instead of describing it.",
};

/**
 * Default seed card definitions per the design spec.
 *
 * The Copilot leads the list deliberately: selectSpeakers breaks affinity ties
 * on card id, so seed order decides who speaks in a room where nothing scores.
 */
const SEED_CARDS: SeedCardDefinition[] = [
    COPILOT_CARD,
    {
        name: "Security Auditor",
        description: "Specialist in runtime sandbox security, vulnerability scanning, compliance verification, and safe code execution gates.",
        personaType: "security",
        providerName: "anthropic",
        capabilities: ["security audit", "sandbox isolation", "compliance verification", "vulnerability scanning"],
        tools: [],
        topicAffinities: ["Code", "Legal", "General"],
        intentAffinities: ["Analysis", "Alert"],
        isDefault: false,
        soulArchetype: "Data Sentinel",
        legend: "I am the Security Auditor. I enforce execution boundaries, sandbox constraints, and platform compliance invariants.",
    },
    {
        name: "Site Reliability Engineer",
        description: "Specialist in incident triage, error recovery, chaos engineering, fault injection, and system telemetry.",
        personaType: "devops",
        providerName: "anthropic",
        capabilities: ["incident triage", "chaos engineering", "fault injection", "telemetry analysis", "error recovery"],
        tools: [],
        topicAffinities: ["Code", "General"],
        intentAffinities: ["Alert", "Analysis"],
        isDefault: false,
        soulArchetype: "Crisis Commander",
        legend: "I am the Site Reliability Engineer. I diagnose root causes, manage system incidents, and ensure platform resilience.",
    },
    {
        name: "Growth Marketer",
        description: "Specialist in AI advertising campaigns, email marketing lifecycle automation, domain warmup, and multi-touch attribution.",
        personaType: "marketing",
        providerName: "anthropic",
        capabilities: ["ad campaign orchestration", "email deliverability", "lifecycle automation", "attribution modeling"],
        tools: [],
        topicAffinities: ["General", "Media"],
        intentAffinities: ["Analysis", "Chat"],
        isDefault: false,
        soulArchetype: "Innovation Director",
        legend: "I am the Growth Marketer. I design high-converting campaigns, outbound email lifecycles, and attribution pipelines.",
    },
    {
        name: "Knowledge Architect",
        description: "Specialist in Knowledge Graph linking, vector search, multi-source reconciliation, and unstructured document extraction.",
        personaType: "knowledge-architect",
        providerName: "anthropic",
        capabilities: ["knowledge graph linking", "vector search", "document parsing", "data reconciliation"],
        tools: [],
        topicAffinities: ["General", "Code"],
        intentAffinities: ["Search", "Analysis"],
        isDefault: false,
        soulArchetype: "Knowledge Architect",
        oceanTraits: { o: 0.84, c: 0.86, e: 0.35, a: 0.8, n: 0.25 },
        legend: "I am the Knowledge Architect. I structure semantic relationships, manage ontologies, and index enterprise intelligence.",
    },
    {
        name: "Backend Architect",
        description: "Specialist in distributed fleet infrastructure, worker isolation, zero-downtime database migrations, and system limits.",
        personaType: "backend-architect",
        providerName: "anthropic",
        capabilities: ["system architecture", "database migrations", "worker isolation", "distributed fleets"],
        tools: [],
        topicAffinities: ["Code", "General"],
        intentAffinities: ["Code Execution", "Analysis"],
        isDefault: false,
        soulArchetype: "Lead Directive",
        legend: "I am the Backend Architect. I design scalable distributed backends, zero-downtime migrations, and fleet topology.",
    },
    {
        name: "Browser Automation Engineer",
        description: "Specialist in Playwright browser automation, neuro-symbolic UI verification, and resilient web harvesting.",
        personaType: "browser-engineer",
        providerName: "anthropic",
        capabilities: ["browser automation", "playwright scripts", "web harvesting", "ui verification"],
        tools: [],
        topicAffinities: ["Code", "General"],
        intentAffinities: ["Code Execution", "Search"],
        isDefault: false,
        soulArchetype: "Tactical Analyst",
        legend: "I am the Browser Automation Engineer. I build resilient Playwright headless automations and web interaction workflows.",
    },
    {
        name: "Coder",
        description: "Specialized coding assistant for code generation, review, and debugging tasks.",
        personaType: "coder",
        providerName: "anthropic",
        capabilities: ["code generation", "code review", "debugging"],
        tools: [],
        topicAffinities: ["Code"],
        intentAffinities: ["Code Execution", "Analysis"],
        isDefault: true,
        soulArchetype: "Tactical Analyst",
        oceanTraits: { o: 0.55, c: 0.92, e: 0.25, a: 0.45, n: 0.35 },
    },
    {
        name: "Analyst",
        description: "Data analysis specialist for pattern recognition and report generation across finance, real estate, and legal domains.",
        personaType: "analyst",
        providerName: "anthropic",
        capabilities: ["data analysis", "pattern recognition", "report generation"],
        tools: [],
        topicAffinities: ["Finance", "Real Estate", "Legal"],
        intentAffinities: ["Analysis", "Alert"],
        isDefault: false,
        soulArchetype: "Tactical Analyst",
        oceanTraits: { o: 0.55, c: 0.92, e: 0.25, a: 0.45, n: 0.35 },
    },
    {
        name: "Media Creator",
        description: "Creative media specialist for image generation and video synthesis.",
        personaType: "media-creator",
        providerName: "flux",
        capabilities: ["image generation", "video synthesis"],
        tools: [],
        topicAffinities: ["Media"],
        intentAffinities: ["Image Generation", "Video"],
        isDefault: false,
        soulArchetype: "Creative Catalyst",
        oceanTraits: { o: 0.95, c: 0.4, e: 0.82, a: 0.78, n: 0.3 },
    },
    {
        name: "GhostWriter",
        description: "Specialist in manuscript drafting, narrative architecture, prose translation, and surgical excerpt rewriting for living documents.",
        personaType: "ghostwriter",
        providerName: "google",
        capabilities: ["document authoring", "prose translation", "narrative synthesis", "excerpt expansion", "manuscript polish"],
        tools: ["scribe_update_node", "scribe_get_document", "scribe_configure_stations", "scribe_add_table_of_contents", "scribe_import_confluence_page", "scribe_publish_to_confluence"],
        topicAffinities: ["General", "Code", "Legal", "Media"],
        intentAffinities: ["Chat", "Analysis"],
        isDefault: false,
        soulArchetype: "Knowledge Architect",
        oceanTraits: { o: 0.84, c: 0.86, e: 0.35, a: 0.8, n: 0.25 },
        legend: "I am the GhostWriter. I translate outlines, rough notes, templates, and excerpts into polished, authoritative, domain-appropriate document prose. I work directly with the Scribe Document Agent to update and elevate manuscripts.",
    },
];

/**
 * How many cards a fresh organization gets.
 *
 * Exported so the provisioning test asserts "one card per definition" rather
 * than a hand-copied number that turns every new specialist into a test failure.
 */
export const SEED_CARD_COUNT = SEED_CARDS.length;

/**
 * The insert row for a seed, with its provider resolved.
 *
 * Provider resolution falls back to any active provider rather than leaving the
 * binding null: a card with no provider silently has no model behind it, which
 * surfaces much later as an unexplained failure to speak.
 */
function cardValues(
    orgId: number,
    seed: SeedCardDefinition,
    providerMap: Map<string, number>,
): typeof agentCards.$inferInsert {
    const providerId =
        providerMap.get(seed.providerName.toLowerCase()) ??
        providerMap.values().next().value ??
        null;

    return {
        organizationId: orgId,
        name: seed.name,
        description: seed.description,
        personaType: seed.personaType,
        modelBindingProviderId: providerId,
        modelBindingModelId: null,
        capabilities: seed.capabilities,
        tools: seed.tools,
        topicAffinities: seed.topicAffinities,
        intentAffinities: seed.intentAffinities,
        enabled: true,
        isDefault: seed.isDefault,
        ...(seed.soulArchetype ? { soulArchetype: seed.soulArchetype } : {}),
        ...(seed.oceanTraits ? { oceanTraits: seed.oceanTraits } : {}),
        ...(seed.legend ? { legend: seed.legend } : {}),
    };
}

export class SeedProvisioningService {
    /**
     * Atomically create the default set of agent cards for an organization.
     * Uses a database transaction: if any card fails, all are rolled back.
     *
     * Looks up providers by name ('anthropic', 'flux') and binds them to the
     * seed cards. If a provider doesn't exist, the card is created with a null
     * model binding (no FK constraint violation since the column is nullable).
     *
     * @param orgId - The organization ID to provision seed cards for.
     * @returns Array of created AgentCardRecord entries.
     * @throws Error with details about which card failed if provisioning fails.
     */
    async seedForOrganization(orgId: number): Promise<AgentCardRecord[]> {
        logger.info(`Starting seed provisioning for organization ${orgId}`);

        try {
            const createdCards = await db.transaction(async (tx) => {
                // Look up available providers for binding
                const providers = await tx
                    .select({ id: llmProviders.id, name: llmProviders.name })
                    .from(llmProviders)
                    .where(eq(llmProviders.isActive, true));

                const providerMap = new Map<string, number>();
                for (const p of providers) {
                    providerMap.set(p.name.toLowerCase(), p.id);
                }

                const cards: AgentCardRecord[] = [];

                for (const seed of SEED_CARDS) {
                    const [created] = await tx
                        .insert(agentCards)
                        .values(cardValues(orgId, seed, providerMap))
                        .returning();

                    cards.push(created);
                    logger.info(
                        `Seed card "${created.name}" (id=${created.id}) created for org ${orgId}`
                    );
                }

                return cards;
            });

            logger.info(
                `Seed provisioning complete for org ${orgId}: ${createdCards.length} cards created`
            );
            return createdCards;
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            logger.error(
                `Seed provisioning failed for org ${orgId}, all cards rolled back: ${message}`
            );
            throw new Error(
                `Seed provisioning failed for organization ${orgId}: ${message}`
            );
        }
    }

    /**
     * Creates the Copilot card if this organization does not have one.
     *
     * seedForOrganization only ever runs once, at org creation, so a card added
     * to SEED_CARDS afterwards never reaches an organization that already
     * exists. The Crew Room's default selection depends on the Copilot existing,
     * so it needs a path that reaches those organizations.
     *
     * Despite the name, and the reasoning this comment used to carry, it backfills
     * every missing seed card rather than only the Copilot: `missing` filters
     * SEED_CARDS whole. That is deliberate. A specialist added to SEED_CARDS has to
     * reach existing organizations somehow, and the alternative is what org 473
     * looked like — an author typing @Ghostwriter at a room whose org had no such
     * card, answered each round by a Copilot deferring to an agent that did not exist.
     *
     * The cost is the one the old comment named: an operator who deletes a seed card
     * gets it back on the next sync. Deletion is not currently distinguishable from
     * never-provisioned, and until it is, a returning card is the better failure.
     *
     * Safe to call on every request: matching is on lower(name), the same key as
     * the agent_cards_org_lower_name_unique index, so a Copilot someone renamed
     * is not duplicated.
     */
    async ensureDefaultCards(orgId: number): Promise<AgentCardRecord[]> {
        const existing = await db
            .select({ name: agentCards.name, personaType: agentCards.personaType })
            .from(agentCards)
            .where(eq(agentCards.organizationId, orgId));

        const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));
        const missing = SEED_CARDS.filter(
            (seed) => !existingNames.has(seed.name.toLowerCase()),
        );

        if (missing.length === 0) {
            try {
                await this.ensureDefaultAppDeployments(orgId);
            } catch {}
            return [];
        }

        const providers = await db
            .select({ id: llmProviders.id, name: llmProviders.name })
            .from(llmProviders)
            .where(eq(llmProviders.isActive, true));

        const providerMap = new Map<string, number>();
        for (const p of providers) providerMap.set(p.name.toLowerCase(), p.id);

        const created: AgentCardRecord[] = [];
        for (const seed of missing) {
            try {
                const [row] = await db
                    .insert(agentCards)
                    .values(cardValues(orgId, seed, providerMap))
                    .onConflictDoNothing()
                    .returning();

                if (row) {
                    created.push(row);
                    logger.info(`Backfilled seed card "${row.name}" (id=${row.id}) for org ${orgId}`);
                }
            } catch (error: unknown) {
                // A missing default is a degraded room, not a failed request.
                logger.warn(
                    `Failed to backfill seed card "${seed.name}" for org ${orgId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        try {
            await this.ensureDefaultAppDeployments(orgId);
        } catch {}

        return created;
    }

    /**
     * Ensures default app deployments exist for an organization space.
     * Auto-installs core workplace blueprints (SDLC Workbench, Codegen Pipeline,
     * Analytics Dashboard, Devops Workbench, etc.) if none are installed.
     */
    async ensureDefaultAppDeployments(orgId: number, forceAll: boolean = false): Promise<void> {
        try {
            const { appRegistryService } = await import("@domain/apps/app-registry.service.js");
            // Read the table directly rather than through listOrgDeployments.
            // That method used to auto-provision when it found nothing, which
            // meant it called back into here — mutual recursion with no base
            // case for an org with no apps, and the reason GET
            // /api/apps/installed hung forever. listOrgDeployments no longer
            // provisions, so the cycle is gone; querying directly here keeps it
            // gone even if someone reintroduces that behaviour.
            const { db } = await import("@server/database_service.js");
            const { appDeployments } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");
            const installed = await db
                .select({ appId: appDeployments.appId })
                .from(appDeployments)
                .where(eq(appDeployments.organizationId, orgId));
            if (!forceAll && installed && installed.length > 0) return;

            const marketApps = await appRegistryService.listAvailableApps(true);
            if (!marketApps || marketApps.length === 0) return;

            // Shape follows the direct query above: { appId }, not { app: {...} }.
            const installedAppIds = new Set(installed.map((i) => i.appId));

            for (const targetApp of marketApps) {
                if (installedAppIds.has(targetApp.id)) continue;
                try {
                    await appRegistryService.installApp(targetApp.id, orgId);
                    logger.info(`Auto-installed default app "${targetApp.slug}" (id=${targetApp.id}) for org ${orgId}`);
                } catch (err: any) {
                    logger.warn(`Failed auto-installing app "${targetApp.slug}" for org ${orgId}: ${err?.message}`);
                }
            }
        } catch (err: any) {
            logger.warn(`ensureDefaultAppDeployments failed for org ${orgId}: ${err?.message}`);
        }
    }
}

export const seedProvisioningService = new SeedProvisioningService();
