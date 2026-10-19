/**
 * Conflict Detection Service
 *
 * Provides pre-execution and post-execution conflict detection
 * for concurrent ticket isolation. Checks whether the base branch
 * has diverged from the mission branch's base commit and whether
 * file changes overlap with the mission's planned modifications.
 */

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "@server/utils/logger.js";
import { ConflictStatus } from "./vcs-config.types.js";

const execFile = promisify(execFileCallback);
const logger = createLogger("ConflictDetection");

export interface DivergenceResult {
    diverged: boolean;
    baseCommitSha: string;
    currentBaseSha: string;
    changedFilesOnBase: string[];
}

export interface ConflictCheckResult {
    status: ConflictStatus;
    conflictingFiles: string[];
    rebaseAttempted: boolean;
    error?: string;
}

export const conflictDetectionService = {
    /**
     * Check if the base branch has diverged from the mission's base commit.
     * Returns which files changed on the base branch since branch creation.
     */
    async checkDivergence(
        workspacePath: string,
        baseBranch: string,
        baseCommitSha: string
    ): Promise<DivergenceResult> {
        try {
            // Fetch latest base branch state
            await execFile("git", ["fetch", "origin", baseBranch], { cwd: workspacePath, timeout: 30000 }).catch(() => {});

            // Get current head of base branch
            const { stdout: currentBaseSha } = await execFile(
                "git", ["rev-parse", `origin/${baseBranch}`],
                { cwd: workspacePath, timeout: 5000 }
            );
            const trimmedBaseSha = currentBaseSha.trim();

            if (trimmedBaseSha === baseCommitSha) {
                return { diverged: false, baseCommitSha, currentBaseSha: trimmedBaseSha, changedFilesOnBase: [] };
            }

            // Get list of files changed on base since our branch point
            const { stdout: changedFiles } = await execFile(
                "git", ["diff", "--name-only", `${baseCommitSha}..origin/${baseBranch}`],
                { cwd: workspacePath, timeout: 10000 }
            );

            const changedFilesOnBase = changedFiles.trim().split("\n").filter(f => f.length > 0);

            return {
                diverged: true,
                baseCommitSha,
                currentBaseSha: trimmedBaseSha,
                changedFilesOnBase,
            };
        } catch (err: any) {
            logger.error(`[ConflictDetection] checkDivergence failed: ${err.message}`);
            return { diverged: false, baseCommitSha, currentBaseSha: baseCommitSha, changedFilesOnBase: [] };
        }
    },

    /**
     * Check if any files changed on the base branch overlap with
     * the mission's planned file modifications.
     */
    hasFileOverlap(changedFilesOnBase: string[], missionPlanFiles: string[]): boolean {
        if (changedFilesOnBase.length === 0 || missionPlanFiles.length === 0) return false;
        const baseSet = new Set(changedFilesOnBase);
        return missionPlanFiles.some(f => baseSet.has(f));
    },

    /**
     * Attempt to rebase the current branch onto the base branch.
     * If conflicts occur, aborts the rebase and returns status: "blocked".
     */
    async attemptRebase(workspacePath: string, baseBranch: string): Promise<ConflictCheckResult> {
        try {
            await execFile("git", ["rebase", `origin/${baseBranch}`], { cwd: workspacePath, timeout: 60000 });

            logger.info(`[ConflictDetection] Rebase onto origin/${baseBranch} succeeded`);
            return { status: "rebased", conflictingFiles: [], rebaseAttempted: true };
        } catch (rebaseErr: any) {
            // Rebase failed — extract conflicting files and abort
            logger.warn(`[ConflictDetection] Rebase failed, aborting: ${rebaseErr.message}`);

            let conflictingFiles: string[] = [];
            try {
                const { stdout } = await execFile("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: workspacePath, timeout: 5000 });
                conflictingFiles = stdout.trim().split("\n").filter(f => f.length > 0);
            } catch { /* best effort */ }

            try {
                await execFile("git", ["rebase", "--abort"], { cwd: workspacePath, timeout: 10000 });
            } catch { /* already clean */ }

            return {
                status: "blocked",
                conflictingFiles,
                rebaseAttempted: true,
                error: `Rebase conflicts in: ${conflictingFiles.join(", ")}`,
            };
        }
    },

    /**
     * Pre-merge check: simulate a merge against the target branch
     * to detect if the mission's changes would conflict.
     *
     * The merge attempt and the subsequent abort are in separate try-catch blocks
     * so that an abort failure cannot be misinterpreted as a merge conflict.
     */
    async preMergeCheck(workspacePath: string, targetBranch: string): Promise<ConflictCheckResult> {
        // Step 1: attempt the dry-run merge
        let mergeSucceeded = false;
        let conflictingFiles: string[] = [];

        try {
            await execFile(
                "git", ["merge", "--no-commit", "--no-ff", `origin/${targetBranch}`],
                { cwd: workspacePath, timeout: 30000 }
            );
            mergeSucceeded = true;
        } catch (mergeErr: any) {
            // Merge would conflict — extract conflicting files
            try {
                const { stdout } = await execFile("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: workspacePath, timeout: 5000 });
                conflictingFiles = stdout.trim().split("\n").filter(f => f.length > 0);
            } catch { /* best effort */ }
        }

        // Step 2: abort the merge regardless of outcome to restore clean state
        // Separated so an abort failure doesn't pollute the merge result
        try {
            await execFile("git", ["merge", "--abort"], { cwd: workspacePath, timeout: 10000 });
        } catch {
            // abort can fail if there is nothing to abort (already clean) or on filesystem issues;
            // fall back to a hard reset to guarantee a clean working tree
            try {
                await execFile("git", ["reset", "--merge"], { cwd: workspacePath, timeout: 10000 });
            } catch (resetErr: any) {
                logger.warn(`[ConflictDetection] merge --abort and reset --merge both failed for ${targetBranch}: ${resetErr.message}`);
            }
        }

        if (mergeSucceeded) {
            return { status: "clean", conflictingFiles: [], rebaseAttempted: false };
        }

        return {
            status: "blocked",
            conflictingFiles,
            rebaseAttempted: false,
            error: `Merge conflicts in: ${conflictingFiles.join(", ")}`,
        };
    },
};
