import { Job } from "bullmq";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { BaseWorker } from "./base-worker.js";
import { AIClientFactory, type AIResponse } from "@domain/ai/core/ai-client.service.js";
import { configResolver } from "@server/core/config-resolver.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ConsensusWorker");

interface ConsensusJobData {
    prompt: string;
    models: Array<{ provider: string; model: string }>;
    judgeModel?: { provider: string; model: string };
    context?: any;
}

export class ConsensusWorker extends BaseWorker<ConsensusJobData, any> {
    constructor() {
        super(QUEUE_NAMES.AI, { // Reusing AI queue or could use a specific CONSENSUS queue
            concurrency: 5,
            lockDuration: 300000,
        });
    }

    protected async execute(job: Job<ConsensusJobData>): Promise<any> {
        const { prompt, models, judgeModel, context } = job.data;
        logger.info(`[ConsensusWorker] Running multi-model consensus for ${models.length} models`);

        // 1. Parallel Execution
        const results = await Promise.all(models.map(async (m) => {
            try {
                const providerMeta = await configResolver.resolveAIProvider(m.provider);
                const client = AIClientFactory.getClient(providerMeta as any);
                const response = await client.execute({ model: m.model } as any, prompt, providerMeta.apiKey);
                return { model: m.model, provider: m.provider, response };
            } catch (err: any) {
                return { model: m.model, provider: m.provider, error: err.message };
            }
        }));

        const successResults = results.filter(r => r.response?.success);
        
        if (successResults.length === 0) {
            throw new Error("All models failed to respond in consensus cycle.");
        }

        // 2. Simple Majority or "Judge" arbitration
        if (judgeModel && successResults.length > 1) {
            logger.info(`[ConsensusWorker] Calling Judge model ${judgeModel.model} for arbitration`);
            const judgePrompt = `
You are a Consensus Arbitrator. Below are multiple responses to the same prompt.
Your task is to select the BEST response based on accuracy, faithfulness to instructions, and logical consistency.

ORIGINAL PROMPT:
${prompt}

RESPONSES:
${successResults.map((r, i) => `--- RESPONSE ${i+1} (${r.model}) ---\n${r.response?.output}`).join("\n\n")}

Select the index (1, 2, 3...) of the best response and provide a brief justification.
Return JSON: { "bestIndex": number, "justification": string }
            `;

            try {
                const judgeMeta = await configResolver.resolveAIProvider(judgeModel.provider);
                const judgeClient = AIClientFactory.getClient(judgeMeta as any);
                const judgeResp = await judgeClient.execute({ model: judgeModel.model } as any, judgePrompt, judgeMeta.apiKey);
                
                if (judgeResp.success && judgeResp.output) {
                    const decision = JSON.parse(judgeResp.output.replace(/```json|```/g, ""));
                    const best = successResults[decision.bestIndex - 1];
                    return {
                        winner: best,
                        allResults: results,
                        justification: decision.justification,
                        consensusReached: true
                    };
                }
            } catch (err: any) {
                logger.warn(`[ConsensusWorker] Arbitration failed, falling back to first success: ${err.message}`);
            }
        }

        // Fallback: Just return the first successful result
        return {
            winner: successResults[0],
            allResults: results,
            consensusReached: false,
            note: "Arbitration skipped or failed"
        };
    }
}

let workerInstance: ConsensusWorker | null = null;

export function startConsensusWorker() {
    if (!workerInstance) {
        workerInstance = new ConsensusWorker();
    }
    return workerInstance;
}
