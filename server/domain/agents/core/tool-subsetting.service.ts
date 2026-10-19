import type { ToolDefinition } from "@domain/tools/v1/capabilities/types.js";

/**
 * Tool subsetting (copilot performance prototype).
 *
 * The copilot hands the model ~70 tool schemas every turn. Tool schemas are
 * token-heavy, so this inflates first-token latency + cost and degrades tool
 * selection. This trims the model-facing toolset for a single turn to:
 *
 *     CORE (always-on)  ∪  top-K tools most relevant to the user's message
 *
 * CORE deliberately includes `discover_capabilities`, so if the relevance filter
 * drops a tool the agent actually needs, it can still JIT-discover and re-acquire
 * it — the subset is a hint, never a hard capability wall.
 *
 * The scorer is LEXICAL on purpose: a perf feature must not add an embedding
 * round-trip per turn. `scoreTool` is the single swap-point for an
 * embedding-similarity backend later, with the same signature.
 */

/** Always available regardless of query — escape hatches + universal primitives. */
const CORE_TOOLS = new Set<string>([
    "discover_capabilities",         // JIT recovery for anything the filter dropped
    "discover_capability_proposals",
    "search_unified_knowledge",
    "remember",
    "request_execute_mode",          // lets read-only modes offer the Execute path
    "list_installed_apps",
    "render_app_surface",
]);

const STOPWORDS = new Set([
    "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are", "do",
    "does", "how", "what", "which", "can", "i", "we", "you", "my", "me", "with",
    "that", "this", "it", "please", "show", "get", "find", "list", "all", "any",
]);

/** Crude singularization so "cycles" matches "cycle", "pipelines" matches "pipeline". */
function stem(w: string): string {
    return w.length >= 4 && w.endsWith("s") ? w.slice(0, -1) : w;
}

function tokenize(s: string): string[] {
    return (s.toLowerCase().match(/[a-z0-9]+/g) || [])
        .filter(w => w.length > 2 && !STOPWORDS.has(w))
        .map(stem);
}

/**
 * Relevance of a tool to the query terms. Name match is the strongest signal,
 * then group, then description. Swap this for embedding cosine similarity later.
 */
export function scoreTool(queryTerms: string[], tool: ToolDefinition): number {
    if (queryTerms.length === 0) return 0;
    // Stem the query terms too, so `scoreTool` matches "cycles"→"cycle" even when
    // called with raw terms (subsetToolsForQuery already stems; stem is idempotent).
    const terms = queryTerms.map(stem);
    const nameTokens = new Set(tokenize(tool.name.replace(/_/g, " ")));
    const groupTokens = new Set(tokenize(tool.group || ""));
    const descTokens = new Set(tokenize(tool.description || ""));
    let score = 0;
    for (const t of terms) {
        if (nameTokens.has(t)) score += 3;
        else if (groupTokens.has(t)) score += 2;
        else if (descTokens.has(t)) score += 1;
    }
    return score;
}

export interface ToolSubsetResult {
    tools: string[];
    applied: boolean;
    before: number;
    after: number;
    reason?: string;
}

export interface ToolSubsetOptions {
    /** Max number of relevance-selected tools (on top of CORE). */
    topK?: number;
    /** Don't subset when the candidate list is already this small. */
    minCandidates?: number;
}

/**
 * Reduce a candidate tool-name list to CORE ∪ top-K relevant tools for one turn.
 * Conservative by design — returns the full list unchanged (applied:false) when
 * the candidate set is already small or the query gives no lexical signal, so it
 * never strips tools on a vague prompt.
 */
export async function subsetToolsForQuery(
    message: string,
    candidateToolNames: string[],
    opts: ToolSubsetOptions = {},
): Promise<ToolSubsetResult> {
    const topK = opts.topK ?? 20;
    const minCandidates = opts.minCandidates ?? 25;
    const before = candidateToolNames.length;

    if (before <= minCandidates) {
        return { tools: candidateToolNames, applied: false, before, after: before, reason: "below-floor" };
    }

    const queryTerms = tokenize(message || "");
    if (queryTerms.length === 0) {
        return { tools: candidateToolNames, applied: false, before, after: before, reason: "no-query-terms" };
    }

    // Lazy import to avoid any load-order/circular coupling with the tool registry.
    const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
    const registry = getAgentTools() as Record<string, ToolDefinition>;

    const scored = candidateToolNames
        .filter(n => !CORE_TOOLS.has(n))
        .map(n => ({ name: n, score: registry[n] ? scoreTool(queryTerms, registry[n]) : 0 }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);

    // Zero signal → don't subset (safer to keep the full set than guess).
    if (scored.length === 0) {
        return { tools: candidateToolNames, applied: false, before, after: before, reason: "no-matches" };
    }

    const picked = scored.slice(0, topK).map(s => s.name);
    const core = candidateToolNames.filter(n => CORE_TOOLS.has(n));
    const tools = Array.from(new Set([...core, ...picked]));

    return { tools, applied: true, before, after: tools.length, reason: "subset" };
}
