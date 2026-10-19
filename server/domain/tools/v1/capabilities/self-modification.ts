/**
 * Self-Modification Tools for Super Admins
 * 
 * WARNING: These tools allow direct modification of the Oddjob codebase.
 * They are restricted to super admins only and include comprehensive safety measures:
 * - Super admin permission checks
 * - Audit logging for all operations
 * - Git integration for version control
 * - Backup and rollback mechanisms
 * - Approval workflow for critical changes
 * - Code validation before applying changes
 */

import { z } from "zod";
import { createLogger } from "@server/utils/logger.js";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import ts from "typescript";
import type { ToolDefinition, ToolContext } from "./types.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("SelfModification");
const execAsync = promisify(exec);
// Used for any git invocation that includes interpolated values (file paths, commit messages,
// commit hashes) so user/LLM-controlled strings can never be interpreted as shell syntax.
const execFileAsync = promisify(execFile);

// Safety constraints
const DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+\//,           // Recursive root deletion
    /dd\s+if=/,                // Disk destruction
    /:(){ :|:& };:/,           // Fork bomb
    /chmod\s+777/,             // Permission escalation
    /chown\s+root/,            // Ownership change
    /sudo\s+su/,               // Privilege escalation
    /wget.*\|.*sh/,            // Remote script execution
    /curl.*\|.*bash/,          // Remote script execution
];

const PROTECTED_PATHS = [
    '/etc/passwd',
    '/etc/shadow',
    '/etc/sudoers',
    '/root/.ssh',
    '/home/*/.ssh',
];

// In-repo files/dirs that must never be touched by a self-modification call, even one made by
// an approved proposal: secrets, dependency manifests/lockfiles, CI config, core security/auth,
// migrations, and the self-modification tooling itself (to prevent disabling safety checks).
export const BLOCKED_RELATIVE_PATTERNS = [
    /^\.env(\..*)?$/,
    /(^|\/)\.env(\..*)?$/,
    /^package\.json$/,
    /^package-lock\.json$/,
    /^pnpm-lock\.yaml$/,
    /^yarn\.lock$/,
    /(^|\/)\.github\/workflows\//,
    /(^|\/)\.git\//,
    /(^|\/)server\/domain\/tools\/v1\/capabilities\/self-modification\.ts$/,
    /(^|\/)server\/routes\/admin\/self-modification\.route\.ts$/,
    /(^|\/)server\/services\/self-modification-admin\.service\.ts$/,
    /(^|\/)server\/config\/env\.ts$/,
    /(^|\/)server\/utils\/auth-context\.ts$/,
    /(^|\/)server\/domain\/core\/auth\//,
    /(^|\/)migrations\//,
    /(^|\/)server\/migrate\.ts$/,
    /(^|\/)scripts\/lint-.*$/,
    /(^|\/)scripts\/check-.*$/,
];

const CODEBASE_ROOT = process.cwd();

// Audit logging
async function logAudit(context: ToolContext, operation: string, details: any) {
    const { db } = await import("@server/database_service.js");
    const { auditLogs } = await import("@shared/schema/index.js");
    
    try {
        await db.insert(auditLogs).values({
            userId: context?.userId ?? "system",
            organizationId: context?.organizationId ?? undefined,
            action: `self_modification_${operation}`,
            entityType: "self_modification",
            entityId: typeof details?.filePath === "string" ? details.filePath : undefined,
            metadata: details,
            ipAddress: context?.ipAddress || 'unknown',
        });
    } catch (err) {
        logger.error("Failed to log audit entry", err);
    }
}

