/**
 * Crew Persona Service
 *
 * Turns an agent card into a *voice*: a Legend (first-person operational
 * philosophy) plus OCEAN traits and a soul archetype, assembled into the system
 * prompt that agent speaks with in a crew discussion.
 *
 * Reuses the platform's existing Soul layer rather than inventing a parallel
 * personality model:
 *   - SoulService.generateSoulPrompt() produces the trait steering lines.
 *   - SOUL_ARCHETYPES is the canonical archetype list.
 *
 * Two gaps in that existing layer are filled here deliberately:
 *
 * 1. Flat traits produce no personality. generateSoulPrompt() only emits
 *    steering above/below thresholds (o>0.8, c>0.8, e<0.3, a>0.7, n>0.6), so the
 *    0.5-across-the-board profile every seeded agent currently carries yields an
 *    EMPTY protocol block and all agents sound identical. Derived profiles here
 *    are deliberately polarised so each crew member reads differently.
 *
 * 2. generateSoulPrompt()'s archetype switch only covers three names ("Ghost
 *    Analyst", "The Quartermaster", "Lead Directive") — and two of those are not
 *    even in SOUL_ARCHETYPES. ARCHETYPE_MANNERISMS below covers all ten canonical
 *    archetypes so the choice actually affects how an agent talks. We add this on
 *    top rather than editing SoulService, which other callers depend on.
 */

import { SoulService, type OceanTraits } from "@domain/agents/core/soul.service.js";
import { SOUL_ARCHETYPES } from "@domain/ai/ui/modules/agent-ai/soul-constants.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

/** A complete derived persona for a crew member. */
export interface CrewPersona {
    archetype: string;
    traits: OceanTraits;
    legend: string;
}

/**
 * Archetype profiles. Traits are polarised on purpose — see note 1 above.
 * Each profile crosses at least one of generateSoulPrompt()'s thresholds so
 * every archetype yields visible steering.
 */
const ARCHETYPE_PROFILES: Record<string, OceanTraits> = {
    "Tactical Analyst": { o: 0.55, c: 0.92, e: 0.25, a: 0.45, n: 0.35 },
    "Strategic Oracle": { o: 0.88, c: 0.82, e: 0.40, a: 0.50, n: 0.30 },
    "Creative Catalyst": { o: 0.95, c: 0.40, e: 0.82, a: 0.78, n: 0.30 },
    "Data Sentinel": { o: 0.40, c: 0.90, e: 0.20, a: 0.40, n: 0.70 },
    "Crisis Commander": { o: 0.50, c: 0.88, e: 0.85, a: 0.32, n: 0.55 },
    "Knowledge Architect": { o: 0.84, c: 0.86, e: 0.35, a: 0.80, n: 0.25 },
    "Process Engineer": { o: 0.45, c: 0.95, e: 0.28, a: 0.55, n: 0.40 },
    "Innovation Director": { o: 0.92, c: 0.60, e: 0.78, a: 0.72, n: 0.28 },
    "Field Operative": { o: 0.62, c: 0.84, e: 0.52, a: 0.48, n: 0.50 },
    "Lead Directive": { o: 0.65, c: 0.80, e: 0.62, a: 0.72, n: 0.30 },
};

/**
 * How each archetype carries itself in discussion. Fills the gap left by
 * SoulService.generateSoulPrompt(), whose switch covers only three names.
 */
const ARCHETYPE_MANNERISMS: Record<string, string> = {
    "Tactical Analyst":
        "Argue from evidence. Quantify claims where you can and say plainly when a number is an estimate.",
    "Strategic Oracle":
        "Speak in second-order consequences. Frame contributions around what it implies three steps out.",
    "Creative Catalyst":
        "Offer the unconventional option nobody has raised yet. Prefer a vivid concrete example over abstraction.",
    "Data Sentinel":
        "Watch for what is missing or unverified. Name risks explicitly and flag anomalies early.",
    "Crisis Commander":
        "Drive toward a decision. State the call, the tradeoff accepted, and the immediate next action.",
    "Knowledge Architect":
        "Give the discussion structure. Define terms, separate the settled from the contested, and cite precedent.",
    "Process Engineer":
        "Reduce ideas to repeatable steps. Point out where a proposal will break under real operating conditions.",
    "Innovation Director":
        "Push scope outward. Ask what becomes possible if the stated constraint were removed.",
    "Field Operative":
        "Test claims against how they behave in practice. Prefer what has actually been observed over what should happen.",
    "Lead Directive":
        "Keep the group oriented on the objective. Use crisp, actionable phrasing.",
};

const DEFAULT_ARCHETYPE = "Lead Directive";

/**
 * Chooses an archetype from what the card already declares. Ordered most
 * specific first — the first rule that matches wins.
 */
function inferArchetype(card: AgentCardRecord): string {
    const text = `${card.name} ${card.description}`.toLowerCase();
    const topics = card.topicAffinities ?? [];
    const intents = card.intentAffinities ?? [];

    if (/dispatch|emergency|incident|crisis|remediation|rescue/.test(text)) return "Crisis Commander";
    if (/deploy|pipeline|release|cab|provision|process/.test(text)) return "Process Engineer";
    if (/doc|writer|documentation|post-mortem/.test(text)) return "Knowledge Architect";
    if (/qa|test|e2e|audit|chaos|evaluat/.test(text)) return "Field Operative";
    if (/security|compliance|vulnerab|monitor|threat/.test(text)) return "Data Sentinel";
    if (/product|requirement|backlog|roadmap|agile/.test(text)) return "Innovation Director";
    if (/research|analys|insight|strategy/.test(text)) return "Strategic Oracle";
    if (/design|media|creative|image|video|brand/.test(text)) return "Creative Catalyst";
    if (/code|develop|program|debug|engineer|frontend|backend|api/.test(text)) return "Tactical Analyst";

    if (topics.includes("Media") || intents.includes("Image Generation") || intents.includes("Video")) {
        return "Creative Catalyst";
    }
    if (topics.includes("Code") || intents.includes("Code Execution")) return "Tactical Analyst";
    if (intents.includes("Alert")) return "Data Sentinel";
    if (intents.includes("Analysis")) return "Strategic Oracle";

    return DEFAULT_ARCHETYPE;
}

/**
 * Stable per-name jitter so two agents sharing an archetype still differ.
 * Deterministic: the same card always derives the same persona.
 */

