import { execSync } from "child_process";
import { createLogger } from "@server/utils/logger.js";
import fs from "fs";
import path from "path";

const logger = createLogger("SelfHealingHandler");

/**
 * Only TypeScript sources are worth type-checking; a docs or config patch that
 * cannot affect the build should not pay a minute of tsc.
 */
const TYPECHECKED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

/**
 * Does the repository still type-check?
 *
 * This exists because nothing sat between the write and the commit. Both apply
 * paths below did `fs.writeFileSync` -> `git add` -> `git commit` with no check
 * of any kind, so a generated patch that did not compile was committed anyway —
 * and on the autonomous path, committed straight onto whoever's branch was
 * checked out. A single session saw 119 type errors land in a tree that had been
 * at zero.
 *
 * Deliberately the whole project rather than the single file: a patch usually
 * breaks its callers, not itself, and `tsc` has no meaningful single-file mode
 * here. It costs roughly a minute, which is cheap against committing a tree that
 * does not build.
 *
 * Set EVOLUTION_SKIP_VERIFY=true to bypass — intended for recovering a wedged
 * environment, not for routine use. The bypass is logged at warn.
 */
function verifyRepositoryTypechecks(filePath: string): { ok: boolean; output?: string } {
    if (process.env.EVOLUTION_SKIP_VERIFY === "true") {
        logger.warn("[SelfHealingHandler] EVOLUTION_SKIP_VERIFY=true — committing without a typecheck.");
        return { ok: true };
    }

    if (!TYPECHECKED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        return { ok: true };
    }

    try {
        execSync("npx tsc --noEmit", {
            stdio: "pipe",
            env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=8192" },
        });
        return { ok: true };
    } catch (error: any) {
        // tsc reports diagnostics on stdout and exits non-zero.
        const output = String(error?.stdout ?? error?.stderr ?? error?.message ?? "");
        return { ok: false, output: output.slice(0, 2000) };
    }
}

export class SelfHealingHandler {
    private static pendingFixes: Array<{
        id: string;
        filePath: string;
        oldContent: string;
        newContent: string;
        description: string;
        /** True when there is no generated code patch — the finding is detection-only. */
        advisory: boolean;
        /** Set when the fix targets a `skills` DB row; approval promotes it via SkillPromotionService (not git). */
        skillId?: number;
        timestamp: string;
    }> = [];

    /**
     * Records a proposed fix for HIL approval.
     *
     * Deduplicates by target file: repeated scans of the same underperforming
     * candidate must not stack identical proposals. Returns the id that is now
     * pending for this file (the existing one if a duplicate was skipped).
     *
     * `opts.oldContent` supplies the baseline for the diff when the target is not a
     * real file on disk (e.g. a `skill://` DB artifact). `opts.skillId` routes the
     * approval to a durable, version-snapshotted skill promotion instead of a git write.
     */
    static proposeFix(
        id: string,
        filePath: string,
        newContent: string,
        description: string,
        opts?: { skillId?: number; oldContent?: string }
    ): string {
        const existing = this.pendingFixes.find(f => f.filePath === filePath);
        if (existing) {
            logger.info(`[SelfHealingHandler] Skipping duplicate proposal for ${filePath} (already pending as ${existing.id}).`);
            return existing.id;
        }

        let oldContent = opts?.oldContent ?? "";
        if (opts?.oldContent === undefined) {
            try {
                const absPath = path.resolve(process.cwd(), filePath);
                if (fs.existsSync(absPath)) {
                    oldContent = fs.readFileSync(absPath, 'utf8');
                }
            } catch (e: any) {
                logger.warn(`Could not read old content for ${filePath}`, e);
            }
        }

        // A finding with no generated code is advisory only — it must never be
        // "applied" (that would blank the target file). Flag it so callers/UI can
        // present it honestly and the apply path can refuse it.
        const advisory = !newContent || newContent.trim() === "";

        this.pendingFixes.push({
            id,
            filePath,
            oldContent,
            newContent,
            description,
            advisory,
            skillId: opts?.skillId,
            timestamp: new Date().toISOString()
        });
        logger.info(`[SelfHealingHandler] Proposed ${advisory ? "advisory (detection-only)" : "evolution"} fix: ${id} for ${filePath}`);
        return id;
    }

    static getPendingFixes() {
        return this.pendingFixes;
    }

    static clearFix(id: string) {
        this.pendingFixes = this.pendingFixes.filter(f => f.id !== id);
    }

