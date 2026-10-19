/**
 * Capability Manifest — the single source of truth for the ACDD bi-directional
 * capability & documentation synchronization engine.
 *
 * This is the TypeScript/zod mirror of the Python reference implementation
 * (`acdd/core/schema.py`). Both directions of the pipeline converge on this one
 * shape:
 *   - Code → Docs: reflection / visual-canvas save → manifest → Markdown.
 *   - Docs → Code: Markdown → LLM extraction → manifest → vector router.
 *
 * IMPORTANT: this module lives in `shared/` and is bundled for the client, so it
 * must stay dependency-light — pure zod + plain helpers only. Crypto hashing of
 * the manifest (used by the reconciler) lives server-side in
 * `server/domain/capabilities/core/*`, NOT here, so `node:crypto` never leaks
 * into the browser bundle.
 */

import { z } from "zod";

/** A capability_id must be a stable, filesystem- and URL-safe slug. */
export const CAPABILITY_ID_PATTERN = /^[a-z0-9_]+$/;
export const CAPABILITY_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export const CURRENT_CAPABILITY_SCHEMA_VERSION = 1;

export const CAPABILITY_CATEGORIES = [
    // Curated taxonomy — used by first-party producers (pipelines/canvas and
    // synthesized capabilities).
    "Data Operations",
    "Browser Automation",
    "Financial Operations",
    "SaaS Connectors",
    "System Utilities",
    "Knowledge",
    "Custom JIT",
    // Agent-tool registry groups — preserved as first-class categories so a
    // tool's real domain (e.g. "App Forge", "Computer Use") survives into its
    // manifest and the semantic router rather than collapsing to a generic
    // bucket. Keep in sync with the tool registry's `group` values.
    "Admin: Personality",
    "Airtable",
    "Analytics Databases",
    "App Forge",
    "Cloud",
    "Collaboration",
    "Computer Use",
    "Control Flow",
    "Core Capabilities",
    "Datasets & External",
    "Discovery",
    "Document Processing",
    "Documentation",
    "Files & Storage",
    "GMS",
    "Generation",
    "Git Workspace",
    "GitHub",
    "Google Workspace",
    "HubSpot",
    "Integrations",
    "Knowledge Graph",
    "Knowledge Management",
    "Linear",
    "Memory",
    "Microsoft 365",
    "Mission Control",
    "Monitoring",
    "Multimodal / Vision",
    "Notion",
    "Observability",
    "Ontology",
    "Pipeline Orchestration",
    "Rescue",
    "Rich UI",
    "SDLC",
    "Salesforce",
    "Self-Modification",
    "Stripe",
    "System Architecture",
    "System Management",
    "Tutorials & Onboarding",
    "Twilio / SMS",
    "Video Content",
    "Web & Browser",
    "Webhooks",
    "Zendesk",
] as const;

export const RISK_PROFILES = ["Low", "Medium", "High", "Critical"] as const;

export const EXECUTION_ENVIRONMENTS = [
    "Host",
    "Isolated Docker Container",
    "Ephemeral Sandbox",
] as const;

export const capabilityCategorySchema = z.enum(CAPABILITY_CATEGORIES);
export const riskProfileSchema = z.enum(RISK_PROFILES);
export const executionEnvironmentSchema = z.enum(EXECUTION_ENVIRONMENTS);

export type CapabilityCategory = z.infer<typeof capabilityCategorySchema>;
export type RiskProfile = z.infer<typeof riskProfileSchema>;
export type ExecutionEnvironment = z.infer<typeof executionEnvironmentSchema>;

/** High/Critical capabilities must never auto-merge; they isolate for review. */
export function riskRequiresIsolation(risk: RiskProfile): boolean {
    return risk === "High" || risk === "Critical";
}

export const metadataSchema = z
    .object({
        display_name: z.string().min(1),
        category: capabilityCategorySchema,
        description: z.string().min(1),
        owner: z.string().default("unassigned"),
    })
    .strict();

export const technicalSpecSchema = z
    .object({
        inputs: z.record(z.string()).default({}),
        outputs: z.record(z.string()).default({}),
    })
    .strict();

