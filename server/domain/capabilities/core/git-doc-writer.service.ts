/**
 * Git Doc Writer Service (Path A output, part 2 of 2)
 * ===================================================
 *
 * Writes a compiled capability doc to `docs/capabilities/<capability_id>.md` and
 * applies a risk-based git strategy:
 *
 *   - **Low / Medium** — commit on the docs branch.
 *   - **High / Critical** — isolate to an `audit/capability-<id>` branch and fire
 *     a review hook; never auto-merged.
 *
 * SAFETY (important for this repo)
 * --------------------------------
 * A prior background process in this codebase has bundled unrelated WIP and
 * switched branches mid-session. To make that class of accident impossible, this
 * writer is **safe-by-default**:
 *   - It stages ONLY the single doc file (`git add -- <path>`), never `-A`.
 *   - `autoCommit`, `autoPush` and `manageBranches` are all OFF unless explicitly
 *     enabled via config/env. With them off, the file is written and the caller
 *     is told it was left uncommitted.
 *   - Full risk-based branch isolation (which switches branches) only runs when
 *     `manageBranches` is enabled — intended for a DEDICATED docs worktree/clone,
 *     not the live dev working tree.
 *
 * The git runner is injectable so tests exercise the command logic without
 * mutating any real repository.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { createLogger } from "@server/utils/logger.js";
import {
    CAPABILITY_ID_PATTERN,
    riskRequiresIsolation,
    type RiskProfile,
} from "@shared/schema/capabilities/index.js";

const logger = createLogger("GitDocWriter");
const execFileAsync = promisify(execFile);

export interface GitDocWriterConfig {
    repoRoot: string;
    docsSubdir: string;
    /** Branch for Low/Medium docs. Empty string = stay on the current branch. */
    docsBranch: string;
    remote: string;
    authorName: string;
    authorEmail: string;
    autoCommit: boolean;
    autoPush: boolean;
    manageBranches: boolean;
}

