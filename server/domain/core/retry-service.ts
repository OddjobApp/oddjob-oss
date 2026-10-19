/**
 * Retry Service
 *
 * Generic retry-with-backoff for an arbitrary operation. Used by
 * circuit-breaker.service.ts, which is its only caller.
 *
 * This file used to also carry a second, diagnosis-driven retry design:
 * shouldRetry() classified a failed pipeline step through errorDiagnosisEngine and
 * returned a RetryDecision, supported by calculateBackoff, getRetryHistory,
 * applyRetryConfig and getRecommendedBackoff. All of it has been removed. It had no
 * production callers at all, and the live retry paths are elsewhere:
 *
 *   - pipeline-step-runner.ts wraps each step in its own attempt loop driven by
 *     step.retryConfig, with its own exponential backoff.
 *   - pipeline-executor.ts routes step failures to errorRecoveryService, which
 *     classifies through errorClassificationService — a different classifier that
 *     already treats timeouts and ECONNREFUSED as retryable TRANSIENT errors.
 *
 * Keeping a plausible-looking second decision path that nothing consulted invited the
 * conclusion that retries were driven by the error knowledge base. They are not.
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('RetryService');

export class RetryService {

    /**
     * Sleep for a given duration
     */
    async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Extract Retry-After delay in milliseconds if present, or return fallback for rate limits
     */
    getRetryAfterMs(error: any): number | null {
        if (!error) return null;

        const status = error.status || error.statusCode || error.response?.status;
        const isRateLimit = status === 429;

        const headers = error.headers || error.response?.headers;
        let retryAfter: string | undefined | null;

        if (headers) {
            if (typeof headers.get === 'function') {
                retryAfter = headers.get('retry-after');
            } else {
                retryAfter = headers['retry-after'] || headers['Retry-After'] || headers['retry-after-ms'];
            }
        }

        if (retryAfter) {
            const seconds = parseFloat(retryAfter);
            if (!isNaN(seconds)) {
                return seconds * 1000;
            }

            const parsedDate = Date.parse(retryAfter);
            if (!isNaN(parsedDate)) {
                return Math.max(0, parsedDate - Date.now());
            }
        }

        if (isRateLimit) {
            return 10000; // 10 seconds default fallback for 429
        }

        return null;
    }

    /**
     * Execute an arbitrary function with retry logic
     */
    async executeWithRetry<T>(
        fn: () => Promise<T>,
        config: {
            maxRetries: number;
            backoffMs: number;
            backoffMultiplier: number;
            retryOn?: (error: any) => boolean;
        } = { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 }
    ): Promise<T> {
        let attempt = 0;
        while (true) {
            try {
                return await fn();
            } catch (error: any) {
                attempt++;
                if (attempt > config.maxRetries || (config.retryOn && !config.retryOn(error))) {
                    throw error;
                }

                // Check for rate-limiting retry-after
                const retryAfterMs = this.getRetryAfterMs(error);
                let finalDelay: number;

                if (retryAfterMs !== null) {
                    finalDelay = retryAfterMs;
                    logger.warn(`Rate limit (429) hit, retrying attempt ${attempt}/${config.maxRetries} after Retry-After delay of ${finalDelay}ms.`);
                } else {
                    const delay = config.backoffMs * Math.pow(config.backoffMultiplier, attempt - 1);
                    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
                    finalDelay = Math.min(Math.round(delay + jitter), 300000);
                    logger.warn(`Operation failed, retrying attempt ${attempt}/${config.maxRetries} in ${finalDelay}ms. Error: ${error.message}`);
                }

                await this.sleep(finalDelay);
            }
        }
    }
}

// Singleton instance
export const retryService = new RetryService();




