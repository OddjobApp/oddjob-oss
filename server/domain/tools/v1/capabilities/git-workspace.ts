/**
 * Git Workspace Tools
 * 
 * Provides coding agents with scoped access to the organization's Git workspace.
 * All operations are constrained to the org's forge workspace directory.
 * Supports: reading/writing code files, running commands (build/test/lint),
 * Git operations (branch, commit, push), and workspace health checks.
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import path from "node:path";
import fs from "node:fs/promises";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "@server/utils/logger.js";

const exec = promisify(execCallback);
const logger = createLogger("GitWorkspaceTools");

// Maximum output length to avoid flooding LLM context
const MAX_OUTPUT_LENGTH = 15000;
const COMMAND_TIMEOUT_MS = 60000;

/**
 * Resolve the workspace path for an org's SDLC coding workspace.
 * Uses the GIT_REPO_URL env var to determine the local clone path,
 * or falls back to the forge workspace root.
 */
async function resolveOrgWorkspace(orgId: number | null | undefined): Promise<string | null> {
    // Strategy 1: Check for org-specific workspace in forge directory
    const { FORGE_WORKSPACE_ROOT } = await import("../../../apps/core/forge-paths.js");
    
    // Look for an sdlc-workspace-org{id} directory
    if (orgId) {
        const orgWorkspace = path.join(FORGE_WORKSPACE_ROOT, `sdlc-workspace-org${orgId}`);
        try {
            await fs.access(orgWorkspace);
            return orgWorkspace;
        } catch { /* not found, try next */ }
    }

    // Strategy 2: Check for GIT_WORKSPACE_ROOT env var
    const envWorkspace = process.env.GIT_WORKSPACE_ROOT;
    if (envWorkspace) {
        try {
            await fs.access(envWorkspace);
            return envWorkspace;
        } catch { /* not found, try next */ }
    }

    // Strategy 3: Check current working directory as the repo root
    const cwd = process.cwd();
    try {
        await fs.access(path.join(cwd, ".git"));
        return cwd;
    } catch { /* not a git repo */ }

    // Strategy 4: Fall back to default workspace under forge
    if (orgId) {
        const defaultWorkspace = path.join(FORGE_WORKSPACE_ROOT, `sdlc-workspace-org${orgId}`);
        await fs.mkdir(defaultWorkspace, { recursive: true });
        return defaultWorkspace;
    }

    return null;
}

/**
 * Validate a file path is within the workspace (prevent directory traversal)
 */
function isWithinWorkspace(workspace: string, filePath: string): boolean {
    const resolved = path.resolve(workspace, filePath);
    const relative = path.relative(workspace, resolved);
    return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function truncateOutput(output: string): string {
    if (output.length <= MAX_OUTPUT_LENGTH) return output;
    return output.substring(0, MAX_OUTPUT_LENGTH) + `\n...(truncated, total ${output.length} chars)`;
}

/**
 * Detect unresolved pipeline/blueprint interpolation tokens (e.g. `{{steps.2.output}}`,
 * `{{context.fixed_package_json_content}}`) in file content bound for the workspace.
 *
 * These `{{…}}` tokens are resolved by the *pipeline* execution engine, NOT by the
 * *mission* tool path. When a rolling-wave coding agent emits one as file content, it
 * is written to disk verbatim — corrupting the file. This was the exact convergence
 * blocker for the codegen cycle: the agent overwrote package.json every wave with a
 * bare `{{steps.N.output}}` token, so eslint/health-check failed until max-waves.
 *
 * Returns the offending token so the caller can give the agent actionable feedback,
 * or null if the content is clean.
 *
 * Exported for unit testing.
 */
export function findUnresolvedTemplateToken(content: string): string | null {
    // Whole content is a single bare {{…}} token → unambiguously an unrendered leak.
    // (A GitHub Actions expression is `${{ … }}`, which starts with `$`, so it won't match.)
    const bare = content.trim().match(/^\{\{[^{}]+\}\}$/);
    if (bare) return bare[0];
    // A known interpolation namespace anywhere in the content (avoids false-positives
    // on legitimate `{{ }}` in templating source, which won't use these namespaces).
    // The `(?<!\$)` lookbehind excludes GitHub Actions / CI syntax `${{ steps.* }}`,
    // `${{ env.* }}`, `${{ secrets.* }}` — Oddjob's leaked tokens are bare `{{ }}`.
    const ns = content.match(/(?<!\$)\{\{\s*(steps|context|outputs|inputs|vars|params|env|secrets)\s*[.[][^}]*\}\}/i);
    return ns ? ns[0] : null;
}

/**
 * Files that define the project's build / dependency / tooling contract. Overwriting
 * these wholesale is high blast-radius (a single bad write breaks lint, install, or
 * build for every subsequent step). Full overwrites are gated behind explicit approval;
 * agents should make scoped edits via workspace_patch_file instead.
 *
 * Exported for unit testing.
 */
export function isProtectedPath(relPath: string): boolean {
    const p = relPath.replace(/\\/g, "/");
    return /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig([.\w-]*)?\.json|[^/]*\.config\.(js|cjs|mjs|ts)|\.eslintrc([.\w-]*)?|\.npmrc|Dockerfile|\.env[^/]*)$/i.test(p);
}

