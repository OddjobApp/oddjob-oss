/**
 * Context Injection Service — Main orchestration service.
 *
 * Orchestrates the full context injection pipeline:
 *   1. Check disabled flag → return empty InjectionResult
 *   2. Extract references from the implementation plan
 *   3. Query XRay (findSymbols + traceImpact) with timeout
 *   4. Score and rank symbols
 *   5. Format context within token budget
 *   6. Emit telemetry
 *
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { createLogger } from "@server/utils/logger.js";
import { xrayIntelligenceService } from "@domain/xray/core/xray-intelligence.service.js";
import type { XRaySymbol, ImpactNode } from "@domain/xray/core/xray-intelligence.service.js";
import { extractReferences } from "./reference-extractor.js";
import { scoreSymbols } from "./relevance-scorer.js";
import { formatContext, DEFAULT_TOKEN_BUDGET } from "./context-formatter.js";
import type { InjectionResult, InjectionOptions, ContextInjectionTelemetry } from "./types.js";

const logger = createLogger("ContextInjection");

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5000;
const FALLBACK_NOTE = "⚠️ Code context unavailable: XRay query timed out";
const NOT_INDEXED_NOTE = "⚠️ Code context unavailable: repository not indexed. Use file discovery tools to explore the codebase.";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyResult(fallbackActivated = false, fallbackReason?: string): InjectionResult {
    return {
        prompt: "",
        metadata: {
            symbolsInjected: 0,
            filesReferenced: 0,
            tokensConsumed: 0,
            queryLatencyMs: 0,
            fallbackActivated,
            truncatedCount: 0,
        },
    };
}

function fallbackResult(note: string, queryLatencyMs: number): InjectionResult {
    return {
        prompt: note,
        metadata: {
            symbolsInjected: 0,
            filesReferenced: 0,
            tokensConsumed: 0,
            queryLatencyMs,
            fallbackActivated: true,
            truncatedCount: 0,
        },
    };
}

/**
 * Creates a timeout promise that rejects after the specified milliseconds.
 */
function createTimeout(ms: number): { promise: Promise<never>; clear: () => void } {
    let timeoutId: ReturnType<typeof setTimeout>;
    const promise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("XRAY_TIMEOUT")), ms);
    });
    return {
        promise,
        clear: () => clearTimeout(timeoutId),
    };
}

// ─── XRay Query Logic ─────────────────────────────────────────────────────────

interface XRayQueryResult {
    symbols: XRaySymbol[];
    impactNodes: ImpactNode[];
    symbolsQueried: number;
}

/**
 * Queries XRay for symbols and impact data based on extracted references.
 * Handles partial failures gracefully — individual query errors are logged and skipped.
 */
async function queryXRay(
    workspacePath: string,
    references: ReturnType<typeof extractReferences>,
): Promise<XRayQueryResult> {
    const allSymbols: XRaySymbol[] = [];
    const allImpactNodes: ImpactNode[] = [];
    let symbolsQueried = 0;

    // Build query list from references
    const queries: string[] = [
        ...references.functionNames,
        ...references.classNames,
        ...references.typeNames,
    ];

    // Query findSymbols for each reference
    for (const query of queries) {
        symbolsQueried++;
        try {
            const symbols = await xrayIntelligenceService.findSymbols(workspacePath, query);
            allSymbols.push(...symbols);
        } catch (err: any) {
            // Requirement 5.1: "not indexed" is a repo-level failure — propagate immediately
            if (err.message?.toLowerCase().includes("not indexed")) {
                throw err;
            }
            // Requirement 1.5: log the miss and continue with partial results
            logger.warn(`findSymbols failed for query "${query}": ${err.message}`);
        }
    }

    // Deduplicate symbols by ID before tracing impact
    const uniqueSymbolMap = new Map<string, XRaySymbol>();
    for (const sym of allSymbols) {
        if (!uniqueSymbolMap.has(sym.id)) {
            uniqueSymbolMap.set(sym.id, sym);
        }
    }
    const uniqueSymbols = Array.from(uniqueSymbolMap.values());

    // Trace impact for key symbols (top priority: types and functions directly referenced)
    // Limit to first 5 to keep latency reasonable
    const symbolsToTrace = uniqueSymbols.slice(0, 5);
    for (const symbol of symbolsToTrace) {
        try {
            const impact = await xrayIntelligenceService.traceImpact(workspacePath, symbol);
            allImpactNodes.push(...impact);
        } catch (err: any) {
            // Partial results: use what's available (Requirement 5.3)
            logger.warn(`traceImpact failed for symbol "${symbol.name}": ${err.message}`);
        }
    }

    return {
        symbols: uniqueSymbols,
        impactNodes: allImpactNodes,
        symbolsQueried,
    };
}

// ─── Main Service ─────────────────────────────────────────────────────────────

