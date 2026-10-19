
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ForgeUtils");

export const AI_CALL_TIMEOUT_MS = 1_800_000; // 30 minutes for local LLM support

export const withAiTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
    Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`AI call timed out after ${AI_CALL_TIMEOUT_MS / 1000}s [${label}]`)), AI_CALL_TIMEOUT_MS)
        )
    ]);

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function executeWithBackoff(client: any, config: any, params: any, options: any, retries: number, emitLog?: any) {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            const result = await withAiTimeout(client.execute(params, options, config.apiKey || ""), params.label || "ai-call");
            return result;
        } catch (err: any) {
            lastError = err;
            const isRateLimit = err.message.includes("429") || err.message.includes("rate limit");
            if (isRateLimit) {
                const wait = Math.pow(2, i) * 2000;
                if (emitLog) await emitLog(`Rate limited. Backing off ${wait}ms...`, 'warn');
                await sleep(wait);
            } else {
                throw err;
            }
        }
    }
    throw lastError;
}
