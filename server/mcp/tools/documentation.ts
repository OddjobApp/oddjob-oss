/**
 * Oddjob MCP Server - System Documentation Tools
 *
 * First-class access to Oddjob's auto-generated system documentation specs
 * (domain modules + the platform API and UI references), so the Co-pilot can
 * reliably enumerate, fetch, and search authoritative system docs — rather than
 * relying on fuzzy RAG over the whole knowledge store.
 */

import { z } from "zod";

export const documentationToolDefinitions = [
    {
        name: "list_system_specs",
        description:
            "List Oddjob's auto-generated system documentation specs — every backend domain module plus the platform API spec and UI spec — with each spec's freshness status (up-to-date / outdated / missing) and last-generated time. Use this to discover what authoritative system documentation exists before fetching a specific spec with get_system_spec.",
        inputSchema: {
            type: "object" as const,
            properties: {
                specType: {
                    type: "string",
                    enum: ["module", "api", "ui", "capability"],
                    description: "Optional filter: only list specs of this type (module = a backend domain module; api/ui/capability = the singleton platform specs).",
                },
            },
        },
    },
    {
        name: "get_system_spec",
        description:
            "Retrieve the full markdown of one Oddjob system documentation spec — the architectural narrative plus the extracted facts (routes, dependencies, resource types, MCP tools, or route map). Provide EITHER `featureId` for a backend domain module (e.g. 'agents', 'mission', 'knowledge') OR `specType` of 'api' (platform-wide API reference), 'ui' (SPA route map), or 'capability' (the authoritative catalog of what Oddjob can do). " +
            "ALWAYS prefer specType 'capability' over guessing when a user asks what Oddjob or you can do, what a capability requires, whether an action needs approval, or whether something is supported — it returns the capability catalog with maturity, guardrails, risk profiles, evidence level, and this organization's actual availability, so you neither over-claim nor wrongly refuse.",
        inputSchema: {
            type: "object" as const,
            properties: {
                featureId: {
                    type: "string",
                    description: "Domain module id (e.g. 'agents'). Mutually exclusive with specType.",
                },
                specType: {
                    type: "string",
                    enum: ["api", "ui", "capability"],
                    description: "Singleton platform spec: 'api', 'ui', or 'capability'. Mutually exclusive with featureId.",
                },
            },
        },
    },
    {
        name: "search_system_docs",
        description:
            "Search across Oddjob's auto-generated system documentation specs (modules, API, UI). Returns matching specs with a snippet and a type label. Prefer this over generic document search when you specifically want authoritative system/architecture documentation.",
        inputSchema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description: "Search text (e.g. 'mission approval', 'MCP tools', 'route map').",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "list_platform_patterns",
        description:
            "List Oddjob's operational patterns and best-practice runbooks. Use this to discover agent-executable guidance by audience or category. Returned entries include verification status; guidance is not proof that an implementation exists.",
        inputSchema: {
            type: "object" as const,
            properties: {
                audience: { type: "string", enum: ["HUMAN_PRIMARY", "AGENT_PRIMARY", "HYBRID", "GOVERNANCE"] },
                category: { type: "string", description: "Optional exact repository category id." },
            },
        },
    },
    {
        name: "search_platform_patterns",
        description:
            "Search the full text and structured execution contracts of Oddjob operational patterns. Use before inventing an operational workflow. Live tool schemas, capability guardrails, runtime safety policy, and user instructions take precedence over returned guidance.",
        inputSchema: {
            type: "object" as const,
            properties: {
                query: { type: "string", description: "Problem, tool, error code, prerequisite, or workflow to search for." },
                audience: { type: "string", enum: ["HUMAN_PRIMARY", "AGENT_PRIMARY", "HYBRID", "GOVERNANCE"] },
            },
            required: ["query"],
        },
    },
    {
        name: "get_platform_pattern",
        description:
            "Retrieve one Oddjob operational pattern by id. Returns the structured agent execution contract and token-focused agent markdown. Check verificationStatus and implementationEvidence before acting; never treat conceptual examples as callable tools.",
        inputSchema: {
            type: "object" as const,
            properties: { id: { type: "string", description: "Pattern id from list_platform_patterns or search_platform_patterns." } },
            required: ["id"],
        },
    },
];

export const ListSystemSpecsInput = z.object({
    specType: z.enum(["module", "api", "ui", "capability"]).optional(),
});

export const GetSystemSpecInput = z.object({
    featureId: z.string().min(1).optional(),
    specType: z.enum(["api", "ui", "capability"]).optional(),
});

export const SearchSystemDocsInput = z.object({
    query: z.string().min(1),
});

const PatternAudience = z.enum(["HUMAN_PRIMARY", "AGENT_PRIMARY", "HYBRID", "GOVERNANCE"]);

export const ListPlatformPatternsInput = z.object({
    audience: PatternAudience.optional(),
    category: z.string().min(1).optional(),
});

export const SearchPlatformPatternsInput = z.object({
    query: z.string().min(1),
    audience: PatternAudience.optional(),
});

export const GetPlatformPatternInput = z.object({ id: z.string().min(1) });
