/**
 * Platform Capability Facts (the "What can Oddjob do?" extraction)
 * ================================================================
 *
 * Deterministic, verifiable answer to the question a buyer, an operator, and the
 * Copilot all ask first. This module produces ONLY facts — no prose, no LLM — so
 * that the capability spec can be fingerprinted exactly like the API and UI
 * specs in `documentation.service.ts`: the hash is a pure function of what the
 * platform actually declares and registers, which makes it immune to git
 * checkout churn and to a reworded narrative.
 *
 * Five layers, each drawn from a real source of truth:
 *
 *   1. Pillars & capabilities  — `shared/product/oddjob-capability-manifest.ts`
 *   2. Executable contracts    — `shared/product/oddjob-executable-capability-manifests.ts`
 *   3. Actionable inventory    — the static agent-tool registry + the MCP tool set
 *   4. Guarantees & limits     — guardrails, risk profiles, and the explicit
 *                                "we are not this" list from positioning
 *   5. Evidence                — canonical demos, readiness checks, and the
 *                                golden-path fixtures on disk
 *
 * DETERMINISM IS THE CONTRACT. Every collection is sorted before it is emitted.
 * An unsorted list would re-hash on filesystem read order and flip the spec to
 * "outdated" on every request, filling the change register with phantom entries.
 *
 * Scope boundary: this is the PLATFORM-WIDE catalog — what Oddjob can do at all.
 * What a *specific organization* can do right now (its missions, configured
 * credentials, connected MCP servers) is a separate, deliberately un-fingerprinted
 * overlay; see `buildCapabilityAvailabilityOverlay` in `documentation.service.ts`.
 *
 * Inputs are injectable so the extraction can be unit-tested without loading the
 * whole agent-tool registry.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createLogger } from "@server/utils/logger.js";
import {
    ODDJOB_POSITIONING,
    ODDJOB_PILLARS,
    ODDJOB_CAPABILITIES,
    ODDJOB_CANONICAL_DEMOS,
    ODDJOB_READINESS_CHECKS,
    ODDJOB_COPILOT_GUIDE,
    type OddjobCapabilityMaturity,
    type OddjobPillarId,
} from "@shared/product/oddjob-capability-manifest.js";
import {
    ODDJOB_EXECUTABLE_CAPABILITY_MANIFESTS,
    PRODUCT_TO_EXECUTABLE_CAPABILITY_ID,
} from "@shared/product/oddjob-executable-capability-manifests.js";
import type { CapabilityManifest } from "@shared/schema/capabilities/index.js";
import { scanBlueprintDrift, type BlueprintDriftSummary } from "./blueprint-drift.js";

const logger = createLogger("CapabilityFacts");

// --- Shapes ---------------------------------------------------------------

/** Minimal structural view of a registered agent tool — avoids importing the
 *  tool registry's types (and therefore its whole module graph) into `shared`. */
export interface AgentToolLike {
    name: string;
    label?: string;
    group?: string;
    description?: string;
    riskLevel?: "high" | "medium" | "low";
    /** Governance lives in a nested object on ToolDefinition, NOT at the top
     *  level. Reading a flat `requiresApproval` here silently reports zero
     *  approval-gated tools across the whole registry. */
    approvalPolicy?: { requiresApproval?: boolean; rationale?: string };
    sideEffects?: string[];
}

export interface McpToolFact {
    name: string;
    description: string;
    sourceFile: string;
}

/** Structural view of `BlueprintMetadata` — kept local so this module does not
 *  depend on the apps domain's types. */
export interface BlueprintLike {
    slug: string;
    name: string;
    description?: string;
    category?: string;
    capabilities?: string[];
}

/**
 * A system app blueprint. Blueprints are the fourth inventory layer: agent tools
 * and MCP tools are what an agent can *invoke*, while a blueprint is a durable
 * interface a team can stand up — so "what can Oddjob do?" is incomplete without
 * them. Each already declares a hand-authored `capabilities` list in the
 * registry; this surfaces it instead of leaving it stranded in code.
 */
export interface CapabilityBlueprintFact {
    slug: string;
    name: string;
    category: string;
    description: string;
    capabilities: string[];
}

export interface CapabilityToolFact {
    name: string;
    label: string;
    riskLevel: "high" | "medium" | "low" | null;
    requiresApproval: boolean;
    approvalRationale: string | null;
}

export interface CapabilityToolGroupFact {
    group: string;
    toolCount: number;
    /**
     * Tools declaring a HARD approval gate via `approvalPolicy.requiresApproval`.
     * Expect this to be small: the registry's flag is an always-approve override,
     * while the ordinary approval boundary is decided at runtime by the governor
     * and autonomy policy from risk + context. A low number here does NOT mean
     * "almost nothing needs approval" — see `highRiskCount`.
     */
    approvalGatedCount: number;
    /** Tools declaring `riskLevel: "high"` — the population the runtime policy
     *  actually evaluates for review. */
    highRiskCount: number;
    tools: CapabilityToolFact[];
}

