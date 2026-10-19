/**
 * Circuit breakers - the single implementation.
 *
 * There were three: this module (in-memory only), an admin copy with Redis
 * persistence and an `isFailure` predicate, and a per-tool variant under
 * domain/mission/core. The first two exported the same seven names with the
 * same signatures over two separate `circuits` maps, so callers were split
 * down the middle: the tool executor and the MCP client registered breakers
 * here, while getAllCircuitStatuses() - what the admin infra-health surface
 * reads - iterated the other map and could not see them at all.
 *
 * This module is now the one implementation; domain/admin/core re-exports it.
 * The mission variant is deliberately left alone - it is a different
 * abstraction (per-tool circuits with fallback-tool routing and event
 * emission), not another copy of this one.
 */
import { createLogger } from "@server/utils/logger.js";
import { retryService } from "../retry-service.js";
import { nodeRedisClient as redis } from "./redis/redis-client.js";

const CIRCUIT_REDIS_PREFIX = "circuit:open:";
const CIRCUIT_REDIS_INDEX = "circuit:open:index"; // Set of currently-open circuit names
const CIRCUIT_REDIS_TTL = 3600; // 1 hour max — circuits auto-recover anyway

const logger = createLogger("CircuitBreaker");

export interface CircuitBreakerConfig {
    name: string;
    failureThreshold: number;      // Number of failures before opening
    resetTimeoutMs: number;        // Time to wait before testing again
    halfOpenMaxAttempts: number;   // Requests to allow in half-open state
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitStats {
    failures: number;
    successes: number;
    lastFailure: Date | null;
    state: CircuitState;
    halfOpenAttempts: number;
}

const DEFAULT_CONFIG: Partial<CircuitBreakerConfig> = {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    halfOpenMaxAttempts: 3,
};

// Store circuit breaker states
const circuits = new Map<string, CircuitStats>();
const configs = new Map<string, CircuitBreakerConfig>();

function persistOpenState(name: string, stats: CircuitStats): void {
    if (!redis) return;
    const payload = JSON.stringify({ failures: stats.failures, lastFailure: stats.lastFailure });
    Promise.all([
        redis.set(`${CIRCUIT_REDIS_PREFIX}${name}`, payload, "EX", CIRCUIT_REDIS_TTL),
        redis.sadd(CIRCUIT_REDIS_INDEX, name),
    ]).catch((err: any) => logger.warn(`Failed to persist circuit state for ${name}: ${err.message}`));
}

function clearPersistedState(name: string): void {
    if (!redis) return;
    Promise.all([
        redis.del(`${CIRCUIT_REDIS_PREFIX}${name}`),
        redis.srem(CIRCUIT_REDIS_INDEX, name),
    ]).catch((err: any) => logger.warn(`Failed to clear persisted circuit state for ${name}: ${err.message}`));
}

/**
 * Create a new circuit breaker
 */
export function createCircuitBreaker(config: CircuitBreakerConfig): void {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    configs.set(config.name, fullConfig as CircuitBreakerConfig);
    circuits.set(config.name, {
        failures: 0,
        successes: 0,
        lastFailure: null,
        state: "CLOSED",
        halfOpenAttempts: 0,
    });
    logger.info(`Circuit breaker created: ${config.name}`, fullConfig);
}

/**
 * Get current circuit state
 */
export function getCircuitState(name: string): CircuitStats | undefined {
    return circuits.get(name);
}

/**
 * Execute a function with circuit breaker protection.
 *
 * `isFailure` lets a resolved result still count as a failure, for providers
 * that signal errors in the payload rather than by throwing.
 */
export async function withCircuitBreaker<T>(
    name: string,
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>,
    isFailure?: (result: T) => boolean
): Promise<T> {
    let stats = circuits.get(name);
    const config = configs.get(name);

    // Auto-create circuit if not exists
    if (!stats) {
        createCircuitBreaker({ name, ...DEFAULT_CONFIG } as CircuitBreakerConfig);
        stats = circuits.get(name)!;
    }

    // Check if circuit should transition from OPEN to HALF_OPEN
    if (stats.state === "OPEN" && stats.lastFailure && config) {
        const timeSinceFailure = Date.now() - stats.lastFailure.getTime();
        if (timeSinceFailure >= config.resetTimeoutMs) {
            stats.state = "HALF_OPEN";
            stats.halfOpenAttempts = 0;
            logger.info(`Circuit ${name} transitioning to HALF_OPEN`);
        }
    }

    // Block request if circuit is OPEN
    if (stats.state === "OPEN") {
        logger.warn(`Circuit ${name} is OPEN, blocking request`);
        if (fallback) {
            return fallback();
        }
        throw new CircuitOpenError(name);
    }

    // In HALF_OPEN, limit attempts
    if (stats.state === "HALF_OPEN" && config) {
        if (stats.halfOpenAttempts >= config.halfOpenMaxAttempts) {
            logger.warn(`Circuit ${name} HALF_OPEN max attempts reached`);
            if (fallback) {
                return fallback();
            }
            throw new CircuitOpenError(name);
        }
        stats.halfOpenAttempts++;
    }

    try {
        const result = await fn();
        if (isFailure && isFailure(result)) {
            stats.failures++;
            stats.lastFailure = new Date();
            if (config && stats.failures >= config.failureThreshold) {
                stats.state = "OPEN";
                persistOpenState(name, stats);
                logger.error(`Circuit ${name} opened after ${stats.failures} failures (custom predicate)`);
            }
            if (stats.state === "HALF_OPEN") {
                stats.state = "OPEN";
                persistOpenState(name, stats);
                logger.error(`Circuit ${name} reopened due to failure in HALF_OPEN`);
            }
            return result;
        }
        // Success - reset circuit
        if (stats.state === "HALF_OPEN") {
            stats.state = "CLOSED";
            clearPersistedState(name);
            logger.info(`Circuit ${name} recovered, transitioning to CLOSED`);
        }
        stats.failures = 0;
        stats.successes++;

        return result;
    } catch (error) {
        stats.failures++;
        stats.lastFailure = new Date();

        // Check if we should open the circuit
        if (config && stats.failures >= config.failureThreshold) {
            stats.state = "OPEN";
            persistOpenState(name, stats);
            logger.error(`Circuit ${name} opened after ${stats.failures} failures`);
        }
        throw error;
    }
}

export interface ResilienceConfig {
    circuitName: string;
    retryConfig?: {
        maxRetries: number;
        backoffMs: number;
        backoffMultiplier: number;
    };
    circuitConfig?: Partial<CircuitBreakerConfig>;
}

/**
 * Execute a function wrapping it in both a circuit breaker and retry logic
 */
export async function withResilience<T>(
    config: ResilienceConfig,
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>
): Promise<T> {
    // If circuit breaker config is provided, ensure it exists
    if (config.circuitConfig) {
        createCircuitBreaker({
            name: config.circuitName,
            ...DEFAULT_CONFIG,
            ...config.circuitConfig
        } as CircuitBreakerConfig);
    }

    return withCircuitBreaker(
        config.circuitName,
        async () => {
            if (config.retryConfig) {
                return retryService.executeWithRetry(fn, config.retryConfig);
            }
            return fn();
        },
        fallback
    );
}

/**
 * Manually reset a circuit breaker
 */
export function resetCircuit(name: string): void {
    const stats = circuits.get(name);
    if (stats) {
        stats.state = "CLOSED";
        stats.failures = 0;
        stats.successes = 0;
        stats.lastFailure = null;
        stats.halfOpenAttempts = 0;
        clearPersistedState(name);
        logger.info(`Circuit ${name} manually reset`);
    }
}

/**
 * Get all circuit breaker statuses
 */
export function getAllCircuitStatuses(): Record<string, CircuitStats> {
    const result: Record<string, CircuitStats> = {};
    circuits.forEach((stats, name) => {
        result[name] = { ...stats };
    });
    return result;
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
    constructor(public circuitName: string) {
        super(`Circuit breaker '${circuitName}' is open`);
        this.name = "CircuitOpenError";
    }
}

async function loadPersistedCircuitStates(): Promise<void> {
    if (!redis) return;
    try {
        // smembers is O(N) on the set size (number of open circuits, typically 0–4)
        const openNames = await redis.smembers(CIRCUIT_REDIS_INDEX);
        for (const name of openNames) {
            const raw = await redis.get(`${CIRCUIT_REDIS_PREFIX}${name}`);
            if (!raw) {
                // Key expired but set entry lingered — clean up
                redis.srem(CIRCUIT_REDIS_INDEX, name).catch(() => {});
                continue;
            }
            const { failures, lastFailure } = JSON.parse(raw);
            const stats = circuits.get(name);
            if (stats) {
                stats.state = "OPEN";
                stats.failures = failures ?? 1;
                stats.lastFailure = lastFailure ? new Date(lastFailure) : new Date();
                logger.warn(`Circuit ${name} restored to OPEN from Redis on startup`);
            }
        }
    } catch (err: any) {
        logger.warn(`Failed to load persisted circuit states: ${err.message}`);
    }
}

/**
 * Registers the tuned per-provider circuits and restores any that were open
 * when the process last stopped.
 *
 * This must be awaited during boot. It never was - both former copies exported
 * it and neither had a caller - so loadPersistedCircuitStates() never ran (the
 * Redis writes were write-only; state survived neither a restart nor a hop
 * between the server and the worker fleet), and every breaker was instead
 * lazily created by withCircuitBreaker from DEFAULT_CONFIG, so the thresholds
 * below were never the ones in force.
 */
// ============================================================================
// PRE-CONFIGURED CIRCUITS FOR COMMON SERVICES
// ============================================================================

export async function initializeCircuits(): Promise<void> {
    createCircuitBreaker({
        name: "openai",
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        halfOpenMaxAttempts: 2,
    });
    createCircuitBreaker({
        name: "gemini",
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        halfOpenMaxAttempts: 2,
    });
    createCircuitBreaker({
        name: "qdrant",
        failureThreshold: 3,
        resetTimeoutMs: 30000,
        halfOpenMaxAttempts: 3,
    });
    createCircuitBreaker({
        name: "external_api",
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenMaxAttempts: 3,
    });
    await loadPersistedCircuitStates();
    logger.info("Circuit breakers initialized and persisted states restored");
}

export const circuitBreakerService = {
    createCircuitBreaker,
    getCircuitState,
    withCircuitBreaker,
    withResilience,
    resetCircuit,
    getAllCircuitStatuses,
    initializeCircuits,
};


