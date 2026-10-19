/**
 * VCS Config Parser
 * 
 * Parses the `missions.vcsConfig` JSONB column into a typed VcsConfig object.
 * Handles null, undefined, empty, and malformed values gracefully by returning
 * the default configuration (single-branch mode, no isolation).
 */

import { z } from "zod";
import { VcsConfig, DEFAULT_VCS_CONFIG, CleanupPolicy, ConflictStatus, MergeStrategy, RetryPolicy } from "./vcs-config.types.js";

const vcsConfigSchema = z.object({
    branch_name: z.string().default(""),
    base_branch: z.string().default("main"),
    base_commit_sha: z.string().default(""),
    current_commit_sha: z.string().optional(),
    merge_strategy: z.enum(["rebase", "merge", "squash"]).default("rebase"),
    conflict_status: z.enum(["clean", "rebased", "blocked", "pending"]).default("pending"),
    conflicting_files: z.array(z.string()).optional(),
    cleanup_policy: z.enum(["immediate", "retain_24h", "manual"]).default("immediate"),
    retry_policy: z.enum(["reuse_branch", "fresh_branch"]).default("fresh_branch"),
    branch_created_at: z.string().default(""),
    last_conflict_check_at: z.string().optional(),
    merged_at: z.string().optional(),
    branch_deleted_at: z.string().optional(),
    // Legacy fields
    branch: z.string().optional(),
    remote: z.string().optional(),
    stack: z.array(z.string()).optional(),
});

/**
 * Parse a raw vcsConfig value (from DB JSONB) into a typed VcsConfig.
 * Never throws — always returns a valid config.
 */
export function parseVcsConfig(raw: unknown): VcsConfig {
    if (!raw || typeof raw !== "object") {
        return { ...DEFAULT_VCS_CONFIG };
    }

    const result = vcsConfigSchema.safeParse(raw);
    if (result.success) {
        return result.data as VcsConfig;
    }

    // Partial parse: extract what we can, fill rest with defaults
    const partial = raw as Record<string, unknown>;
    return {
        branch_name: typeof partial.branch_name === "string" ? partial.branch_name : DEFAULT_VCS_CONFIG.branch_name,
        base_branch: typeof partial.base_branch === "string" ? partial.base_branch : DEFAULT_VCS_CONFIG.base_branch,
        base_commit_sha: typeof partial.base_commit_sha === "string" ? partial.base_commit_sha : DEFAULT_VCS_CONFIG.base_commit_sha,
        current_commit_sha: typeof partial.current_commit_sha === "string" ? partial.current_commit_sha : undefined,
        merge_strategy: (["rebase", "merge", "squash"] as MergeStrategy[]).includes(partial.merge_strategy as MergeStrategy)
            ? partial.merge_strategy as MergeStrategy
            : DEFAULT_VCS_CONFIG.merge_strategy,
        conflict_status: (["clean", "rebased", "blocked", "pending"] as ConflictStatus[]).includes(partial.conflict_status as ConflictStatus)
            ? partial.conflict_status as ConflictStatus
            : DEFAULT_VCS_CONFIG.conflict_status,
        conflicting_files: Array.isArray(partial.conflicting_files) ? partial.conflicting_files as string[] : undefined,
        cleanup_policy: (["immediate", "retain_24h", "manual"] as CleanupPolicy[]).includes(partial.cleanup_policy as CleanupPolicy)
            ? partial.cleanup_policy as CleanupPolicy
            : DEFAULT_VCS_CONFIG.cleanup_policy,
        retry_policy: (["reuse_branch", "fresh_branch"] as RetryPolicy[]).includes(partial.retry_policy as RetryPolicy)
            ? partial.retry_policy as RetryPolicy
            : DEFAULT_VCS_CONFIG.retry_policy,
        branch_created_at: typeof partial.branch_created_at === "string" ? partial.branch_created_at : DEFAULT_VCS_CONFIG.branch_created_at,
        last_conflict_check_at: typeof partial.last_conflict_check_at === "string" ? partial.last_conflict_check_at : undefined,
        merged_at: typeof partial.merged_at === "string" ? partial.merged_at : undefined,
        branch_deleted_at: typeof partial.branch_deleted_at === "string" ? partial.branch_deleted_at : undefined,
        // Legacy
        branch: typeof partial.branch === "string" ? partial.branch : undefined,
        remote: typeof partial.remote === "string" ? partial.remote : undefined,
        stack: Array.isArray(partial.stack) ? partial.stack as string[] : undefined,
    };
}

/**
 * Check if a vcsConfig indicates active isolation (branch_name is set).
 */
export function hasActiveBranch(config: VcsConfig): boolean {
    return config.branch_name.length > 0 && config.branch_name.startsWith("mission/");
}
