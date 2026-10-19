/**
 * Relevance Scorer — Scores and ranks XRay symbols by relevance to an implementation plan.
 *
 * Scoring factors:
 *   - Proximity to modified files (weight: 0.4)
 *   - Frequency in plan references (weight: 0.3)
 *   - Dependency depth from impact analysis (weight: 0.3)
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import type { XRaySymbol, ImpactNode } from "@domain/xray/core/xray-intelligence.service.js";
import type { ExtractedReferences, ScoredSymbol } from "./types.js";

// ─── Exclusion Patterns ───────────────────────────────────────────────────────

const EXCLUDED_PATH_PATTERNS = [
    "node_modules/",
    "dist/",
    ".generated.",
    "vendor/",
];

function isExcluded(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    return EXCLUDED_PATH_PATTERNS.some((pattern) => normalized.includes(pattern));
}

// ─── Scoring Helpers ──────────────────────────────────────────────────────────

const PROXIMITY_WEIGHT = 0.4;
const FREQUENCY_WEIGHT = 0.3;
const DEPTH_WEIGHT = 0.3;

/**
 * Proximity score: How close is the symbol's file to referenced file paths?
 *   Same file = 1.0
 *   Same directory = 0.7
 *   Adjacent directory (shared parent) = 0.4
 *   Otherwise = 0.1
 */
function computeProximityScore(symbolFilePath: string, referencedFilePaths: string[]): number {
    if (referencedFilePaths.length === 0) return 0.1;

    const normalizedSymbol = symbolFilePath.replace(/\\/g, "/");
    const symbolDir = getDirectory(normalizedSymbol);
    const symbolParent = getDirectory(symbolDir);

    let best = 0.1;

    for (const refPath of referencedFilePaths) {
        const normalizedRef = refPath.replace(/\\/g, "/");

        // Same file
        if (normalizedSymbol === normalizedRef) {
            return 1.0; // Can't do better, return immediately
        }

        const refDir = getDirectory(normalizedRef);

        // Same directory
        if (symbolDir === refDir) {
            best = Math.max(best, 0.7);
            continue;
        }

        // Adjacent directory (shared parent)
        const refParent = getDirectory(refDir);
        if (symbolParent === refParent) {
            best = Math.max(best, 0.4);
        }
    }

    return best;
}

/**
 * Frequency score: How often does the symbol name appear in the plan references?
 * Count occurrences across functionNames, classNames, typeNames.
 * Normalize: min(count / 3, 1.0) — 3+ mentions = max score.
 */
function computeFrequencyScore(symbolName: string, references: ExtractedReferences): number {
    let count = 0;

    for (const name of references.functionNames) {
        if (name === symbolName) count++;
    }
    for (const name of references.classNames) {
        if (name === symbolName) count++;
    }
    for (const name of references.typeNames) {
        if (name === symbolName) count++;
    }

    return Math.min(count / 3, 1.0);
}

/**
 * Dependency depth score: Based on impactNode depth.
 *   depth 0 (direct import) = 1.0
 *   depth 1 (one hop) = 0.7
 *   depth 2+ = max(0.1, 1.0 - depth * 0.3)
 */
function computeDepthScore(symbolId: string, impactNodes: ImpactNode[]): number {
    const node = impactNodes.find((n) => n.symbol.id === symbolId);
    if (!node) return 0.1; // Not in impact graph, minimum score

    const depth = node.depth;
    if (depth === 0) return 1.0;
    if (depth === 1) return 0.7;
    return Math.max(0.1, 1.0 - depth * 0.3);
}

// ─── Category Assignment ──────────────────────────────────────────────────────

/**
 * Assign a category to a symbol based on its kind, impact nodes, and file path.
 *
 * Priority:
 *   1. type definitions → "types"
 *   2. called functions (in impactNodes) → "related_functions"
 *   3. imports (impactNode reason contains "Import") → "imports"
 *   4. test/spec files → "usage_examples"
 *   5. default → "related_functions"
 */