// Safety validation
export function validateSafety(filePath: string, content: string): { safe: boolean; reason?: string } {
    // Check for dangerous patterns in content
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(content)) {
            return { safe: false, reason: "Content contains dangerous command pattern" };
        }
    }

    // Check protected paths
    const absolutePath = path.resolve(CODEBASE_ROOT, filePath);
    for (const protectedPath of PROTECTED_PATHS) {
        if (absolutePath.includes(protectedPath.replace('*', ''))) {
            return { safe: false, reason: "Attempted to modify protected system file" };
        }
    }

    // Ensure path is within codebase
    const relativePath = path.relative(CODEBASE_ROOT, absolutePath).split(path.sep).join("/");
    if (!absolutePath.startsWith(CODEBASE_ROOT) || relativePath.startsWith("..")) {
        return { safe: false, reason: "Path outside codebase root" };
    }

    // Check in-repo blocklist (secrets, manifests, lockfiles, CI config, self-modification tooling)
    for (const pattern of BLOCKED_RELATIVE_PATTERNS) {
        if (pattern.test(relativePath)) {
            return { safe: false, reason: `Path '${relativePath}' is in the self-modification blocklist` };
        }
    }

    // Pre-flight syntax validation for code and JSON content
    if (content && content.trim()) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === ".json") {
            try {
                JSON.parse(content);
            } catch (err: any) {
                return { safe: false, reason: `JSON syntax error: ${err.message}` };
            }
        } else if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
            try {
                const sf = ts.createSourceFile(
                    filePath,
                    content,
                    ts.ScriptTarget.Latest,
                    true,
                    ext === ".tsx" || ext === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
                );
                const parseErrors = (sf as any).parseDiagnostics;
                if (Array.isArray(parseErrors) && parseErrors.length > 0) {
                    const firstMsg = typeof parseErrors[0].messageText === "string"
                        ? parseErrors[0].messageText
                        : parseErrors[0].messageText?.messageText || "Syntax parsing error";
                    return { safe: false, reason: `Syntax error in proposed code: ${firstMsg}` };
                }
            } catch (err: any) {
                return { safe: false, reason: `Code validation error: ${err.message}` };
            }
        }
    }

    return { safe: true };
}

// Git operations
async function gitStatus(): Promise<string> {
    try {
        const { stdout } = await execAsync('git status --porcelain', { cwd: CODEBASE_ROOT });
        return stdout;
    } catch (err: any) {
        throw new Error(`Git status failed: ${err.message}`);
    }
}

async function gitDiff(filePath: string): Promise<string> {
    try {
        const { stdout } = await execFileAsync("git", ["diff", "--", filePath], { cwd: CODEBASE_ROOT });
        return stdout;
    } catch (err: any) {
        throw new Error(`Git diff failed: ${err.message}`);
    }
}

async function gitCommit(message: string, branch?: string): Promise<string> {
    try {
        if (branch) {
            const sanitizedBranch = branch.replace(/[^a-zA-Z0-9_\-\/]/g, "").slice(0, 60);
            if (sanitizedBranch) {
                const branchName = sanitizedBranch.startsWith("evolution/")
                    ? sanitizedBranch
                    : `evolution/${sanitizedBranch}`;
                await execFileAsync("git", ["checkout", "-B", branchName], { cwd: CODEBASE_ROOT });
            }
        }
        await execFileAsync("git", ["add", "-A"], { cwd: CODEBASE_ROOT });
        const { stdout } = await execFileAsync("git", ["commit", "-m", message], { cwd: CODEBASE_ROOT });
        return stdout;
    } catch (err: any) {
        throw new Error(`Git commit failed: ${err.message}`);
    }
}

async function gitCheckout(filePath: string, commit?: string): Promise<string> {
    try {
        // `git checkout <commit> -- <path>` restores the file from that commit; without a
        // commit, `git checkout -- <path>` restores it from the index/HEAD.
        const args = commit ? ["checkout", commit, "--", filePath] : ["checkout", "--", filePath];
        const { stdout } = await execFileAsync("git", args, { cwd: CODEBASE_ROOT });
        return stdout;
    } catch (err: any) {
        throw new Error(`Git checkout failed: ${err.message}`);
    }
}

async function createBackup(filePath: string): Promise<string> {
    const timestamp = Date.now();
    const backupPath = `${filePath}.backup-${timestamp}`;
    await fs.copyFile(filePath, backupPath);
    return backupPath;
}

