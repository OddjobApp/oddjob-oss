/**
 * Context Formatter — Formats ranked symbols into a structured prompt section.
 *
 * Produces a structured "Code Context" block with categories:
 *   1. Types & Interfaces
 *   2. Related Functions
 *   3. Import Map
 *   4. Usage Examples
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import type { ScoredSymbol } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default token budget when no override is specified (Requirement 4.1) */
export const DEFAULT_TOKEN_BUDGET = 4000;

/** Minimum tokens reserved for the "types" category (Requirement 4.4) */
export const TYPE_MINIMUM_RESERVE = 500;

// ─── Public Interface ─────────────────────────────────────────────────────────

export interface FormatOptions {
    tokenBudget: number;
    maxLinesPerSymbol: number;   // default: 50
    includeRelationship: boolean; // default: true
}

export interface FormatResult {
    prompt: string;
    tokensUsed: number;
    symbolsIncluded: number;
    truncatedCount: number;
}

// ─── Category Configuration ───────────────────────────────────────────────────

const CATEGORY_DISPLAY_NAMES: Record<ScoredSymbol["category"], string> = {
    types: "Types & Interfaces",
    related_functions: "Related Functions",
    imports: "Import Map",
    usage_examples: "Usage Examples",
};

const CATEGORY_ORDER: ScoredSymbol["category"][] = [
    "types",
    "related_functions",
    "imports",
    "usage_examples",
];

// ─── Token Counting ───────────────────────────────────────────────────────────

/**
 * Approximate token count using character count ÷ 4.
 * This is a fast heuristic that avoids a tiktoken dependency.
 */
export function countTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// ─── Symbol Formatting ────────────────────────────────────────────────────────

/**
 * Truncate a code snippet to the configured max lines.
 */
function truncateSnippet(code: string, maxLines: number): string {
    const lines = code.split("\n");
    if (lines.length <= maxLines) return code;
    return lines.slice(0, maxLines).join("\n") + "\n    // ... (truncated)";
}

/**
 * Format a single symbol entry for non-import categories.
 * Produces: file path header, relationship line, code block.
 */
function formatSymbolEntry(scored: ScoredSymbol, options: FormatOptions): string {
    const { symbol, relationship } = scored;
    const lines: string[] = [];

    // File path + line range
    lines.push(`📄 ${symbol.filePath} (L${symbol.startLine}-L${symbol.endLine})`);

    // Relationship description
    if (options.includeRelationship && relationship) {
        lines.push(`↳ ${relationship}`);
    }

    // Code snippet (use signature, truncated to max lines)
    const snippet = truncateSnippet(symbol.signature, options.maxLinesPerSymbol);
    lines.push("```typescript");
    lines.push(snippet);
    lines.push("```");

    return lines.join("\n");
}

/**
 * Format a single symbol entry for the "Import Map" category.
 * Produces: `- \`{filePath}\` → {name}` (one line, no code block).
 */