function assignCategory(
    symbol: XRaySymbol,
    impactNodes: ImpactNode[],
): ScoredSymbol["category"] {
    // Type definitions
    if (symbol.kind === "interface" || symbol.kind === "type") {
        return "types";
    }

    // Test files
    const normalizedPath = symbol.filePath.replace(/\\/g, "/").toLowerCase();
    if (normalizedPath.includes("test") || normalizedPath.includes("spec")) {
        return "usage_examples";
    }

    // Check if symbol appears in impact nodes
    const impactNode = impactNodes.find((n) => n.symbol.id === symbol.id);
    if (impactNode) {
        // If the reason contains "Import", it's an import
        if (impactNode.reason.toLowerCase().includes("import")) {
            return "imports";
        }
        // Otherwise it's a related function
        return "related_functions";
    }

    // Functions/methods default to related_functions
    if (symbol.kind === "function" || symbol.kind === "method") {
        return "related_functions";
    }

    // Default
    return "related_functions";
}

// ─── Relationship String ──────────────────────────────────────────────────────

function buildRelationship(
    symbol: XRaySymbol,
    impactNodes: ImpactNode[],
    references: ExtractedReferences,
): string {
    // Use impactNode reason if available
    const impactNode = impactNodes.find((n) => n.symbol.id === symbol.id);
    if (impactNode && impactNode.reason) {
        return impactNode.reason;
    }

    // Generate a relationship string based on category/kind
    if (symbol.kind === "interface" || symbol.kind === "type") {
        const targetFile = references.filePaths[0] || "plan";
        return `Type used in ${targetFile}`;
    }

    if (symbol.kind === "function" || symbol.kind === "method") {
        return `Function referenced in plan`;
    }

    return `Related symbol`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function getDirectory(filePath: string): string {
    const lastSlash = filePath.lastIndexOf("/");
    return lastSlash >= 0 ? filePath.substring(0, lastSlash) : "";
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Score, categorize, deduplicate, and sort XRay symbols by relevance.
 *
 * @param symbols - Raw symbols returned by XRay findSymbols
 * @param impactNodes - Impact/dependency nodes from XRay traceImpact
 * @param references - Extracted references from the implementation plan
 * @returns Scored, deduplicated, sorted symbols ready for formatting
 */
export function scoreSymbols(
    symbols: XRaySymbol[],
    impactNodes: ImpactNode[],
    references: ExtractedReferences,
): ScoredSymbol[] {
    // 1. Exclude unwanted symbols
    const filtered = symbols.filter((s) => !isExcluded(s.filePath));

    // 2. Score each symbol
    const scored: ScoredSymbol[] = filtered.map((symbol) => {
        const proximityScore = computeProximityScore(symbol.filePath, references.filePaths);
        const frequencyScore = computeFrequencyScore(symbol.name, references);
        const depthScore = computeDepthScore(symbol.id, impactNodes);

        // Weighted sum, clamped to [0.0, 1.0]
        const rawScore =
            proximityScore * PROXIMITY_WEIGHT +
            frequencyScore * FREQUENCY_WEIGHT +
            depthScore * DEPTH_WEIGHT;

        const relevanceScore = Math.max(0.0, Math.min(1.0, rawScore));

        const category = assignCategory(symbol, impactNodes);
        const relationship = buildRelationship(symbol, impactNodes, references);

        return {
            symbol,
            relevanceScore,
            category,
            relationship,
        };
    });

    // 3. Deduplicate by symbol ID, keeping highest score
    const deduped = deduplicateBySymbolId(scored);

    // 4. Sort descending by relevance score
    deduped.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return deduped;
}

function deduplicateBySymbolId(scored: ScoredSymbol[]): ScoredSymbol[] {
    const bestByID = new Map<string, ScoredSymbol>();

    for (const entry of scored) {
        const existing = bestByID.get(entry.symbol.id);
        if (!existing || entry.relevanceScore > existing.relevanceScore) {
            bestByID.set(entry.symbol.id, entry);
        }
    }

    return Array.from(bestByID.values());
}
