import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ResilienceService");

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ResilienceOptions {
    maxFailures?: number;      // Number of consecutive failures before tripping the circuit breaker
    cooldownMs?: number;       // Time in milliseconds to wait before attempting recovery (HALF_OPEN)
}

interface CircuitBreakerState {
    state: CircuitState;
    failures: number;
    lastFailureTime?: number;
}

export class CircuitBreakerOpenError extends Error {
    constructor(operationName: string) {
        super(`Circuit breaker is OPEN for operation: ${operationName}`);
        this.name = "CircuitBreakerOpenError";
    }
}

export class ResilienceService {
    private circuits = new Map<string, CircuitBreakerState>();

    private getOrCreateCircuit(operationName: string): CircuitBreakerState {
        let circuit = this.circuits.get(operationName);
        if (!circuit) {
            circuit = { state: "CLOSED", failures: 0 };
            this.circuits.set(operationName, circuit);
        }
        return circuit;
    }

    /**
     * Executes an arbitrary function with circuit-breaker protection.
     */
    async executeWithResilience<T>(
        operationName: string,
        fn: () => Promise<T>,
        options: ResilienceOptions = {}
    ): Promise<T> {
        const maxFailures = options.maxFailures ?? 5;
        const cooldownMs = options.cooldownMs ?? 10000;

        const circuit = this.getOrCreateCircuit(operationName);

        // 1. If OPEN, check if cooldown has elapsed to transition to HALF_OPEN
        if (circuit.state === "OPEN") {
            const now = Date.now();
            if (circuit.lastFailureTime && now - circuit.lastFailureTime >= cooldownMs) {
                logger.info(`Circuit breaker for '${operationName}' cooldown elapsed. Transitioning to HALF_OPEN.`);
                circuit.state = "HALF_OPEN";
            } else {
                logger.warn(`Execution blocked: Circuit breaker is OPEN for '${operationName}'`);
                throw new CircuitBreakerOpenError(operationName);
            }
        }

        // 2. Execute operation
        try {
            const result = await fn();

            // Success: Reset state on successful execution (CLOSED or HALF_OPEN -> CLOSED)
            if (circuit.state !== "CLOSED") {
                logger.info(`Operation '${operationName}' succeeded. Resetting circuit breaker to CLOSED.`);
            }
            circuit.state = "CLOSED";
            circuit.failures = 0;
            circuit.lastFailureTime = undefined;

            return result;
        } catch (error) {
            // Failure: Record failure and transition states
            circuit.failures++;
            circuit.lastFailureTime = Date.now();

            if (circuit.state === "HALF_OPEN" || circuit.failures >= maxFailures) {
                logger.error(
                    `Circuit breaker for '${operationName}' tripped to OPEN. Failures: ${circuit.failures}/${maxFailures}. Error: ${(error as Error).message}`
                );
                circuit.state = "OPEN";
            } else {
                logger.warn(
                    `Operation '${operationName}' failed. Failures: ${circuit.failures}/${maxFailures}. Error: ${(error as Error).message}`
                );
            }

            throw error;
        }
    }

    /**
     * Resets the circuit breaker state for an operation.
     */
    resetCircuit(operationName: string): void {
        this.circuits.delete(operationName);
        logger.info(`Circuit breaker for '${operationName}' reset manually.`);
    }

    /**
     * Gets the current state of a circuit breaker.
     */
    getCircuitState(operationName: string): CircuitState {
        return this.getOrCreateCircuit(operationName).state;
    }
}

export const resilienceService = new ResilienceService();