export interface CapabilityContractFact {
    capabilityId: string;
    capabilityVersion: string;
    schemaVersion: number;
    category: string;
    owner: string;
    summary: string;
    inputs: Array<{ name: string; type: string }>;
    outputs: Array<{ name: string; type: string }>;
    guardrails: string[];
    businessUseCases: string[];
    riskProfile: string;
    executionEnvironment: string;
    dependencies: string[];
}

/**
 * What evidence EXISTS for a capability — deliberately not "this test passed".
 * Generating the spec must never execute a mission or a contract run, so the
 * honest signal is which artifacts are declared against the capability.
 */
export type CapabilityVerificationLevel = "contract+demo" | "contract" | "declared";

export interface CapabilityEvidenceFact {
    verificationLevel: CapabilityVerificationLevel;
    hasExecutableContract: boolean;
    demoIds: string[];
    readinessCheckIds: string[];
    /** Readiness checks on this pillar that carry a runnable `command`. */
    executableReadinessCheckIds: string[];
}

/**
 * Maturity derived from artifacts that exist — see docs/CAPABILITY_MATURITY_RUBRIC.md.
 *
 * `maturity` was previously a hand-typed literal in the product manifest: nothing
 * computed it, nothing consumed it beyond a badge colour, and no document said
 * what the levels meant. A capability could therefore be labelled "advanced"
 * while half of what it claimed did not exist.
 *
 * The declared value survives as a CEILING only. Declaring something
 * experimental while it hardens is legitimate and is respected; declaring
 * something advanced achieves nothing, because the evidence has to be present.
 *
 * Presence, not passing: this must not execute anything. The capability spec is
 * a fingerprinted singleton, so running a readiness command here would make its
 * fingerprint depend on the state of the world.
 */
const MATURITY_RANK: Record<OddjobCapabilityMaturity, number> = {
    experimental: 0,
    foundation: 1,
    maturing: 2,
    advanced: 3,
};

export interface MaturityInputs {
    hasExecutableContract: boolean;
    demoCount: number;
    executableReadinessCheckCount: number;
    /** The authored value, applied as an upper bound. */
    declared: OddjobCapabilityMaturity;
}

export function deriveCapabilityMaturity(input: MaturityInputs): {
    maturity: OddjobCapabilityMaturity;
    earned: OddjobCapabilityMaturity;
    cappedByDeclaration: boolean;
    rationale: string;
} {
    let earned: OddjobCapabilityMaturity;
    let rationale: string;

    if (!input.hasExecutableContract) {
        earned = "experimental";
        rationale = "No executable capability manifest is mapped to this product capability.";
    } else if (input.demoCount === 0) {
        earned = "foundation";
        rationale = "Has an executable contract, but no canonical demo exercises it end to end.";
    } else if (input.executableReadinessCheckCount === 0) {
        earned = "maturing";
        rationale = `Executable contract and ${input.demoCount} canonical demo(s), but its pillar has no readiness check with a runnable command.`;
    } else {
        earned = "advanced";
        rationale = `Executable contract, ${input.demoCount} canonical demo(s), and ${input.executableReadinessCheckCount} executable readiness check(s) on its pillar.`;
    }

    const cappedByDeclaration = MATURITY_RANK[input.declared] < MATURITY_RANK[earned];
    return {
        maturity: cappedByDeclaration ? input.declared : earned,
        earned,
        cappedByDeclaration,
        rationale: cappedByDeclaration
            ? `${rationale} Reported as "${input.declared}" because the manifest declares that lower ceiling.`
            : rationale,
    };
}

export interface CapabilityFact {
    id: string;
    name: string;
    pillar: OddjobPillarId;
    pillarName: string;
    /** Computed from evidence — see docs/CAPABILITY_MATURITY_RUBRIC.md. */
    maturity: OddjobCapabilityMaturity;
    /** The authored value from the product manifest, applied as a ceiling. */
    declaredMaturity: OddjobCapabilityMaturity;
    /** Which artifacts produced the level, in words. */
    maturityRationale: string;
    /** True when the manifest declared a level lower than the evidence earned. */
    maturityCappedByDeclaration: boolean;
    buyerValue: string;
    primarySurfaces: string[];
    copilotNextActions: string[];
    hardeningFocus: string[];
    contract: CapabilityContractFact | null;
    evidence: CapabilityEvidenceFact;
}

export interface CapabilityPillarFact {
    id: OddjobPillarId;
    name: string;
    buyerLabel: string;
    promise: string;
    proofPoints: string[];
    capabilityIds: string[];
}

export interface CapabilityDemoFact {
    id: string;
    title: string;
    buyerQuestion: string;
    outcome: string;
    capabilityIds: string[];
    successCriteria: string[];
    guidedPrompt: string;
}

export interface CapabilityReadinessFact {
    id: string;
    label: string;
    pillar: OddjobPillarId;
    priority: "p0" | "p1" | "p2";
    command: string | null;
    expected: string;
}

export interface CapabilityGoldenPathFact {
    id: string;
    title: string;
    buyerQuestion: string;
    fixtureFile: string;
    successCriteria: string[];
}

export interface CapabilityCopilotCommandFact {
    id: string;
    label: string;
    pillar: OddjobPillarId;
    riskLevel: "low" | "medium" | "high";
    requiresApproval: boolean;
    intent: string;
    suggestedTools: string[];
    userFacingResult: string;
}