    /**
     * Generates a simple unified diff for the UI.
     */
    static getFixDiff(id: string): string {
        const fix = this.pendingFixes.find(f => f.id === id);
        if (!fix) return "Fix not found.";

        const oldLines = fix.oldContent.split('\n');
        const newLines = fix.newContent.split('\n');
        
        let diff = `--- ${fix.filePath} (original)\n+++ ${fix.filePath} (evolution)\n`;
        // Simple line-by-line diff for MVP
        const max = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < max; i++) {
            if (oldLines[i] !== newLines[i]) {
                if (i < oldLines.length) diff += `- ${oldLines[i]}\n`;
                if (i < newLines.length) diff += `+ ${newLines[i]}\n`;
            } else {
                diff += `  ${oldLines[i]}\n`;
            }
        }
        return diff;
    }

    /**
     * Applies a proposed fix to the codebase on a specialized evolution branch.
     * This follows the 'HIL-Approval' pattern for architecture safety.
     */
    static async applyEvolutionFix(issueId: string, filePath: string, newContent: string) {
        logger.info(`[SelfHealingHandler] Initiating evolution fix for: ${issueId}`);

        // Safety: never apply an empty patch. Detection-only findings carry no
        // generated code, and writing "" would blank the target file (this is how
        // the phantom skills/1/handler.ts and 150+ no-op branches were produced).
        if (!newContent || newContent.trim() === "") {
            throw new Error("Refusing to apply: this is a detection-only finding with no code patch. Manual remediation is required.");
        }

        const absPath = path.resolve(process.cwd(), filePath);

        // Ensure directory exists
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const branchSuffix = issueId.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const branchName = `evolution/fix-${branchSuffix}-${Date.now()}`;

        if (!/^evolution\/fix-[a-z0-9-]+-\d+$/.test(branchName)) {
            throw new Error(`Unsafe branch name derived from issueId "${issueId}" — rejecting to protect repository state.`);
        }

        // Remember where the caller is so we can return them here — never strand
        // them on the evolution branch (that's what silently hijacked the working
        // branch mid-session before).
        let originalBranch = "";
        try {
            originalBranch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
        } catch {
            /* detached HEAD or git unavailable — best effort */
        }

        try {
            // 1. Force create/reset branch
            logger.info(`[SelfHealingHandler] Creating/Resetting evolution branch: ${branchName}`);
            execSync(`git checkout -B ${branchName}`, { stdio: 'inherit' });

            // 2. Apply fix
            fs.writeFileSync(absPath, newContent, 'utf8');
            logger.info(`[SelfHealingHandler] Fix applied to file system: ${filePath}`);

            // 2a. Verify before committing. A patch that does not compile is not a
            //     fix, and committing it puts the branch in a state no human asked
            //     for. Roll the file back so the branch is left untouched.
            const verification = verifyRepositoryTypechecks(filePath);
            if (!verification.ok) {
                logger.error(`[SelfHealingHandler] Typecheck failed after patching ${filePath} — refusing to commit.`);
                try {
                    execSync(`git checkout -- "${filePath}"`, { stdio: "pipe" });
                } catch {
                    /* untracked file: remove the patch we just wrote */
                    try { fs.unlinkSync(absPath); } catch { /* best effort */ }
                }
                throw new Error(
                    `Evolution fix for ${issueId} rejected: the patch does not type-check.
${verification.output ?? ""}`
                );
            }

            // 3. Stage and Commit — scoped to the patched file only, never `git add .`,
            //    so unrelated working-tree changes are never bundled into the commit.
            execSync(`git add -- "${filePath}"`, { stdio: 'inherit' });
            execSync(`git commit -m "evolution(fix): automated architecture improvement for ${issueId}"`, { stdio: 'inherit' });

            // 4. Return the caller to their original branch; the fix stays on branchName for review.
            if (originalBranch && originalBranch !== "HEAD") {
                execSync(`git checkout ${originalBranch}`, { stdio: 'inherit' });
            }

            return {
                success: true,
                branch: branchName,
                filePath,
                appliedAt: new Date().toISOString()
            };

        } catch (error: any) {
            logger.error(`[SelfHealingHandler] Failed to apply evolution fix: ${error.message}`);
            // Try to return to the original branch if we crashed mid-way.
            try {
                if (originalBranch && originalBranch !== "HEAD") {
                    execSync(`git checkout ${originalBranch}`, { stdio: 'inherit' });
                } else {
                    execSync(`git checkout -`, { stdio: 'inherit' });
                }
            } catch (e: any) {
                logger.warn(`[SelfHealingHandler] Recovery checkout failed: ${e.message}`);
            }
            throw error;
        }
    }

    /**
     * Directly applies and commits a fix to the current branch.
     * Used for AUTONOMOUS governance mode.
     */
    static async autonomousApplyFix(issueId: string, filePath: string, newContent: string) {
        logger.info(`[SelfHealingHandler] [AUTONOMOUS] Committing direct fix for: ${issueId}`);

        const absPath = path.resolve(process.cwd(), filePath);
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        try {
            // 1. Apply fix
            fs.writeFileSync(absPath, newContent, 'utf8');

            // 1a. Verify before committing. This path commits onto whatever branch
            //     is currently checked out, so an uncompilable patch lands directly
            //     in someone's working branch. Roll back rather than commit.
            const verification = verifyRepositoryTypechecks(filePath);
            if (!verification.ok) {
                logger.error(`[SelfHealingHandler] [AUTONOMOUS] Typecheck failed after patching ${filePath} — refusing to commit.`);
                try {
                    execSync(`git checkout -- "${filePath}"`, { stdio: "pipe" });
                } catch {
                    try { fs.unlinkSync(absPath); } catch { /* best effort */ }
                }
                throw new Error(
                    `Autonomous fix for ${issueId} rejected: the patch does not type-check.
${verification.output ?? ""}`
                );
            }

            // 2. Stage and Commit directly
            execSync(`git add ${filePath}`);
            execSync(`git commit -m "evolution(self-healing): autonomous repair for ${issueId}"`);

            logger.info(`[SelfHealingHandler] [AUTONOMOUS] Successfully committed fix to ${filePath}`);
            
            return {
                success: true,
                filePath,
                appliedAt: new Date().toISOString(),
                mode: 'AUTONOMOUS'
            };
        } catch (error: any) {
            logger.error(`[SelfHealingHandler] Autonomous fix failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Scans for specific technical debt patterns (e.g. TODOs, circular dependencies).
     */
    static async scanForDebtPatterns() {
        // Implement ripgrep-based scans here
        logger.info("[SelfHealingHandler] Scanning for technical debt markers...");
        // Placeholder for rg logic
    }
}

export const selfHealingHandler = new SelfHealingHandler();
