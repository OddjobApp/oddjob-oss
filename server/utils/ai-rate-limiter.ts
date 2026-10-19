import { createLogger } from "./logger.js";

const logger = createLogger("AIRateLimiter");

export type AIProvider = "openai" | "anthropic" | "google" | "cohere" | "mistral";

export interface RateLimitConfig {
    provider?: AIProvider;
    maxRequestsPerMinute: number;
    maxTokensPerMinute?: number;
    maxConcurrentRequests?: number;
}

export interface CostTracking {
    organizationId: number;
    provider: AIProvider;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    timestamp: Date;
}

interface TokenBucket {
    tokens: number;
    lastRefill: number;
    maxTokens: number;
    refillRate: number; // tokens per millisecond
}

interface QueuedRequest<T> {
    id: string;
    resolve: (value: T) => void;
    reject: (reason?: Error) => void;
    execute: () => Promise<T>;
    priority: number;
    provider: AIProvider;
    organizationId: number;
    timestamp: number;
    retryCount: number;
}

/**
 * Universal AI Rate Limiter with Cost Tracking
 * 
 * Research-backed implementation:
 * - Token bucket algorithm for smooth rate limiting
 * - Priority queue for different request types
 * - Exponential backoff for retries
 * - Per-organization cost tracking
 */
class AIRateLimiter {
    private buckets: Map<AIProvider, TokenBucket> = new Map();
    private queues: Map<AIProvider, QueuedRequest<unknown>[]> = new Map();
    private processorInterval: NodeJS.Timeout | null = null;
    private running: Map<AIProvider, number> = new Map();
    private costHistory: CostTracking[] = [];
    private maxHistorySize = 10000;

    // Default rate limits (conservative to avoid hitting provider limits)
    private defaultConfigs: Record<AIProvider, RateLimitConfig> = {
        openai: { maxRequestsPerMinute: 30, maxTokensPerMinute: 60000, maxConcurrentRequests: 5 },
        anthropic: { maxRequestsPerMinute: 20, maxTokensPerMinute: 40000, maxConcurrentRequests: 3 },
        google: { maxRequestsPerMinute: 60, maxTokensPerMinute: 60000, maxConcurrentRequests: 10 },
        cohere: { maxRequestsPerMinute: 40, maxTokensPerMinute: 50000, maxConcurrentRequests: 5 },
        mistral: { maxRequestsPerMinute: 30, maxTokensPerMinute: 50000, maxConcurrentRequests: 5 }
    };

    private customConfigs: Map<AIProvider, RateLimitConfig> = new Map();

    constructor() {
        // Initialize buckets for all providers
        Object.keys(this.defaultConfigs).forEach(provider => {
            const config = this.defaultConfigs[provider as AIProvider];
            this.initializeBucket(provider as AIProvider, config);
            this.queues.set(provider as AIProvider, []);
            this.running.set(provider as AIProvider, 0);
        });

        // Start queue processing loop
        this.startQueueProcessor();
    }

    private initializeBucket(provider: AIProvider, config: RateLimitConfig): void {
        const now = Date.now();
        this.buckets.set(provider, {
            tokens: config.maxRequestsPerMinute,
            lastRefill: now,
            maxTokens: config.maxRequestsPerMinute,
            refillRate: config.maxRequestsPerMinute / 60000 // per millisecond
        });
    }

    private startQueueProcessor(): void {
        this.processorInterval = setInterval(() => this.processQueues(), 100);
    }

    shutdown(): void {
        if (this.processorInterval) {
            clearInterval(this.processorInterval);
            this.processorInterval = null;
        }
    }

    private refillBucket(bucket: TokenBucket): void {
        const now = Date.now();
        const elapsed = now - bucket.lastRefill;
        const tokensToAdd = elapsed * bucket.refillRate;
        
        bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;
    }

    private async processQueues(): Promise<void> {
        for (const [provider, queue] of this.queues.entries()) {
            const bucket = this.buckets.get(provider);
            if (!bucket) continue;

            this.refillBucket(bucket);

            const running = this.running.get(provider) || 0;
            const config = this.getConfig(provider);
            const maxConcurrent = config.maxConcurrentRequests || 5;

            // Sort by priority (lower = higher priority) and timestamp
            queue.sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                return a.timestamp - b.timestamp;
            });