export interface CapabilityFacts {
    /** Curated cross-studio handoffs; included in the reference fingerprint. */
    crewWorkflowGuide?: string;
    positioning: {
        category: string;
        oneLiner: string;
        buyerMessage: string;
        leadWith: string[];
        /** The explicit "Oddjob is NOT this" list. Stops the Copilot from
         *  over-claiming, and answers the buyer's real question faster. */
        notPositionedAs: string[];
    };
    pillars: CapabilityPillarFact[];
    capabilities: CapabilityFact[];
    toolGroups: CapabilityToolGroupFact[];
    totalAgentTools: number;
    totalApprovalGatedTools: number;
    totalHighRiskTools: number;
    mcpToolCount: number;
    mcpToolModules: Array<{ sourceFile: string; toolNames: string[] }>;
    blueprints: CapabilityBlueprintFact[];
    blueprintCategories: Array<{ category: string; blueprintCount: number }>;
    /** Declared-vs-implemented check over the blueprint source tree. */
    blueprintDrift: BlueprintDriftSummary;
    demos: CapabilityDemoFact[];
    readinessChecks: CapabilityReadinessFact[];
    goldenPaths: CapabilityGoldenPathFact[];
    copilot: {
        operatingMode: string;
        firstRunPrompt: string;
        defaultObjectTypes: string[];
        guidedFlows: string[];
        commands: CapabilityCopilotCommandFact[];
        trustQuestions: Array<{ question: string; answerShouldInclude: string[] }>;
    };
    counts: {
        pillars: number;
        capabilities: number;
        withExecutableContract: number;
        toolGroups: number;
        demos: number;
        goldenPaths: number;
        blueprints: number;
        blueprintCategories: number;
    };
}

export interface CapabilityFactsInput {
    /** Injectable guide loader; production reads the canonical Capabilities doc. */
    loadCrewWorkflowGuide?: () => Promise<string>;
    /** MCP tool definitions, passed in by the caller so this module does not
     *  duplicate `documentation.service.ts`'s 28 MCP imports (and so the two
     *  can never drift into disagreeing about the tool set). */
    mcpTools: McpToolFact[];
    /** Loads the STATIC agent-tool registry. Injectable for tests; the default
     *  pulls the real registry. Connected-MCP-server tools are excluded by
     *  design — those vary per deployment and belong in the org overlay. */
    loadAgentTools?: () => Promise<Record<string, AgentToolLike>>;
    /** Loads SYSTEM app blueprints. The default calls `listAll()` with no org id,
     *  which returns the static registry only — org-cloned blueprints and
     *  installed apps are per-tenant and belong in the availability overlay. */
    loadBlueprints?: () => Promise<BlueprintLike[]>;
    /** Root for golden-path fixtures. Defaults to `<cwd>/fixtures/golden-path`. */
    goldenPathDir?: string;
    /** Root of the blueprint source tree used for drift detection. Defaults to
     *  the same path X-Ray indexes (`server/blueprints/apps`). */
    blueprintRoot?: string;
}

// --- Defaults -------------------------------------------------------------

/**
 * Reads the static tool registry. Importing the capability barrel is what runs
 * `registerStaticTools()`, so the import order matters: register first, read
 * second. `toolRegistry.getAllTools()` (as opposed to `getAgentTools()`) is the
 * deliberate choice — the latter merges tools from *connected* MCP servers,
 * which would make the platform fingerprint depend on runtime connection state.
 */
async function loadStaticAgentTools(): Promise<Record<string, AgentToolLike>> {
    await import("@domain/tools/v1/capabilities/index.js");

    // The barrel registers launch tools from a FLOATING promise
    // (`void import("./launch-tools.js").then(...)`), so immediately after the
    // barrel resolves the registry is short by those tools. Fingerprinting that
    // half-populated registry makes the capability spec's freshness depend on
    // *when* it was read — flipping between up-to-date and outdated and writing
    // phantom entries into the change register.
    //
    // Awaiting the same specifier settles the shared module promise; because the
    // barrel attached its `.then` first, its registration callback runs before
    // this continuation. The setImmediate then flushes anything else queued
    // during evaluation.
    await import("@domain/tools/v1/capabilities/launch-tools.js").catch(() => {
        /* launch-tools may not exist in all environments — same as the barrel. */
    });
    await new Promise((resolve) => setImmediate(resolve));

    const { toolRegistry } = await import("@domain/tools/core/tool-registry.js");
    return toolRegistry.getAllTools() as unknown as Record<string, AgentToolLike>;
}

/**
 * System blueprints only. `listAll()` short-circuits to the in-code registry when
 * no org id is supplied — deliberate, because passing one would merge that org's
 * cloned apps and make the platform fingerprint tenant-dependent.
 */
async function loadSystemBlueprints(): Promise<BlueprintLike[]> {
    const { blueprintRegistryService } = await import("@domain/apps/blueprint-registry.service.js");
    return blueprintRegistryService.listAll();
}

// --- Extraction -----------------------------------------------------------

const UNGROUPED = "Ungrouped";

function byName<T extends { name: string }>(a: T, b: T): number {
    return a.name.localeCompare(b.name);
}

