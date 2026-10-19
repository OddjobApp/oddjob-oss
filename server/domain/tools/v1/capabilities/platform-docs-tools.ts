import path from "node:path";
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { assertOrgId } from "@server/utils/auth-context.js";

/**
 * Internal platform documentation access for agents.
 *
 * Backs `platform-docs-tool.service.ts`, which shipped implemented but
 * unregistered — the crew persona prompt instructed agents they "MUST call"
 * these names while nothing defined them.
 *
 * Every entry point resolves the organization from the tool context via
 * assertOrgId. The service methods default `organizationId` to 1, which would
 * silently serve another tenant's documentation; passing it explicitly here means
 * that default is never reached from a registered tool call.
 */

const DOCS_ROOT = path.resolve(process.cwd(), "docs");

/**
 * Resolve a caller-supplied doc path and confirm it stays inside docs/.
 *
 * Checked with a separator-terminated prefix rather than a bare startsWith:
 * `startsWith(DOCS_ROOT)` alone also accepts a sibling like `docs-internal/`.
 */
function resolveDocPath(relativeDocPath: string): { path: string } | { error: string } {
    if (typeof relativeDocPath !== "string" || relativeDocPath.trim() === "") {
        return { error: "A document path is required." };
    }
    if (relativeDocPath.includes("\0")) {
        return { error: "Invalid document path." };
    }

    const cleaned = relativeDocPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const withinDocs = cleaned.startsWith("docs/") || cleaned === "docs" ? cleaned : path.posix.join("docs", cleaned);
    const full = path.resolve(process.cwd(), withinDocs);

    if (full !== DOCS_ROOT && !full.startsWith(DOCS_ROOT + path.sep)) {
        return { error: "Access denied. Paths must remain within the docs/ directory." };
    }
    if (!/\.(md|mdx|txt)$/i.test(full)) {
        return { error: "Only .md, .mdx and .txt documents can be read." };
    }
    return { path: full };
}

