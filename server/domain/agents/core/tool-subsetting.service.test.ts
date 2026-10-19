import { describe, it, expect, vi } from "vitest";

// Small deterministic fake registry so the unit test doesn't pull the real
// 300+-tool registry. Inlined in the factory because vi.mock is hoisted.
vi.mock("@domain/tools/v1/capabilities/index.js", () => ({
    getAgentTools: () => ({
        approve_cycle: { name: "approve_cycle", group: "Operations", description: "Approve a staged operational cycle and launch its mission fleet." },
        list_pending_cycles: { name: "list_pending_cycles", group: "Operations", description: "List operational cycles awaiting approval." },
        list_datasets: { name: "list_datasets", group: "Data", description: "List available datasets." },
        query_dataset: { name: "query_dataset", group: "Data", description: "Query rows from a dataset." },
        create_pipeline: { name: "create_pipeline", group: "Pipelines", description: "Create a new pipeline." },
        search_documents: { name: "search_documents", group: "Knowledge", description: "Search documents in the knowledge base." },
        google_search: { name: "google_search", group: "Web", description: "Search the public web." },
        discover_capabilities: { name: "discover_capabilities", group: "Meta", description: "Discover available capabilities." },
        search_unified_knowledge: { name: "search_unified_knowledge", group: "Knowledge", description: "Unified knowledge search." },
        remember: { name: "remember", group: "Memory", description: "Store a memory." },
    }),
}));

import { subsetToolsForQuery, scoreTool } from "./tool-subsetting.service.js";

describe("scoreTool", () => {
    const tool = { name: "approve_cycle", group: "Operations", description: "Approve a staged operational cycle." } as any;

    it("scores a name-token match higher than a description-only match", () => {
        const nameHit = scoreTool(["approve"], tool);          // matches name
        const descOnly = scoreTool(["staged"], tool);          // matches description only
        expect(nameHit).toBeGreaterThan(descOnly);
        expect(descOnly).toBeGreaterThan(0);
    });

    it("stems plurals so 'cycles' matches the 'cycle' token", () => {
        expect(scoreTool(["cycles"], tool)).toBeGreaterThan(0);
    });

    it("returns 0 when there are no query terms", () => {
        expect(scoreTool([], tool)).toBe(0);
    });
});

describe("subsetToolsForQuery", () => {
    const candidates = [
        "approve_cycle", "list_pending_cycles", "list_datasets", "query_dataset",
        "create_pipeline", "search_documents", "google_search",
        "discover_capabilities", "search_unified_knowledge", "remember",
    ];

    it("selects the relevant tools and always retains CORE (JIT escape hatch)", async () => {
        const r = await subsetToolsForQuery("approve the cycle", candidates, { minCandidates: 3, topK: 5 });
        expect(r.applied).toBe(true);
        expect(r.after).toBeLessThan(r.before);
        // Relevant tools selected.
        expect(r.tools).toContain("approve_cycle");
        expect(r.tools).toContain("list_pending_cycles");
        // CORE always present so a dropped tool is still JIT-recoverable.
        expect(r.tools).toContain("discover_capabilities");
        // Irrelevant tools dropped.
        expect(r.tools).not.toContain("google_search");
        expect(r.tools).not.toContain("list_datasets");
    });

    it("does not subset when the candidate list is already small (below floor)", async () => {
        const r = await subsetToolsForQuery("approve the cycle", candidates); // default minCandidates=25
        expect(r.applied).toBe(false);
        expect(r.reason).toBe("below-floor");
        expect(r.tools).toEqual(candidates);
    });

    it("does not subset a query with no meaningful terms", async () => {
        const r = await subsetToolsForQuery("the a of it", candidates, { minCandidates: 3 });
        expect(r.applied).toBe(false);
        expect(r.reason).toBe("no-query-terms");
        expect(r.tools).toEqual(candidates);
    });

    it("does not subset when nothing matches (keeps the full set rather than guess)", async () => {
        const r = await subsetToolsForQuery("banana elephant xylophone", candidates, { minCandidates: 3 });
        expect(r.applied).toBe(false);
        expect(r.reason).toBe("no-matches");
        expect(r.tools).toEqual(candidates);
    });

    it("caps the number of relevance-selected tools at topK (plus CORE)", async () => {
        // Every tool mentions a matching term so all score > 0; topK must bound the
        // non-core selections.
        const r = await subsetToolsForQuery("cycle dataset pipeline document search knowledge web", candidates, { minCandidates: 3, topK: 2 });
        expect(r.applied).toBe(true);
        const core = r.tools.filter(t => ["discover_capabilities", "search_unified_knowledge", "remember"].includes(t));
        const nonCore = r.tools.filter(t => !core.includes(t));
        expect(nonCore.length).toBeLessThanOrEqual(2);
    });
});