function toolGroupsFrom(tools: Record<string, AgentToolLike>): CapabilityToolGroupFact[] {
    const groups = new Map<string, CapabilityToolFact[]>();

    for (const [registeredName, tool] of Object.entries(tools)) {
        const group = tool?.group?.trim() || UNGROUPED;
        const list = groups.get(group) ?? [];
        list.push({
            name: tool?.name || registeredName,
            label: tool?.label || tool?.name || registeredName,
            riskLevel: tool?.riskLevel ?? null,
            requiresApproval: tool?.approvalPolicy?.requiresApproval === true,
            approvalRationale: tool?.approvalPolicy?.rationale ?? null,
        });
        groups.set(group, list);
    }

    return Array.from(groups.entries())
        .map(([group, list]) => {
            const sorted = [...list].sort(byName);
            return {
                group,
                toolCount: sorted.length,
                approvalGatedCount: sorted.filter((t) => t.requiresApproval).length,
                highRiskCount: sorted.filter((t) => t.riskLevel === "high").length,
                tools: sorted,
            };
        })
        .sort((a, b) => a.group.localeCompare(b.group));
}

function contractFrom(manifest: CapabilityManifest): CapabilityContractFact {
    const asPairs = (record: Record<string, string>) =>
        Object.entries(record)
            .map(([name, type]) => ({ name, type }))
            .sort(byName);

    return {
        capabilityId: manifest.capability_id,
        capabilityVersion: manifest.capability_version,
        schemaVersion: manifest.schema_version,
        category: manifest.metadata.category,
        owner: manifest.metadata.owner,
        summary: manifest.documentation_meta.summary || manifest.metadata.description,
        inputs: asPairs(manifest.technical_spec.inputs),
        outputs: asPairs(manifest.technical_spec.outputs),
        guardrails: [...manifest.documentation_meta.guardrails].sort(),
        businessUseCases: [...manifest.documentation_meta.business_use_cases].sort(),
        riskProfile: manifest.runtime_context.risk_profile,
        executionEnvironment: manifest.runtime_context.execution_environment,
        dependencies: [...manifest.runtime_context.dependencies].sort(),
    };
}

/**
 * Golden-path fixtures are the strongest evidence artifact the repo holds: each
 * one is a buyer question with machine-checkable success criteria, exercised by
 * `scripts/smoke/run-golden-path-contract.ts`. Listing them (sorted by filename)
 * keeps the "what is actually proven" column honest without running anything.
 *
 * A missing or unreadable fixtures directory yields an empty list rather than
 * throwing: golden paths are supplementary evidence, and a checkout without the
 * fixtures should still be able to render its capability catalog.
 */
async function scanGoldenPaths(dir: string): Promise<CapabilityGoldenPathFact[]> {
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        logger.debug(`No golden-path fixtures at ${dir}`);
        return [];
    }

    const facts: CapabilityGoldenPathFact[] = [];
    for (const file of entries.filter((f) => f.endsWith(".json")).sort()) {
        try {
            const raw = await readFile(path.join(dir, file), "utf8");
            const parsed = JSON.parse(raw) as {
                id?: string;
                title?: string;
                buyerQuestion?: string;
                successCriteria?: string[];
            };
            facts.push({
                id: parsed.id ?? path.basename(file, ".json"),
                title: parsed.title ?? path.basename(file, ".json"),
                buyerQuestion: parsed.buyerQuestion ?? "",
                fixtureFile: `fixtures/golden-path/${file}`,
                successCriteria: Array.isArray(parsed.successCriteria) ? [...parsed.successCriteria] : [],
            });
        } catch (error) {
            logger.warn(`Skipping unreadable golden-path fixture ${file}: ${(error as Error).message}`);
        }
    }
    return facts;
}

