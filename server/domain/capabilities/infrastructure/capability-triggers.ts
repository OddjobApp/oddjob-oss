/**
 * Capability Sync Triggers (automatic enqueue sources)
 * ====================================================
 *
 * Turns platform events into capability-sync jobs so the loop runs without
 * manual HTTP calls. Two triggers, both OPT-IN and safe-by-default:
 *
 *   - Tool registry → code-to-docs: on worker boot (if enabled), map every
 *     registered agent tool to a CapabilityManifest and enqueue a Path A job so
 *     the platform self-documents its own tools.
 *   - Docs file-watcher → docs-to-code: watch `docs/capabilities/*.md` and, on
 *     change, enqueue a Path B ingest.
 *
 * Gating (nothing runs unless explicitly configured):
 *   - `ACDD_SYNC_ORG_ID`         — the org capabilities are attributed to. REQUIRED.
 *   - `ACDD_SYNC_TOOLS_ON_BOOT`  — enable the tool-registry trigger.
 *   - `ACDD_WATCH_DOCS`          — enable the docs file-watcher.
 *
 * The org gate matters: capability state is org-scoped (FK to orgs), while
 * platform tools are global — so auto-attribution needs an explicit, existing
 * org id rather than a guess.
 *
 * All the real logic is injectable so it can be unit-tested without a worker,
 * Redis or the filesystem.
 */

import { watch } from "node:fs";
import * as path from "node:path";

import { createLogger } from "@server/utils/logger.js";
import {
    safeParseCapabilityManifest,
    capabilityCategorySchema,
    type CapabilityCategory,
    type CapabilityManifest,
    type RiskProfile,
} from "@shared/schema/capabilities/index.js";
import type { ToolDefinition } from "@domain/tools/v1/capabilities/types.js";
import { enqueueCodeToDocs, enqueueDocsToCodeFile } from "./capability-sync-queue.js";

const logger = createLogger("CapabilityTriggers");

function envBool(name: string): boolean {
    const raw = process.env[name];
    return !!raw && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

// --- Tool → manifest mapping ---------------------------------------------

/**
 * ToolDefinition.riskLevel is lowercase; RISK_PROFILES are capitalized. The
 * manifest schema rejects a mismatch, so map rather than cast.
 *
 * "Critical" has no ToolDefinition equivalent — a tool that warrants it needs
 * the riskLevel union widened first, so nothing here can silently produce it.
 */
const TOOL_RISK_TO_PROFILE: Record<string, RiskProfile> = {
    low: "Low",
    medium: "Medium",
    high: "High",
};

/** Best-effort friendly type name for a zod field. */
function zodFieldType(zt: any): string {
    const typeName = zt?._def?.typeName;
    switch (typeName) {
        case "ZodOptional":
        case "ZodNullable":
        case "ZodDefault":
            return zodFieldType(zt._def.innerType);
        case "ZodString":
            return "string";
        case "ZodNumber":
            return "number";
        case "ZodBoolean":
            return "boolean";
        case "ZodArray":
            return "array";
        case "ZodObject":
        case "ZodRecord":
            return "object";
        case "ZodEnum":
            return "enum";
        default:
            return "any";
    }
}

/**
 * Map an agent ToolDefinition to a validated CapabilityManifest, or null if the
 * tool name can't produce a valid slug.
 */
export function toolDefinitionToManifest(name: string, tool: ToolDefinition): CapabilityManifest | null {
    const capabilityId = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!capabilityId) return null;

    const shape = (tool as any)?.parameters?.shape;
    const inputs: Record<string, string> = {};
    if (shape && typeof shape === "object") {
        for (const [key, zt] of Object.entries(shape)) {
            inputs[key] = zodFieldType(zt);
        }
    }

    // Preserve the tool's registered group as the category when it is a known
    // category (all live tool groups are first-class categories — see
    // CAPABILITY_CATEGORIES); otherwise fall back to a generic bucket.
    const groupParse = capabilityCategorySchema.safeParse((tool as any)?.group);
    const category: CapabilityCategory = groupParse.success ? groupParse.data : "System Utilities";

    const candidate = {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: capabilityId,
        metadata: {
            display_name: (tool as any)?.label || name,
            category,
            description: (tool as any)?.description || `Agent tool: ${name}`,
            owner: "platform",
        },
        technical_spec: {
            inputs,
            outputs: { result: "string" },
        },
        documentation_meta: {
            summary: (tool as any)?.description || "",
            business_use_cases: [],
            guardrails: Array.isArray((tool as any)?.guardrails) ? (tool as any).guardrails : [],
        },
        runtime_context: {
            // Carried from the definition rather than hardcoded. Every page
            // generated from a tool used to read "Risk Profile: Low" and "No
            // explicit guardrails declared" — including the tools that fetch
            // arbitrary URLs — which is the most misleading possible default
            // for the pages a reviewer consults first. An undeclared riskLevel
            // still falls back to "Low", so this only ever sharpens a page.
            risk_profile: TOOL_RISK_TO_PROFILE[(tool as any)?.riskLevel as string] ?? "Low",
            execution_environment: "Host",
            dependencies: [],
        },
    };

    const parsed = safeParseCapabilityManifest(candidate);
    return parsed.success ? parsed.data : null;
}

