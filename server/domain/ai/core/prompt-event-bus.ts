import { createLogger } from "@server/utils/logger.js";
import { compileSpecToSystemPrompt, XRayGraph, OperationalGuide } from "./spec-compiler.js";
import { copilotPromptManager } from "./copilot-prompt-manager.service.js";

const logger = createLogger("PromptEventBus");

// In-Memory fallback cache & pub/sub for compiled prompt fragments
const promptCache = new Map<string, string>();
const eventListeners = new Set<(event: { appId: string; fingerprint: string; timestamp: number }) => void>();

interface PromptBusMetrics {
    reindexCount: number;
    cacheHits: number;
    cacheMisses: number;
    lastCompileLatencyMs: number;
    totalCompileLatencyMs: number;
    cachedPromptCount: number;
}

const metrics: PromptBusMetrics = {
    reindexCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    lastCompileLatencyMs: 0,
    totalCompileLatencyMs: 0,
    cachedPromptCount: 0
};

export function getPromptBusMetrics(): PromptBusMetrics & { averageCompileLatencyMs: number } {
    return {
        ...metrics,
        cachedPromptCount: promptCache.size,
        averageCompileLatencyMs: metrics.reindexCount > 0
            ? Number((metrics.totalCompileLatencyMs / metrics.reindexCount).toFixed(2))
            : 0
    };
}

export function subscribeArchitectureUpdates(
    listener: (event: { appId: string; fingerprint: string; timestamp: number }) => void
): () => void {
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
}

export function getCachedCompiledPrompt(appId: string): string | null {
    const cached = promptCache.get(`spec:system_prompt:${appId}`);
    if (cached) {
        metrics.cacheHits++;
        return cached;
    }
    metrics.cacheMisses++;
    return null;
}

/**
 * Called when the AST diffing pipeline or auto-indexer finishes re-indexing.
 * Compiles the prompt fragment, updates high-speed cache, updates CopilotPromptManager,
 * and broadcasts real-time invalidation events across active Copilot sessions.
 */
export async function onArchitectureReindexed(graph: XRayGraph, guide: OperationalGuide): Promise<string> {
    const startTime = performance.now();

    // 1. Compile the graph into a system prompt string
    const compiledPrompt = compileSpecToSystemPrompt(graph, guide);

    const cacheKey = `spec:system_prompt:${graph.scopeAppId}`;

    // 2. Write to high-speed cache
    promptCache.set(cacheKey, compiledPrompt);

    const compileDuration = Number((performance.now() - startTime).toFixed(2));
    metrics.reindexCount++;
    metrics.lastCompileLatencyMs = compileDuration;
    metrics.totalCompileLatencyMs += compileDuration;

    // 3. Update CopilotPromptManager live state
    copilotPromptManager.onArchitectureUpdated({
        readinessScore: guide.readinessScore,
        readinessGapsCount: guide.readinessGaps?.length || 0,
        subgraphNodesCount: graph.stats?.totalNodes || 33,
        subgraphEdgesCount: graph.stats?.totalRelationships || 13,
        readinessGaps: guide.readinessGaps?.map(g => `${g.severity.toUpperCase()}: ${g.gap} - ${g.finding}`) || []
    });

    const updateEvent = {
        appId: graph.scopeAppId,
        fingerprint: graph.fingerprint,
        timestamp: Date.now()
    };

    // 4. Broadcast event to subscribed WebSocket sessions / active instances
    eventListeners.forEach(listener => {
        try {
            listener(updateEvent);
        } catch (err) {
            logger.error(`[PromptEventBus] Error notifying listener:`, err);
        }
    });

    logger.info(`[PromptEventBus] Architecture re-indexed for app '${graph.scopeAppId}' in ${compileDuration}ms. Fingerprint: ${graph.fingerprint}`);

    return compiledPrompt;
}