export interface SmeDomainDefinition {
    domainName: string;
    description: string;
    runbookIds: string[];
    handRaisingInstruction: string;
}

export const DOMAIN_SME_CATALOG: Record<string, SmeDomainDefinition> = {
    "Security & Compliance": {
        domainName: "Security, Governance & Sandbox Compliance",
        description: "Hardened code execution, audit logs, credential isolation, and Human-in-the-Loop decision gates.",
        runbookIds: [
            "secure-code-sandbox-and-python-runtime",
            "compliance-and-audit-trails",
            "escalation-and-confidence-gates",
            "hil-form-schema-standards",
        ],
        handRaisingInstruction:
            "When security boundaries, compliance rules, sandbox constraints, or authorization gates are discussed, apply these standards directly to enforce non-negotiable platform safety invariants.",
    },
    "DevOps & Reliability": {
        domainName: "DevOps, SRE & Incident Recovery",
        description: "Circuit breakers, fault injection, real-time X-Ray triage, and dynamic LLM routing.",
        runbookIds: [
            "agent-error-recovery",
            "debugging-and-xray-playbook",
            "automated-incident-triage",
            "chaos-engineering-and-fault-injection",
            "dynamic-llm-routing-and-cost-arbitrage",
        ],
        handRaisingInstruction:
            "When runtime failures, timeouts, system outages, debugging, or cost spikes are discussed, diagnose the issue immediately and prescribe the exact state machine transition or backoff formula.",
    },
    "Architecture & Infrastructure": {
        domainName: "Platform Architecture, Fleet Scaling & Migrations",
        description: "Distributed worker fleet, zero-downtime database migrations, swarms, and calculation nodes.",
        runbookIds: [
            "distributed-fleet-and-worker-isolation",
            "zero-downtime-database-migrations",
            "crew-room-collaboration-and-swarms",
            "system-limits-and-quotas",
            "pipeline-and-mission-assembly",
        ],
        handRaisingInstruction:
            "When system scaling, schema migrations, worker isolation, or pipeline DAG assembly are discussed, outline the concrete architecture and phased rollout steps directly.",
    },
    "Data & Knowledge Graph": {
        domainName: "Data Engineering, Knowledge Graph & Reconciliation",
        description: "Entity linking, multi-source reconciliation, hybrid vector/graph search, and transactional writeback.",
        runbookIds: [
            "knowledge-graph-linking",
            "multi-source-reconciliation",
            "hybrid-vector-and-graph-retrieval",
            "unstructured-document-parsing",
            "transactional-writeback",
            "apps-in-crew",
        ],
        handRaisingInstruction:
            "When data pipelines, entity resolution, similarity scoring, vector embeddings, or database writebacks are discussed, prescribe the exact data schemas, matching rules, and linking rules directly.",
    },
    "Growth & Marketing": {
        domainName: "Growth Operations, AI Advertising & Email Lifecycle",
        description: "Multi-variant ad creative synthesis, Thompson Sampling ROAS optimization, email deliverability, and DNS authentication.",
        runbookIds: [
            "ai-marketing-and-ad-campaign-orchestration",
            "email-marketing-and-lifecycle-automation",
            "enterprise-saas-data-ingestion",
        ],
        handRaisingInstruction:
            "When marketing campaigns, ad creative synthesis, ROAS optimization, cold outbound email, or deliverability are discussed, prescribe the exact psychographic framing and deliverability limits directly.",
    },
    "Writing & Documentation": {
        domainName: "Longform Authoring, Document Architecture & Editorial Craft",
        description: "Structured manuscript drafting, station-based document assembly, narrative arc, and publication-grade prose through Scribe Studio.",
        runbookIds: [
            "scribe-studio-authoring-and-editorial-guide",
            "unstructured-document-parsing",
            "hil-form-schema-standards",
        ],
        handRaisingInstruction:
            "When drafting, outlining, rewriting, or structuring documents is discussed, prescribe the concrete station structure, archetype mode, and prose treatment directly.",
    },
    "Media & Creative Production": {
        domainName: "Film, Image & Creative Production",
        description: "Production storyboarding, shot design, visual style bibles, and editorial layout for generated media.",
        runbookIds: [
            "film-editor-screen-layout",
            "design-tokens-and-theming",
            "motion-design-and-micro-animations",
        ],
        handRaisingInstruction:
            "When video, image, storyboard, shot, or visual style work is discussed, prescribe the concrete scene, shot, or style treatment directly.",
    },
    "Finance & Business Operations": {
        domainName: "Financial Analysis, Audit & Revenue Operations",
        description: "Cost and revenue modelling, audit-ledger discipline, contract ingestion, and financial reporting grounded in tracked data.",
        runbookIds: [
            "compliance-and-audit-trails",
            "transactional-writeback",
            "autonomous-sql-generation-and-safety",
            "enterprise-saas-data-ingestion",
        ],
        handRaisingInstruction:
            "When budgets, spend, revenue, contracts, or financial risk are discussed, quantify the position from the room's data tools and state assumptions explicitly.",
    },
    "UI & Browser Automation": {
        domainName: "Frontend Engineering, Playwright Automation & UI Standards",
        description: "Browser automation, Playwright standards, visual validation, and responsive instant apps.",
        runbookIds: [
            "browser-automation-and-playwright-standards",
            "neuro-symbolic-calculation-nodes",
            "antipatterns-and-pitfalls",
        ],
        handRaisingInstruction:
            "When web scraping, Playwright automation, browser testing, UI design, or frontend component assembly are discussed, prescribe the concrete selectors, layouts, or component specs directly.",
    },
};

/**
 * Maps an agent card and archetype to its designated Subject Matter Expert domain.
 */