export interface ToolSyncDeps {
    tools?: Record<string, ToolDefinition>;
    enqueue?: (organizationId: number, manifest: CapabilityManifest) => Promise<unknown>;
}

/**
 * Enqueue a code-to-docs job for every registered agent tool. Returns the count
 * enqueued. Idempotent in effect: the queue's signature-hash jobId and the
 * reconciler gate collapse repeat boots to no-ops.
 */
export async function syncToolsToCapabilities(organizationId: number, deps: ToolSyncDeps = {}): Promise<number> {
    let tools = deps.tools;
    if (!tools) {
        const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
        tools = getAgentTools();
    }
    const enqueue = deps.enqueue ?? enqueueCodeToDocs;

    let count = 0;
    for (const [name, tool] of Object.entries(tools)) {
        const manifest = toolDefinitionToManifest(name, tool);
        if (!manifest) continue;
        try {
            await enqueue(organizationId, manifest);
            count++;
        } catch (err) {
            logger.warn(`Failed to enqueue tool ${name} for docs sync: ${String(err)}`);
        }
    }
    return count;
}

// --- Docs file-watcher ----------------------------------------------------

type DocEnqueue = (organizationId: number, absPath: string) => Promise<unknown>;

/** Handle a single changed doc path (testable core of the watcher). */
export async function onDocChanged(
    organizationId: number,
    absPath: string,
    enqueue: DocEnqueue = enqueueDocsToCodeFile,
): Promise<void> {
    if (!absPath.endsWith(".md")) return;
    try {
        await enqueue(organizationId, absPath);
        logger.info(`Enqueued docs→code for ${absPath}`);
    } catch (err) {
        logger.warn(`Failed to enqueue docs→code for ${absPath}: ${String(err)}`);
    }
}

export function docsDir(): string {
    const repoRoot = process.env.ACDD_DOCS_REPO_PATH || process.cwd();
    return path.resolve(repoRoot, process.env.ACDD_DOCS_SUBDIR || "docs/capabilities");
}

/** Start a debounced recursive watcher over the docs dir. Returns a stop handle. */
export function startDocsWatcher(
    organizationId: number,
    opts: { dir?: string; enqueue?: DocEnqueue; debounceMs?: number } = {},
): { close: () => void } | null {
    const dir = opts.dir ?? docsDir();
    const enqueue = opts.enqueue ?? enqueueDocsToCodeFile;
    const debounceMs = opts.debounceMs ?? 500;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    let watcher: ReturnType<typeof watch>;
    try {
        watcher = watch(dir, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            const rel = filename.toString();
            if (!rel.endsWith(".md")) return;
            const abs = path.join(dir, rel);
            const existing = timers.get(abs);
            if (existing) clearTimeout(existing);
            timers.set(
                abs,
                setTimeout(() => {
                    timers.delete(abs);
                    void onDocChanged(organizationId, abs, enqueue);
                }, debounceMs),
            );
        });
    } catch (err) {
        logger.warn(`Docs watcher failed to start on ${dir}: ${String(err)}`);
        return null;
    }

    logger.info(`Watching ${dir} for Markdown changes (Path B auto-ingest).`);
    return {
        close: () => {
            for (const t of timers.values()) clearTimeout(t);
            watcher.close();
        },
    };
}

// --- Orchestration --------------------------------------------------------

/**
 * Start whichever auto-triggers are enabled by env. Returns a stop handle, or
 * null when no org is configured (triggers disabled).
 */
export function startCapabilityTriggers(): { stop: () => void } | null {
    const raw = process.env.ACDD_SYNC_ORG_ID;
    const organizationId = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
        logger.info("ACDD auto-triggers disabled (set ACDD_SYNC_ORG_ID to an existing org id to enable).");
        return null;
    }

    const stops: Array<() => void> = [];

    if (envBool("ACDD_SYNC_TOOLS_ON_BOOT")) {
        void syncToolsToCapabilities(organizationId)
            .then((n) => logger.info(`Enqueued ${n} tool capabilities for docs sync (org ${organizationId}).`))
            .catch((err) => logger.warn(`Tool sync trigger failed: ${String(err)}`));
    }

    if (envBool("ACDD_WATCH_DOCS")) {
        const watcher = startDocsWatcher(organizationId);
        if (watcher) stops.push(watcher.close);
    }

    if (!envBool("ACDD_SYNC_TOOLS_ON_BOOT") && !envBool("ACDD_WATCH_DOCS")) {
        logger.info(
            "ACDD_SYNC_ORG_ID is set but no trigger is enabled " +
                "(set ACDD_SYNC_TOOLS_ON_BOOT and/or ACDD_WATCH_DOCS).",
        );
    }

    return { stop: () => stops.forEach((s) => s()) };
}
