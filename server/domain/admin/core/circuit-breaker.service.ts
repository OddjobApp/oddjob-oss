/**
 * Re-export shim.
 *
 * The implementation moved to domain/core/infrastructure/circuit-breaker.service.ts.
 * This file used to hold a second, independent copy: same seven exported names,
 * same signatures, its own module-level `circuits` map. The tool executor and
 * MCP client registered their breakers in the other map, so getAllCircuitStatuses()
 * here - the source for the admin infra-health surface - never saw them.
 *
 * Kept as a shim rather than deleted because several call sites and an
 * integration suite import from this path; they now share one map with
 * everything else.
 */
export {
    createCircuitBreaker,
    getCircuitState,
    withCircuitBreaker,
    withResilience,
    resetCircuit,
    getAllCircuitStatuses,
    initializeCircuits,
    CircuitOpenError,
    circuitBreakerService,
} from "@domain/core/infrastructure/circuit-breaker.service.js";

export type {
    CircuitBreakerConfig,
    CircuitState,
    CircuitStats,
    ResilienceConfig,
} from "@domain/core/infrastructure/circuit-breaker.service.js";
