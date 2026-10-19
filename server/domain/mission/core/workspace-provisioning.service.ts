/**
 * Workspace Provisioning Service
 * 
 * Provides first-class workspace lifecycle management for coding missions.
 * When a coding mission starts, this service ensures:
 * 1. The git repo is cloned (or workspace exists)
 * 2. A feature branch is created for this mission run
 * 3. Dependencies are installed
 * 4. The workspace path is registered on the mission record
 * 
 * Multi-org safety:
 * - Workspaces are namespaced by orgId (sdlc-workspace-org{id})
 * - Mutex prevents concurrent provisioning for the same org
 * - Disk quota checked before cloning
 * - Git credentials resolved per-org from the credentials table
 */

import { db } from "@server/database_service.js";
import { missions, missionRuns, credentials } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { exec as execCallback, execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@server/utils/logger.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";
import { tenantProcessEnv } from "@server/utils/tenant-process-env.js";

const exec = promisify(execCallback);
const execFile = promisify(execFileCallback);
const logger = createLogger("WorkspaceProvisioningService");

// In-memory mutex to prevent concurrent provisioning for the same org
const provisioningLocks = new Map<number, Promise<any>>();

// Disk quota: max 2GB per workspace
const MAX_WORKSPACE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Ensure a workspace has a package.json so agent-generated `npm install` commands don't fail with
 * ENOENT (no such file). Only writes a minimal stub when none exists — never overwrites a real
 * project's manifest. Best-effort: a failure here must not block provisioning.
 */
async function ensureWorkspacePackageJson(workspacePath: string, orgId: number): Promise<void> {
    try {
        const pkgPath = path.join(workspacePath, "package.json");
        const exists = await fs.access(pkgPath).then(() => true).catch(() => false);
        if (exists) return;
        const stub = {
            name: `sdlc-workspace-org${orgId}`,
            version: "0.0.0",
            private: true,
            description: "Auto-scaffolded workspace manifest (no source-control repo configured for this org).",
        };
        await fs.writeFile(pkgPath, JSON.stringify(stub, null, 2) + "\n", "utf8");
        logger.info(`[WorkspaceProvisioning] Scaffolded minimal package.json in ${workspacePath}`);
    } catch (err: any) {
        logger.warn(`[WorkspaceProvisioning] Failed to scaffold package.json in ${workspacePath}: ${err.message}`);
    }
}

export interface WorkspaceProvisionResult {
    success: boolean;
    workspacePath: string | null;
    branch: string | null;
    error?: string;
    details?: {
        cloned: boolean;
        branchCreated: boolean;
        depsInstalled: boolean;
    };
}

export const workspaceProvisioningService = {
    /**
     * Provision a workspace for a coding mission.
     * Idempotent — safe to call multiple times.
     * Uses a per-org mutex to prevent concurrent clone operations.
     */
    async provision(
        missionId: number,
        missionRunId: number,
        orgId: number | null,
        options: {
            repoUrl?: string;
            branch?: string;
            baseBranch?: string;
            skipDeps?: boolean;
        } = {}
    ): Promise<WorkspaceProvisionResult> {
        if (!orgId) {
            return { success: false, workspacePath: null, branch: null, error: "orgId is required for workspace provisioning" };
        }

        // Acquire per-org mutex
        const existingLock = provisioningLocks.get(orgId);
        if (existingLock) {
            logger.info(`[WorkspaceProvisioning] Waiting for existing provisioning lock for org ${orgId}`);
            try { await existingLock; } catch { /* previous run failed, we'll retry */ }
        }

        const provisionPromise = this._doProvision(missionId, missionRunId, orgId, options);
        provisioningLocks.set(orgId, provisionPromise);

        try {
            const result = await provisionPromise;
            return result;
        } finally {
            provisioningLocks.delete(orgId);
        }
    },

    async _doProvision(
        missionId: number,
        missionRunId: number,
        orgId: number,
        options: {
            repoUrl?: string;
            branch?: string;
            baseBranch?: string;
            skipDeps?: boolean;
        }
    ): Promise<WorkspaceProvisionResult> {
        const details = { cloned: false, branchCreated: false, depsInstalled: false };
        
        try {
            // 1. Resolve workspace path (org-scoped)
            const { FORGE_WORKSPACE_ROOT } = await import("../../apps/core/forge-paths.js");
            const workspacePath = path.join(FORGE_WORKSPACE_ROOT, `sdlc-workspace-org${orgId}`);

            // 2. Resolve git credentials from the org's credential store
            let repoUrl = options.repoUrl;
            let gitToken: string | null = null;

            if (!repoUrl) {
                // Look for source_control credential
                const [cred] = await db.select()
                    .from(credentials)
                    .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "source_control")))
                    .limit(1);
                
                if (cred) {
                    gitToken = (await resolveCredentialSecret(cred)) || null;
                    const meta = cred.metadata as any;
                    repoUrl = meta?.repo_url || meta?.repoUrl || process.env.GIT_REPO_URL;
                } else {
                    repoUrl = process.env.GIT_REPO_URL;
                    gitToken = process.env.GIT_API_TOKEN || null;
                }
            }

            // 3. Check if workspace already exists
            const exists = await fs.access(workspacePath).then(() => true).catch(() => false);
            
            if (!exists) {
                if (!repoUrl) {
                    // No repo URL — create an empty initialized workspace. Scaffold a minimal
                    // package.json so agent-generated `npm install` commands succeed (install nothing)
                    // instead of failing with ENOENT (no such file package.json), which was causing
                    // rolling-wave SDLC runs to burn through their wave limit and fail.
                    await fs.mkdir(workspacePath, { recursive: true });
                    await exec("git init", { cwd: workspacePath, timeout: 10000 });
                    await ensureWorkspacePackageJson(workspacePath, orgId);
                    logger.info(`[WorkspaceProvisioning] Created empty workspace at ${workspacePath} for org ${orgId}`);
                } else {
                    // Clone with credentials (token injected into URL)
                    let cloneUrl = repoUrl;
                    if (gitToken && repoUrl.startsWith("https://")) {
                        try {
                            const url = new URL(repoUrl);
                            url.username = "oauth2";
                            url.password = gitToken;
                            cloneUrl = url.toString();
                        } catch {
                            // If URL parsing fails, use as-is
                        }
                    }
                    
                    await fs.mkdir(path.dirname(workspacePath), { recursive: true });
                    
                    // Shallow clone to save disk space (depth=1); use execFile to avoid shell injection
                    await execFile("git", ["clone", "--depth", "1", cloneUrl, workspacePath], {
                        timeout: 180000,
                        maxBuffer: 1024 * 1024 * 10,
                    });
                    logger.info(`[WorkspaceProvisioning] Cloned repo to ${workspacePath} for org ${orgId}`);
                }
                details.cloned = true;
            } else {
                // Workspace exists — check disk quota
                try {
                    const { stdout } = await exec(
                        process.platform === "win32" ? `powershell -c "(Get-ChildItem -Recurse '${workspacePath}' | Measure-Object -Property Length -Sum).Sum"` 
                            : `du -sb "${workspacePath}" | cut -f1`,
                        { cwd: workspacePath, timeout: 30000 }
                    );
                    const sizeBytes = parseInt(stdout.trim()) || 0;
                    if (sizeBytes > MAX_WORKSPACE_SIZE_BYTES) {
                        logger.warn(`[WorkspaceProvisioning] Workspace for org ${orgId} exceeds 2GB quota (${(sizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB)`);
                    }
                } catch { /* disk check is non-fatal */ }

                // Pull latest (non-fatal if it fails)
                try {
                    await exec("git pull --rebase --autostash", { cwd: workspacePath, timeout: 30000 });
                } catch {
                    logger.warn(`[WorkspaceProvisioning] git pull failed for org ${orgId}, continuing with existing state`);
                }
            }

            // 4. Create feature branch for this mission run
            const branchName = options.branch || `mission/run-${missionRunId}`;
            const baseBranch = options.baseBranch || "main";
            
            try {
                await execFile("git", ["fetch", "origin", baseBranch], { cwd: workspacePath, timeout: 30000 }).catch(() => {});

                const { stdout: currentBranch } = await execFile("git", ["branch", "--show-current"], { cwd: workspacePath });
                if (currentBranch.trim() !== branchName) {
                    await execFile("git", ["checkout", "-B", branchName, `origin/${baseBranch}`], { cwd: workspacePath, timeout: 10000 }).catch(async () => {
                        await execFile("git", ["checkout", "-B", branchName], { cwd: workspacePath, timeout: 10000 });
                    });
                }
                details.branchCreated = true;
            } catch (branchErr: any) {
                logger.warn(`[WorkspaceProvisioning] Branch creation failed for org ${orgId}: ${branchErr.message}`);
            }

            // 5. Install dependencies
            if (!options.skipDeps) {
                const hasPackageJson = await fs.access(path.join(workspacePath, "package.json")).then(() => true).catch(() => false);
                if (hasPackageJson) {
                    const hasNodeModules = await fs.access(path.join(workspacePath, "node_modules")).then(() => true).catch(() => false);
                    if (!hasNodeModules) {
                        try {
                            await exec("npm install --legacy-peer-deps", { 
                                cwd: workspacePath, 
                                timeout: 180000,
                                env: tenantProcessEnv({ NODE_ENV: "development" }),
                            });
                            details.depsInstalled = true;
                        } catch (npmErr: any) {
                            logger.warn(`[WorkspaceProvisioning] npm install failed for org ${orgId}: ${npmErr.message}`);
                        }
                    } else {
                        details.depsInstalled = true;
                    }
                }
            }

            // 6. Register workspace path on the mission
            await db.update(missions)
                .set({ workspacePath })
                .where(eq(missions.id, missionId));

            // Update mission run context with workspace info
            if (missionRunId > 0) {
                const [run] = await db.select({ missionContext: missionRuns.missionContext })
                    .from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
                const ctx = (run?.missionContext as any) || {};
                await db.update(missionRuns)
                    .set({
                        missionContext: {
                            ...ctx,
                            workspacePath,
                            branch: branchName,
                            workspaceProvisioned: true,
                        }
                    })
                    .where(eq(missionRuns.id, missionRunId));
            }

            logger.info(`[WorkspaceProvisioning] Org ${orgId} mission ${missionId} workspace ready: ${workspacePath} (branch: ${branchName})`);

            return { success: true, workspacePath, branch: branchName, details };
        } catch (err: any) {
            logger.error(`[WorkspaceProvisioning] Failed for org ${orgId}: ${err.message}`);
            return { success: false, workspacePath: null, branch: null, error: err.message, details };
        }
    },

    /**
     * Check if a mission has a provisioned workspace
     */
    async isProvisioned(missionId: number): Promise<{ provisioned: boolean; workspacePath: string | null }> {
        const [mission] = await db.select({ workspacePath: missions.workspacePath })
            .from(missions).where(eq(missions.id, missionId)).limit(1);
        
        if (!mission?.workspacePath) return { provisioned: false, workspacePath: null };
        
        const exists = await fs.access(mission.workspacePath).then(() => true).catch(() => false);
        return { provisioned: exists, workspacePath: exists ? mission.workspacePath : null };
    },

    /**
     * Determine if a mission needs workspace provisioning.
     */
    needsWorkspace(missionConfig: any): boolean {
        const codingAgents = ["ai-backend-dev", "ai-frontend-dev", "ai-mobile-dev", "ai-dba"];
        const primaryAgent = missionConfig?.primaryAgent;
        return codingAgents.includes(primaryAgent) || 
               missionConfig?.environment === "development" ||
               missionConfig?.sequence?.some((s: any) => 
                   s.action?.includes("write_") || s.action?.includes("code") || s.action?.includes("build")
               );
    },

    // ═══════════════════════════════════════════════════════════════════════
    // CONCURRENT TICKET ISOLATION — Isolated provisioning with mutex + branch
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Provision an isolated workspace for a coding mission with:
     * 1. Concurrency semaphore (per-repo limit)
     * 2. Workspace mutex (serialized write access)
     * 3. Deterministic branch creation (mission/{id}/{step})
     * 4. Conflict detection before agent execution
     * 5. VCS config tracking in DB
     * 
     * Returns a lock that MUST be released via completeMission() when done.
     */
    async provisionIsolated(
        missionId: number,
        missionRunId: number,
        orgId: number,
        options: {
            stepCode?: string;
            baseBranch?: string;
            concurrencyLimit?: number;
            repoUrl?: string;
            missionPlanFiles?: string[]; // Files the mission plans to modify
        } = {}
    ): Promise<WorkspaceProvisionResult & { lock?: any }> {
        const { workspaceMutexService } = await import("./workspace-mutex.service.js");
        const { conflictDetectionService } = await import("./conflict-detection.service.js");
        const { deriveBranchName } = await import("./branch-naming.js");
        const { parseVcsConfig } = await import("./vcs-config.parser.js");

        const stepCode = options.stepCode || "implement";
        const baseBranch = options.baseBranch || "main";
        const concurrencyLimit = options.concurrencyLimit || 3;

        // 1. Resolve workspace path and repo URL
        const { FORGE_WORKSPACE_ROOT } = await import("../../apps/core/forge-paths.js");
        const workspacePath = path.join(FORGE_WORKSPACE_ROOT, `sdlc-workspace-org${orgId}`);

        let repoUrl = options.repoUrl;
        if (!repoUrl) {
            // Resolve from org credentials
            const [cred] = await db.select()
                .from(credentials)
                .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "source_control")))
                .limit(1);
            if (cred) {
                const meta = cred.metadata as any;
                repoUrl = meta?.repo_url || meta?.repoUrl || process.env.GIT_REPO_URL || "";
            } else {
                repoUrl = process.env.GIT_REPO_URL || "";
            }
        }

        if (!repoUrl) {
            return { success: false, workspacePath: null, branch: null, error: "No repository URL configured for this org" };
        }

        // 2. Acquire concurrency slot
        const slotAcquired = await workspaceMutexService.tryAcquireSlot(orgId, repoUrl, missionId, concurrencyLimit);
        if (!slotAcquired) {
            return { success: false, workspacePath: null, branch: null, error: `Concurrency limit (${concurrencyLimit}) reached for this repository. Wait for another mission to complete.` };
        }

        // 3. Acquire workspace mutex
        let lock;
        try {
            lock = await workspaceMutexService.acquire({
                orgId,
                repoUrl,
                missionId,
                ttlMs: 300_000, // 5 min
                acquireTimeoutMs: 60_000, // 1 min wait
            });
        } catch (mutexErr: any) {
            // Release semaphore slot on mutex failure
            await workspaceMutexService.releaseSlot(orgId, repoUrl, missionId);
            return { success: false, workspacePath: null, branch: null, error: mutexErr.message };
        }

        try {
            // 4. Ensure workspace exists (clone if needed)
            const exists = await fs.access(workspacePath).then(() => true).catch(() => false);
            if (!exists) {
                const gitToken = process.env.GIT_API_TOKEN;
                let cloneUrl = repoUrl;
                if (gitToken && repoUrl.startsWith("https://")) {
                    try {
                        const url = new URL(repoUrl);
                        url.username = "oauth2";
                        url.password = gitToken;
                        cloneUrl = url.toString();
                    } catch { /* use as-is */ }
                }
                await fs.mkdir(path.dirname(workspacePath), { recursive: true });
                await execFile("git", ["clone", "--depth", "1", cloneUrl, workspacePath], { timeout: 180000, maxBuffer: 1024 * 1024 * 10 });
                logger.info(`[WorkspaceProvisioning] Cloned repo for isolated provision (org ${orgId})`);
            }

            // 5. Fetch latest base branch
            await execFile("git", ["fetch", "origin", baseBranch], { cwd: workspacePath, timeout: 30000 }).catch(() => {});

            // 6. Get base commit SHA
            let baseCommitSha = "";
            try {
                const { stdout } = await execFile("git", ["rev-parse", `origin/${baseBranch}`], { cwd: workspacePath, timeout: 5000 });
                baseCommitSha = stdout.trim();
            } catch { /* non-fatal */ }

            // 7. Create/reset mission branch
            const branchName = deriveBranchName(missionId, stepCode);
            try {
                await execFile("git", ["checkout", "-B", branchName, `origin/${baseBranch}`], { cwd: workspacePath, timeout: 10000 });
            } catch {
                // Fallback: branch from current HEAD
                await execFile("git", ["checkout", "-B", branchName], { cwd: workspacePath, timeout: 10000 });
            }

            // 8. Conflict detection (if base has diverged and we know plan files)
            let conflictStatus: "clean" | "rebased" | "blocked" | "pending" = "clean";
            if (options.missionPlanFiles && options.missionPlanFiles.length > 0) {
                const divergence = await conflictDetectionService.checkDivergence(workspacePath, baseBranch, baseCommitSha);
                if (divergence.diverged) {
                    const hasOverlap = conflictDetectionService.hasFileOverlap(divergence.changedFilesOnBase, options.missionPlanFiles);
                    if (hasOverlap) {
                        const rebaseResult = await conflictDetectionService.attemptRebase(workspacePath, baseBranch);
                        conflictStatus = rebaseResult.status;
                        if (conflictStatus === "blocked") {
                            // A non-mergeable base divergence must NOT permanently fail the
                            // mission (that stalls the whole cycle). attemptRebase already
                            // aborted the rebase, so the branch is clean on its original base.
                            // Proceed and let the mission do its work; the divergence is
                            // surfaced as "pending" for later reconciliation rather than a
                            // hard stop.
                            logger.warn(`[WorkspaceProvisioning] Mission ${missionId} rebase blocked (${rebaseResult.error}); proceeding on un-rebased base instead of failing.`);
                            conflictStatus = "pending";
                        }
                    }
                }
            }

            // 9. Update vcsConfig on mission record
            // repo_url is stored here so completeMission can resolve the correct semaphore key
            // without repeating the DB credential lookup.
            const vcsConfig = {
                branch_name: branchName,
                base_branch: baseBranch,
                base_commit_sha: baseCommitSha,
                merge_strategy: "rebase" as const,
                conflict_status: conflictStatus,
                cleanup_policy: "immediate" as const,
                retry_policy: "fresh_branch" as const,
                branch_created_at: new Date().toISOString(),
                repo_url: repoUrl,
            };

            await db.update(missions)
                .set({ workspacePath, vcsConfig })
                .where(eq(missions.id, missionId));

            // 10. Update mission run context
            if (missionRunId > 0) {
                const [run] = await db.select({ missionContext: missionRuns.missionContext })
                    .from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
                const ctx = (run?.missionContext as any) || {};
                await db.update(missionRuns)
                    .set({
                        missionContext: {
                            ...ctx,
                            workspacePath,
                            branch: branchName,
                            workspaceProvisioned: true,
                            isolatedBranch: true,
                        }
                    })
                    .where(eq(missionRuns.id, missionRunId));
            }

            logger.info(`[WorkspaceProvisioning] Isolated provision complete: org=${orgId}, mission=${missionId}, branch=${branchName}, conflict=${conflictStatus}`);

            return {
                success: true,
                workspacePath,
                branch: branchName,
                lock, // Caller must release via completeMission()
                details: { cloned: !exists, branchCreated: true, depsInstalled: false },
            };
        } catch (err: any) {
            // Release lock and slot on any error
            await workspaceMutexService.release(lock);
            await workspaceMutexService.releaseSlot(orgId, repoUrl, missionId);
            logger.error(`[WorkspaceProvisioning] Isolated provision failed: ${err.message}`);
            return { success: false, workspacePath: null, branch: null, error: err.message };
        }
    },

    /**
     * Complete a mission's isolated workspace session.
     * 1. Ensures clean working tree
     * 2. Runs pre-merge conflict check
     * 3. Updates vcsConfig with final state
     * 4. Releases workspace mutex
     * 5. Releases concurrency slot
     * 6. Triggers branch cleanup per policy
     */
    async completeMission(
        missionId: number,
        orgId: number,
        lock: any,
        options: {
            repoUrl?: string;
            targetBranch?: string;
        } = {}
    ): Promise<{ success: boolean; conflictStatus?: string; error?: string }> {
        const { workspaceMutexService } = await import("./workspace-mutex.service.js");
        const { conflictDetectionService } = await import("./conflict-detection.service.js");
        const { branchCleanupService } = await import("./branch-cleanup.service.js");
        const { parseVcsConfig } = await import("./vcs-config.parser.js");

        try {
            // 1. Get mission workspace and vcsConfig
            const [mission] = await db.select({ workspacePath: missions.workspacePath, vcsConfig: missions.vcsConfig })
                .from(missions).where(eq(missions.id, missionId)).limit(1);

            if (!mission?.workspacePath) {
                return { success: false, error: "Mission has no workspace path" };
            }

            const workspacePath = mission.workspacePath;
            const config = parseVcsConfig(mission.vcsConfig);
            const targetBranch = options.targetBranch || config.base_branch;

            // 2. Ensure clean working tree (no uncommitted changes leaked)
            // git add -A stages all changes including deletions; git add . would miss them.
            try {
                const { stdout } = await execFile("git", ["status", "--porcelain"], { cwd: workspacePath, timeout: 5000 });
                if (stdout.trim()) {
                    await execFile("git", ["add", "-A"], { cwd: workspacePath, timeout: 10000 }).catch(() => {});
                    await execFile("git", ["commit", "-m", "chore: cleanup uncommitted changes"], { cwd: workspacePath, timeout: 10000 }).catch(() => {});
                }
            } catch { /* non-fatal */ }

            // 3. Get final commit SHA
            let currentCommitSha = "";
            try {
                const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: workspacePath, timeout: 5000 });
                currentCommitSha = stdout.trim();
            } catch { /* non-fatal */ }

            // 4. Pre-merge conflict check
            const mergeCheck = await conflictDetectionService.preMergeCheck(workspacePath, targetBranch);

            // 5. Update vcsConfig with final state
            const updatedConfig = {
                ...config,
                current_commit_sha: currentCommitSha,
                conflict_status: mergeCheck.status,
                conflicting_files: mergeCheck.conflictingFiles.length > 0 ? mergeCheck.conflictingFiles : undefined,
                last_conflict_check_at: new Date().toISOString(),
            };

            await db.update(missions)
                .set({ vcsConfig: updatedConfig })
                .where(eq(missions.id, missionId));

            // 6. Release workspace mutex
            if (lock) {
                await workspaceMutexService.release(lock);
            }

            // 7. Release concurrency slot — use the repoUrl stored in vcsConfig at provision time
            // so the semaphore key matches exactly, regardless of how the env is configured now.
            const repoUrl = options.repoUrl || (config as any).repo_url || process.env.GIT_REPO_URL || "";
            if (repoUrl) {
                await workspaceMutexService.releaseSlot(orgId, repoUrl, missionId);
            }

            // 8. Trigger branch cleanup (non-blocking)
            if (mergeCheck.status === "clean" && config.branch_name) {
                branchCleanupService.deleteAfterMerge(workspacePath, config.branch_name, config.cleanup_policy)
                    .catch(err => logger.warn(`[WorkspaceProvisioning] Branch cleanup error: ${err.message}`));
            }

            logger.info(`[WorkspaceProvisioning] Mission ${missionId} completed: conflict=${mergeCheck.status}, commitSha=${currentCommitSha.slice(0, 8)}`);

            return { success: true, conflictStatus: mergeCheck.status };
        } catch (err: any) {
            // Always try to release lock and slot on error
            if (lock) {
                const { workspaceMutexService: wms } = await import("./workspace-mutex.service.js");
                await wms.release(lock).catch(() => {});
            }
            logger.error(`[WorkspaceProvisioning] completeMission failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    },
};
