/**
 * Intent-to-Pipeline Mapper
 * Maps natural language intent to a pipeline for trigger_pipeline.
 */

import { createLogger } from "@server/utils/logger.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { AIClientFactory } from "../../ai/core/ai-client.service.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { pipelineService } from "./pipeline.service.js";
import { type OrgContext } from "../../jobs/job.service.js";

const logger = createLogger("IntentPipelineMapper");

export interface IntentMappingResult {
    pipelineId: number;
    confidence: number;
    inputHints?: Record<string, string>;
}

/**
 * Map natural language intent to a pipeline.
 * Returns null if no suitable pipeline found or confidence is too low.
 */
export async function mapIntentToPipeline(
    intent: string,
    orgId: number,
    allowedPipelineIds?: number[] | null
): Promise<IntentMappingResult | null> {
    try {
        const orgContext = getSystemOrgContext(orgId);

        const pipelines = await pipelineService.list(orgContext, {
            pipelineIds: allowedPipelineIds ?? undefined,
            includeInactive: false,
            limit: 50,
        });

        if (pipelines.length === 0) return null;

        const catalog = pipelines.map((p) => ({
            id: p.id,
            name: p.name,
            description: (p as any).description || "",
        }));

        // Deterministic rescue-dispatch fast path. These phrases are intentionally
        // narrow and are evaluated only against the caller's allowed pipeline set.
        const normalizedIntent = intent.toLowerCase();
        const rescueIntentRules = [
            { name: "Dispatch Closure", matches: (value: string) => /\b(close|complete|resolve|resolved)\b/.test(value) && /\b(dispatch|rescue|request)\b/.test(value) },
            { name: "Dispatch Performance Learning Loop", matches: (value: string) => /\b(performance|review|analytics|learning)\b/.test(value) && /\b(dispatch|provider|routing)\b/.test(value) },
            { name: "Dispatch Tracker Handoff", matches: (value: string) => /\b(tracker|map)\b/.test(value) || value.includes("operations control") || value.includes("dispatch board") },
            { name: "Dispatch SLA Monitoring", matches: (value: string) => /\b(monitor|sla|status|track)\b/.test(value) && /\b(dispatch|rescue|request)\b/.test(value) },
            { name: "Provider Assignment", matches: (value: string) => /\b(assign|match|nearest|reassign|dispatch)\b/.test(value) && /\b(provider|responder)\b/.test(value) },
            { name: "Process Incident Intake", matches: (value: string) => /\b(rescue|help|emergency|roadside|medical|incident)\b/.test(value) && /\b(need|request|support|intake|submit)\b/.test(value) },
        ];
        for (const rule of rescueIntentRules) {
            if (!rule.matches(normalizedIntent)) continue;
            const matched = pipelines.find((pipeline) => pipeline.name.includes(rule.name));
            if (matched) return { pipelineId: matched.id, confidence: 0.99 };
        }

        const aiConfig = await systemAiService.getAiConfig("copilot");
        if (!aiConfig?.apiKey) return null;

        const aiClient = AIClientFactory.getClient({
            provider: aiConfig.provider as any,
            baseUrl: aiConfig.baseUrl || undefined,
        });

        const prompt = `You are a pipeline routing assistant. Given a user's intent and a list of available pipelines, identify the best matching pipeline.

Available Pipelines:
${JSON.stringify(catalog, null, 2)}

User Intent: "${intent}"

Respond with ONLY a JSON object (no markdown):
{
  "pipelineId": <number>,
  "confidence": <0-1>,
  "inputHints": { "<paramName>": "<suggested value or description>" }
}

Rules:
- pipelineId must be one of the IDs from the list
- confidence: 1.0 = exact match, 0.5 = partial, <0.5 = uncertain (return null instead)
- If no pipeline fits well, respond with: {"pipelineId": null, "confidence": 0}
- inputHints: optional, for required pipeline inputs the user might need to provide`;

        const result = await aiClient.execute(
            {
                model: aiConfig.model,
                userPrompt: prompt,
                temperature: 0.1,
                requestType: "json",
                useCache: false,
                saveOutputToFile: false,
                credentialId: aiConfig.credentialId || 0,
            },
            undefined,
            aiConfig.apiKey
        );

        if (!result.success || !result.output) return null;

        const cleanOutput = result.output.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleanOutput) as {
            pipelineId?: number | null;
            confidence?: number;
            inputHints?: Record<string, string>;
        };

        if (parsed.pipelineId == null || (parsed.confidence ?? 0) < 0.5) return null;

        const validId = pipelines.some((p) => p.id === parsed.pipelineId);
        if (!validId) return null;

        return {
            pipelineId: parsed.pipelineId,
            confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
            inputHints: parsed.inputHints,
        };
    } catch (e) {
        logger.warn("Intent-to-pipeline mapping failed", { intent, error: (e as Error).message });
        return null;
    }
}


