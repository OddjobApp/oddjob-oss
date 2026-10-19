/**
 * Context Injection — Shared Types
 */

import type { XRaySymbol } from "@domain/xray/core/xray-intelligence.service.js";

export interface InjectionResult {
    prompt: string;
    metadata: {
        symbolsInjected: number;
        filesReferenced: number;
        tokensConsumed: number;
        queryLatencyMs: number;
        fallbackActivated: boolean;
        truncatedCount: number;
    };
}

export interface InjectionOptions {
    tokenBudget?: number;              // default: 4000
    timeoutMs?: number;                // default: 5000
    disabled?: boolean;                // opt-out flag
    priorityCategories?: string[];     // override priority order
}

export interface ExtractedReferences {
    filePaths: string[];
    functionNames: string[];
    classNames: string[];
    moduleNames: string[];
    typeNames: string[];
}

export interface ScoredSymbol {
    symbol: XRaySymbol;
    relevanceScore: number;            // 0.0 - 1.0
    category: "types" | "related_functions" | "imports" | "usage_examples";
    relationship: string;              // e.g., "Called by createUser()"
}

export interface ContextInjectionTelemetry {
    missionId: number;
    orgId: number;
    symbolsQueried: number;
    symbolsInjected: number;
    tokensConsumed: number;
    queryLatencyMs: number;
    fallbackActivated: boolean;
    fallbackReason?: string;
    truncatedCount: number;
}