function formatImportEntry(scored: ScoredSymbol): string {
    const { symbol } = scored;
    return `- \`${symbol.filePath}\` → ${symbol.name}`;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Format ranked symbols into a structured prompt section with categories
 * and token budget enforcement.
 *
 * Symbols are included in category priority order, within each category
 * sorted by descending relevance score. The budget is enforced by dropping
 * the lowest-ranked symbols that don't fit.
 *
 * @param rankedSymbols - Scored and sorted symbols from the relevance scorer
 * @param options - Formatting configuration (budget, max lines, relationship toggle)
 * @returns Formatted prompt string with metadata
 */
export function formatContext(
    rankedSymbols: ScoredSymbol[],
    options: FormatOptions,
): FormatResult {
    const {
        tokenBudget,
        maxLinesPerSymbol = 50,
        includeRelationship = true,
    } = options;

    // Resolve effective options (apply defaults for callers passing partial)
    const effectiveOptions: FormatOptions = {
        tokenBudget,
        maxLinesPerSymbol,
        includeRelationship,
    };

    // ── 1. Group symbols by category ──────────────────────────────────────────
    const grouped = new Map<ScoredSymbol["category"], ScoredSymbol[]>();
    for (const category of CATEGORY_ORDER) {
        grouped.set(category, []);
    }
    for (const scored of rankedSymbols) {
        const list = grouped.get(scored.category);
        if (list) {
            list.push(scored);
        }
    }

    // Within each category, maintain descending relevance score order
    for (const list of grouped.values()) {
        list.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    // ── 2. Build category sections within budget ──────────────────────────────
    // Reserve tokens for header and footer (estimated ~80 tokens for framing)
    const headerFooterReserve = 80;
    const availableBudget = tokenBudget - headerFooterReserve;

    // Track included entries per category
    const includedByCategory = new Map<ScoredSymbol["category"], { text: string; scored: ScoredSymbol }[]>();
    for (const category of CATEGORY_ORDER) {
        includedByCategory.set(category, []);
    }

    let totalTokens = 0;
    let symbolsIncluded = 0;
    let truncatedCount = 0;

    // Determine if type symbols are available (Requirement 4.4)
    const typeSymbols = grouped.get("types") || [];
    const hasTypeSymbols = typeSymbols.length > 0;

    // Calculate the budget ceiling for non-type categories.
    // When type symbols exist, reserve at least TYPE_MINIMUM_RESERVE tokens for them.
    // This means non-type categories cannot consume more than (availableBudget - TYPE_MINIMUM_RESERVE).
    const nonTypeBudgetCeiling = hasTypeSymbols
        ? Math.max(0, availableBudget - TYPE_MINIMUM_RESERVE)
        : availableBudget;

    // Process types first — they get full access to availableBudget
    let typesTokensUsed = 0;
    for (const scored of typeSymbols) {
        const entryText = formatSymbolEntry(scored, effectiveOptions);
        const entryTokens = countTokens(entryText);

        if (totalTokens + entryTokens <= availableBudget) {
            includedByCategory.get("types")!.push({ text: entryText, scored });
            totalTokens += entryTokens;
            typesTokensUsed += entryTokens;
            symbolsIncluded++;
        } else {
            truncatedCount++;
        }
    }

    // Process remaining categories — budget is constrained by the type reservation
    let nonTypeTokensUsed = 0;
    for (const category of CATEGORY_ORDER) {
        if (category === "types") continue; // already processed

        const symbols = grouped.get(category) || [];

        for (const scored of symbols) {
            const entryText =
                category === "imports"
                    ? formatImportEntry(scored)
                    : formatSymbolEntry(scored, effectiveOptions);

            const entryTokens = countTokens(entryText);

            // Non-type symbols must fit within both:
            //   1. The total available budget (totalTokens + entryTokens <= availableBudget)
            //   2. The non-type ceiling (nonTypeTokensUsed + entryTokens <= nonTypeBudgetCeiling)
            const fitsOverallBudget = totalTokens + entryTokens <= availableBudget;
            const fitsNonTypeCeiling = nonTypeTokensUsed + entryTokens <= nonTypeBudgetCeiling;

            if (fitsOverallBudget && fitsNonTypeCeiling) {
                includedByCategory.get(category)!.push({ text: entryText, scored });
                totalTokens += entryTokens;
                nonTypeTokensUsed += entryTokens;
                symbolsIncluded++;
            } else {
                truncatedCount++;
            }
        }
    }

    // ── 3. Count unique files from included symbols ───────────────────────────
    const uniqueFiles = new Set<string>();
    for (const entries of includedByCategory.values()) {
        for (const { scored } of entries) {
            uniqueFiles.add(scored.symbol.filePath);
        }
    }
    const fileCount = uniqueFiles.size;

    // ── 4. Assemble the prompt ────────────────────────────────────────────────
    // Build header
    const header = `═══ CODE CONTEXT (${symbolsIncluded} symbols, ${fileCount} files, ${totalTokens.toLocaleString()} tokens) ═══`;

    // Build body grouped by category
    const bodyParts: string[] = [];

    for (const category of CATEGORY_ORDER) {
        const entries = includedByCategory.get(category)!;
        if (entries.length === 0) continue;

        bodyParts.push(`\n### ${CATEGORY_DISPLAY_NAMES[category]}\n`);
        for (const { text } of entries) {
            bodyParts.push(text);
        }
    }

    // Build footer
    let footer = "═══ END CODE CONTEXT";
    if (truncatedCount > 0) {
        footer += ` (${truncatedCount} additional symbols excluded due to token budget)`;
    }
    footer += " ═══";

    const prompt = [header, ...bodyParts, "", footer].join("\n");
    const actualTokensUsed = countTokens(prompt);

    return {
        prompt,
        tokensUsed: actualTokensUsed,
        symbolsIncluded,
        truncatedCount,
    };
}