export const SELF_MODIFICATION_TOOLS: Record<string, ToolDefinition> = {
    code_edit: {
        name: "code_edit",

        idempotency: "none",
        label: "Edit Code File",
        group: "Self-Modification",
        superAdminOnly: true,
        description: "Edit a file in the Oddjob codebase. Creates backup and Git commit. SUPER ADMIN ONLY.",
        parameters: z.object({
            filePath: z.string().describe("Relative path to the file within the codebase"),
            oldContent: z.string().describe("The exact content to replace (must match current file content)"),
            newContent: z.string().describe("The new content to write"),
            commitMessage: z.string().optional().describe("Git commit message (auto-generated if not provided)"),
            branch: z.string().optional().describe("Optional isolated evolution branch (e.g. fix-cache) to commit to"),
        }),
        execute: async ({ filePath, oldContent, newContent, commitMessage, branch }: any, context: ToolContext) => {
            // Super admin check
            if (!context?.isSuperAdmin) {
                return "Error: Super admin permissions required for code modification.";
            }

            const absolutePath = path.resolve(CODEBASE_ROOT, filePath);

            try {
                // Safety validation
                const safety = validateSafety(filePath, newContent);
                if (!safety.safe) {
                    await logAudit(context, "code_edit_blocked", { filePath, reason: safety.reason });
                    return `Error: ${safety.reason}`;
                }

                // Read current content
                const currentContent = await fs.readFile(absolutePath, 'utf-8');

                // Verify oldContent matches
                if (currentContent !== oldContent) {
                    await logAudit(context, "code_edit_mismatch", { filePath });
                    return "Error: oldContent does not match current file content. File may have been modified by another process.";
                }

                // Create backup
                const backupPath = await createBackup(absolutePath);
                logger.info(`Created backup: ${backupPath}`);

                // Write new content
                await fs.writeFile(absolutePath, newContent, 'utf-8');

                // Git commit
                const msg = commitMessage || `Self-modification: Edit ${filePath}`;
                await gitCommit(msg, branch);

                // Log audit
                await logAudit(context, "code_edit_success", { 
                    filePath, 
                    backupPath, 
                    commitMessage: msg,
                    branch,
                    changeSize: newContent.length - oldContent.length 
                });

                logger.info(`Successfully edited ${filePath}`);
                return `Successfully edited ${filePath}. Backup created at ${backupPath}. Git commit: ${msg}${branch ? ` (branch: evolution/${branch.replace(/^evolution\//, '')})` : ''}`;

            } catch (err: any) {
                await logAudit(context, "code_edit_failed", { filePath, error: err.message });
                return `Error editing file: ${err.message}`;
            }
        },
    },

    code_create: {
        name: "code_create",

        idempotency: "none",
        label: "Create Code File",
        group: "Self-Modification",
        superAdminOnly: true,
        description: "Create a new file in the Oddjob codebase. SUPER ADMIN ONLY.",
        parameters: z.object({
            filePath: z.string().describe("Relative path for the new file"),
            content: z.string().describe("Content to write to the new file"),
            commitMessage: z.string().optional().describe("Git commit message"),
            branch: z.string().optional().describe("Optional isolated evolution branch to commit to"),
        }),
        execute: async ({ filePath, content, commitMessage, branch }: any, context: ToolContext) => {
            if (!context?.isSuperAdmin) {
                return "Error: Super admin permissions required.";
            }

            const absolutePath = path.resolve(CODEBASE_ROOT, filePath);

            try {
                // Safety validation
                const safety = validateSafety(filePath, content);
                if (!safety.safe) {
                    await logAudit(context, "code_create_blocked", { filePath, reason: safety.reason });
                    return `Error: ${safety.reason}`;
                }

                // Check if file already exists
                try {
                    await fs.access(absolutePath);
                    return "Error: File already exists. Use code_edit to modify existing files.";
                } catch {
                    // File doesn't exist, proceed
                }

                // Ensure directory exists
                const dir = path.dirname(absolutePath);
                await fs.mkdir(dir, { recursive: true });

                // Write file
                await fs.writeFile(absolutePath, content, 'utf-8');

                // Git commit
                const msg = commitMessage || `Self-modification: Create ${filePath}`;
                await gitCommit(msg, branch);

                await logAudit(context, "code_create_success", { filePath, commitMessage: msg, branch });
                logger.info(`Successfully created ${filePath}`);
                return `Successfully created ${filePath}. Git commit: ${msg}${branch ? ` (branch: evolution/${branch.replace(/^evolution\//, '')})` : ''}`;

            } catch (err: any) {
                await logAudit(context, "code_create_failed", { filePath, error: err.message });
                return `Error creating file: ${err.message}`;
            }
        },
    },

    code_delete: {
        name: "code_delete",

        idempotency: "idempotent",
        label: "Delete Code File",
        group: "Self-Modification",
        superAdminOnly: true,
        description: "Delete a file from the Oddjob codebase. Creates backup and requires confirmation. SUPER ADMIN ONLY.",
        parameters: z.object({
            filePath: z.string().describe("Relative path to the file to delete"),
            confirm: z.boolean().describe("Must be true to confirm deletion"),
            commitMessage: z.string().optional().describe("Git commit message"),
            branch: z.string().optional().describe("Optional isolated evolution branch to commit to"),
        }),
        execute: async ({ filePath, confirm, commitMessage, branch }: any, context: ToolContext) => {
            if (!context?.isSuperAdmin) {
                return "Error: Super admin permissions required.";
            }

            if (!confirm) {
                return "Error: Deletion requires confirm=true parameter.";
            }

            const absolutePath = path.resolve(CODEBASE_ROOT, filePath);

            try {
                // Safety validation
                const safety = validateSafety(filePath, "");
                if (!safety.safe) {
                    await logAudit(context, "code_delete_blocked", { filePath, reason: safety.reason });
                    return `Error: ${safety.reason}`;
                }

                // Check if file exists
                await fs.access(absolutePath);

                // Create backup
                const backupPath = await createBackup(absolutePath);
                logger.info(`Created backup before deletion: ${backupPath}`);

                // Delete file
                await fs.unlink(absolutePath);

                // Git commit
                const msg = commitMessage || `Self-modification: Delete ${filePath}`;
                await gitCommit(msg, branch);

                await logAudit(context, "code_delete_success", { filePath, backupPath, commitMessage: msg, branch });
                logger.info(`Successfully deleted ${filePath}`);
                return `Successfully deleted ${filePath}. Backup preserved at ${backupPath}. Git commit: ${msg}${branch ? ` (branch: evolution/${branch.replace(/^evolution\//, '')})` : ''}`;

            } catch (err: any) {
                await logAudit(context, "code_delete_failed", { filePath, error: err.message });
                return `Error deleting file: ${err.message}`;
            }
        },
    },

    code_read: {
        name: "code_read",

        idempotency: "read-safe",
        label: "Read Code File",
        group: "Self-Modification",
        superAdminOnly: true,
        description: "Read a file from the Oddjob codebase. SUPER ADMIN ONLY.",
        parameters: z.object({
            filePath: z.string().describe("Relative path to the file to read"),
        }),
        execute: async ({ filePath }: any, context: ToolContext) => {
            if (!context?.isSuperAdmin) {
                return "Error: Super admin permissions required.";
            }

            const absolutePath = path.resolve(CODEBASE_ROOT, filePath);

            try {
                const content = await fs.readFile(absolutePath, 'utf-8');
                
                // Truncate if too large
                const maxLength = 50000;
                if (content.length > maxLength) {
                    return content.substring(0, maxLength) + `\n...(truncated, total ${content.length} chars)`;
                }
                
                await logAudit(context, "code_read_success", { filePath, size: content.length });
                return content;
            } catch (err: any) {
                await logAudit(context, "code_read_failed", { filePath, error: err.message });
                return `Error reading file: ${err.message}`;
            }
        },
    },

    code_diff: {
        name: "code_diff",

        idempotency: "read-safe",
        label: "View Code Diff",
        group: "Self-Modification",
        superAdminOnly: true,
        description: "View Git diff for a file or entire codebase. SUPER ADMIN ONLY.",
        parameters: z.object({
            filePath: z.string().optional().describe("Relative path to file (omit for full diff)"),
        }),
        execute: async ({ filePath }: any, context: ToolContext) => {
            if (!context?.isSuperAdmin) {
                return "Error: Super admin permissions required.";
            }

            try {
                const diff = filePath ? await gitDiff(filePath) : await execAsync('git diff', { cwd: CODEBASE_ROOT }).then(r => r.stdout);
                
                await logAudit(context, "code_diff_success", { filePath });
                return diff || "No changes detected.";
            } catch (err: any) {
                await logAudit(context, "code_diff_failed", { filePath, error: err.message });
                return `Error getting diff: ${err.message}`;
            }
        },
    },

    code_rollback: {
        name: "code_rollback",

        idempotency: "idempotent",
        label: "Rollback Code Change",
        group: "Self-Modification",
        superAdminOnly: true,
        description: "Rollback a file to a previous Git commit or restore from backup. SUPER ADMIN ONLY.",
        parameters: z.object({
            filePath: z.string().describe("Relative path to the file to rollback"),
            commit: z.string().optional().describe("Git commit hash to rollback to (omits to restore from latest backup)"),
            confirm: z.boolean().describe("Must be true to confirm rollback"),
        }),
        execute: async ({ filePath, commit, confirm }: any, context: ToolContext) => {
            if (!context?.isSuperAdmin) {
                return "Error: Super admin permissions required.";
            }

            if (!confirm) {
                return "Error: Rollback requires confirm=true parameter.";
            }

            const absolutePath = path.resolve(CODEBASE_ROOT, filePath);

            try {
                if (commit) {
                    // Git rollback
                    await gitCheckout(filePath, commit);
                    await logAudit(context, "code_rollback_git", { filePath, commit });
                    return `Successfully rolled back ${filePath} to commit ${commit}`;
                } else {
                    // Backup rollback
                    const backupFiles = await fs.readdir(path.dirname(absolutePath));
                    const backupFile = backupFiles
                        .filter(f => f.startsWith(path.basename(filePath) + '.backup-'))
                        .sort()
                        .pop();

                    if (!backupFile) {
                        return "Error: No backup found for this file.";
                    }

                    const backupPath = path.join(path.dirname(absolutePath), backupFile);
                    await fs.copyFile(backupPath, absolutePath);
                    
                    await logAudit(context, "code_rollback_backup", { filePath, backupFile });
                    return `Successfully restored ${filePath} from backup ${backupFile}`;
                }
            } catch (err: any) {
                await logAudit(context, "code_rollback_failed", { filePath, error: err.message });
                return `Error during rollback: ${err.message}`;
            }
        },
    },

    code_status: {
        name: "code_status",

        idempotency: "read-safe",
        label: "View Code Status",
        group: "Self-Modification",
        superAdminOnly: true,
        description: "View Git status and pending changes. SUPER ADMIN ONLY.",
        parameters: z.object({}),
        execute: async (_: any, context: ToolContext) => {
            if (!context?.isSuperAdmin) {
                return "Error: Super admin permissions required.";
            }

            try {
                const status = await gitStatus();
                const branch = await execAsync('git branch --show-current', { cwd: CODEBASE_ROOT }).then(r => r.stdout.trim());
                
                await logAudit(context, "code_status_success", {});
                return `Branch: ${branch}\n\nChanges:\n${status || "No uncommitted changes"}`;
            } catch (err: any) {
                await logAudit(context, "code_status_failed", { error: err.message });
                return `Error getting status: ${err.message}`;
            }
        },
    },

    ai_refactor: {
        name: "ai_refactor",

        idempotency: "none",
        label: "AI-Assisted Refactoring",
        group: "Self-Modification",
        superAdminOnly: true,
        description: "Use AI to suggest code refactoring. Does not apply changes automatically. SUPER ADMIN ONLY.",
        parameters: z.object({
            filePath: z.string().describe("Relative path to the file to refactor"),
            instruction: z.string().describe("Refactoring instruction (e.g., 'improve performance', 'add error handling')"),
        }),
        execute: async ({ filePath, instruction }: any, context: ToolContext) => {
            if (!context?.isSuperAdmin) {
                return "Error: Super admin permissions required.";
            }

            const absolutePath = path.resolve(CODEBASE_ROOT, filePath);

            try {
                // Read current content
                const content = await fs.readFile(absolutePath, 'utf-8');

                // Use AI for refactoring suggestion
                const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
                const client = AIClientFactory.getClient({ provider: "google" } as any);

                const prompt = `Refactor the following code according to this instruction: "${instruction}"\n\nFile: ${filePath}\n\nCode:\n${content}\n\nReturn ONLY the refactored code, no explanation.`;

                const result = await client.execute({
                    model: "gemini-2.0-flash",
                    temperature: 0.3,
                    maxTokens: 10000,
                    isPriority: false,
                    userPrompt: prompt,
                    systemPrompt: "You are a code refactoring expert. Output only valid code.",
                    useCache: false,
                    saveOutputToFile: false,
                }, undefined, developmentProviderKey());

                const refactoredCode = (result as any)?.text || (result as any)?.content || String(result);

                await logAudit(context, "ai_refactor_success", { filePath, instruction });
                return `Refactored code for ${filePath}:\n\n${refactoredCode}\n\nNOTE: This is a suggestion. Use code_edit with oldContent/newContent to apply changes.`;

            } catch (err: any) {
                await logAudit(context, "ai_refactor_failed", { filePath, error: err.message });
                return `Error during AI refactoring: ${err.message}`;
            }
        },
    },
};