export function inferSmeDomain(card: AgentCardRecord, archetype: string): SmeDomainDefinition {
    const text = `${card.name} ${card.description}`.toLowerCase();
    const topics = (card.topicAffinities ?? []).map((t) => t.toLowerCase());
    const intents = (card.intentAffinities ?? []).map((i) => i.toLowerCase());

    if (
        archetype === "Data Sentinel" ||
        /security|compliance|vulnerab|audit|guardrail|auth|sandbox/.test(text) ||
        topics.includes("security")
    ) {
        return DOMAIN_SME_CATALOG["Security & Compliance"];
    }
    if (
        archetype === "Crisis Commander" ||
        archetype === "Field Operative" ||
        /sre|devops|chaos|incident|triage|debug|error|monitor|recovery/.test(text) ||
        topics.includes("devops") ||
        topics.includes("infrastructure")
    ) {
        return DOMAIN_SME_CATALOG["DevOps & Reliability"];
    }
    if (
        /\b(docs?|documents?|writ(?:er|ing|ten)|manuscripts?|scribe\w*|prose|editorial|novels?|author\w*|sow)\b/.test(text)
    ) {
        return DOMAIN_SME_CATALOG["Writing & Documentation"];
    }
    if (
        /\b(market|marketing|growth|ad|ads|advertising|email|prospect|prospecting|campaign|copywriting|roas|crm|outreach)\b/.test(text) ||
        topics.includes("marketing") ||
        topics.includes("sales")
    ) {
        return DOMAIN_SME_CATALOG["Growth & Marketing"];
    }
    if (
        /financ|budget|treasury|accounting|forecast|revenue|asc606|pricing|billing|investor/.test(text) ||
        topics.includes("finance")
    ) {
        return DOMAIN_SME_CATALOG["Finance & Business Operations"];
    }
    if (
        /\b(media|film|video|cinem|storyboard|shot)\b/.test(text) ||
        topics.includes("media") ||
        intents.includes("video")
    ) {
        return DOMAIN_SME_CATALOG["Media & Creative Production"];
    }
    if (
        archetype === "Knowledge Architect" ||
        /data|graph|ontology|reconcil|vector|sql|dataset|etl/.test(text) ||
        topics.includes("data") ||
        topics.includes("analytics")
    ) {
        return DOMAIN_SME_CATALOG["Data & Knowledge Graph"];
    }
    if (
        /frontend|ui|browser|playwright|scrape|canvas|design|component|mobile|ios|android/.test(text) ||
        topics.includes("ui") ||
        intents.includes("image generation")
    ) {
        return DOMAIN_SME_CATALOG["UI & Browser Automation"];
    }
    return DOMAIN_SME_CATALOG["Architecture & Infrastructure"];
}