function envBool(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function defaultGitDocWriterConfig(): GitDocWriterConfig {
    return {
        repoRoot: process.env.ACDD_DOCS_REPO_PATH || process.cwd(),
        docsSubdir: process.env.ACDD_DOCS_SUBDIR || "docs/capabilities",
        docsBranch: process.env.ACDD_GIT_DOCS_BRANCH || "",
        remote: process.env.ACDD_GIT_REMOTE || "origin",
        authorName: process.env.ACDD_GIT_AUTHOR_NAME || "ACDD Bot",
        authorEmail: process.env.ACDD_GIT_AUTHOR_EMAIL || "acdd-bot@oddjob.local",
        autoCommit: envBool("ACDD_GIT_AUTO_COMMIT", false),
        autoPush: envBool("ACDD_GIT_AUTO_PUSH", false),
        manageBranches: envBool("ACDD_DOCS_MANAGE_BRANCHES", false),
    };
}

/** Injectable git runner: (args, cwd) -> stdout. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

const defaultGitRunner: GitRunner = async (args, cwd) => {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout;
};

/** Hook fired for High/Critical docs that require human review. */
export type ReviewHook = (capabilityId: string, branch: string) => void | Promise<void>;

export interface CommitResult {
    capabilityId: string;
    docPath: string;
    branch: string;
    written: boolean;
    committed: boolean;
    pushed: boolean;
    requiresReview: boolean;
    message: string;
}

export class GitDocWriterError extends Error {}

export class GitDocWriterService {
    private readonly config: GitDocWriterConfig;
    private readonly git: GitRunner;
    private readonly reviewHook: ReviewHook;

    constructor(
        options: {
            config?: Partial<GitDocWriterConfig>;
            git?: GitRunner;
            reviewHook?: ReviewHook;
        } = {},
    ) {
        this.config = { ...defaultGitDocWriterConfig(), ...options.config };
        this.git = options.git ?? defaultGitRunner;
        this.reviewHook = options.reviewHook ?? defaultReviewHook;
    }

    /** Absolute, traversal-safe path for a capability's doc file. */
    docPath(capabilityId: string): string {
        this.requireValidId(capabilityId);
        const docsDir = path.resolve(this.config.repoRoot, this.config.docsSubdir);
        const target = path.resolve(docsDir, `${capabilityId}.md`);
        if (target !== path.join(docsDir, `${capabilityId}.md`)) {
            throw new GitDocWriterError(`Refusing to write outside docs dir: ${target}`);
        }
        return target;
    }

    /** Read the current on-disk doc for a capability, or null if none exists. */
    async readExisting(capabilityId: string): Promise<string | null> {
        try {
            return await fs.readFile(this.docPath(capabilityId), "utf8");
        } catch {
            return null;
        }
    }

    /** Write the doc and (if enabled) commit it per its risk profile. */
    async write(capabilityId: string, markdown: string, risk: RiskProfile): Promise<CommitResult> {
        this.requireValidId(capabilityId);
        const absPath = this.docPath(capabilityId);
        const relPath = path.relative(this.config.repoRoot, absPath).split(path.sep).join("/");
        const requiresReview = riskRequiresIsolation(risk);

        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, markdown, "utf8");

        const base: CommitResult = {
            capabilityId,
            docPath: relPath,
            branch: this.config.docsBranch || "(current)",
            written: true,
            committed: false,
            pushed: false,
            requiresReview,
            message: "",
        };

        if (!this.config.autoCommit) {
            return { ...base, message: "Doc written; auto-commit disabled (ACDD_GIT_AUTO_COMMIT off)." };
        }

        await this.requireGitRepo();

        if (this.config.manageBranches) {
            return this.commitManaged(base, relPath, capabilityId, risk);
        }
        return this.commitInPlace(base, relPath, capabilityId, requiresReview);
    }

    // ------------------------------------------------------------------
    // Commit strategies
    // ------------------------------------------------------------------

    /** Safe default: commit ONLY this file on the current branch; no switching. */
    private async commitInPlace(
        base: CommitResult,
        relPath: string,
        capabilityId: string,
        requiresReview: boolean,
    ): Promise<CommitResult> {
        const branch = (await this.currentBranch()) || "(detached)";
        const committed = await this.stageAndCommit(relPath, this.commitMessage(capabilityId, requiresReview));
        const pushed = committed ? await this.maybePush(branch) : false;

        if (requiresReview) await this.safeReview(capabilityId, branch);

        return {
            ...base,
            branch,
            committed,
            pushed,
            message: committed
                ? `Committed ${relPath} on ${branch}${requiresReview ? " (flagged for review)" : ""}.`
                : "No changes to commit.",
        };
    }

    /** Full risk-based isolation. Switches branches — intended for a dedicated docs checkout. */
    private async commitManaged(
        base: CommitResult,
        relPath: string,
        capabilityId: string,
        risk: RiskProfile,
    ): Promise<CommitResult> {
        const original = await this.currentBranch();
        const requiresReview = riskRequiresIsolation(risk);
        const branch = requiresReview
            ? `audit/capability-${capabilityId}`
            : this.config.docsBranch || original;

        let committed = false;
        let pushed = false;
        try {
            if (branch && branch !== original) await this.checkout(branch, true);
            committed = await this.stageAndCommit(relPath, this.commitMessage(capabilityId, requiresReview));
            pushed = committed ? await this.maybePush(branch) : false;
        } finally {
            if (original && branch !== original) {
                await this.checkout(original, false).catch(() =>
                    logger.warn(`Could not restore original branch ${original}.`),
                );
            }
        }

        if (requiresReview) await this.safeReview(capabilityId, branch);

        return {
            ...base,
            branch,
            committed,
            pushed,
            message: committed
                ? requiresReview
                    ? `Isolated ${risk}-risk doc on ${branch}; flagged for human review.`
                    : `Committed ${relPath} to ${branch}.`
                : "No changes to commit.",
        };
    }

    // ------------------------------------------------------------------
    // Git primitives
    // ------------------------------------------------------------------

    private async stageAndCommit(relPath: string, message: string): Promise<boolean> {
        await this.git(["add", "--", relPath], this.config.repoRoot);
        const status = await this.git(["status", "--porcelain", "--", relPath], this.config.repoRoot);
        if (!status.trim()) {
            logger.info(`No changes for ${relPath}; skipping commit.`);
            return false;
        }
        await this.git(
            [
                "-c",
                `user.name=${this.config.authorName}`,
                "-c",
                `user.email=${this.config.authorEmail}`,
                "commit",
                "-m",
                message,
                "--",
                relPath,
            ],
            this.config.repoRoot,
        );
        return true;
    }

    private async maybePush(branch: string): Promise<boolean> {
        if (!this.config.autoPush) return false;
        try {
            const remotes = (await this.git(["remote"], this.config.repoRoot)).split(/\s+/).filter(Boolean);
            if (!remotes.includes(this.config.remote)) {
                logger.warn(`Remote ${this.config.remote} not configured; committed locally only.`);
                return false;
            }
            await this.git(["push", "--set-upstream", this.config.remote, branch], this.config.repoRoot);
            return true;
        } catch (err) {
            logger.warn(`Push of ${branch} failed; commit retained locally.`, { err });
            return false;
        }
    }

    private async currentBranch(): Promise<string> {
        try {
            return (await this.git(["rev-parse", "--abbrev-ref", "HEAD"], this.config.repoRoot)).trim();
        } catch {
            return "";
        }
    }

    private async checkout(branch: string, createIfMissing: boolean): Promise<void> {
        const exists = await this.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], this.config.repoRoot)
            .then(() => true)
            .catch(() => false);
        if (exists) {
            await this.git(["checkout", branch], this.config.repoRoot);
        } else if (createIfMissing) {
            await this.git(["checkout", "-b", branch], this.config.repoRoot);
        } else {
            throw new GitDocWriterError(`Branch ${branch} does not exist.`);
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private commitMessage(capabilityId: string, requiresReview: boolean): string {
        return requiresReview
            ? `security(audit): automated verification document draft for ${capabilityId}`
            : `docs(auto): update capabilities matrix for ${capabilityId}`;
    }

    private requireValidId(capabilityId: string): void {
        if (!CAPABILITY_ID_PATTERN.test(capabilityId ?? "")) {
            throw new GitDocWriterError(
                `Invalid capability_id "${capabilityId}"; refusing to build a file path.`,
            );
        }
    }

    private async requireGitRepo(): Promise<void> {
        try {
            await fs.access(path.join(this.config.repoRoot, ".git"));
        } catch {
            throw new GitDocWriterError(
                `${this.config.repoRoot} is not a git repository. Set ACDD_DOCS_REPO_PATH to a git workspace.`,
            );
        }
    }

    private async safeReview(capabilityId: string, branch: string): Promise<void> {
        try {
            await this.reviewHook(capabilityId, branch);
        } catch (err) {
            logger.warn(`Review hook failed for ${capabilityId}.`, { err });
        }
    }
}

const defaultReviewHook: ReviewHook = (capabilityId, branch) => {
    logger.warn(
        `[HUMAN REVIEW REQUIRED] capability=${capabilityId} branch=${branch} — high/critical doc awaiting verification.`,
    );
};

export const gitDocWriter = new GitDocWriterService();
