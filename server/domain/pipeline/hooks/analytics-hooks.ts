import { ExecutionHook, HookParams } from "./execution-hooks.js";

/**
 * What an executor attaches to its StepExecutionResult to declare the LLM calls the
 * step made. Executors may attach a single entry or, when a step makes several calls,
 * an array of them — one ai_usage_logs row is written per entry.
 */
interface AiUsageEntry {
    provider: string;
    model: string;
    /** Provider-shaped usage blob, used only when explicit counts are absent. */
    metadata?: any;
    promptTokens?: number;
    completionTokens?: number;
}

export class AIAnalyticsHook implements ExecutionHook {
    name = "AIAnalyticsHook";

    async onStepComplete({ result, pipeline, pipelineExecution, stepExecution, orgId, userId }: HookParams): Promise<void> {
        const raw = (result as any)?.__aiUsageMetadata;
        if (!raw) return;

        const entries: AiUsageEntry[] = Array.isArray(raw) ? raw : [raw];

        for (const entry of entries) {
            try {
                const { logAIUsage } = await import("@domain/admin/core/analytics.service.js");
                await logAIUsage({
                    pipelineId: pipeline.id,
                    userId: userId || "system",
                    executionId: pipelineExecution.id,
                    stepExecutionId: stepExecution.id,
                    provider: entry.provider,
                    model: entry.model,
                    metadata: entry.metadata,
                    // Forwarded explicitly when the executor knows them. Without this the
                    // insert falls back to extractTokenCounts(provider, metadata), which
                    // reads google usage from `usageMetadata.promptTokenCount` — a shape
                    // AIResponse never produces — and silently records 0 tokens / $0.00.
                    promptTokens: entry.promptTokens,
                    completionTokens: entry.completionTokens,
                    organizationId: orgId || null,
                });
            } catch (error: any) {
                console.error("[AIAnalyticsHook] Failed to log AI usage:", error);
            }
        }
    }
}
