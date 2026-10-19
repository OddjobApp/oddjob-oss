/**
 * Branch Naming Utilities
 * 
 * Deterministic branch naming and mutex key derivation for
 * concurrent ticket isolation. All functions are pure and stateless.
 */

import { createHash } from "node:crypto";

/**
 * Derive a deterministic branch name for a mission run.
 * 
 * Convention: mission/{missionId}/{stepCode}
 * 
 * Properties:
 * - Deterministic: same inputs always produce same output
 * - Non-colliding: missionId is globally unique
 * - Identifiable: mission/ prefix enables safe cleanup filtering
 */
export function deriveBranchName(missionId: number, stepCode: string): string {
    const sanitizedStep = stepCode.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-");
    return `mission/${missionId}/${sanitizedStep}`;
}

/**
 * Check if a branch name follows the mission branch convention.
 * Only branches starting with "mission/" are safe for automated deletion.
 */
export function isMissionBranch(branchName: string): boolean {
    return branchName.startsWith("mission/");
}

/**
 * Derive a deterministic Redis mutex key for a workspace.
 * Scoped by orgId and a hash of the repo URL.
 * 
 * Pattern: mutex:ws:{orgId}:{repoHash12}
 */
export function deriveMutexKey(orgId: number, repoUrl: string): string {
    const hash = createHash("sha256").update(repoUrl).digest("hex").slice(0, 12);
    return `mutex:ws:${orgId}:${hash}`;
}

/**
 * Derive a Redis key for the concurrency semaphore.
 * Pattern: semaphore:repo:{orgId}:{repoHash12}
 */
export function deriveSemaphoreKey(orgId: number, repoUrl: string): string {
    const hash = createHash("sha256").update(repoUrl).digest("hex").slice(0, 12);
    return `semaphore:repo:${orgId}:${hash}`;
}
