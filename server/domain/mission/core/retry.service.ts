/**
 * Mission Retry Service
 * 
 * Implements automatic retry with exponential backoff for transient failures.
 * Integrates with circuit breaker to prevent retry storms.
 */

import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { missionCorrelationService } from "./mission-correlation.service.js";
import { circuitBreakerService, CircuitBreakerError } from "./circuit-breaker.service.js";

const logger = createLogger("MissionRetry");

export interface RetryConfig {
    maxAttempts: number;           // Maximum retry attempts
    baseDelay: number;           // Initial delay in ms
    maxDelay: number;            // Maximum delay cap
    backoffMultiplier: number;   // Exponential factor
    jitter: boolean;             // Add random jitter
    retryableErrors: string[];    // Error patterns to retry
    nonRetryableErrors: string[]; // Error patterns to not retry
}

export interface RetryContext {
    attempt: number;
    startTime: number;
    lastError?: Error;
    delays: number[];
    correlationId: string;
}

export interface RetryResult<T> {
    success: boolean;
    result?: T;
    error?: Error;
    attempts: number;
    totalTime: number;
    retried: boolean;
}

export interface DeadLetterEntry {
    id: string;
    toolName: string;
    args: any;
    error: string;
    attempts: number;
    timestamp: Date;
    correlationId: string;
    missionRunId?: number;
}

// Default configuration
const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
    retryableErrors: [
        'ETIMEDOUT',
        'ECONNREFUSED',
        'ENOTFOUND',
        'EAI_AGAIN',
        'timeout',
        'rate limit',
        'too many requests',
        'temporarily unavailable',
    ],
    nonRetryableErrors: [
        'ENOTRETRYABLE',
        'PERMISSION_DENIED',
        'INVALID_ARGUMENT',
    ],
};

// In-memory dead letter queue — capped to prevent unbounded growth
const MAX_DEAD_LETTER_SIZE = 500;
const deadLetterQueue: DeadLetterEntry[] = [];

// Active retry contexts
const retryContexts = new Map<string, RetryContext>();