/** Extract the complete, deterministic platform capability catalog. */
export async function scanCapabilityFacts(input: CapabilityFactsInput): Promise<CapabilityFacts> {
    const loadTools = input.loadAgentTools ?? loadStaticAgentTools;
    const loadBlueprints = input.loadBlueprints ?? loadSystemBlueprints;
    const goldenPathDir = input.goldenPathDir ?? path.join(process.cwd(), "fixtures", "golden-path");

    const [agentTools, goldenPaths, rawBlueprints, crewWorkflowGuide] = await Promise.all([
        loadTools(),
        scanGoldenPaths(goldenPathDir),
        loadBlueprints(),
        input.loadCrewWorkflowGuide?.() ?? readFile(
            path.join(process.cwd(), "docs", "capabilities", "crew_studio_integration_workflows.md"), "utf8",
        ),
    ]);

    const blueprints: CapabilityBlueprintFact[] = rawBlueprints
        .map((blueprint) => ({
            slug: blueprint.slug,
            name: blueprint.name,
            category: blueprint.category?.trim() || "Uncategorized",
            description: blueprint.description ?? "",
            capabilities: [...(blueprint.capabilities ?? [])].sort(),
        }))
        .sort((a, b) => a.slug.localeCompare(b.slug));

    const blueprintDrift = await scanBlueprintDrift({
        declared: blueprints.map((b) => ({ slug: b.slug, capabilities: b.capabilities })),
        blueprintRoot: input.blueprintRoot,
    });

    const blueprintCategories = Array.from(
        blueprints.reduce((acc, blueprint) => {
            acc.set(blueprint.category, (acc.get(blueprint.category) ?? 0) + 1);
            return acc;
        }, new Map<string, number>()),
    )
        .map(([category, blueprintCount]) => ({ category, blueprintCount }))
        .sort((a, b) => a.category.localeCompare(b.category));

    const toolGroups = toolGroupsFrom(agentTools);
    const totalAgentTools = toolGroups.reduce((n, g) => n + g.toolCount, 0);
    const totalApprovalGatedTools = toolGroups.reduce((n, g) => n + g.approvalGatedCount, 0);
    const totalHighRiskTools = toolGroups.reduce((n, g) => n + g.highRiskCount, 0);

    const manifestsById = new Map<string, CapabilityManifest>(
        ODDJOB_EXECUTABLE_CAPABILITY_MANIFESTS.map((m) => [m.capability_id, m]),
    );
    const productToExecutable = PRODUCT_TO_EXECUTABLE_CAPABILITY_ID as Record<string, string | undefined>;
    const pillarNames = new Map(ODDJOB_PILLARS.map((p) => [p.id, p.name]));

    const capabilities: CapabilityFact[] = ODDJOB_CAPABILITIES.map((capability) => {
        const executableId = productToExecutable[capability.id];
        const manifest = executableId ? manifestsById.get(executableId) : undefined;

        const demoIds = ODDJOB_CANONICAL_DEMOS
            .filter((demo) => demo.capabilityIds.includes(capability.id))
            .map((demo) => demo.id)
            .sort();
        const pillarChecks = ODDJOB_READINESS_CHECKS.filter((check) => check.pillar === capability.pillar);
        const readinessCheckIds = pillarChecks.map((check) => check.id).sort();
        const executableReadinessCheckIds = pillarChecks
            .filter((check) => !!check.command)
            .map((check) => check.id)
            .sort();

        const hasExecutableContract = !!manifest;
        const verificationLevel: CapabilityVerificationLevel = hasExecutableContract
            ? (demoIds.length > 0 ? "contract+demo" : "contract")
            : "declared";

        const derivedMaturity = deriveCapabilityMaturity({
            hasExecutableContract,
            demoCount: demoIds.length,
            executableReadinessCheckCount: executableReadinessCheckIds.length,
            declared: capability.maturity,
        });

        return {
            id: capability.id,
            name: capability.name,
            pillar: capability.pillar,
            pillarName: pillarNames.get(capability.pillar) ?? capability.pillar,
            maturity: derivedMaturity.maturity,
            declaredMaturity: capability.maturity,
            maturityRationale: derivedMaturity.rationale,
            maturityCappedByDeclaration: derivedMaturity.cappedByDeclaration,
            buyerValue: capability.buyerValue,
            primarySurfaces: [...capability.primarySurfaces].sort(),
            copilotNextActions: [...capability.copilotNextActions],
            hardeningFocus: [...capability.hardeningFocus],
            contract: manifest ? contractFrom(manifest) : null,
            evidence: {
                verificationLevel,
                hasExecutableContract,
                demoIds,
                readinessCheckIds,
                executableReadinessCheckIds,
            },
        };
    }).sort((a, b) => a.id.localeCompare(b.id));

    const pillars: CapabilityPillarFact[] = ODDJOB_PILLARS.map((pillar) => ({
        id: pillar.id,
        name: pillar.name,
        buyerLabel: pillar.buyerLabel,
        promise: pillar.promise,
        proofPoints: [...pillar.proofPoints],
        capabilityIds: capabilities.filter((c) => c.pillar === pillar.id).map((c) => c.id),
    })).sort((a, b) => a.id.localeCompare(b.id));

    const mcpToolModules = Array.from(
        input.mcpTools.reduce((acc, tool) => {
            const list = acc.get(tool.sourceFile) ?? [];
            list.push(tool.name);
            acc.set(tool.sourceFile, list);
            return acc;
        }, new Map<string, string[]>()),
    )
        .map(([sourceFile, toolNames]) => ({ sourceFile, toolNames: [...toolNames].sort() }))
        .sort((a, b) => a.sourceFile.localeCompare(b.sourceFile));

    return {
        crewWorkflowGuide,
        positioning: {
            category: ODDJOB_POSITIONING.category,
            oneLiner: ODDJOB_POSITIONING.oneLiner,
            buyerMessage: ODDJOB_POSITIONING.buyerMessage,
            leadWith: [...ODDJOB_POSITIONING.leadWith],
            notPositionedAs: [...ODDJOB_POSITIONING.avoidPositioningAs],
        },
        pillars,
        capabilities,
        toolGroups,
        totalAgentTools,
        totalApprovalGatedTools,
        totalHighRiskTools,
        mcpToolCount: input.mcpTools.length,
        mcpToolModules,
        blueprints,
        blueprintCategories,
        blueprintDrift,
        demos: ODDJOB_CANONICAL_DEMOS.map((demo) => ({
            id: demo.id,
            title: demo.title,
            buyerQuestion: demo.buyerQuestion,
            outcome: demo.outcome,
            capabilityIds: [...demo.capabilityIds].sort(),
            successCriteria: [...demo.successCriteria],
            guidedPrompt: demo.guidedPrompt,
        })).sort((a, b) => a.id.localeCompare(b.id)),
        readinessChecks: ODDJOB_READINESS_CHECKS.map((check) => ({
            id: check.id,
            label: check.label,
            pillar: check.pillar,
            priority: check.priority,
            command: check.command ?? null,
            expected: check.expected,
        })).sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id)),
        goldenPaths,
        copilot: {
            operatingMode: ODDJOB_COPILOT_GUIDE.operatingMode,
            firstRunPrompt: ODDJOB_COPILOT_GUIDE.firstRunPrompt,
            defaultObjectTypes: [...ODDJOB_COPILOT_GUIDE.defaultObjectTypes],
            guidedFlows: [...ODDJOB_COPILOT_GUIDE.guidedFlows],
            commands: ODDJOB_COPILOT_GUIDE.commands.map((command) => ({
                id: command.id,
                label: command.label,
                pillar: command.pillar,
                riskLevel: command.riskLevel,
                requiresApproval: command.requiresApproval,
                intent: command.intent,
                suggestedTools: [...command.suggestedTools].sort(),
                userFacingResult: command.userFacingResult,
            })).sort((a, b) => a.id.localeCompare(b.id)),
            trustQuestions: ODDJOB_COPILOT_GUIDE.trustQuestions
                .map((q) => ({ question: q.question, answerShouldInclude: [...q.answerShouldInclude] }))
                .sort((a, b) => a.question.localeCompare(b.question)),
        },
        counts: {
            pillars: pillars.length,
            capabilities: capabilities.length,
            withExecutableContract: capabilities.filter((c) => c.evidence.hasExecutableContract).length,
            toolGroups: toolGroups.length,
            demos: ODDJOB_CANONICAL_DEMOS.length,
            goldenPaths: goldenPaths.length,
            blueprints: blueprints.length,
            blueprintCategories: blueprintCategories.length,
        },
    };
}

