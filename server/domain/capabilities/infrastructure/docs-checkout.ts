/**
 * Dedicated Docs Checkout provisioning (production auto-commit)
 * ============================================================
 *
 * `git-doc-writer` with `ACDD_DOCS_MANAGE_BRANCHES=true` switches branches
 * (mainline docs branch for Low/Medium, `audit/capability-*` for High/Critical).
 * That is unsafe in the live dev working tree, so in production it must run
 * against a DEDICATED checkout — a separate `git worktree` (shares the object
 * store, cheap) or a full clone.
 *
 * This module idempotently ensures that checkout exists and is on the right
 * branch, so `ACDD_DOCS_REPO_PATH` can point the writer at it safely.
 *
 * Config (env):
 *   ACDD_DOCS_REPO_PATH        — the checkout location (also the writer's root).
 *   ACDD_DOCS_CHECKOUT_MODE    — worktree | clone | none (default none = verify only).
 *   ACDD_DOCS_CHECKOUT_SOURCE  — worktree: source repo path (default cwd);
 *                                clone: remote URL to clone.
 *   ACDD_DOCS_CHECKOUT_BRANCH  — branch to check out (default ACDD_GIT_DOCS_BRANCH or "main").
 *   ACDD_GIT_REMOTE            — remote name (default "origin").
 *
 * Git + filesystem access are injectable so the provisioning command logic is
 * unit-tested without touching a real repo.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { createLogger } from "@server/utils/logger.js";
import type { GitRunner } from "../core/git-doc-writer.service.js";

const logger = createLogger("DocsCheckout");
const execFileAsync = promisify(execFile);

const defaultGit: GitRunner = async (args, cwd) => {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout;
};

export interface DocsCheckoutConfig {
    path: string | null;
    mode: "worktree" | "clone" | "none";
    source: string;
    branch: string;
    remote: string;
}

export function resolveDocsCheckoutConfig(): DocsCheckoutConfig {
    const mode = (process.env.ACDD_DOCS_CHECKOUT_MODE || "none").trim().toLowerCase();
    return {
        path: process.env.ACDD_DOCS_REPO_PATH || null,
        mode: mode === "worktree" || mode === "clone" ? mode : "none",
        source: process.env.ACDD_DOCS_CHECKOUT_SOURCE || process.cwd(),
        branch: process.env.ACDD_DOCS_CHECKOUT_BRANCH || process.env.ACDD_GIT_DOCS_BRANCH || "main",
        remote: process.env.ACDD_GIT_REMOTE || "origin",
    };
}

export interface CheckoutResult {
    ready: boolean;
    path: string | null;
    created: boolean;
    reason: string;
}

export interface CheckoutDeps {
    git?: GitRunner;
    isGitRepo?: (p: string) => Promise<boolean>;
}

async function pathIsGitRepo(p: string): Promise<boolean> {
    try {
        // A worktree has a `.git` FILE; a clone has a `.git` DIR — access covers both.
        await fs.access(path.join(p, ".git"));
        return true;
    } catch {
        return false;
    }
}

async function branchExists(git: GitRunner, cwd: string, branch: string): Promise<boolean> {
    return git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd)
        .then(() => true)
        .catch(() => false);
}

async function ensureOnBranch(git: GitRunner, cwd: string, branch: string): Promise<void> {
    const current = (await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd).catch(() => "")).trim();
    if (current === branch) return;
    if (await branchExists(git, cwd, branch)) {
        await git(["checkout", branch], cwd);
    } else {
        await git(["checkout", "-b", branch], cwd);
    }
}

/**
 * Ensure the dedicated docs checkout exists and is on the configured branch.
 * Idempotent: safe to call on every worker boot.
 */
export async function ensureDocsCheckout(
    config: DocsCheckoutConfig = resolveDocsCheckoutConfig(),
    deps: CheckoutDeps = {},
): Promise<CheckoutResult> {
    const git = deps.git ?? defaultGit;
    const isGitRepo = deps.isGitRepo ?? pathIsGitRepo;
    const { path: checkoutPath, mode, source, branch } = config;

    if (!checkoutPath) {
        return { ready: false, path: null, created: false, reason: "ACDD_DOCS_REPO_PATH not set" };
    }

    if (await isGitRepo(checkoutPath)) {
        try {
            await ensureOnBranch(git, checkoutPath, branch);
        } catch (err) {
            return {
                ready: false,
                path: checkoutPath,
                created: false,
                reason: `checkout exists but branch setup failed: ${String(err)}`,
            };
        }
        return { ready: true, path: checkoutPath, created: false, reason: `existing checkout ready on ${branch}` };
    }

    if (mode === "none") {
        return {
            ready: false,
            path: checkoutPath,
            created: false,
            reason: `${checkoutPath} is not a git repo and ACDD_DOCS_CHECKOUT_MODE=none (no provisioning)`,
        };
    }

    try {
        if (mode === "worktree") {
            const exists = await branchExists(git, source, branch);
            const args = exists
                ? ["worktree", "add", checkoutPath, branch]
                : ["worktree", "add", "-b", branch, checkoutPath];
            await git(args, source);
        } else {
            // clone
            await git(["clone", "--branch", branch, source, checkoutPath], process.cwd());
        }
    } catch (err) {
        return {
            ready: false,
            path: checkoutPath,
            created: false,
            reason: `provisioning via ${mode} failed: ${String(err)}`,
        };
    }

    logger.info(`Provisioned dedicated docs checkout at ${checkoutPath} (${mode}, branch ${branch}).`);
    return { ready: true, path: checkoutPath, created: true, reason: `provisioned via ${mode}` };
}