export const missionRetryService = {
    /**
     * Execute a function with automatic retry
     */
    async execute<T>(
        toolName: string,
        fn: () => Promise<T>,
        config: Partial<RetryConfig> = {},
        context: {
            missionRunId?: number;
            operationId?: string;
        } = {}
    ): Promise<RetryResult<T>> {
        const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
        const operationId = context.operationId || `${toolName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const correlationId = missionCorrelationService.getCorrelationId();
        const startTime = Date.now();
        
        const retryContext: RetryContext = {
            attempt: 0,
            startTime,
            delays: [],
            correlationId,
        };
        
        retryContexts.set(operationId, retryContext);
        
        logger.info(`[Retry] Starting execution for ${toolName}`, {
            operationId,
            correlationId,
            maxAttempts: fullConfig.maxAttempts,
        });
        
        let lastError: Error | undefined;
        
        for (let attempt = 1; attempt <= fullConfig.maxAttempts; attempt++) {
            retryContext.attempt = attempt;
            
            try {
                // Check circuit breaker before attempt
                const circuitCheck = circuitBreakerService.canExecute(toolName);
                if (!circuitCheck.allowed && attempt > 1) {
                    // Circuit opened during retry - fail fast
                    logger.warn(`[Retry] Circuit open for ${toolName}, aborting retry`);
                    throw new CircuitBreakerError(
                        `Circuit open for ${toolName}`,
                        circuitCheck.state,
                        toolName
                    );
                }
                
                const result = await fn();
                
                // Success - record in circuit breaker
                circuitBreakerService.recordSuccess(toolName);
                
                const totalTime = Date.now() - startTime;
                
                if (attempt > 1) {
                    this.emitEvent('retry_success', {
                        toolName,
                        operationId,
                        attempts: attempt,
                        totalTime,
                        correlationId,
                    });
                }
                
                retryContexts.delete(operationId);
                
                return {
                    success: true,
                    result,
                    attempts: attempt,
                    totalTime,
                    retried: attempt > 1,
                };
                
            } catch (error: any) {
                lastError = error;
                retryContext.lastError = error;
                
                // Check if error is retryable
                if (!this.isRetryable(error, fullConfig)) {
                    logger.info(`[Retry] Non-retryable error for ${toolName}: ${error.message}`);
                    break;
                }
                
                // Record failure in circuit breaker
                if (attempt === 1) {
                    // Only record first failure to avoid double-counting
                    circuitBreakerService.recordFailure(toolName, error);
                }
                
                // Check if we should retry
                if (attempt >= fullConfig.maxAttempts) {
                    logger.warn(`[Retry] Max attempts reached for ${toolName}`);
                    break;
                }
                
                // Calculate delay with exponential backoff
                const delay = this.calculateDelay(attempt, fullConfig);
                retryContext.delays.push(delay);
                
                logger.info(`[Retry] Attempt ${attempt} failed for ${toolName}, waiting ${delay}ms`, {
                    error: error.message,
                    nextAttempt: attempt + 1,
                });
                
                this.emitEvent('retry_attempt', {
                    toolName,
                    operationId,
                    attempt,
                    delay,
                    error: error.message,
                    correlationId,
                });
                
                // Wait before next attempt
                await this.sleep(delay);
            }
        }
        
        // All retries exhausted - add to dead letter queue
        const totalTime = Date.now() - startTime;
        
        this.addToDeadLetter({
            toolName,
            args: {}, // Could capture args if needed
            error: lastError?.message || 'Unknown error',
            attempts: retryContext.attempt,
            timestamp: new Date(),
            correlationId,
            missionRunId: context.missionRunId,
        });
        
        this.emitEvent('retry_exhausted', {
            toolName,
            operationId,
            attempts: retryContext.attempt,
            totalTime,
            error: lastError?.message,
            correlationId,
        });
        
        retryContexts.delete(operationId);
        
        return {
            success: false,
            error: lastError,
            attempts: retryContext.attempt,
            totalTime,
            retried: retryContext.attempt > 1,
        };
    },

    /**
     * Quick retry with default settings
     */
    async retry<T>(
        fn: () => Promise<T>,
        options: {
            attempts?: number;
            delay?: number;
            onRetry?: (attempt: number, error: Error) => void;
        } = {}
    ): Promise<T> {
        const maxAttempts = options.attempts || 3;
        const baseDelay = options.delay || 1000;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                if (attempt >= maxAttempts) {
                    throw error;
                }
                
                if (options.onRetry) {
                    options.onRetry(attempt, error);
                }
                
                const delay = baseDelay * Math.pow(2, attempt - 1);
                await this.sleep(delay);
            }
        }
        
        throw new Error('Retry loop exited unexpectedly');
    },

    /**
     * Check if an error is retryable
     */
    isRetryable(error: Error, config: RetryConfig): boolean {
        const errorMessage = error.message.toLowerCase();
        const errorName = error.name.toLowerCase();
        
        // Check non-retryable patterns first
        for (const pattern of config.nonRetryableErrors) {
            if (errorMessage.includes(pattern.toLowerCase()) ||
                errorName.includes(pattern.toLowerCase())) {
                return false;
            }
        }
        
        // Check retryable patterns
        for (const pattern of config.retryableErrors) {
            if (errorMessage.includes(pattern.toLowerCase()) ||
                errorName.includes(pattern.toLowerCase())) {
                return true;
            }
        }
        
        // Default: retry network/timeout errors
        if (errorMessage.includes('network') ||
            errorMessage.includes('timeout') ||
            errorMessage.includes('connection') ||
            errorName.includes('timeout')) {
            return true;
        }
        
        // Don't retry by default for other errors
        return false;
    },

    /**
     * Calculate delay with exponential backoff and jitter
     */
    calculateDelay(attempt: number, config: RetryConfig): number {
        // Exponential backoff: baseDelay * 2^(attempt-1)
        const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
        
        // Cap at maxDelay
        const cappedDelay = Math.min(exponentialDelay, config.maxDelay);
        
        // Add jitter (±25%) to prevent thundering herd
        if (config.jitter) {
            const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
            return Math.max(0, cappedDelay + jitter);
        }
        
        return cappedDelay;
    },

    /**
     * Add entry to dead letter queue
     */
    addToDeadLetter(entry: Omit<DeadLetterEntry, 'id'>): DeadLetterEntry {
        const fullEntry: DeadLetterEntry = {
            ...entry,
            id: `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        };
        
        deadLetterQueue.push(fullEntry);
        
        if (deadLetterQueue.length > MAX_DEAD_LETTER_SIZE) {
            deadLetterQueue.shift();
        }
        
        logger.warn(`[Retry] Added to dead letter queue: ${fullEntry.id}`, {
            toolName: entry.toolName,
            attempts: entry.attempts,
        });
        
        this.emitEvent('dead_letter_added', {
            id: fullEntry.id,
            toolName: entry.toolName,
            correlationId: entry.correlationId,
        });
        
        return fullEntry;
    },

    /**
     * Get dead letter queue
     */
    getDeadLetterQueue(options: {
        toolName?: string;
        limit?: number;
        since?: Date;
    } = {}): DeadLetterEntry[] {
        let filtered = [...deadLetterQueue];
        
        if (options.toolName) {
            filtered = filtered.filter(e => e.toolName === options.toolName);
        }
        
        if (options.since) {
            filtered = filtered.filter(e => e.timestamp >= options.since!);
        }
        
        // Sort by timestamp descending
        filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        
        if (options.limit) {
            filtered = filtered.slice(0, options.limit);
        }
        
        return filtered;
    },

    /**
     * Remove from dead letter queue
     */
    removeFromDeadLetter(id: string): boolean {
        const index = deadLetterQueue.findIndex(e => e.id === id);
        if (index === -1) return false;
        
        deadLetterQueue.splice(index, 1);
        return true;
    },

    /**
     * Replay dead letter entry
     */
    async replayDeadLetter<T>(
        id: string,
        fn: () => Promise<T>,
        config: Partial<RetryConfig> = {}
    ): Promise<RetryResult<T> | null> {
        const entry = deadLetterQueue.find(e => e.id === id);
        if (!entry) return null;
        
        // Remove from DLQ
        this.removeFromDeadLetter(id);
        
        // Retry with fresh context
        return this.execute(entry.toolName, fn, config, {
            missionRunId: entry.missionRunId,
        });
    },

    /**
     * Get retry statistics
     */
    getStats(): {
        activeRetries: number;
        deadLetterCount: number;
        deadLetterByTool: Record<string, number>;
    } {
        const deadLetterByTool: Record<string, number> = {};
        
        for (const entry of deadLetterQueue) {
            deadLetterByTool[entry.toolName] = (deadLetterByTool[entry.toolName] || 0) + 1;
        }
        
        return {
            activeRetries: retryContexts.size,
            deadLetterCount: deadLetterQueue.length,
            deadLetterByTool,
        };
    },

    /**
     * Get retry context for operation
     */
    getRetryContext(operationId: string): RetryContext | undefined {
        return retryContexts.get(operationId);
    },

    /**
     * Clear all retry contexts (for testing)
     */
    clearContexts(): void {
        retryContexts.clear();
    },

    /**
     * Clear dead letter queue (for testing)
     */
    clearDeadLetterQueue(): void {
        deadLetterQueue.length = 0;
    },

    // Private helpers
    sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    emitEvent(type: string, data: Record<string, any>): void {
        const correlationId = missionCorrelationService.getCorrelationId();
        
        eventStream.publish(
            `mission_retry.${type}`,
            {
                ...data,
                timestamp: new Date().toISOString(),
            },
            {
                correlationId,
                subject: data.toolName ? `tool:${data.toolName}` : 'retry:system',
            },
            'mission-retry'
        ).catch((err: any) => {
            logger.error(`[Retry] Failed to emit event: ${err}`);
        });
    },
};

/**
 * Decorator for adding retry to methods
 */
export function withRetry(config: Partial<RetryConfig> = {}) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;
        
        descriptor.value = async function (...args: any[]) {
            const toolName = `${target.constructor.name}.${propertyKey}`;
            
            const retryResult = await missionRetryService.execute(
                toolName,
                () => originalMethod.apply(this, args),
                config
            );
            
            if (!retryResult.success && retryResult.error) {
                throw retryResult.error;
            }
            
            return retryResult.result;
        };
        
        return descriptor;
    };
}
