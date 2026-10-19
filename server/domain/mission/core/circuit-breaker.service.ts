/**
 * Circuit Breaker Service
 * 
 * Implements the circuit breaker pattern to prevent cascading failures
 * when external tools fail. Tracks failure rates and automatically
 * opens circuits when thresholds are exceeded.
 */

import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { missionCorrelationService } from "./mission-correlation.service.js";

const logger = createLogger("CircuitBreaker");

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
    failureThreshold: number;      // Failures before opening circuit
    recoveryTimeout: number;       // ms before attempting recovery
    halfOpenMaxCalls: number;      // Max test calls in half-open state
    successThreshold: number;      // Successes needed to close circuit
}

export interface CircuitStats {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number | null;
    lastSuccessTime: number | null;
    totalCalls: number;
    consecutiveSuccesses: number;
    halfOpenCalls: number;
}

export interface ToolCircuit {
    toolName: string;
    config: CircuitBreakerConfig;
    stats: CircuitStats;
    fallbackTool?: string;
}

// Default configuration
const DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeout: 30000,  // 30 seconds
    halfOpenMaxCalls: 3,
    successThreshold: 2,
};

// In-memory circuit storage — capped to prevent unbounded growth from dynamic tool names
const MAX_CIRCUITS = 500;
const circuits = new Map<string, ToolCircuit>();

function evictOldestCircuit() {
    // Map preserves insertion order; shift the oldest entry
    const firstKey = circuits.keys().next().value;
    if (firstKey !== undefined) circuits.delete(firstKey);
}

// Circuit breaker events
interface CircuitEvent {
    type: 'circuit_opened' | 'circuit_closed' | 'circuit_half_opened' | 'call_rejected';
    toolName: string;
    correlationId?: string;
    timestamp: Date;
    details?: Record<string, any>;
}

