/**
 * Branch Cleanup Service
 * 
 * Handles post-merge branch deletion and periodic orphan cleanup
 * for concurrent ticket isolation. Ensures repositories don't accumulate
 * hundreds of stale mission branches.
 */

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { missions } from "@shared/schema/index.js";
import { eq, sql, and, isNull } from "drizzle-orm";
import { isMissionBranch } from "./branch-naming.js";
import { CleanupPolicy } from "./vcs-config.types.js";

const execFile = promisify(execFileCallback);
const logger = createLogger("BranchCleanup");

export interface CleanupResult {
    deleted: boolean;
    branchName: string;
    deletedAt?: string;
    error?: string;
    retryCount: number;
}

export const branchCleanupService = {
    /**
     * Delete a mission branch after successful merge.
     * Respects the cleanup policy: immediate, retain_24h, or manual.
     */
    async deleteAfterMerge(
        workspacePath: string,
        branchName: string,
        policy: CleanupPolicy
    ): Promise<CleanupResult> {
        // Safety guard: never delete non-mission branches
        if (!this.isSafeToDelete(branchName)) {
            return { deleted: false, branchName, error: "Branch does not match mission/ prefix — skipping", retryCount: 0 };
        }

        if (policy === "manual") {
            logger.info(`[BranchCleanup] Manual cleanup policy — skipping deletion of ${branchName}`);
            return { deleted: false, branchName, error: "Manual cleanup policy", retryCount: 0 };
        }

        if (policy === "retain_24h") {
            // Schedule for later — in production this would use a delayed queue
            // For now, log and skip (the orphan cleanup will catch it after 24h)
            logger.info(`[BranchCleanup] Retain 24h policy — ${branchName} will be cleaned by orphan job`);
            return { deleted: false, branchName, error: "Scheduled for 24h retention", retryCount: 0 };
        }

        // Immediate deletion with retry
        return await this._deleteWithRetry(workspacePath, branchName);
    },

    /**
     * Delete a remote branch with up to 3 retries and exponential backoff.
     */
    async _deleteWithRetry(workspacePath: string, branchName: string, maxRetries: number = 3): Promise<CleanupResult> {
        let lastError = "";
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await execFile("git", ["push", "origin", "--delete", branchName], {
                    cwd: workspacePath,
                    timeout: 30000,
                });

                const deletedAt = new Date().toISOString();
                logger.info(`[BranchCleanup] Deleted remote branch ${branchName} (attempt ${attempt + 1})`);
                return { deleted: true, branchName, deletedAt, retryCount: attempt };
            } catch (err: any) {
                lastError = err.message;
                // If the branch doesn't exist (already deleted), treat as success
                if (err.message.includes("remote ref does not exist") || err.stderr?.includes("remote ref does not exist")) {
                    logger.info(`[BranchCleanup] Branch ${branchName} already deleted`);
                    return { deleted: true, branchName, deletedAt: new Date().toISOString(), retryCount: attempt };
                }

                if (attempt < maxRetries - 1) {
                    const backoffMs = 1000 * Math.pow(2, attempt);
                    logger.warn(`[BranchCleanup] Delete failed for ${branchName} (attempt ${attempt + 1}), retrying in ${backoffMs}ms: ${err.message}`);
                    await new Promise(r => setTimeout(r, backoffMs));
                }
            }
        }

        logger.error(`[BranchCleanup] Failed to delete ${branchName} after ${maxRetries} attempts: ${lastError}`);
        return { deleted: false, branchName, error: lastError, retryCount: maxRetries };
    },

    /**
     * Run periodic orphan cleanup.
     * Finds mission branches older than retentionDays and deletes them.
     * Only deletes branches matching the mission/ prefix.
     */
    async runOrphanCleanup(orgId: number, retentionDays: number = 7): Promise<CleanupResult[]> {
        const results: CleanupResult[] = [];

        try {
            // Find missions with branches that were created more than retentionDays ago
            // and either haven't been merged or haven't been cleaned up
            const retentionThreshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

            const orphanMissions = await db.select({
                id: missions.id,
                workspacePath: missions.workspacePath,
                vcsConfig: missions.vcsConfig,
            })
            .from(missions)
            .where(and(
                eq(missions.organizationId, orgId),
                isNull(missions.deletedAt),
                sql`(${missions.vcsConfig}->>'branch_name') IS NOT NULL AND (${missions.vcsConfig}->>'branch_name') != ''`,
                sql`(${missions.vcsConfig}->>'branch_deleted_at') IS NULL`,
                sql`(${missions.vcsConfig}->>'branch_created_at')::timestamp < ${retentionThreshold}::timestamp`
            ))
            .limit(50);

            for (const mission of orphanMissions) {
                const config = mission.vcsConfig as any;
                const branchName = config?.branch_name;
                const workspace = mission.workspacePath;

                if (!branchName || !workspace || !this.isSafeToDelete(branchName)) continue;

                const result = await this._deleteWithRetry(workspace, branchName);
                results.push(result);

                // Record deletion in vcsConfig
                if (result.deleted) {
                    try {
                        await db.update(missions)
                            .set({
                                vcsConfig: sql`jsonb_set(
                                    COALESCE(${missions.vcsConfig}::jsonb, '{}'::jsonb),
                                    '{branch_deleted_at}',
                                    ${JSON.stringify(result.deletedAt)}::jsonb
                                )`,
                            })
                            .where(eq(missions.id, mission.id));
                    } catch { /* non-fatal */ }
                }
            }

            logger.info(`[BranchCleanup] Orphan cleanup for org ${orgId}: ${results.filter(r => r.deleted).length}/${results.length} deleted`);
        } catch (err: any) {
            logger.error(`[BranchCleanup] Orphan cleanup failed for org ${orgId}: ${err.message}`);
        }

        return results;
    },

    /**
     * Safety guard: only branches with the mission/ prefix are safe to delete.
     */
    isSafeToDelete(branchName: string): boolean {
        return isMissionBranch(branchName);
    },
};