// --- Deterministic reference markdown -------------------------------------

const MATURITY_LABEL: Record<OddjobCapabilityMaturity, string> = {
    foundation: "Foundation",
    maturing: "Maturing",
    advanced: "Advanced",
    experimental: "Experimental",
};

const VERIFICATION_LABEL: Record<CapabilityVerificationLevel, string> = {
    "contract+demo": "Contract + demo",
    contract: "Contract only",
    declared: "Declared",
};

const DRIFT_STATUS_LABEL: Record<string, string> = {
    aligned: "Aligned",
    partially_evidenced: "Partially evidenced",
    unevidenced: "Unevidenced",
    missing_implementation: "Declared, not implemented",
    undeclared: "Implemented, undeclared",
};

/** Escape pipes so a value containing `|` cannot break a markdown table row. */
function cell(value: string): string {
    return value.replace(/\|/g, "\\|");
}

function list(values: string[]): string {
    return values.length > 0 ? values.map((v) => `\`${v}\``).join(", ") : "_none_";
}

/**
 * The verified facts as a standalone markdown section — no top-level title and
 * no prose, so it can sit beneath an AI-written overview exactly like the API
 * and UI references. THIS is what gets fingerprinted.
 */
export function buildCapabilityReferenceMarkdown(facts: CapabilityFacts): string {
    const lines: string[] = [
        ...(facts.crewWorkflowGuide ? [facts.crewWorkflowGuide.trim(), "", "---", ""] : []),
        "## Reference — platform capability catalog",
        "",
        `- **Category:** ${facts.positioning.category}`,
        `- **Capabilities:** ${facts.counts.capabilities} across ${facts.counts.pillars} pillars`,
        `- **With executable contract:** ${facts.counts.withExecutableContract}`,
        `- **Agent tools:** ${facts.totalAgentTools} across ${facts.counts.toolGroups} groups — ${facts.totalHighRiskTools} declared high-risk, ${facts.totalApprovalGatedTools} with a hard approval gate`,
        `- **MCP tools:** ${facts.mcpToolCount} across ${facts.mcpToolModules.length} modules`,
        `- **App blueprints:** ${facts.counts.blueprints} across ${facts.counts.blueprintCategories} categories`,
        `- **Canonical demos:** ${facts.counts.demos} · **Golden-path fixtures:** ${facts.counts.goldenPaths}`,
        "",
        "_Extracted from the product capability manifest, the ACDD executable manifests, the static agent-tool registry, and the MCP tool set. Availability for a specific organization is reported separately by the availability overlay._",
        "",
        "### What Oddjob is not",
        "",
        ...facts.positioning.notPositionedAs.map((item) => `- Not a ${item}.`),
        "",
        "### Pillars",
        "",
        "| Pillar | Buyer label | Promise | Capabilities |",
        "| --- | --- | --- | --- |",
        ...facts.pillars.map(
            (p) => `| ${cell(p.name)} | ${cell(p.buyerLabel)} | ${cell(p.promise)} | ${p.capabilityIds.length} |`,
        ),
        "",
        "### Capability matrix",
        "",
        "| Capability | Pillar | Maturity | Evidence | Risk | Surfaces |",
        "| --- | --- | --- | --- | --- | --- |",
        ...facts.capabilities.map((c) =>
            [
                `| ${cell(c.name)}`,
                cell(c.pillarName),
                MATURITY_LABEL[c.maturity],
                VERIFICATION_LABEL[c.evidence.verificationLevel],
                c.contract?.riskProfile ?? "_n/a_",
                c.primarySurfaces.length,
            ].join(" | ") + " |",
        ),
    ];

    for (const capability of facts.capabilities) {
        lines.push("", `### ${capability.name} (\`${capability.id}\`)`, "");
        lines.push(`- **Pillar:** ${capability.pillarName}`);
        // The rationale ships with the level so a reader never has to take the
        // badge on trust — see docs/CAPABILITY_MATURITY_RUBRIC.md.
        lines.push(
            `- **Maturity:** ${MATURITY_LABEL[capability.maturity]} — ${capability.maturityRationale}` +
                (capability.maturityCappedByDeclaration
                    ? ` _(declared ceiling: ${MATURITY_LABEL[capability.declaredMaturity]})_`
                    : ""),
        );
        lines.push(`- **Buyer value:** ${capability.buyerValue}`);
        lines.push(`- **Surfaces:** ${list(capability.primarySurfaces)}`);
        lines.push(
            `- **Evidence:** ${VERIFICATION_LABEL[capability.evidence.verificationLevel]}` +
            ` — ${capability.evidence.demoIds.length} demo(s), ${capability.evidence.readinessCheckIds.length} readiness check(s)`,
        );

        if (capability.contract) {
            const c = capability.contract;
            lines.push(
                "",
                `**Executable contract** — \`${c.capabilityId}\` v${c.capabilityVersion} (schema v${c.schemaVersion}), owner ${c.owner}.`,
                "",
                `- **Category:** ${c.category}`,
                `- **Risk profile:** ${c.riskProfile} · **Environment:** ${c.executionEnvironment}`,
                `- **Depends on:** ${list(c.dependencies)}`,
                "",
                "| Direction | Field | Type |",
                "| --- | --- | --- |",
                ...c.inputs.map((f) => `| in | \`${f.name}\` | \`${cell(f.type)}\` |`),
                ...c.outputs.map((f) => `| out | \`${f.name}\` | \`${cell(f.type)}\` |`),
            );
            if (c.guardrails.length > 0) {
                lines.push("", "**Guardrails**", "", ...c.guardrails.map((g) => `- ${g}`));
            }
            if (c.businessUseCases.length > 0) {
                lines.push("", "**Use cases**", "", ...c.businessUseCases.map((u) => `- ${u}`));
            }
        } else {
            lines.push("", "_No executable contract declared — this capability is described but not yet contract-backed._");
        }

        if (capability.copilotNextActions.length > 0) {
            lines.push("", "**What the Copilot can do next**", "", ...capability.copilotNextActions.map((a) => `- ${a}`));
        }
    }

    lines.push(
        "",
        "### Agent tool inventory",
        "",
        "_`Approval-gated` counts tools whose `approvalPolicy.requiresApproval` is set — an always-approve override. It is deliberately narrow: the ordinary review boundary is decided at runtime by the governor and autonomy policy from risk and context, so a low count here does not mean work proceeds unreviewed._",
        "",
        "| Group | Tools | High-risk | Approval-gated |",
        "| --- | --- | --- | --- |",
    );
    for (const group of facts.toolGroups) {
        lines.push(`| ${cell(group.group)} | ${group.toolCount} | ${group.highRiskCount} | ${group.approvalGatedCount} |`);
    }
    for (const group of facts.toolGroups) {
        lines.push("", `#### ${group.group}`, "");
        for (const tool of group.tools) {
            const marks = [
                tool.riskLevel ? `risk: ${tool.riskLevel}` : null,
                tool.requiresApproval
                    ? `always requires approval${tool.approvalRationale ? ` — ${tool.approvalRationale}` : ""}`
                    : null,
            ].filter(Boolean);
            lines.push(`- \`${tool.name}\` — ${cell(tool.label)}${marks.length ? ` _(${cell(marks.join(", "))})_` : ""}`);
        }
    }

    lines.push("", "### MCP tool surface", "", "| Module | Tools |", "| --- | --- |");
    for (const module of facts.mcpToolModules) {
        lines.push(`| \`${module.sourceFile}\` | ${module.toolNames.map((n) => `\`${n}\``).join(", ")} |`);
    }

    if (facts.blueprints.length > 0) {
        lines.push(
            "",
            "### App blueprints",
            "",
            "_System blueprints a team can stand up as a durable interface. Org-cloned blueprints and installed deployments are per-tenant and appear in the availability overlay, not here._",
            "",
            "| Category | Blueprints |",
            "| --- | --- |",
            ...facts.blueprintCategories.map((c) => `| ${cell(c.category)} | ${c.blueprintCount} |`),
            "",
            "| Blueprint | Category | Declared capabilities |",
            "| --- | --- | --- |",
            ...facts.blueprints.map(
                (b) => `| ${cell(b.name)} (\`${b.slug}\`) | ${cell(b.category)} | ${b.capabilities.length > 0 ? b.capabilities.map((c) => cell(c)).join(", ") : "_none declared_"} |`,
            ),
        );
        for (const blueprint of facts.blueprints) {
            if (!blueprint.description) continue;
            lines.push("", `#### ${blueprint.name} (\`${blueprint.slug}\`)`, "", blueprint.description);
        }

        const drift = facts.blueprintDrift;
        lines.push(
            "",
            "### Blueprint capability drift (declared vs implemented)",
            "",
            "_Each declared capability is checked against the blueprint's own source tree. A term match is EVIDENCE, not proof: it means the words appear in the code, not that the feature works. Matches made only of generic engineering words are reported as weak and never count as verified._",
            "",
            `- **Aligned:** ${drift.counts.aligned} — every declared capability is evidenced`,
            `- **Partially evidenced:** ${drift.counts.partiallyEvidenced}`,
            `- **Unevidenced:** ${drift.counts.unevidenced}`,
            `- **Declared but not implemented:** ${drift.counts.missingImplementation} — a registry entry with no source directory`,
            `- **Implemented but undeclared:** ${drift.counts.undeclared} — blueprint source with no registry entry, so it is invisible to the marketplace and the Copilot`,
            `- **Capabilities verified:** ${drift.counts.verifiedCapabilities} of ${drift.counts.declaredCapabilities}`,
            "",
            "| Blueprint | Drift status | Source files | Capabilities verified |",
            "| --- | --- | --- | --- |",
            ...drift.blueprints.map((b) => {
                const verified = b.capabilities.filter((c) => c.status === "verified" && !c.weakMatch).length;
                const total = b.capabilities.length;
                return `| \`${b.slug}\` | ${DRIFT_STATUS_LABEL[b.status]} | ${b.hasImplementation ? b.sourceFileCount : "_no source_"} | ${total > 0 ? `${verified}/${total}` : "—"} |`;
            }),
        );

        const withFindings = drift.blueprints.filter((b) =>
            b.capabilities.some((c) => c.status !== "verified" || c.weakMatch),
        );
        if (withFindings.length > 0) {
            lines.push("", "#### Unevidenced capability claims", "");
            for (const blueprint of withFindings) {
                lines.push(`**\`${blueprint.slug}\`**`, "");
                for (const capability of blueprint.capabilities) {
                    if (capability.status === "verified" && !capability.weakMatch) continue;
                    const detail = capability.missingTerms.length > 0
                        ? `no code reference for ${capability.missingTerms.map((t) => `\`${t}\``).join(", ")}`
                        : "matched only generic terms";
                    lines.push(`- ${cell(capability.capability)} — _${detail}_`);
                }
                lines.push("");
            }
        }
    }

    if (facts.demos.length > 0) {
        lines.push("", "### Canonical demos", "");
        for (const demo of facts.demos) {
            lines.push(
                `#### ${demo.title} (\`${demo.id}\`)`,
                "",
                `- **Buyer question:** ${demo.buyerQuestion}`,
                `- **Outcome:** ${demo.outcome}`,
                `- **Capabilities:** ${list(demo.capabilityIds)}`,
                `- **Guided prompt:** ${demo.guidedPrompt}`,
                "",
                "**Success criteria**",
                "",
                ...demo.successCriteria.map((s) => `- ${s}`),
                "",
            );
        }
    }

    if (facts.goldenPaths.length > 0) {
        lines.push("", "### Golden-path fixtures", "", "| Fixture | Buyer question | Criteria |", "| --- | --- | --- |");
        for (const gp of facts.goldenPaths) {
            lines.push(`| \`${gp.id}\` | ${cell(gp.buyerQuestion)} | ${gp.successCriteria.length} |`);
        }
    }

    if (facts.readinessChecks.length > 0) {
        lines.push("", "### Readiness checks", "", "| Priority | Check | Pillar | Command | Expected |", "| --- | --- | --- | --- | --- |");
        for (const check of facts.readinessChecks) {
            lines.push(
                `| ${check.priority.toUpperCase()} | ${cell(check.label)} | ${check.pillar} | ${check.command ? `\`${cell(check.command)}\`` : "_manual_"} | ${cell(check.expected)} |`,
            );
        }
    }

    lines.push(
        "",
        "### Copilot operating guide",
        "",
        `- **Operating mode:** ${facts.copilot.operatingMode}`,
        `- **First-run prompt:** ${facts.copilot.firstRunPrompt}`,
        `- **Default object types:** ${list(facts.copilot.defaultObjectTypes)}`,
        "",
        "**Guided flows**",
        "",
        ...facts.copilot.guidedFlows.map((f) => `- ${f}`),
        "",
        "| Command | Pillar | Risk | Approval | Suggested tools |",
        "| --- | --- | --- | --- | --- |",
        ...facts.copilot.commands.map(
            (c) =>
                `| ${cell(c.label)} | ${c.pillar} | ${c.riskLevel} | ${c.requiresApproval ? "required" : "none"} | ${list(c.suggestedTools)} |`,
        ),
        "",
        "**Trust questions the Copilot must be able to answer**",
        "",
        ...facts.copilot.trustQuestions.map((q) => `- ${q.question} _(must cover: ${q.answerShouldInclude.join("; ")})_`),
    );

    return lines.join("\n");
}
