
import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "../../ai/core/ai-client.service.js";

const logger = createLogger("LocalSLM");

export type SLMTaskType = 'classify' | 'summarize' | 'extract' | 'reason';

const TASK_MODEL_MAP: Record<SLMTaskType, string> = {
    classify: 'llama3.2:1b-instruct-q4_K_M',
    summarize: 'llama3.2:1b-instruct-q4_K_M',
    extract: 'llama3.2:1b-instruct-q4_K_M',
    reason: 'deepseek-r1:1.5b-q4_K_M'
};

export class LocalSLMService {
    /**
     * Executes a low-complexity task using a local model via Ollama.
     * Includes automatic fallback to a cloud model if local execution fails.
     */
    static async execute(taskType: SLMTaskType, prompt: string, fallbackToCloud: boolean = true): Promise<string | null> {
        const model = TASK_MODEL_MAP[taskType];
        
        try {
            logger.debug(`[LocalSLM] Routing ${taskType} task to local model: ${model}`);
            
            const client = AIClientFactory.getClient({ 
                provider: 'ollama', 
                baseUrl: 'http://localhost:11434' 
            } as any);

            const result = await client.execute({
                model: model,
                userPrompt: prompt,
                temperature: 0.1,
                isPriority: false,
                provider: 'ollama',        // tells CachedAIClient to skip cloud overhead
                baseUrl: 'http://localhost:11434',
                options: {
                    num_gpu: Number(process.env.OLLAMA_NUM_GPU ?? 99)
                },
                useCache: false,           // no caching for local tasks
            } as any, undefined, "");

            if (result.success && result.output) {
                logger.info(`[LocalSLM] Successfully executed ${taskType} via ${model}.`);
                return result.output;
            }

            throw new Error(result.error || "Execution failed");

        } catch (err: any) {
            logger.warn(`[LocalSLM] Local execution failed for ${taskType}: ${err.message}`);
            
            if (fallbackToCloud) {
                logger.info(`[LocalSLM] Falling back to Gemini Flash for ${taskType}...`);
                const { systemAiService } = await import("./system-ai.service.js");
                return await systemAiService.generateText(prompt, {
                    model: 'gemini-1.5-flash',
                    temperature: 0.1
                });
            }
        }
        return null;
    }
}