export const documentationMetaSchema = z
    .object({
        summary: z.string().default(""),
        business_use_cases: z.array(z.string()).default([]),
        guardrails: z.array(z.string()).default([]),
    })
    .strict();

export const runtimeContextSchema = z
    .object({
        risk_profile: riskProfileSchema.default("Low"),
        execution_environment: executionEnvironmentSchema.default("Host"),
        dependencies: z.array(z.string()).default([]),
    })
    .strict();

export const capabilityManifestSchema = z
    .object({
        /** Version of this manifest contract, independent of capability behavior. */
        schema_version: z.number().int().positive().default(CURRENT_CAPABILITY_SCHEMA_VERSION),
        /** Semantic version of the capability's externally observable behavior. */
        capability_version: z
            .string()
            .regex(CAPABILITY_VERSION_PATTERN, "capability_version must be a semantic version (for example 1.2.0).")
            .default("1.0.0"),
        capability_id: z
            .string()
            .regex(
                CAPABILITY_ID_PATTERN,
                "capability_id must match ^[a-z0-9_]+$ (lowercase letters, digits, underscores).",
            ),
        metadata: metadataSchema,
        technical_spec: technicalSpecSchema,
        documentation_meta: documentationMetaSchema.default({}),
        runtime_context: runtimeContextSchema.default({}),
    })
    .strict();

export type Metadata = z.infer<typeof metadataSchema>;
export type TechnicalSpec = z.infer<typeof technicalSpecSchema>;
export type DocumentationMeta = z.infer<typeof documentationMetaSchema>;
export type RuntimeContext = z.infer<typeof runtimeContextSchema>;
export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;

/**
 * Validate an arbitrary payload into a normalized manifest.
 * Throws a `z.ZodError` on failure — callers should surface `.issues`.
 */
export function parseCapabilityManifest(data: unknown): CapabilityManifest {
    return capabilityManifestSchema.parse(data);
}

export function safeParseCapabilityManifest(data: unknown) {
    return capabilityManifestSchema.safeParse(data);
}

/**
 * Flatten a manifest into the semantic text block used for vector indexing.
 * Includes engineering *and* documentation signal so both natural-language
 * discovery and Markdown-paragraph ingestion retrieve the right capability.
 */
export function buildEmbeddingText(m: CapabilityManifest): string {
    return [
        `Capability ID: ${m.capability_id}`,
        `Capability Version: ${m.capability_version}`,
        `Manifest Schema Version: ${m.schema_version}`,
        `Name: ${m.metadata.display_name}`,
        `Category: ${m.metadata.category}`,
        `Owner: ${m.metadata.owner}`,
        `Description: ${m.metadata.description}`,
        `Summary: ${m.documentation_meta.summary}`,
        `Use Cases: ${m.documentation_meta.business_use_cases.join("; ")}`,
        `Guardrails: ${m.documentation_meta.guardrails.join("; ")}`,
        `Inputs: ${stableStringify(m.technical_spec.inputs)}`,
        `Outputs: ${stableStringify(m.technical_spec.outputs)}`,
        `Risk: ${m.runtime_context.risk_profile}`,
        `Environment: ${m.runtime_context.execution_environment}`,
    ].join("\n");
}

/**
 * The semantically meaningful subset used to detect *behavioural* drift.
 * Excludes cosmetic prose (descriptions, summaries) so a reworded sentence does
 * not read as a capability change, while a changed input type or guardrail does.
 */
export function capabilitySignature(m: CapabilityManifest): Record<string, unknown> {
    return {
        capability_id: m.capability_id,
        category: m.metadata.category,
        inputs: sortRecord(m.technical_spec.inputs),
        outputs: sortRecord(m.technical_spec.outputs),
        guardrails: [...m.documentation_meta.guardrails].sort(),
        risk_profile: m.runtime_context.risk_profile,
        execution_environment: m.runtime_context.execution_environment,
    };
}

/** Deterministic, key-sorted JSON for stable hashing and diffing. */
export function stableStringify(value: unknown): string {
    return JSON.stringify(sortDeep(value));
}

function sortRecord(record: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function sortDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => [k, sortDeep(v)]),
        );
    }
    return value;
}
