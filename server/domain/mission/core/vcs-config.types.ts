/**
 * VCS Configuration Types
 * 
 * Types for the `missions.vcsConfig` JSONB column that stores
 * branch metadata, merge state, and lifecycle information for
 * concurrent ticket isolation.
 */

export type CleanupPolicy = "immediate" | "retain_24h" | "manual";
export type ConflictStatus = "clean" | "rebased" | "blocked" | "pending";
export type MergeStrategy = "rebase" | "merge" | "squash";
export type RetryPolicy = "reuse_branch" | "fresh_branch";

export interface VcsConfig {
    // Branch identity
    branch_name: string;
    base_branch: string;
    base_commit_sha: string;
    current_commit_sha?: string;

    // Merge state
    merge_strategy: MergeStrategy;
    conflict_status: ConflictStatus;
    conflicting_files?: string[];

    // Lifecycle
    cleanup_policy: CleanupPolicy;
    retry_policy: RetryPolicy;

    // Timestamps
    branch_created_at: string;
    last_conflict_check_at?: string;
    merged_at?: string;
    branch_deleted_at?: string;

    // Legacy compat
    branch?: string;
    remote?: string;
    stack?: string[];
}

export const DEFAULT_VCS_CONFIG: VcsConfig = {
    branch_name: "",
    base_branch: "main",
    base_commit_sha: "",
    merge_strategy: "rebase",
    conflict_status: "pending",
    cleanup_policy: "immediate",
    retry_policy: "fresh_branch",
    branch_created_at: "",
};