export const contextInjectionService = {
    /**
     * Orchestrates the full context injection pipeline.
     *
     * @param implementationPlan - The plan (string or structured object) describing what to implement
     * @param workspacePath - Absolute path to the workspace root
     * @param orgId - Organization ID for telemetry
     * @param options - Optional configuration overrides
     * @returns InjectionResult with formatted prompt and metadata
     */
    async injectContext(
        implementationPlan: string | object,
        workspacePath: string,
        orgId: number,
        options?: InjectionOptions,
    ): Promise<InjectionResult> {
        const startTime = Date.now();
        const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const tokenBudget = options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
        const disabled = options?.disabled ?? false;

        // ── 1. Check disabled flag ────────────────────────────────────────────
        if (disabled) {
            logger.info("Context injection disabled via options flag");
            return emptyResult();
        }

        // ── 2. Extract references from plan ───────────────────────────────────
        const references = extractReferences(implementationPlan);

        // If no references could be extracted, nothing to query
        const totalRefs =
            references.filePaths.length +
            references.functionNames.length +
            references.classNames.length +
            references.typeNames.length;

        if (totalRefs === 0) {
            logger.info("No references extracted from implementation plan — skipping injection");
            return emptyResult();
        }

        // ── 3. Query XRay with timeout ────────────────────────────────────────
        let xrayResult: XRayQueryResult;
        const timeout = createTimeout(timeoutMs);

        try {
            xrayResult = await Promise.race([
                queryXRay(workspacePath, references),
                timeout.promise,
            ]);
        } catch (err: any) {
            const queryLatencyMs = Date.now() - startTime;

            if (err.message === "XRAY_TIMEOUT") {
                // Requirement 5.4: timeout → activate Fallback_Mode
                logger.warn(`XRay query timed out after ${timeoutMs}ms — activating Fallback_Mode`);
                const result = fallbackResult(FALLBACK_NOTE, queryLatencyMs);

                // Requirement 5.5: emit metric event for monitoring
                this._emitTelemetry({
                    missionId: 0,
                    orgId,
                    symbolsQueried: 0,
                    symbolsInjected: 0,
                    tokensConsumed: 0,
                    queryLatencyMs,
                    fallbackActivated: true,
                    fallbackReason: "timeout",
                    truncatedCount: 0,
                });

                return result;
            }

            // XRay threw an error — check for "not indexed" response
            if (err.message?.toLowerCase().includes("not indexed")) {
                logger.warn(`XRay reports repository not indexed — activating Fallback_Mode`);
                const result = fallbackResult(NOT_INDEXED_NOTE, queryLatencyMs);

                this._emitTelemetry({
                    missionId: 0,
                    orgId,
                    symbolsQueried: 0,
                    symbolsInjected: 0,
                    tokensConsumed: 0,
                    queryLatencyMs,
                    fallbackActivated: true,
                    fallbackReason: "not_indexed",
                    truncatedCount: 0,
                });

                return result;
            }

            // Generic XRay error — gracefully return fallback
            logger.error(`XRay query failed: ${err.message}`);
            const result = fallbackResult(FALLBACK_NOTE, queryLatencyMs);

            this._emitTelemetry({
                missionId: 0,
                orgId,
                symbolsQueried: 0,
                symbolsInjected: 0,
                tokensConsumed: 0,
                queryLatencyMs,
                fallbackActivated: true,
                fallbackReason: `error: ${err.message}`,
                truncatedCount: 0,
            });

            return result;
        } finally {
            timeout.clear();
        }

        const queryLatencyMs = Date.now() - startTime;

        // If XRay returned no symbols, return empty result
        if (xrayResult.symbols.length === 0) {
            logger.info("XRay returned no symbols — skipping injection");

            this._emitTelemetry({
                missionId: 0,
                orgId,
                symbolsQueried: xrayResult.symbolsQueried,
                symbolsInjected: 0,
                tokensConsumed: 0,
                queryLatencyMs,
                fallbackActivated: false,
                truncatedCount: 0,
            });

            return emptyResult();
        }

        // ── 4. Score symbols ──────────────────────────────────────────────────
        const scoredSymbols = scoreSymbols(
            xrayResult.symbols,
            xrayResult.impactNodes,
            references,
        );

        // ── 5. Format context within token budget ─────────────────────────────
        const formatResult = formatContext(scoredSymbols, {
            tokenBudget,
            maxLinesPerSymbol: 50,
            includeRelationship: true,
        });

        // ── 6. Assemble final result ──────────────────────────────────────────
        const uniqueFiles = new Set(scoredSymbols.map((s) => s.symbol.filePath));
        const result: InjectionResult = {
            prompt: formatResult.prompt,
            metadata: {
                symbolsInjected: formatResult.symbolsIncluded,
                filesReferenced: uniqueFiles.size,
                tokensConsumed: formatResult.tokensUsed,
                queryLatencyMs,
                fallbackActivated: false,
                truncatedCount: formatResult.truncatedCount,
            },
        };

        // ── 7. Emit telemetry ─────────────────────────────────────────────────
        this._emitTelemetry({
            missionId: 0,
            orgId,
            symbolsQueried: xrayResult.symbolsQueried,
            symbolsInjected: formatResult.symbolsIncluded,
            tokensConsumed: formatResult.tokensUsed,
            queryLatencyMs,
            fallbackActivated: false,
            truncatedCount: formatResult.truncatedCount,
        });

        return result;
    },

    /**
     * Internal: emit telemetry data via logger.
     * Separated for testability.
     */
    _emitTelemetry(telemetry: ContextInjectionTelemetry): void {
        logger.info("ContextInjectionTelemetry", telemetry);
    },
};
