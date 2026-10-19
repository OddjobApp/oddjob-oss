/**
 * Embed Profile Circuit Breaker
 * Per-deployment failure tracking. After N consecutive failures, stops calling
 * the profile API for T seconds to avoid cascading failures.
 */

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_SECONDS = 60;

interface DeploymentState {
    failureCount: number;
    lastFailureAt: number;
    openUntil: number;
}

const stateByDeployment = new Map<number, DeploymentState>();

export function isOpen(
    deploymentId: number,
    options?: { failureThreshold?: number; cooldownSeconds?: number }
): boolean {
    const threshold = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    const cooldown = options?.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;

    const state = stateByDeployment.get(deploymentId);
    if (!state) return false;

    const now = Date.now();
    if (state.failureCount < threshold) return false;
    if (now < state.openUntil) return true;

    // Cooldown expired; reset
    stateByDeployment.delete(deploymentId);
    return false;
}

export function recordSuccess(deploymentId: number): void {
    stateByDeployment.delete(deploymentId);
}

export function recordFailure(
    deploymentId: number,
    options?: { failureThreshold?: number; cooldownSeconds?: number }
): void {
    const threshold = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    const cooldown = options?.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;

    let state = stateByDeployment.get(deploymentId);
    if (!state) {
        state = { failureCount: 0, lastFailureAt: 0, openUntil: 0 };
        stateByDeployment.set(deploymentId, state);
    }

    state.failureCount += 1;
    state.lastFailureAt = Date.now();

    if (state.failureCount >= threshold) {
        state.openUntil = state.lastFailureAt + cooldown * 1000;
    }
}