export const GIT_WORKSPACE_TOOLS: Record<string, ToolDefinition> = {

    // ═══════════════════════════════════════════════════════════════════════
    // WORKSPACE HEALTH CHECK
    // ═══════════════════════════════════════════════════════════════════════
    workspace_health_check: {
        name: "workspace_health_check",
        label: "Workspace Health Check",
        group: "Git Workspace",
        description: "Pre-flight validation of the coding workspace. Checks: git repo exists, dependencies installed, test runner works, build compiles, lint passes. Run this BEFORE writing any code.",
        riskLevel: "low",
        idempotency: "read-safe",
        parameters: z.object({
            checks: z.array(z.enum([
                "git_workspace_exists",
                "dependencies_installed",
                "test_harness_operational",
                "lint_config_valid",
                "build_compiles"
            ])).optional().describe("Specific checks to run. If omitted, runs all checks."),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return JSON.stringify({ healthy: false, error: "No workspace found for this organization." });

            const checks = params.checks || [
                "git_workspace_exists",
                "dependencies_installed", 
                "test_harness_operational",
                "lint_config_valid",
                "build_compiles"
            ];
            const results: Record<string, { pass: boolean; detail: string }> = {};

            for (const check of checks) {
                try {
                    switch (check) {
                        case "git_workspace_exists": {
                            await fs.access(path.join(workspace, ".git"));
                            const { stdout } = await exec("git status --porcelain", { cwd: workspace, timeout: 10000 });
                            results[check] = { pass: true, detail: `Git repo OK. ${stdout.trim() ? `${stdout.trim().split("\n").length} modified files` : "Clean working tree"}` };
                            break;
                        }
                        case "dependencies_installed": {
                            const hasNodeModules = await fs.access(path.join(workspace, "node_modules")).then(() => true).catch(() => false);
                            const hasPackageLock = await fs.access(path.join(workspace, "package-lock.json")).then(() => true).catch(() => false);
                            if (hasNodeModules) {
                                results[check] = { pass: true, detail: "node_modules present" };
                            } else if (hasPackageLock) {
                                results[check] = { pass: false, detail: "package-lock.json found but node_modules missing. Run: npm install" };
                            } else {
                                // Check for other package managers
                                const hasYarnLock = await fs.access(path.join(workspace, "yarn.lock")).then(() => true).catch(() => false);
                                results[check] = { pass: false, detail: hasYarnLock ? "yarn.lock found but node_modules missing. Run: yarn install" : "No lock file or node_modules found." };
                            }
                            break;
                        }
                        case "test_harness_operational": {
                            const pkg = JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf-8"));
                            const hasTestScript = !!pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1';
                            results[check] = { pass: hasTestScript, detail: hasTestScript ? `Test script: ${pkg.scripts.test}` : "No test script configured" };
                            break;
                        }
                        case "lint_config_valid": {
                            const pkg = JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf-8"));
                            const hasLint = !!pkg.scripts?.lint;
                            const hasEslintConfig = await fs.access(path.join(workspace, ".eslintrc.json")).then(() => true).catch(() => 
                                fs.access(path.join(workspace, ".eslintrc.js")).then(() => true).catch(() => false)
                            );
                            results[check] = { pass: hasLint || hasEslintConfig, detail: hasLint ? `Lint script: ${pkg.scripts.lint}` : (hasEslintConfig ? "ESLint config found" : "No lint configuration") };
                            break;
                        }
                        case "build_compiles": {
                            const pkg = JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf-8"));
                            const hasBuild = !!pkg.scripts?.build;
                            if (hasBuild) {
                                // Just check TSC --noEmit for speed rather than full build
                                const hasTsConfig = await fs.access(path.join(workspace, "tsconfig.json")).then(() => true).catch(() => false);
                                if (hasTsConfig) {
                                    try {
                                        await exec("npx tsc --noEmit --pretty false 2>&1 | head -20", { cwd: workspace, timeout: 30000 });
                                        results[check] = { pass: true, detail: "TypeScript compiles cleanly" };
                                    } catch (e: any) {
                                        const errors = (e.stdout || e.stderr || "").trim().split("\n").slice(0, 5).join("\n");
                                        results[check] = { pass: false, detail: `TypeScript errors:\n${errors}` };
                                    }
                                } else {
                                    results[check] = { pass: true, detail: `Build script available: ${pkg.scripts.build}` };
                                }
                            } else {
                                results[check] = { pass: false, detail: "No build script in package.json" };
                            }
                            break;
                        }
                    }
                } catch (e: any) {
                    results[check] = { pass: false, detail: `Check failed: ${e.message}` };
                }
            }

            const allPassed = Object.values(results).every(r => r.pass);
            return JSON.stringify({ healthy: allPassed, workspace, results }, null, 2);
        },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // CODE FILE OPERATIONS (scoped to workspace)
    // ═══════════════════════════════════════════════════════════════════════
    workspace_read_file: {
        name: "workspace_read_file",
        label: "Read Code File",
        group: "Git Workspace",
        description: "Read the content of a source code file from the Git workspace. Path is relative to the project root.",
        riskLevel: "low",
        idempotency: "read-safe",
        parameters: z.object({
            path: z.string().describe("Relative path to the file (e.g., 'server/routes/users.ts' or 'client/src/App.tsx')"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";
            if (!isWithinWorkspace(workspace, params.path)) return "Error: Path escapes workspace boundary.";

            const fullPath = path.resolve(workspace, params.path);
            try {
                const content = await fs.readFile(fullPath, "utf-8");
                return truncateOutput(content);
            } catch (e: any) {
                return `Error reading file: ${e.message}`;
            }
        },
    },

    workspace_write_file: {
        name: "workspace_write_file",
        label: "Write Code File",
        group: "Git Workspace",
        description: "Write or overwrite a source code file in the Git workspace. Creates directories as needed. Path is relative to the project root.",
        riskLevel: "medium",
        idempotency: "idempotent",
        sideEffects: ["file-system"],
        parameters: z.object({
            path: z.string().describe("Relative path for the file (e.g., 'server/routes/users.ts')"),
            content: z.string().describe("Full file content to write"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";
            if (!isWithinWorkspace(workspace, params.path)) return "Error: Path escapes workspace boundary.";

            // Guard 1: reject unrendered pipeline template tokens leaking into file content.
            const leakedToken = findUnresolvedTemplateToken(params.content);
            if (leakedToken) {
                logger.warn(`[workspace_write_file] Rejected write to ${params.path}: unresolved template token ${leakedToken}`);
                return `Error: refusing to write '${params.path}' — content contains an unresolved template token '${leakedToken}'. Interpolation like {{steps.N.output}} is NOT resolved by workspace write tools; provide the fully-rendered, literal file content.`;
            }

            const fullPath = path.resolve(workspace, params.path);

            // Guard 2: block wholesale overwrite of build/dependency/tooling config unless
            // explicitly approved. Creation of a new protected file is allowed; overwriting
            // an existing one must go through a scoped patch (or carry an approval flag).
            if (isProtectedPath(params.path) && !context?.allowProtectedWrites) {
                let exists = false;
                try { await fs.access(fullPath); exists = true; } catch { /* new file — creation is fine */ }
                if (exists) {
                    logger.warn(`[workspace_write_file] Blocked full overwrite of protected file ${params.path} (no approval)`);
                    return `Error: refusing to overwrite protected file '${params.path}' (build/dependency/tooling config) via full write — this requires explicit human approval. Make a scoped change with workspace_patch_file instead.`;
                }
            }

            try {
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                await fs.writeFile(fullPath, params.content, "utf-8");
                logger.info(`[workspace_write_file] Wrote ${params.path} (${params.content.length} chars)`);
                return `Successfully wrote ${params.path} (${params.content.length} chars)`;
            } catch (e: any) {
                return `Error writing file: ${e.message}`;
            }
        },
    },

    workspace_list_files: {
        name: "workspace_list_files",
        label: "List Files in Directory",
        group: "Git Workspace",
        description: "List files and directories at a given path in the workspace. Excludes node_modules, .git, .next, dist.",
        riskLevel: "low",
        idempotency: "read-safe",
        parameters: z.object({
            path: z.string().optional().default(".").describe("Relative directory path (default: project root)"),
            recursive: z.boolean().optional().default(false).describe("Whether to list recursively (max depth 3)"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";
            
            const targetPath = params.path || ".";
            if (!isWithinWorkspace(workspace, targetPath) && targetPath !== ".") {
                return "Error: Path escapes workspace boundary.";
            }

            const fullPath = path.resolve(workspace, targetPath);
            const SKIP = new Set(["node_modules", ".next", "dist", ".git", ".turbo", ".cache", "__pycache__"]);

            const results: string[] = [];
            const listDir = async (dir: string, depth: number) => {
                if (depth > 3) return;
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (SKIP.has(entry.name)) continue;
                    const rel = path.relative(fullPath, path.join(dir, entry.name));
                    if (entry.isDirectory()) {
                        results.push(`[DIR] ${rel}/`);
                        if (params.recursive) await listDir(path.join(dir, entry.name), depth + 1);
                    } else {
                        results.push(rel);
                    }
                }
            };

            try {
                await listDir(fullPath, 0);
                return results.length > 0 ? results.join("\n") : "Empty directory.";
            } catch (e: any) {
                return `Error listing directory: ${e.message}`;
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SCOPED SHELL EXECUTION (cwd = workspace)
    // ═══════════════════════════════════════════════════════════════════════
    workspace_run_command: {
        name: "workspace_run_command",

        idempotency: "none",
        label: "Run Command in Workspace",
        group: "Git Workspace",
        description: "Execute a shell command within the Git workspace directory. Use for: npm run build, npm test, npx tsc --noEmit, npm run lint, etc. Commands run with cwd set to the project root.",
        riskLevel: "medium",
        sideEffects: ["file-system"],
        parameters: z.object({
            command: z.string().describe("The command to run (e.g., 'npm run build', 'npm test -- --run', 'npx tsc --noEmit')"),
            timeout_ms: z.number().optional().default(60000).describe("Timeout in milliseconds (default: 60s)"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";

            // Block dangerous commands
            const dangerous = ["rm -rf /", "rm -rf /*", "format", "mkfs", "dd if=", ":(){ :|:& };:"];
            if (dangerous.some(d => params.command.includes(d))) {
                return "Error: Command blocked by safety filter.";
            }

            try {
                const timeout = Math.min(params.timeout_ms || COMMAND_TIMEOUT_MS, 120000);
                const { stdout, stderr } = await exec(params.command, { 
                    cwd: workspace, 
                    timeout,
                    maxBuffer: 1024 * 1024 * 5, // 5MB buffer
                    env: { ...process.env, CI: "true", NODE_ENV: "development" }
                });
                const output = `**Command**: ${params.command}\n**CWD**: ${workspace}\n\n**STDOUT**:\n${truncateOutput(stdout)}\n\n**STDERR**:\n${truncateOutput(stderr)}`;
                return output;
            } catch (e: any) {
                const output = `**Command Failed**: ${params.command}\n**Exit Code**: ${e.code || "unknown"}\n\n**STDOUT**:\n${truncateOutput(e.stdout || "")}\n\n**STDERR**:\n${truncateOutput(e.stderr || "")}`;
                return output;
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // GIT OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════
    git_status: {
        name: "git_status",
        label: "Git Status",
        group: "Git Workspace",
        description: "Show the current git status including branch name, staged/unstaged changes, and untracked files.",
        riskLevel: "low",
        idempotency: "read-safe",
        parameters: z.object({}),
        execute: async (_params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";

            try {
                const { stdout: branch } = await exec("git branch --show-current", { cwd: workspace });
                const { stdout: status } = await exec("git status --short", { cwd: workspace });
                const { stdout: log } = await exec("git log --oneline -5", { cwd: workspace });
                return `**Branch**: ${branch.trim()}\n\n**Status**:\n${status.trim() || "(clean)"}\n\n**Recent Commits**:\n${log.trim()}`;
            } catch (e: any) {
                return `Error: ${e.message}`;
            }
        },
    },

    git_create_branch: {
        name: "git_create_branch",

        idempotency: "none",
        label: "Create Git Branch",
        group: "Git Workspace",
        description: "Create and switch to a new Git branch for this ticket/feature. Always branch off the latest main/develop.",
        riskLevel: "medium",
        sideEffects: ["file-system"],
        parameters: z.object({
            branch_name: z.string().describe("Branch name (e.g., 'feature/JIRA-123-login-api')"),
            base_branch: z.string().optional().default("main").describe("Branch to base off of (default: main)"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";

            try {
                // Fetch latest and create branch
                await exec(`git fetch origin ${params.base_branch}`, { cwd: workspace, timeout: 30000 }).catch(() => {});
                await exec(`git checkout -b ${params.branch_name} origin/${params.base_branch}`, { cwd: workspace, timeout: 10000 }).catch(async () => {
                    // If origin/base doesn't exist, branch from local
                    await exec(`git checkout -b ${params.branch_name}`, { cwd: workspace, timeout: 10000 });
                });
                const { stdout } = await exec("git branch --show-current", { cwd: workspace });
                return `Created and switched to branch: ${stdout.trim()}`;
            } catch (e: any) {
                return `Error creating branch: ${e.message}`;
            }
        },
    },

    git_commit: {
        name: "git_commit",

        idempotency: "none",
        label: "Git Commit",
        group: "Git Workspace",
        description: "Stage specified files (or all changes) and create a commit with the given message.",
        riskLevel: "medium",
        sideEffects: ["file-system"],
        parameters: z.object({
            message: z.string().describe("Commit message (follow conventional commits: feat:, fix:, refactor:, test:, docs:)"),
            files: z.array(z.string()).optional().describe("Specific files to stage. If omitted, stages all changes (git add .)"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";

            try {
                if (params.files && params.files.length > 0) {
                    for (const file of params.files) {
                        await exec(`git add "${file}"`, { cwd: workspace });
                    }
                } else {
                    await exec("git add .", { cwd: workspace });
                }

                const { stdout } = await exec(`git commit -m "${params.message.replace(/"/g, '\\"')}"`, { cwd: workspace });
                return `Committed: ${stdout.trim()}`;
            } catch (e: any) {
                if (e.message.includes("nothing to commit")) {
                    return "Nothing to commit — working tree clean.";
                }
                return `Error committing: ${e.message}`;
            }
        },
    },

    git_push: {
        name: "git_push",

        idempotency: "none",
        label: "Git Push",
        group: "Git Workspace",
        description: "Push the current branch to origin. Sets upstream tracking on first push.",
        riskLevel: "medium",
        sideEffects: ["external-api"],
        parameters: z.object({
            force: z.boolean().optional().default(false).describe("Force push (use with caution)"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";

            try {
                const { stdout: branch } = await exec("git branch --show-current", { cwd: workspace });
                const branchName = branch.trim();
                const forceFlag = params.force ? " --force" : "";
                const { stdout, stderr } = await exec(`git push -u origin ${branchName}${forceFlag}`, { cwd: workspace, timeout: 60000 });
                return `Pushed ${branchName} to origin.\n${stdout}\n${stderr}`;
            } catch (e: any) {
                return `Error pushing: ${e.message}\n${e.stderr || ""}`;
            }
        },
    },

    git_diff: {
        name: "git_diff",
        label: "Git Diff",
        group: "Git Workspace",
        description: "Show the diff of changes in the workspace. Useful to review what you've written before committing.",
        riskLevel: "low",
        idempotency: "read-safe",
        parameters: z.object({
            staged: z.boolean().optional().default(false).describe("Show only staged changes"),
            file: z.string().optional().describe("Show diff for a specific file only"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";

            try {
                const stagedFlag = params.staged ? " --staged" : "";
                const fileArg = params.file ? ` -- "${params.file}"` : "";
                const { stdout } = await exec(`git diff${stagedFlag}${fileArg}`, { cwd: workspace, timeout: 15000 });
                return truncateOutput(stdout || "(no changes)");
            } catch (e: any) {
                return `Error: ${e.message}`;
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // CODE SEARCH (grep/ripgrep for finding patterns in workspace)
    // ═══════════════════════════════════════════════════════════════════════
    workspace_search: {
        name: "workspace_search",
        label: "Search Code",
        group: "Git Workspace",
        description: "Search for a text pattern or regex across the workspace codebase. Returns matching lines with file paths and line numbers. Excludes node_modules, .git, dist, .next.",
        riskLevel: "low",
        idempotency: "read-safe",
        parameters: z.object({
            pattern: z.string().describe("Text or regex pattern to search for (e.g., 'export function', 'TODO', 'import.*express')"),
            path: z.string().optional().describe("Limit search to a specific subdirectory (e.g., 'server/routes')"),
            file_pattern: z.string().optional().describe("Glob pattern for file types (e.g., '*.ts', '*.tsx')"),
            max_results: z.number().optional().default(30).describe("Maximum number of matches to return (default: 30)"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";

            try {
                const searchPath = params.path ? path.resolve(workspace, params.path) : workspace;
                if (params.path && !isWithinWorkspace(workspace, params.path)) {
                    return "Error: Path escapes workspace boundary.";
                }

                // Try ripgrep first (faster), fall back to grep
                const excludes = "--glob '!node_modules' --glob '!.git' --glob '!.next' --glob '!dist' --glob '!*.lock'";
                const fileFilter = params.file_pattern ? `--glob '${params.file_pattern}'` : "";
                const maxCount = params.max_results || 30;

                let command: string;
                try {
                    // Check if rg (ripgrep) is available
                    await exec("rg --version", { cwd: workspace, timeout: 3000 });
                    command = `rg "${params.pattern.replace(/"/g, '\\"')}" ${excludes} ${fileFilter} --max-count ${maxCount} --line-number --no-heading "${searchPath}"`;
                } catch {
                    // Fall back to grep
                    const grepExcludes = "--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=dist";
                    const includeFlag = params.file_pattern ? `--include='${params.file_pattern}'` : "";
                    command = `grep -rn ${grepExcludes} ${includeFlag} "${params.pattern.replace(/"/g, '\\"')}" "${searchPath}" | head -${maxCount}`;
                }

                const { stdout } = await exec(command, { cwd: workspace, timeout: 30000, maxBuffer: 1024 * 1024 });
                if (!stdout.trim()) return "No matches found.";
                return truncateOutput(stdout.trim());
            } catch (e: any) {
                if (e.code === 1) return "No matches found."; // grep returns 1 for no matches
                return `Error searching: ${e.message}`;
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // PATCH FILE (targeted string replacement without rewriting entire file)
    // ═══════════════════════════════════════════════════════════════════════
    workspace_patch_file: {
        name: "workspace_patch_file",
        label: "Patch File",
        group: "Git Workspace",
        description: "Make a targeted edit to a file by replacing a specific string/code block with new content. More efficient than rewriting the entire file. The old_content must match exactly (including whitespace).",
        riskLevel: "medium",
        idempotency: "idempotent",
        sideEffects: ["file-system"],
        parameters: z.object({
            path: z.string().describe("Relative path to the file to patch"),
            old_content: z.string().describe("The exact content to find and replace (must match exactly, including whitespace)"),
            new_content: z.string().describe("The new content to replace it with"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";
            if (!isWithinWorkspace(workspace, params.path)) return "Error: Path escapes workspace boundary.";

            // Reject unrendered pipeline template tokens leaking into the replacement content.
            const leakedToken = findUnresolvedTemplateToken(params.new_content);
            if (leakedToken) {
                logger.warn(`[workspace_patch_file] Rejected patch to ${params.path}: unresolved template token ${leakedToken}`);
                return `Error: refusing to patch '${params.path}' — new_content contains an unresolved template token '${leakedToken}'. Interpolation like {{steps.N.output}} is NOT resolved by workspace tools; provide fully-rendered, literal content.`;
            }

            const fullPath = path.resolve(workspace, params.path);
            try {
                const content = await fs.readFile(fullPath, "utf-8");

                if (!content.includes(params.old_content)) {
                    // Try to find a close match for better error messages
                    const lines = params.old_content.split("\n");
                    const firstLine = lines[0].trim();
                    const contentLines = content.split("\n");
                    const closeMatch = contentLines.findIndex(l => l.trim() === firstLine);
                    
                    if (closeMatch >= 0) {
                        return `Error: old_content not found exactly. A similar line exists at line ${closeMatch + 1}. Check whitespace/indentation matches exactly.`;
                    }
                    return "Error: old_content not found in file. Verify the exact content including whitespace.";
                }

                const occurrences = content.split(params.old_content).length - 1;
                if (occurrences > 1) {
                    return `Error: old_content matches ${occurrences} locations. Add more context to make the match unique.`;
                }

                const newContent = content.replace(params.old_content, params.new_content);
                await fs.writeFile(fullPath, newContent, "utf-8");
                
                logger.info(`[workspace_patch_file] Patched ${params.path} (replaced ${params.old_content.length} chars with ${params.new_content.length} chars)`);
                return `Successfully patched ${params.path}`;
            } catch (e: any) {
                return `Error patching file: ${e.message}`;
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // WORKSPACE TREE (condensed project structure for context)
    // ═══════════════════════════════════════════════════════════════════════
    workspace_tree: {
        name: "workspace_tree",
        label: "Project Structure",
        group: "Git Workspace",
        description: "Show the project directory tree structure (condensed). Useful for understanding project layout before writing code. Excludes node_modules, .git, .next, dist.",
        riskLevel: "low",
        idempotency: "read-safe",
        parameters: z.object({
            path: z.string().optional().default(".").describe("Subdirectory to show tree for (default: project root)"),
            depth: z.number().optional().default(3).describe("Maximum depth (default: 3)"),
        }),
        execute: async (params, context: ToolContext) => {
            const workspace = await resolveOrgWorkspace(context?.organizationId);
            if (!workspace) return "Error: No workspace found.";

            const targetPath = params.path || ".";
            if (targetPath !== "." && !isWithinWorkspace(workspace, targetPath)) {
                return "Error: Path escapes workspace boundary.";
            }

            const fullPath = path.resolve(workspace, targetPath);
            const SKIP = new Set(["node_modules", ".next", "dist", ".git", ".turbo", ".cache", "__pycache__", ".venv", "coverage"]);
            const maxDepth = Math.min(params.depth || 3, 5);
            const lines: string[] = [];

            const buildTree = async (dir: string, prefix: string, depth: number) => {
                if (depth > maxDepth) return;
                const entries = await fs.readdir(dir, { withFileTypes: true });
                const sorted = entries
                    .filter(e => !SKIP.has(e.name) && !e.name.startsWith("."))
                    .sort((a, b) => {
                        if (a.isDirectory() && !b.isDirectory()) return -1;
                        if (!a.isDirectory() && b.isDirectory()) return 1;
                        return a.name.localeCompare(b.name);
                    });

                for (let i = 0; i < sorted.length; i++) {
                    const entry = sorted[i];
                    const isLast = i === sorted.length - 1;
                    const connector = isLast ? "└── " : "├── ";
                    const childPrefix = isLast ? "    " : "│   ";

                    if (entry.isDirectory()) {
                        lines.push(`${prefix}${connector}${entry.name}/`);
                        await buildTree(path.join(dir, entry.name), prefix + childPrefix, depth + 1);
                    } else {
                        lines.push(`${prefix}${connector}${entry.name}`);
                    }
                }
            };

            try {
                lines.push(targetPath === "." ? workspace.split(path.sep).pop() + "/" : targetPath + "/");
                await buildTree(fullPath, "", 0);
                return truncateOutput(lines.join("\n"));
            } catch (e: any) {
                return `Error: ${e.message}`;
            }
        },
    },
};