export const PLATFORM_DOCS_TOOLS: Record<string, ToolDefinition> = {
    search_platform_documentation: {
        name: "search_platform_documentation",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Search Platform Documentation",
        group: "Platform & Specs",
        description:
            "Search this platform's feature specs, API contracts, capability manifests and UI specs. Use before answering questions about internal architecture or platform capabilities.",
        parameters: z.object({
            query: z.string().min(2).describe("What to search for, e.g. 'operational cycles budget'"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const organizationId = assertOrgId(context?.organizationId);
            const { platformDocsTool } = await import("@domain/crew/core/platform-docs-tool.service.js");
            const { results, summary } = await platformDocsTool.searchDocumentation(params.query, organizationId);
            if (results.length === 0) {
                return `No platform documentation matched "${params.query}". Say so rather than describing the platform from memory.`;
            }
            return `${summary}\n\n${JSON.stringify(results.slice(0, 20), null, 2)}`;
        },
    },

    get_platform_feature_spec: {
        name: "get_platform_feature_spec",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Platform Feature Spec",
        group: "Platform & Specs",
        description:
            "Fetch the full specification for one platform feature, or the aggregate 'api', 'ui' or 'capability' spec.",
        parameters: z.object({
            featureId: z
                .string()
                .describe("Feature id from list_platform_features, or one of: api, ui, capability"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const organizationId = assertOrgId(context?.organizationId);
            const { platformDocsTool } = await import("@domain/crew/core/platform-docs-tool.service.js");
            const spec = await platformDocsTool.getFeatureSpec(params.featureId, organizationId);
            if (spec && typeof spec === "object" && "error" in spec) {
                return `Could not retrieve spec "${params.featureId}": ${(spec as any).error}`;
            }
            return typeof spec === "string" ? spec : JSON.stringify(spec, null, 2);
        },
    },

    list_platform_features: {
        name: "list_platform_features",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Platform Features",
        group: "Platform & Specs",
        description:
            "Enumerate documented platform feature modules with their ids and versions. Use to discover a valid featureId for get_platform_feature_spec.",
        parameters: z.object({}),
        execute: async (_params: any, context: ToolContext) => {
            const organizationId = assertOrgId(context?.organizationId);
            const { platformDocsTool } = await import("@domain/crew/core/platform-docs-tool.service.js");
            const features = await platformDocsTool.listFeatures(organizationId);
            if (features.length === 0) {
                return "No documented platform features are registered for this organization.";
            }
            return JSON.stringify(features, null, 2);
        },
    },

    read_internal_repo_doc: {
        name: "read_internal_repo_doc",
        idempotency: "read-safe",
        label: "Read Internal Repo Doc",
        group: "Platform & Specs",
        description:
            "Read a markdown document from the repository's docs/ directory by relative path, e.g. 'specs/World_Model_Spec.md'. Reads are confined to docs/.",
        parameters: z.object({
            docPath: z.string().describe("Path relative to docs/, e.g. 'specs/ONTOLOGY_SERVICE_DESIGN.md'"),
        }),
        execute: async (params: any) => {
            // Validate here rather than relying on the service: this is the security
            // boundary for a caller-supplied path, and the tool layer is where an
            // agent-chosen argument first becomes a filesystem read.
            const resolved = resolveDocPath(params.docPath);
            if ("error" in resolved) return `Error: ${resolved.error}`;

            const { readFile } = await import("node:fs/promises");
            try {
                const content = await readFile(resolved.path, "utf-8");
                const clipped = content.slice(0, 12000);
                const note = content.length > clipped.length
                    ? `\n\n…(truncated at 12000 of ${content.length} characters)`
                    : "";
                return `# ${path.relative(process.cwd(), resolved.path).replace(/\\/g, "/")}\n\n${clipped}${note}`;
            } catch (e: any) {
                return `Error: could not read "${params.docPath}": ${e?.message || String(e)}`;
            }
        },
    },
};

/**
 * System documentation specs.
 *
 * These three exist as MCP tools (server/mcp/tools/documentation.ts) with working
 * handlers, but were never bridged into the v1 registry — while sitting in the
 * crew allowlists the whole time. Same defect as the six above: the agent was
 * offered a name it could not call. `crew-task-lifecycle` asserts exactly this
 * ("offers no tool name that the v1 registry cannot resolve") and was failing on
 * them. Bridged the way DATA_TOOLS bridges list_datasets.
 */
function mcpText(result: any): string {
    if (result?.content && Array.isArray(result.content)) {
        const text = result.content.find((c: any) => c.type === "text");
        if (text?.text) return text.text;
    }
    return JSON.stringify(result, null, 2);
}

export const SYSTEM_DOCS_TOOLS: Record<string, ToolDefinition> = {
    list_system_specs: {
        name: "list_system_specs",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List System Specs",
        group: "Platform & Specs",
        description:
            "List Oddjob's auto-generated system documentation specs — every backend domain module plus the platform API, UI and capability specs — with each one's freshness. Use to discover what exists before fetching one with get_system_spec.",
        parameters: z.object({
            specType: z.enum(["module", "api", "ui", "capability"]).optional()
                .describe("Filter to one spec type"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleListSystemSpecs } = await import("@server/mcp/handlers/documentation.js");
            return mcpText(await handleListSystemSpecs(params, context as any));
        },
    },

    get_system_spec: {
        name: "get_system_spec",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get System Spec",
        group: "Platform & Specs",
        description:
            "Retrieve the full markdown of one system documentation spec. Provide EITHER featureId for a backend domain module, OR specType 'api' / 'ui' / 'capability'. Prefer specType 'capability' when asked what the platform can do, so you neither over-claim nor wrongly refuse.",
        parameters: z.object({
            featureId: z.string().min(1).optional()
                .describe("Domain module id, e.g. 'agents'. Mutually exclusive with specType."),
            specType: z.enum(["api", "ui", "capability"]).optional()
                .describe("Singleton platform spec. Mutually exclusive with featureId."),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!params.featureId && !params.specType) {
                return "Error: provide either featureId or specType. Call list_system_specs to see what exists.";
            }
            const { handleGetSystemSpec } = await import("@server/mcp/handlers/documentation.js");
            return mcpText(await handleGetSystemSpec(params, context as any));
        },
    },

    search_system_docs: {
        name: "search_system_docs",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Search System Docs",
        group: "Platform & Specs",
        description:
            "Search across the auto-generated system documentation specs (modules, API, UI). Prefer this over generic document search when you specifically want authoritative architecture documentation.",
        parameters: z.object({
            query: z.string().min(2).describe("Search text, e.g. 'mission approval', 'route map'"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleSearchSystemDocs } = await import("@server/mcp/handlers/documentation.js");
            return mcpText(await handleSearchSystemDocs(params, context as any));
        },
    },

    list_platform_patterns: {
        name: "list_platform_patterns",
        idempotency: "read-safe",
        label: "List Platform Patterns",
        group: "Platform & Specs",
        description:
            "List Oddjob's operational patterns, best-practice runbooks, and architectural standards. Filter by audience (AGENT_PRIMARY, HUMAN_PRIMARY, HYBRID, GOVERNANCE) or category.",
        parameters: z.object({
            audience: z.enum(["HUMAN_PRIMARY", "AGENT_PRIMARY", "HYBRID", "GOVERNANCE"]).optional()
                .describe("Filter by target audience classification"),
            category: z.string().optional()
                .describe("Optional category ID, e.g. '01-foundations-and-architecture', '06-agent-runtime-runbooks'"),
        }),
        execute: async (params: any) => {
            const { handleListPlatformPatterns } = await import("@server/mcp/handlers/documentation.js");
            return mcpText(await handleListPlatformPatterns(params));
        },
    },

    search_platform_patterns: {
        name: "search_platform_patterns",
        idempotency: "read-safe",
        label: "Search Platform Patterns",
        group: "Platform & Specs",
        description:
            "Search the full text, tags, and structured execution contracts of Oddjob best practice operational patterns and runbooks.",
        parameters: z.object({
            query: z.string().min(2).describe("Search query, error code, tool name, or workflow to search for"),
            audience: z.enum(["HUMAN_PRIMARY", "AGENT_PRIMARY", "HYBRID", "GOVERNANCE"]).optional()
                .describe("Filter by target audience classification"),
        }),
        execute: async (params: any) => {
            const { handleSearchPlatformPatterns } = await import("@server/mcp/handlers/documentation.js");
            return mcpText(await handleSearchPlatformPatterns(params));
        },
    },

    get_platform_pattern: {
        name: "get_platform_pattern",
        idempotency: "read-safe",
        label: "Get Platform Pattern",
        group: "Platform & Specs",
        description:
            "Retrieve one Oddjob operational pattern by ID. Returns the structured agent execution contract and token-optimized agent markdown.",
        parameters: z.object({
            id: z.string().min(1).describe("Pattern ID from list_platform_patterns or search_platform_patterns, e.g. 'agent-error-recovery'"),
        }),
        execute: async (params: any) => {
            const { handleGetPlatformPattern } = await import("@server/mcp/handlers/documentation.js");
            return mcpText(await handleGetPlatformPattern(params));
        },
    },
};