            while (
                queue.length > 0 &&
                bucket.tokens >= 1 &&
                running < maxConcurrent
            ) {
                const request = queue.shift();
                if (!request) break;

                bucket.tokens--;
                this.running.set(provider, running + 1);

                this.executeWithRetry(request).finally(() => {
                    const currentRunning = this.running.get(provider) || 0;
                    this.running.set(provider, Math.max(0, currentRunning - 1));
                });
            }
        }
    }

    private async executeWithRetry<T>(request: QueuedRequest<T>): Promise<void> {
        const maxRetries = 3;
        const baseDelay = 1000;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await request.execute();
                request.resolve(result);
                return;
            } catch (error) {
                const isRateLimit = this.isRateLimitError(error);
                
                if (isRateLimit && attempt < maxRetries) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    logger.warn(`Rate limit hit, retrying after ${delay}ms`, {
                        provider: request.provider,
                        attempt: attempt + 1,
                        maxRetries
                    });
                    await this.sleep(delay);
                } else {
                    request.reject(error instanceof Error ? error : new Error(String(error)));
                    return;
                }
            }
        }
    }

    private isRateLimitError(error: unknown): boolean {
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            return message.includes("rate limit") ||
                   message.includes("too many requests") ||
                   message.includes("429");
        }
        return false;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Execute an AI API call with rate limiting and cost tracking
     */
    async execute<T>(
        provider: AIProvider,
        organizationId: number,
        operation: () => Promise<T>,
        options: {
            priority?: number;
            trackCost?: boolean;
            estimatedTokens?: { input: number; output: number };
            model?: string;
        } = {}
    ): Promise<T> {
        const { priority = 5, trackCost = true, estimatedTokens, model } = options;

        return new Promise((resolve, reject) => {
            const request: QueuedRequest<T> = {
                id: this.generateRequestId(),
                resolve,
                reject,
                execute: async () => {
                    const startTime = Date.now();
                    try {
                        const result = await operation();
                        
                        if (trackCost && estimatedTokens && model) {
                            this.trackCost({
                                organizationId,
                                provider,
                                model,
                                inputTokens: estimatedTokens.input,
                                outputTokens: estimatedTokens.output,
                                costUsd: this.calculateCost(provider, model, estimatedTokens),
                                timestamp: new Date()
                            });
                        }

                        return result;
                    } catch (error) {
                        throw error;
                    }
                },
                priority,
                provider,
                organizationId,
                timestamp: Date.now(),
                retryCount: 0
            };

            const queue = this.queues.get(provider);
            if (queue) {
                queue.push(request as QueuedRequest<unknown>);
                
                logger.debug(`Request queued`, {
                    requestId: request.id,
                    provider,
                    organizationId,
                    priority,
                    queueLength: queue.length
                });
            } else {
                reject(new Error(`Unknown provider: ${provider}`));
            }
        });
    }

    /**
     * Track API call cost for organization
     */
    private trackCost(tracking: CostTracking): void {
        this.costHistory.push(tracking);
        
        // Trim history if too large
        if (this.costHistory.length > this.maxHistorySize) {
            this.costHistory = this.costHistory.slice(-this.maxHistorySize / 2);
        }

        logger.debug(`Cost tracked`, {
            organizationId: tracking.organizationId,
            provider: tracking.provider,
            model: tracking.model,
            costUsd: tracking.costUsd.toFixed(4),
            totalTokens: tracking.inputTokens + tracking.outputTokens
        });
    }

    /**
     * Calculate estimated cost based on provider pricing
     */
    private calculateCost(
        provider: AIProvider,
        model: string,
        tokens: { input: number; output: number }
    ): number {
        // Pricing per 1K tokens (approximate, should be updated from config)
        const pricing: Record<string, { input: number; output: number }> = {
            "gpt-4": { input: 0.03, output: 0.06 },
            "gpt-4o": { input: 0.005, output: 0.015 },
            "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
            "text-embedding-ada-002": { input: 0.0001, output: 0 },
            "claude-3-opus": { input: 0.015, output: 0.075 },
            "claude-3-sonnet": { input: 0.003, output: 0.015 },
            "claude-3-haiku": { input: 0.00025, output: 0.00125 },
            "gemini-pro": { input: 0.0005, output: 0.0015 },
            "default": { input: 0.01, output: 0.03 }
        };

        const rates = pricing[model] || pricing["default"];
        const inputCost = (tokens.input / 1000) * rates.input;
        const outputCost = (tokens.output / 1000) * rates.output;
        
        return inputCost + outputCost;
    }

    /**
     * Get cost summary for an organization
     */
    getCostSummary(organizationId: number, since?: Date): {
        totalCostUsd: number;
        totalTokens: number;
        callsByProvider: Record<AIProvider, number>;
    } {
        const cutoff = since || new Date(0);
        
        const relevant = this.costHistory.filter(
            c => c.organizationId === organizationId && c.timestamp >= cutoff
        );

        const totalCostUsd = relevant.reduce((sum, c) => sum + c.costUsd, 0);
        const totalTokens = relevant.reduce(
            (sum, c) => sum + c.inputTokens + c.outputTokens, 
            0
        );

        const callsByProvider = relevant.reduce((acc, c) => {
            acc[c.provider] = (acc[c.provider] || 0) + 1;
            return acc;
        }, {} as Record<AIProvider, number>);

        return { totalCostUsd, totalTokens, callsByProvider };
    }

    /**
     * Get current queue status
     */
    getQueueStatus(): Record<AIProvider, { queueLength: number; running: number; availableTokens: number }> {
        const status = {} as Record<AIProvider, { queueLength: number; running: number; availableTokens: number }>;

        for (const provider of Object.keys(this.defaultConfigs) as AIProvider[]) {
            const bucket = this.buckets.get(provider);
            if (bucket) {
                this.refillBucket(bucket);
                status[provider] = {
                    queueLength: this.queues.get(provider)?.length || 0,
                    running: this.running.get(provider) || 0,
                    availableTokens: Math.floor(bucket.tokens)
                };
            }
        }

        return status;
    }

    /**
     * Update rate limit configuration for a provider
     */
    setConfig(provider: AIProvider, config: Partial<RateLimitConfig>): void {
        const current = this.getConfig(provider);
        const updated = { ...current, ...config };
        this.customConfigs.set(provider, updated);
        this.initializeBucket(provider, updated);
        
        logger.info(`Rate limit config updated`, { provider, config: updated });
    }

    private getConfig(provider: AIProvider): RateLimitConfig {
        return this.customConfigs.get(provider) || this.defaultConfigs[provider];
    }

    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

export const aiRateLimiter = new AIRateLimiter();

/**
 * Convenience wrapper for executing AI calls with rate limiting
 */
export async function withRateLimit<T>(
    provider: AIProvider,
    organizationId: number,
    operation: () => Promise<T>,
    options?: Parameters<AIRateLimiter["execute"]>[3]
): Promise<T> {
    return aiRateLimiter.execute(provider, organizationId, operation, options);
}
