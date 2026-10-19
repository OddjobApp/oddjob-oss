/**
 * Ephemeral Sub-Agent Service
 * Provides ultra-fast, lightweight in-memory agent delegation for deterministic
 * and single-turn sub-tasks (JSON repair, schema conversion, diff validation, entity normalization)
 * without incurring Swarm auction and consensus overhead.
 */

import { createLogger } from "@server/utils/logger.js";
import { mockLLMAdapter } from "../adapters/mock-llm.adapter.js";
import { openAIAdapter } from "../adapters/openai.adapter.js";
import { ollamaAdapter } from "../adapters/ollama.adapter.js";
import type { LLMAdapter, LLMRequest } from "../adapters/types.js";

const logger = createLogger("EphemeralSubAgent");

export interface EphemeralTaskRequest {
    taskType: "json_repair" | "diff_validation" | "entity_normalization" | "custom_transform";
    input: string | Record<string, any>;
    schema?: Record<string, any>;
    instructions?: string;
    preferredModel?: string;
    timeoutMs?: number;
}

export interface EphemeralTaskResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    durationMs: number;
    subAgentId: string;
    modelUsed: string;
}

export class EphemeralSubAgentService {
    private static subAgentCounter = 0;

    /**
     * Resolves an adapter based on environment and request
     */
    private static getAdapter(preferredModel?: string): LLMAdapter {
        if (process.env.LLM_PROVIDER === "mock" || process.env.NODE_ENV === "test") {
            return mockLLMAdapter;
        }
        if (preferredModel?.startsWith("ollama:") || preferredModel?.startsWith("local:")) {
            return ollamaAdapter;
        }
        return openAIAdapter;
    }

    /**
     * Executes a fast ephemeral task
     */
    static async execute<T = any>(task: EphemeralTaskRequest): Promise<EphemeralTaskResult<T>> {
        const startTime = Date.now();
        const subAgentId = `ephemeral-agent-${++this.subAgentCounter}-${Date.now().toString(36)}`;
        const timeoutMs = task.timeoutMs || 3000; // 3s default safety cutoff

        try {
            let prompt = "";
            const rawInput = typeof task.input === "string" ? task.input : JSON.stringify(task.input, null, 2);

            switch (task.taskType) {
                case "json_repair":
                    prompt = `You are a precision JSON repair sub-agent. Fix syntax errors and return ONLY valid JSON.\n\nInput:\n${rawInput}`;
                    break;
                case "diff_validation":
                    prompt = `You are a diff validation sub-agent. Verify the proposed modifications are syntactically sound.\n\nDiff Content:\n${rawInput}`;
                    break;
                case "entity_normalization":
                    prompt = `You are an entity normalization sub-agent. Clean, trim, and normalize key-value entities.\n\nEntities:\n${rawInput}`;
                    break;
                default:
                    prompt = `${task.instructions || "Process the following input with precision"}:\n\n${rawInput}`;
            }

            const adapter = this.getAdapter(task.preferredModel);
            const request: LLMRequest = {
                messages: [
                    { role: "system", content: "You are a specialized ephemeral micro-agent. Respond concisely with exact structured output." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1, // High determinism
                maxTokens: 1024,
            };

            const response = await Promise.race([
                adapter.complete(request, { modelId: task.preferredModel || "gpt-4o-mini" }, {}),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Ephemeral task timed out after ${timeoutMs}ms`)), timeoutMs))
            ]);

            let parsedData: any = response.content;
            if (task.taskType === "json_repair" || task.taskType === "entity_normalization") {
                try {
                    const cleanJson = response.content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
                    parsedData = JSON.parse(cleanJson);
                } catch {
                    // Keep raw output if JSON parse fails
                }
            }

            const durationMs = Date.now() - startTime;
            logger.debug(`[EphemeralSubAgent] Task ${task.taskType} completed in ${durationMs}ms by ${subAgentId}`);

            return {
                success: true,
                data: parsedData as T,
                durationMs,
                subAgentId,
                modelUsed: response.model,
            };
        } catch (err: any) {
            const durationMs = Date.now() - startTime;
            logger.warn(`[EphemeralSubAgent] Task ${task.taskType} failed in ${durationMs}ms:`, err?.message);
            return {
                success: false,
                error: err?.message || "Ephemeral execution failed",
                durationMs,
                subAgentId,
                modelUsed: task.preferredModel || "unknown",
            };
        }
    }
}

export const ephemeralSubAgent = EphemeralSubAgentService;