export const circuitBreakerService = {
    /**
     * Get or create circuit breaker for a tool
     */
    getCircuit(toolName: string, customConfig?: Partial<CircuitBreakerConfig>): ToolCircuit {
        if (!circuits.has(toolName)) {
            if (circuits.size >= MAX_CIRCUITS) evictOldestCircuit();
            circuits.set(toolName, {
                toolName,
                config: { ...DEFAULT_CONFIG, ...customConfig },
                stats: {
                    state: 'closed',
                    failures: 0,
                    successes: 0,
                    lastFailureTime: null,
                    lastSuccessTime: null,
                    totalCalls: 0,
                    consecutiveSuccesses: 0,
                    halfOpenCalls: 0,
                },
            });
        }
        return circuits.get(toolName)!;
    },

    /**
     * Check if a call should be allowed through the circuit
     */
    canExecute(toolName: string): { allowed: boolean; reason?: string; state: CircuitState } {
        const circuit = this.getCircuit(toolName);
        const now = Date.now();

        // Check if we should transition from open to half-open
        if (circuit.stats.state === 'open') {
            const timeSinceLastFailure = now - (circuit.stats.lastFailureTime || 0);
            
            if (timeSinceLastFailure >= circuit.config.recoveryTimeout) {
                // Transition to half-open
                circuit.stats.state = 'half-open';
                circuit.stats.halfOpenCalls = 0;
                circuit.stats.consecutiveSuccesses = 0;
                
                this.emitEvent({
                    type: 'circuit_half_opened',
                    toolName,
                    timestamp: new Date(),
                });
                
                logger.info(`[CircuitBreaker] ${toolName} transitioned to half-open`);
            } else {
                return {
                    allowed: false,
                    reason: `Circuit open. Retry after ${Math.ceil((circuit.config.recoveryTimeout - timeSinceLastFailure) / 1000)}s`,
                    state: 'open',
                };
            }
        }

        // In half-open state, limit the number of test calls
        if (circuit.stats.state === 'half-open') {
            if (circuit.stats.halfOpenCalls >= circuit.config.halfOpenMaxCalls) {
                return {
                    allowed: false,
                    reason: 'Half-open call limit reached',
                    state: 'half-open',
                };
            }
            circuit.stats.halfOpenCalls++;
        }

        return { allowed: true, state: circuit.stats.state };
    },

    /**
     * Record a successful call
     */
    recordSuccess(toolName: string): void {
        const circuit = this.getCircuit(toolName);
        
        circuit.stats.successes++;
        circuit.stats.totalCalls++;
        circuit.stats.lastSuccessTime = Date.now();
        circuit.stats.consecutiveSuccesses++;

        // In half-open state, check if we can close the circuit
        if (circuit.stats.state === 'half-open') {
            if (circuit.stats.consecutiveSuccesses >= circuit.config.successThreshold) {
                this.closeCircuit(toolName);
            }
        }

        // Reset failures in closed state after consecutive successes
        if (circuit.stats.state === 'closed' && circuit.stats.consecutiveSuccesses >= 3) {
            circuit.stats.failures = 0;
        }
    },

    /**
     * Record a failed call
     */
    recordFailure(toolName: string, error: Error): void {
        const circuit = this.getCircuit(toolName);
        
        circuit.stats.failures++;
        circuit.stats.totalCalls++;
        circuit.stats.lastFailureTime = Date.now();
        circuit.stats.consecutiveSuccesses = 0;

        // In half-open state, any failure re-opens the circuit
        if (circuit.stats.state === 'half-open') {
            this.openCircuit(toolName, `Failure in half-open state: ${error.message}`);
            return;
        }

        // In closed state, check if we should open
        if (circuit.stats.state === 'closed') {
            if (circuit.stats.failures >= circuit.config.failureThreshold) {
                this.openCircuit(toolName, `Failure threshold (${circuit.config.failureThreshold}) exceeded`);
            }
        }
    },

    /**
     * Execute a function with circuit breaker protection
     */
    async execute<T>(
        toolName: string,
        fn: () => Promise<T>,
        options: {
            fallback?: () => Promise<T>;
            fallbackValue?: T;
            onFallback?: (error: Error) => void;
        } = {}
    ): Promise<T> {
        const check = this.canExecute(toolName);
        
        if (!check.allowed) {
            // Try fallback if provided
            if (options.fallback) {
                logger.info(`[CircuitBreaker] ${toolName} circuit ${check.state}, using fallback`);
                try {
                    return await options.fallback();
                } catch (fallbackError: any) {
                    logger.error(`[CircuitBreaker] Fallback also failed for ${toolName}: ${fallbackError.message}`);
                    throw new CircuitBreakerError(
                        `Circuit open for ${toolName} and fallback failed: ${fallbackError.message}`,
                        check.state,
                        toolName
                    );
                }
            }

            // Return fallback value if provided
            if (options.fallbackValue !== undefined) {
                logger.info(`[CircuitBreaker] ${toolName} circuit ${check.state}, returning fallback value`);
                return options.fallbackValue;
            }

            // Emit rejection event
            this.emitEvent({
                type: 'call_rejected',
                toolName,
                timestamp: new Date(),
                details: { reason: check.reason, state: check.state },
            });

            throw new CircuitBreakerError(
                check.reason || `Circuit ${check.state} for ${toolName}`,
                check.state,
                toolName
            );
        }

        // Execute the call
        try {
            const result = await fn();
            this.recordSuccess(toolName);
            return result;
        } catch (error: any) {
            this.recordFailure(toolName, error);
            throw error;
        }
    },

    /**
     * Manually open a circuit
     */
    openCircuit(toolName: string, reason: string): void {
        const circuit = this.getCircuit(toolName);
        
        if (circuit.stats.state !== 'open') {
            circuit.stats.state = 'open';
            circuit.stats.lastFailureTime = Date.now();
            
            logger.warn(`[CircuitBreaker] ${toolName} circuit OPENED: ${reason}`);
            
            this.emitEvent({
                type: 'circuit_opened',
                toolName,
                timestamp: new Date(),
                details: { reason, failures: circuit.stats.failures },
            });
        }
    },

    /**
     * Manually close a circuit
     */
    closeCircuit(toolName: string): void {
        const circuit = this.getCircuit(toolName);
        
        circuit.stats.state = 'closed';
        circuit.stats.failures = 0;
        circuit.stats.halfOpenCalls = 0;
        circuit.stats.consecutiveSuccesses = 0;
        
        logger.info(`[CircuitBreaker] ${toolName} circuit CLOSED`);
        
        this.emitEvent({
            type: 'circuit_closed',
            toolName,
            timestamp: new Date(),
        });
    },

    /**
     * Get circuit statistics
     */
    getStats(toolName?: string): Record<string, CircuitStats> | CircuitStats | null {
        if (toolName) {
            const circuit = circuits.get(toolName);
            return circuit ? { ...circuit.stats } : null;
        }
        
        const allStats: Record<string, CircuitStats> = {};
        circuits.forEach((circuit, name) => {
            allStats[name] = { ...circuit.stats };
        });
        return allStats;
    },

    /**
     * Get all circuit states
     */
    getAllCircuits(): Array<{ toolName: string; state: CircuitState; stats: CircuitStats }> {
        return Array.from(circuits.entries()).map(([toolName, circuit]) => ({
            toolName,
            state: circuit.stats.state,
            stats: { ...circuit.stats },
        }));
    },

    /**
     * Reset a specific circuit or all circuits
     */
    reset(toolName?: string): void {
        if (toolName) {
            circuits.delete(toolName);
            logger.info(`[CircuitBreaker] Reset circuit for ${toolName}`);
        } else {
            circuits.clear();
            logger.info(`[CircuitBreaker] Reset all circuits`);
        }
    },

    /**
     * Update circuit configuration
     */
    configure(toolName: string, config: Partial<CircuitBreakerConfig>): void {
        const circuit = this.getCircuit(toolName);
        circuit.config = { ...circuit.config, ...config };
        logger.info(`[CircuitBreaker] Updated config for ${toolName}`, config);
    },

    /**
     * Get recommended fallback tool
     */
    getFallbackTool(toolName: string): string | undefined {
        const circuit = circuits.get(toolName);
        return circuit?.fallbackTool;
    },

    /**
     * Set fallback tool for a circuit
     */
    setFallbackTool(toolName: string, fallbackTool: string): void {
        const circuit = this.getCircuit(toolName);
        circuit.fallbackTool = fallbackTool;
    },

    /**
     * Check if any circuits are open
     */
    hasOpenCircuits(): boolean {
        return Array.from(circuits.values()).some(c => c.stats.state === 'open');
    },

    /**
     * Get summary of all circuit states
     */
    getSummary(): { total: number; closed: number; open: number; halfOpen: number } {
        const summary = { total: 0, closed: 0, open: 0, halfOpen: 0 };
        
        circuits.forEach(circuit => {
            summary.total++;
            if (circuit.stats.state === 'half-open') {
                summary.halfOpen++;
            } else {
                summary[circuit.stats.state]++;
            }
        });
        
        return summary;
    },

    /**
     * Emit circuit breaker event
     */
    emitEvent(event: CircuitEvent): void {
        const correlationId = missionCorrelationService.getCorrelationId();
        
        eventStream.publish(
            `circuit_breaker.${event.type}`,
            {
                toolName: event.toolName,
                correlationId,
                timestamp: event.timestamp.toISOString(),
                details: event.details,
            },
            {
                correlationId,
                subject: `tool:${event.toolName}`,
            },
            'circuit-breaker'
        ).catch((err: any) => {
            logger.error(`[CircuitBreaker] Failed to emit event: ${err}`);
        });
    },
};

/**
 * Circuit Breaker Error
 */
export class CircuitBreakerError extends Error {
    constructor(
        message: string,
        public readonly state: CircuitState,
        public readonly toolName: string
    ) {
        super(message);
        this.name = 'CircuitBreakerError';
    }
}

/**
 * Decorator for protecting tool calls with circuit breaker
 */
export function withCircuitBreaker(
    toolName: string,
    options: {
        fallback?: () => Promise<any>;
        fallbackValue?: any;
    } = {}
) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;
        
        descriptor.value = async function (...args: any[]) {
            return circuitBreakerService.execute(
                toolName,
                () => originalMethod.apply(this, args),
                options
            );
        };
        
        return descriptor;
    };
}