function nameJitter(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    // Map to [-0.06, +0.06] — enough to separate voices, too small to cross a
    // threshold and silently undo the archetype's intended steering.
    return ((Math.abs(hash) % 121) - 60) / 1000;
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

/** Applies jitter to every trait except the archetype's defining extremes. */
function personaliseTraits(base: OceanTraits, name: string): OceanTraits {
    const j = nameJitter(name);
    const shift = (v: number): number => {
        // Leave decisive traits alone so the archetype survives the jitter.
        if (v > 0.8 || v < 0.3) return v;
        return clamp01(Number((v + j).toFixed(3)));
    };
    return { o: shift(base.o), c: shift(base.c), e: shift(base.e), a: shift(base.a), n: shift(base.n) };
}

/**
 * Writes a first-person Legend from what the card actually is. Deterministic —
 * no model call — so backfilling 21 agents costs nothing and stays stable across
 * runs. SoulService.evolveLegend() can refine these later from real outcomes.
 */
function composeLegend(card: AgentCardRecord, archetype: string): string {
    const caps = (card.capabilities ?? []).slice(0, 3);
    const capClause = caps.length > 0 ? caps.join(", ") : "general assistance";
    const topics = (card.topicAffinities ?? []).filter((t) => t !== "General");
    const topicClause = topics.length > 0 ? ` across ${topics.join(" and ")}` : "";

    const stance: Record<string, string> = {
        "Tactical Analyst": "I trust what can be measured, and I say so when a claim outruns its evidence.",
        "Strategic Oracle": "I read the second and third order effects before I commit to a position.",
        "Creative Catalyst": "I look for the option nobody has put on the table yet.",
        "Data Sentinel": "I watch the edges — the unverified assumption is the one that costs us.",
        "Crisis Commander": "I would rather make the call and own the tradeoff than wait for certainty.",
        "Knowledge Architect": "I give a discussion structure so the group argues about the right thing.",
        "Process Engineer": "I care whether an idea survives contact with real operating conditions.",
        "Innovation Director": "I ask what becomes possible once the stated constraint is lifted.",
        "Field Operative": "I trust observed behaviour over intended behaviour.",
        "Lead Directive": "I keep the group pointed at the objective.",
    };

    return (
        `I am ${card.name}, operating as a ${archetype}. ` +
        `My work centres on ${capClause}${topicClause}. ` +
        `${stance[archetype] ?? stance[DEFAULT_ARCHETYPE]}`
    );
}

export class CrewPersonaService {
    /** Derives a full persona for a card that has none yet. Deterministic. */
    derivePersona(card: AgentCardRecord): CrewPersona {
        const archetype = inferArchetype(card);
        const base = ARCHETYPE_PROFILES[archetype] ?? ARCHETYPE_PROFILES[DEFAULT_ARCHETYPE];
        const traits = personaliseTraits(base, card.name);
        return { archetype, traits, legend: composeLegend(card, archetype) };
    }

    /**
     * Resolves the persona actually stored on a card, deriving anything missing.
     * A card whose traits are still the flat 0.5 default is treated as unset —
     * that profile produces no steering and is never a deliberate choice.
     */
    resolvePersona(card: AgentCardRecord): CrewPersona {
        const derived = this.derivePersona(card);
        const stored = card.oceanTraits;
        const isFlatDefault =
            !stored ||
            (stored.o === 0.5 && stored.c === 0.5 && stored.e === 0.5 && stored.a === 0.5 && stored.n === 0.5);

        return {
            archetype: card.soulArchetype ?? derived.archetype,
            traits: isFlatDefault ? derived.traits : (stored as OceanTraits),
            legend: card.legend ?? derived.legend,
        };
    }

    /**
     * Builds the system prompt an agent speaks with in a crew room.
     *
     * @param card         The agent card taking the turn.
     * @param crewRoster   Names + one-line roles of the other members, so an agent
     *                     knows who it is talking to and can address them directly.
     * @param memoryContext Prompt-ready recall from the agent's own knowledge
     *                     graph (patterns and lessons it has accumulated).
     */
    buildSystemPrompt(
        card: AgentCardRecord,
        crewRoster: Array<{ name: string; description: string }> = [],
        memoryContext = "",
        projectKey: string | null = null,
        toolNames: string[] = [],
        nextSpeaker: string | null = null,
        heldBeliefs: string[] = [],
        orgContext?: { orgName?: string; userDisplayName?: string },
    ): string {
        const persona = this.resolvePersona(card);
        const soulPrompt = SoulService.generateSoulPrompt(persona.traits, persona.archetype);
        const mannerism = ARCHETYPE_MANNERISMS[persona.archetype] ?? ARCHETYPE_MANNERISMS[DEFAULT_ARCHETYPE];

        const orgName = orgContext?.orgName || "Oddjob Platform";
        const userName = orgContext?.userDisplayName || "Human Operator";

        const orgBlock =
            `\n### ACTIVE ORGANIZATION & USER CONTEXT\n` +
            `- Organization / Company Name: **${orgName}**\n` +
            `- Requesting User / Host: **${userName}**\n` +
            `- Role & Workspace: Ground all drafts, emails, communications, and proposals in this organization context.\n`;

        const others = crewRoster.filter((m) => m.name !== card.name);
        const rosterBlock =
            others.length > 0
                ? `\n### CREW\nYou are in a working discussion with:\n` +
                  others.map((m) => `- ${m.name}: ${m.description}`).join("\n") +
                  `\nA human participant is in the room as well, and a Supervisor observes and critiques.\n`
                : "";

        const memoryBlock = memoryContext.trim()
            ? `\n### YOUR ACCUMULATED EXPERIENCE\nDrawn from your own knowledge graph — prior patterns and lessons from work you have actually done. Ground your contribution in this where it applies, and say when you are drawing on it.\n${memoryContext.trim()}\n`
            : "";

        // Which Project Space this discussion belongs to. Agents are told
        // explicitly so they scope their contribution to it and do not volunteer
        // material from elsewhere — the prompt half of the boundary that
        // discussionScope() enforces in the knowledge graph.
        // Agents were narrating what they *would* look up ("I will search the
        // knowledge base…") instead of calling the tool, and one claimed to have
        // searched when it had made no call at all. Be explicit that intent is
        // not evidence.
        // Opening an app is a request to be acted on, not a question to answer.
        // Without this an agent holding render_app_surface still replied in prose
        // ("I cannot open the SDLC Workbench"), because the block above frames
        // every tool as something you check a claim with.
        const canLaunchApps = toolNames.includes("render_app_surface");
        const launchLine = canLaunchApps
            ? `- When someone asks to open, launch or find an app, workbench or blueprint: call list_installed_apps to resolve it, then render_app_surface to hand it over. Never answer that in prose, and never invent a slug or href — use the one the catalog returned.\n`
            : "";
        // Asking what an app holds is a data question, not a launch: answer it
        // from the records rather than opening the app and leaving them to look.
        const appDataLine = toolNames.includes("read_app_records")
            ? `- When someone asks what is IN an app — its transactions, defects, tickets, rescues — call read_app_records with the app's slug (from list_installed_apps) to see its collections, then read the relevant one. For totals, averages or counts pass \`aggregate\` instead of adding up rows. Answer from what it returned and quote its summary (how many records it covered). SDLC stage handoff records are app-wide: verify their room/cycle/repository binding. Offered is not source completion; acknowledged is a destination software receipt, not a human approval, CI result, merge or deployment. Never mutate protected handoff/source evidence through generic record actions.\n`
            : "";

        const canAssemble = toolNames.includes("mount_builder_pod");
        const assemblyLine = canAssemble
            ? `- APP CREATION: For a new application, call plan_app_architecture first with the user's requirements. Follow its recommendedTool, archetype, layout, surfaces, and capabilities; do not reduce dashboards, consoles, boards, portals, spatial canvases, collaboration hubs, or data studios to a form wizard. Then call mount_builder_pod with PRE-POPULATED props matching that plan. Calculators, intake forms, questionnaires and other forms belong to Form Studio (mount_form_studio), never to a builder pod. For non-app primitives, select the matching specialized pod. 'stageId' is optional and internal; never ask the user for it.\n`
            : "";

        const canPropose = toolNames.includes("propose_cycle_draft") || toolNames.includes("propose_app_draft") || toolNames.includes("propose_mission");
        const proposeLine = canPropose
            ? `- When a user has completed form intake, submitted parameters, or asked to save/create an application or cycle draft: call propose_app_draft (for applications/tools) or propose_cycle_draft (for operational cycles) or propose_mission to save the draft directly into the workspace registry and mount an inline 1-click approval/review card.\n`
            : "";

        // Two cycle tools, two different objects: propose_cycle_draft files a
        // loose stage list for review; this saves the full wave graph.
        const canSavePlan = toolNames.includes("commit_project_plan_to_cycle");
        const savePlanLine = canSavePlan
            ? `- When the user asks to save or commit a WAVE PLAN (waves with objectives, predecessor dependencies, assignees, acceptance criteria — e.g. the Project Studio plan): call commit_project_plan_to_cycle with the full plan. It saves the plan as a cycle awaiting approval; nothing runs until an admin approves it, so say that — never say the cycle launched. Use propose_cycle_draft only for a loose list of stages with no wave plan behind it.
`
            : "";

        // Deploying the assembled stack is a different act from drafting it.
        // Without this line the assembly guidance above absorbs every "ship it"
        // request into another mount_builder_pod call, and the room re-mounts the
        // same pod instead of proposing the scaffold that actually builds it.
        const canDeployAssembly = toolNames.includes("propose_assembly_deployment");
        const deployAssemblyLine = canDeployAssembly
            ? `- When someone asks to DEPLOY, ship, scaffold or build out an assembly that has already been discussed or mounted: call propose_assembly_deployment. Resolve the pack IDs with list_scaffold_packs or resolve_assembly_dag first and pass only IDs that exist. Pick a real appName (lowercase, hyphenated — it becomes a directory and a DNS label) from what the app IS; never invent a pack ID and never re-mount a pod in place of proposing the deployment. A deploy assembles, starts, and verifies but stays unpublished by default. Set publish=true only when the user explicitly asks to publish/share a link, and accessPolicy=public only when public access is explicit. Preserve the room's original app structure and behavior by default. If the user selected an App Forge theme, pass its exact designStyleId and optional aiEmbellishment; embellishment is visual-only and must not invent or remove features.\n`
            : "";

        // Name only tools the agent actually holds this turn.
        //
        // `toolNames` is the granted set, and a tool that was never registered is
        // silently absent from it. Hardcoding a wish-list of names into the prompt
        // therefore instructs the model to call tools that do not exist — it then
        // either fabricates the call or, worse, reports the answer it was told to
        // produce. Deriving the sentence from the granted set keeps the prompt and
        // the registry from drifting apart.
        const present = (...names: string[]) => names.filter((n) => toolNames.includes(n));

        const docsTools = present(
            "search_system_docs",
            "get_system_spec",
            "list_system_specs",
            "search_platform_documentation",
            "get_platform_feature_spec",
            "read_internal_repo_doc",
            "search_platform_patterns",
            "get_platform_pattern",
            "list_platform_patterns",
            "search_unified_knowledge",
            "discover_capabilities",
        );
        const docsLine = docsTools.length
            ? `- INTERNAL DOCUMENTATION, SPECS & BEST PRACTICES: You have access to authoritative platform feature documentation, domain module specifications, API references, capability catalogs, and 65 verified operational runbooks in docs/platform/.
  • When solving complex tasks, handling errors, designing architecture, or fulfilling user support requests, call search_platform_patterns or get_platform_pattern to retrieve the structured AgentExecutionContract (preconditions, tools, safety boundaries) and token-optimized guidance.
  • Internalize the retrieved runbooks to augment your reasoning: follow their algorithmic decision trees, error recovery taxonomies, and idempotency rules rather than inventing unverified workflows from scratch.
  • When asked about internal architecture, platform capabilities, backend modules, or system design, call ${docsTools.join(" or ")} before answering rather than answering from memory.\n`
            : "";

        const datasetTools = present(
            "list_datasets",
            "get_dataset_items",
            "calculate_dataset_metric",
            "search_unified_knowledge",
            "run_saved_query",
            "list_saved_queries",
        );
        const datasetLine = datasetTools.length
            ? `- DATASETS, WORK ORDERS & STATISTICAL METRICS: When asked to analyze data, compute metrics (e.g. average resolution times, totals, counts, medians), or report on service requests, work orders, or datasets, use ${datasetTools.join(", ")}. Never guess a numerical result. If the tools you hold cannot answer the question, say so plainly instead of estimating.\n`
            : "";

        const canListSaaS = toolNames.includes("list_saas_adapters");
        const saasLine = canListSaaS
            ? `- CRITICAL: When asked about integrations, SaaS adapters, external connections, Jira, Confluence, Slack, GitHub, or what systems this project is connected to: you MUST call list_saas_adapters. Do not answer from memory or guess - always call this tool explicitly. This renders as an assembly surface showing all adapters bound to this project and organization with their connection status, sync configuration, and bound resources.\n`
            : "";

        const canQueryXRay = toolNames.includes("execute_visual_query") || toolNames.includes("list_xray_specs") || toolNames.includes("get_xray_spec");
        const xrayLine = canQueryXRay
            ? `- When asked about platform topology, system architecture, component relationships, or structural dependencies: use execute_visual_query to traverse the System X-Ray graph. This reveals nodes (pipelines, agents, datasets, missions, apps) and their relationships (TRIGGERS, WRITES_TO, READS_FROM, BELONGS_TO). For detailed architecture specs of specific components, use get_xray_spec. For discovering which components have documented specs, use list_xray_specs.\n`
            : "";

        const researchTools = present(
            "search_unified_knowledge",
            "google_search",
            "browse_web",
            "propose_research_mission"
        );
        let researchLine = "";
        if (researchTools.length > 0) {
            const ladderParts: string[] = [];
            if (toolNames.includes("search_unified_knowledge")) {
                ladderParts.push("search_unified_knowledge (what this organisation already knows)");
            }
            if (toolNames.includes("google_search")) {
                ladderParts.push("google_search (external web search)");
            }
            if (toolNames.includes("browse_web")) {
                ladderParts.push("browse_web (inspecting specific web pages)");
            }
            if (toolNames.includes("propose_research_mission")) {
                ladderParts.push("propose_research_mission (escalating for human-approved deep research)");
            }

            const ladderText = ladderParts.join(" → ");
            researchLine =
                `- CRITICAL: When you do not know something — org facts, external entities, industry trends, technical details, or anything not already in this thread — do NOT guess or speculate. You MUST use research tools. Work in this order, stopping as soon as you can answer: ${ladderText}. ALWAYS try at least one search before answering in prose. If your search returns no results, try the next research tool in your set. Only if ALL research tools you hold fail should you say plainly "I could not find information about X after searching" rather than filling the gap with plausible detail.\n`;

            if (toolNames.includes("search_unified_knowledge")) {
                researchLine +=
                    `- IMPORTANT: When search_unified_knowledge returns results with URLs or document IDs, EXPLICITLY INCLUDE them and copy each URL exactly as returned. Relative /knowledge/... URLs are valid Oddjob links; never invent a hostname or replace their origin. If the user asks to "present research" or "create a deck", you will need these URLs/IDs to reference the original research sources in your presentation.\n`;
                if (toolNames.includes("generate_presentation_deck")) {
                    researchLine +=
                        `- When you find research findings and the user asks to "present", "show", or "display" the results: First use search_unified_knowledge to gather the research. Then call generate_presentation_deck with the research content structured as markdown. Include the source URLs/document IDs from your search results in the deck content so the research can be referenced.\n`;
                }
            }
        }

        const docTools = present("list_document_templates", "get_document_template");
        const docTemplateLine = docTools.length
            ? `- When someone asks to render, generate, or view a document template (e.g. PRD, Test Plan, RCA Post-Mortem, Executive Brief, SOC2 Compliance Report): call ${docTools.join(" or ")} to retrieve and render the structured template inline.\n`
            : "";

        const spatialTools = present("h3_hexagonal_spatial_evaluate", "geofence_spatial_evaluate");
        const canRenderAppSurface = toolNames.includes("render_app_surface");
        const canRenderMap = toolNames.includes("render_map");
        const canInstantApp = toolNames.includes("assemble_instant_app") || toolNames.includes("render_instant_app");
        let spatialMapLine = "";
        if (canRenderMap || canInstantApp || canRenderAppSurface || spatialTools.length > 0) {
            spatialMapLine = `- When someone asks for a map, route, directions, geographic markers, or an instant app map:\n`;
            if (canRenderMap) {
                spatialMapLine += `  • For maps and routes: call render_map({ markers: [{ lat, lng, label, description }], route: { waypoints: [{ lat, lng, label }] } }) to render the interactive map with road-snapped route and distance/duration directly in the chat turn.\n`;
            }
            if (canInstantApp) {
                spatialMapLine += `  • You can also call assemble_instant_app({ blocks: [{ component: "MapPod", props: { markers: [...], route: { waypoints: [...] } } }] }) (or render_instant_app with component: "MapPod") to render an instant app map.\n`;
            }
            if (canRenderAppSurface) {
                spatialMapLine += `  • ONLY if the user specifically requests the Signal Intelligence operations workbench: call render_app_surface({ title: "Signal Intelligence & Uber H3 Hexagonal Spatial Map", href: "/signal-intelligence", mode: "embed" }). For all general map and location requests, use render_map or assemble_instant_app with MapPod instead.\n`;
            }
            if (spatialTools.length > 0) {
                spatialMapLine += `  • You may also call ${spatialTools.join(" or ")} to compute inline spatial state for a specific asset.\n`;
            }
        }

        const availableChartTools: string[] = [];
        if (toolNames.includes('publish_work_product')) availableChartTools.push('  - For substantive deliverables, maintain one current room work product with publish_work_product. Reuse its documentKey when revising, provide complete content and a change summary, and preserve user corrections. Cite sources and state unmet room success criteria. Avoid publishing a document for routine acknowledgments.');
        if (toolNames.includes("render_performance_scorecard")) availableChartTools.push("  - Use render_performance_scorecard for vendor and other performance reviews. Include sourced 0–100 dimension scores, weights, methodology, and mandatory criteria; null means not assessed. Never infer approval from a score.");
        if (toolNames.includes("render_gate_review")) availableChartTools.push("  - Use render_gate_review for project phase-gate readiness. Keep failed or unverified mandatory criteria visible. Rendering a review does not advance a project or authorize execution.");
        if (toolNames.includes("render_map")) availableChartTools.push("  - Use render_map for geographic locations, facilities, delivery stops, or proximity search results with pinpoint markers.");
        if (toolNames.includes("render_chart")) availableChartTools.push("  - Use render_chart for trend data, time-series, breakdowns, or KPI values (types: bar, line, pie, area).");
        if (toolNames.includes("render_table")) availableChartTools.push("  - Use render_table for multi-column tabular data or structured comparisons of 4+ items.");
        if (toolNames.includes("render_comparison")) availableChartTools.push("  - Use render_comparison for side-by-side comparison of 2-3 options with criteria.");
        if (toolNames.includes("render_carousel")) availableChartTools.push("  - Use render_carousel for a swipeable card carousel of 2+ items — products, document versions, generated options, or search results with images and links.");
        if (toolNames.includes("render_list")) availableChartTools.push("  - Use render_list for ordered/unordered item lists or checklists.");
        if (toolNames.includes("render_timeline")) availableChartTools.push("  - Use render_timeline for chronological events, milestones, or release schedules.");
        if (toolNames.includes("render_progress")) availableChartTools.push("  - Use render_progress for task completion %, multi-step progress, or pipeline stage status.");
        if (toolNames.includes("render_tree")) availableChartTools.push("  - Use render_tree for hierarchical/nested data (org charts, dependency trees).");
        if (toolNames.includes("get_health_dashboard")) availableChartTools.push("  - Use get_health_dashboard to fetch live platform health and cost metrics.");

        const chartLine = availableChartTools.length
            ? `- When presenting data, metrics, analytics, comparisons, or any structured information: always call the appropriate Rich-UI tool instead of describing the data in prose.\n` +
              availableChartTools.join("\n") + "\n"
            : "";

        // GATHER FIRST, THEN RENDER.
        const canGenerateDecks = toolNames.includes("generate_presentation_deck");
        const hasKnowledgeSearch = toolNames.includes("search_unified_knowledge");
        const deckResearchInstruction = hasKnowledgeSearch
            ? `  - When asked to "present research", "show me the findings", or "display the results": CRITICAL - You MUST use search_unified_knowledge first to gather the research. On your FIRST turn, call search_unified_knowledge and EXPLICITLY SAVE the URLs, document IDs, and evidence from the search results. On your SECOND turn, call generate_presentation_deck with the research content structured as markdown, INCLUDING the URLs/documentIds in the content so sources can be referenced.\n`
            : "";
        const deckLine = canGenerateDecks
            ? `- When asked to create, layout, or generate a presentation deck, slide deck, visual document, whitepaper, or executive brief: CALL generate_presentation_deck({ title, content, themeId, formatCategory }).\n` +
              `  - CRITICAL ANTI-PATTERN TO AVOID: Do NOT call generate_presentation_deck in the same turn you call data-fetching tools. You cannot render data you have not yet processed. Violating this produces empty slides with generic placeholder text.\n` +
              `  - MANDATORY SYNTHESIS STEP: Before calling generate_presentation_deck, you MUST convert ALL fetched data into structured markdown in your \`content\` parameter. The assembler builds slides from this markdown structure.\n` +
              `  - DO NOT ASK THE USER to specify items that tool results already returned. Include all relevant results in the deck content.\n` +
              `  - NEVER CALL generate_presentation_deck TWICE in the same turn. Pick one call. Multiple calls fire duplicate decks with different themes.\n` +
              deckResearchInstruction +
              `  - \`content\` is the document. Write it as markdown — \`#\` headings per section, \`-\` bullets for findings, real figures inline — because the assembler builds slides from that structure. Passing section titles with nothing under them produces empty slides.\n` +
              `  - IMPORTANT: When research results contain URLs or document IDs, you MUST include them in your markdown content as: "Source: [Document Title](URL)" or "Source: Document #123" so the research can be referenced in the deck.\n` +
              `  - Set \`formatCategory\` to what was asked for: presentation_deck for slides, whitepaper for a written document, executive_brief for a one-page summary, magazine_ad for an editorial spread. They render differently.\n` +
              `  - If a lookup came back empty, say so in the content. An honest "no failed jobs in the last 24h" is a finding; inventing a number is not.\n` +
              `  - Do not stall asking about missing templates, and do not debate whether to build it. Gather on turn 1, build deck on turn 2.\n`
            : "";

        const canGenerateDocs = toolNames.some((t) =>
            ["generate_pdf", "generate_excel", "generate_word", "generate_google_doc", "generate_mermaid_diagram"].includes(t)
        );
        const docGenLine = canGenerateDocs
            ? `- When asked to generate, create, or export files (PDF, Word doc, Excel spreadsheet, Mermaid diagram): call generate_pdf, generate_word, generate_excel, or generate_mermaid_diagram with the synthesized content. As with decks: if the file is meant to contain information you have not looked up yet, look it up first and export on your next turn.\n`
            : "";

        const canScaffoldMultiStep = toolNames.includes("scaffold_multistep_app");
        const multiStepScaffoldLine = canScaffoldMultiStep
            ? `- MULTI-STEP APPS: After plan_app_architecture identifies a workflow, case-management, or other staged experience, call scaffold_multistep_app with the returned archetype, layout, capabilities, and concrete stages. Preserve branching, data bindings, pipelines, approvals, and specialized surfaces. Use modal_wizard only for true step-by-step workflows.\n`
            : "";

        const canReadAttachments = toolNames.includes("get_attachment_text") || toolNames.includes("search_attachments") || toolNames.includes("list_attachments");
        const attachmentLine = canReadAttachments
            ? `- ATTACHMENTS & UPLOADED FILES: When someone asks about an attached file, uploaded PRD, or asks to build an app/workflow from an attachment: CALL list_attachments to discover what files exist, then call get_attachment_text({ attachmentId or fileName }) or search_attachments to read the extracted requirements. Once read, IMMEDIATELY DISSECT the specification and call scaffold_multistep_app or mount_builder_pod on your next turn.\n`
            : "";

        
        const sme = inferSmeDomain(card, persona.archetype);
        const smeBlock =
            `\n### DESIGNATED SME SPECIALTY & TOPIC RUNBOOKS\n` +
            `You are the primary Subject Matter Expert (SME) on: **${sme.domainName}**.\n` +
            `${sme.description}\n\n` +
            `**Your Core Topic Runbooks:**\n` +
            sme.runbookIds.map((id) => `- \`${id}\``).join("\n") +
            `\n\n` +
            `**SME Execution Principles:**\n` +
            `- ${sme.handRaisingInstruction}\n` +
            `- Lead decisively with concrete answers, artifacts, code, and execution. Do NOT robotically recite "I am the SME on..." or cite runbook IDs in your speech — embody your expertise through the substance and precision of your response.\n` +
            `- ACTION FIRST: When the human asks for a deliverable, Table of Contents, outline, schema, code, or document: IMMEDIATELY DELIVER IT. Never merely announce that you will do it, debate who should do it, or stall in meta-discussion.\n` +
            `- When discussions focus on domains outside your specialty, support the discussion constructively or build on your peers' proposals.\n`;

        const canRenderIntake = toolNames.includes("render_intake_form");
        const intakeLine = canRenderIntake
            ? `- ON-THE-FLY APPS, FORMS & CALCULATORS: When the user asks to build or show an app on the fly (weather app, live data app, dynamic calculator, mortgage/BMI calculator, intake form), you have full capability to build and render it immediately! Do NOT state that the app is missing from the catalog and do NOT defer to App Forge.\n` +
              `  • For interactive apps, calculators, or live data tools: call render_intake_form directly! Use 'location' (GPS/map picker), 'text', or 'number' inputs, 'query' fields for live external APIs (e.g. url: 'https://api.open-meteo.com/v1/forecast', params: { latitude: '{{latitude}}', longitude: '{{longitude}}', current_weather: 'true' }, jsonPath: 'current_weather.temperature', unit: '°C'), and 'computed' fields with formulas (e.g. 'round(temp * 9/5 + 32, 1)').\n` +
              `  • Example BMI Calculator: render_intake_form({ title: "BMI Calculator", description: "Calculate your Body Mass Index", fields: [{ key: "weight", label: "Weight (kg)", type: "number" }, { key: "height", label: "Height (cm)", type: "number" }, { key: "bmi", label: "BMI", type: "computed", formula: "round(weight / ((height/100) * (height/100)), 2)", format: "number" }] })\n` +
              `  • For composable visual dashboards: call assemble_instant_app with modular blocks (MetricGrid, IndustrialDashboardHero, StatusTimeline).\n`
            : "";

        const appListingLine = canLaunchApps || toolNames.includes("list_installed_apps")
            ? `- For apps and workspaces: call render_app_surface or list_installed_apps to show available apps.\n`
            : "";

        let toolCatalogIntro = `You can call these tools: ${toolNames.join(", ")}.\n`;
        if (toolNames.length > 25) {
            const categories: Record<string, string[]> = {
                "🔍 Research & Knowledge": [],
                "📊 Rich UI & Visualizations": [],
                "💻 Code & Execution": [],
                "📈 Datasets & Metrics": [],
                "🛠️ App Studio & Workflows": [],
                "🔗 SaaS & Integrations": [],
                "⚙️ System & Platform": [],
                "📦 Additional Tools": [],
            };

            for (const name of toolNames) {
                if (/search|knowledge|confluence|web|google|wiki|browse|arxiv|patent/i.test(name)) {
                    categories["🔍 Research & Knowledge"].push(name);
                } else if (/render|chart|table|deck|presentation|graph|diagram|timeline|pdf|excel|word/i.test(name)) {
                    categories["📊 Rich UI & Visualizations"].push(name);
                } else if (/code|python|execute|query|sql|eval|datalog|sandbox/i.test(name)) {
                    categories["💻 Code & Execution"].push(name);
                } else if (/dataset|metric|stats|analytics|order|ticket/i.test(name)) {
                    categories["📈 Datasets & Metrics"].push(name);
                } else if (/app|scaffold|pod|studio|surface|wizard|component/i.test(name)) {
                    categories["🛠️ App Studio & Workflows"].push(name);
                } else if (/saas|jira|slack|github|adapter|webhook|sync/i.test(name)) {
                    categories["🔗 SaaS & Integrations"].push(name);
                } else if (/system|health|audit|permission|security|config|xray/i.test(name)) {
                    categories["⚙️ System & Platform"].push(name);
                } else {
                    categories["📦 Additional Tools"].push(name);
                }
            }

            const catLines: string[] = ["Categorized tool directory:\n"];
            for (const [catName, tools] of Object.entries(categories)) {
                if (tools.length > 0) {
                    catLines.push(`**${catName}** (${tools.length}):\n${tools.join(", ")}`);
                }
            }
            toolCatalogIntro = catLines.join("\n\n") + "\n";
        }

        const toolBlock = toolNames.length
            ? `\n### TOOLS\n${toolCatalogIntro}\n` +
              `- CRITICAL: NEVER describe a tool call in prose - actually CALL the tool. When the user asks for an action or deliverable you hold a tool for, invoke the tool directly. Do NOT write "I would call tool_name with..." - execute it. The tool call itself is what creates the surface or applies the change.\n` +
              intakeLine +
              appListingLine +
              attachmentLine +
              multiStepScaffoldLine +
              deckLine +
              docGenLine +
              docsLine +
              researchLine +
              docTemplateLine +
              spatialMapLine +
              datasetLine +
              saasLine +
              xrayLine +
              chartLine +
              launchLine +
              appDataLine +
              assemblyLine +
              proposeLine +
              savePlanLine +
              deployAssemblyLine
            : "";

        // Positions the agent already holds, so it argues consistently across
        // rounds instead of re-deriving a stance each time — and has to own a
        // change of mind rather than quietly switching.
        const beliefBlock = heldBeliefs.length
            ? `\n### WHAT YOU CURRENTLY HOLD\n` +
              heldBeliefs.map((b) => `- ${b}`).join("\n") +
              `\nIf the discussion has changed your mind, say so explicitly.\n`
            : "";

        // Theory of mind, folded into the turn the agent is already taking so it
        // costs no extra model call. Scored afterwards against what the subject
        // actually says, which is what stops this being fluent guesswork.
        const predictionBlock = nextSpeaker
            ? `\n### BEFORE YOU FINISH\n` +
              `On a final line, write exactly:\n` +
              `PREDICTION(${nextSpeaker}): <one sentence on what you expect ${nextSpeaker} to argue>\n` +
              `That line is stripped before anyone sees your turn, and is scored against what they actually say. ` +
              `Be specific — a safe non-answer scores badly.\n`
            : "";

        const projectBlock = projectKey
            ? `\n### PROJECT SPACE\nThis discussion belongs to the "${projectKey}" Project Space. Keep your contribution scoped to it, and do not introduce material from other projects.\n`
            : "";

        return (
            `You are ${card.name}. ${card.description}\n\n` +
            `### LEGEND\n${persona.legend}\n` +
            projectBlock +
            orgBlock +
            soulPrompt +
            smeBlock +
            `\n### BEARING\n- ${mannerism}\n` +
            rosterBlock +
            memoryBlock +
            `\n### DISCUSSION RULES\n` +
            `- You are one voice among several. Contribute your perspective; do not summarise the whole discussion — that is the Supervisor's job.\n` +
            `- Engage with what others actually said. Address them by name when you agree, build, or disagree.\n` +
            `- Disagree when you genuinely do. Consensus that papers over a real difference is worthless.\n` +
            `- Be substantive and brief: at most two short paragraphs.\n` +
            `- Speak in your own voice. Never prefix your reply with your own name.\n` +
            `- SIGNING & SENDER IDENTITY: When signing emails, drafts, tickets, or correspondence, always sign with your actual assigned agent name ("${card.name}") and role ("${persona.archetype}"). Never output literal placeholder text such as "[Your Name]", "[Agent Name]", "[Insert Name]", or "[Your Position]".\n` +
            `- NO UNFILLED PLACEHOLDERS: Never output raw placeholder brackets like [Company Name], [Your Name], [Your Position], [Link], or [Phone]. Always resolve variables using the known organization name (${orgName}) and user identity (${userName}). If any necessary information is genuinely missing, explicitly ask the user for it or invoke render_intake_form / request_human_input rather than emitting bracketed placeholders.\n` +
            `- NATIVE TOOL EXECUTION ONLY: NEVER output markdown code blocks containing JSON tool calls (such as \`\`\`json { "name": "..." } \`\`\`) in your chat responses. Tool calls must be invoked exclusively through the API tool execution mechanism, never as code fences in chat text.\n` +
            `- ACTION PROPOSALS: When drafting an outbound action, email, or operational mutation for the user, provide the clear text and offer an actionable proposal or intake form for review.\n` +
            `- DO NOT RE-FIRE COMPLETED WORK: If another agent has already called a generation tool (generate_presentation_deck, generate_word, scaffold_multistep_app, render_intake_form, etc.) and produced an artifact in this session, DO NOT call the same tool again. Re-running completed tools creates duplicate artifacts and wastes resources. Acknowledge the existing deliverable instead.\n` +
            `- STAY ON-SCRIPT: Only build or propose what the user explicitly requested. Do NOT invent additional deliverables, enhancements, or unsolicited features (e.g., spatial maps, extra dashboards, unrequested integrations) beyond what the user asked for. If you have a suggestion, state it as text — do NOT call a tool to build it without user approval.\n` +
            toolBlock +
            beliefBlock +
            predictionBlock
        );
    }

    /** The canonical archetype list, for UI pickers. */
    listArchetypes(): string[] {
        return [...SOUL_ARCHETYPES];
    }

    /**
     * Maps an active Creation Studio stage to preferred domain advocate archetypes.
     */
    getDomainAdvocates(stageTypeOrId: string): string[] {
        const key = stageTypeOrId.toLowerCase();
        if (key.includes("scaffold") || key.includes("host") || key.includes("pack")) {
            return ["Knowledge Architect", "Lead Directive", "Process Engineer"];
        }
        if (key.includes("pipeline") || key.includes("step") || key.includes("flow")) {
            return ["Process Engineer", "Tactical Analyst", "Field Operative"];
        }
        if (key.includes("governance") || key.includes("hil") || key.includes("sec") || key.includes("audit")) {
            return ["Data Sentinel", "Crisis Commander", "Tactical Analyst"];
        }
        if (key.includes("dataset") || key.includes("schema") || key.includes("data") || key.includes("sql")) {
            return ["Data Sentinel", "Knowledge Architect"];
        }
        if (key.includes("mission") || key.includes("brief") || key.includes("goal")) {
            return ["Strategic Oracle", "Lead Directive"];
        }
        if (key.includes("agent") || key.includes("hr") || key.includes("team")) {
            return ["Lead Directive", "Knowledge Architect"];
        }
        return ["Tactical Analyst", "Strategic Oracle"];
    }
}

export const crewPersonaService = new CrewPersonaService();
