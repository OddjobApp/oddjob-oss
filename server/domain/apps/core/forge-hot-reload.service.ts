/**
 * Hot-Reload AI Service for Code Generation
 *
 * Research backing (Anthropic 2026 Trends): Agentic coding systems moving
 * from simple autocomplete to tighter feedback loops and faster learning cycles.
 *
 * Features:
 * - Incremental patches instead of full rebuilds
 * - Live error monitoring with instant fix generation
 * - Fast feedback loop: Change → Test → Fix in seconds
 * - Targeted patch generation based on error patterns
 */

import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "@server/utils/logger.js";
import { aiRateLimiter, type AIProvider } from "@server/utils/ai-rate-limiter.js";
import { spawnSync } from "child_process";
import * as chokidar from "chokidar";
import { FORGE_WORKSPACE_ROOT } from "./forge-paths.js";
import { orgJsonCompletion } from "@domain/ai/core/org-json-completion.js";

const logger = createLogger("ForgeHotReload");

export interface HotReloadSession {
    id: string;
    appId: number;
    organizationId: number;
    workspacePath: string;
    watchPaths: string[];
    isActive: boolean;
    lastBuildTime: Date;
    pendingChanges: FileChange[];
    errorState: ErrorState;
}

export interface FileChange {
    path: string;
    type: "modified" | "added" | "deleted";
    timestamp: Date;
    content?: string;
}

export interface ErrorState {
    hasErrors: boolean;
    errors: LiveError[];
    lastErrorCheck: Date;
}

export interface LiveError {
    file: string;
    line: number;
    column: number;
    message: string;
    severity: "error" | "warning";
    code?: string;
}

export interface GeneratedPatch {
    id: string;
    targetFile: string;
    originalRange: { start: number; end: number };
    replacement: string;
    explanation: string;
    confidence: number;
    isValidated: boolean;
}

/**
 * Hot-Reload AI Service
 */
export class ForgeHotReloadService {
    private sessions: Map<string, HotReloadSession> = new Map();
    private watchers: Map<string, chokidar.FSWatcher> = new Map();

    /**
     * Start a hot-reload session for an app
     */
    async startSession(appId: number, organizationId: number): Promise<HotReloadSession> {
        const sessionId = `hotreload_${appId}_${Date.now()}`;
        const workspacePath = path.join(FORGE_WORKSPACE_ROOT, `app_${appId}`);

        logger.info("Starting hot-reload session", { sessionId, appId });

        const session: HotReloadSession = {
            id: sessionId,
            appId,
            organizationId,
            workspacePath,
            watchPaths: [
                path.join(workspacePath, "pages/**/*"),
                path.join(workspacePath, "components/**/*"),
                path.join(workspacePath, "src/**/*"),
                path.join(workspacePath, "lib/**/*")
            ],
            isActive: true,
            lastBuildTime: new Date(),
            pendingChanges: [],
            errorState: { hasErrors: false, errors: [], lastErrorCheck: new Date() }
        };

        this.sessions.set(sessionId, session);

        // Set up file watcher
        await this.setupWatcher(session);

        return session;
    }

    /**
     * Set up file watcher for hot reload
     */
    private async setupWatcher(session: HotReloadSession): Promise<void> {
        const watcher = chokidar.watch(session.watchPaths, {
            ignored: /node_modules/,
            persistent: true,
            ignoreInitial: true
        });

        watcher.on("change", async (filePath) => {
            if (!session.isActive) return;

            logger.debug("File changed", { sessionId: session.id, file: filePath });

            const change: FileChange = {
                path: filePath,
                type: "modified",
                timestamp: new Date()
            };

            session.pendingChanges.push(change);

            // Debounce: wait for changes to settle
            await this.debounceAndProcess(session);
        });

        this.watchers.set(session.id, watcher);
    }

    /**
     * Debounce and process pending changes
     */
    private debouncers: Map<string, NodeJS.Timeout> = new Map();

    private async debounceAndProcess(session: HotReloadSession): Promise<void> {
        const existing = this.debouncers.get(session.id);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
            this.debouncers.delete(session.id);
            await this.processChanges(session);
        }, 500);

        this.debouncers.set(session.id, timer);
    }

    /**
     * Process pending changes with fast feedback loop
     */
    private async processChanges(session: HotReloadSession): Promise<void> {
        if (session.pendingChanges.length === 0) return;

        const changes = [...session.pendingChanges];
        session.pendingChanges = [];

        logger.info("Processing changes", {
            sessionId: session.id,
            changeCount: changes.length
        });

        // Step 1: Quick TypeScript check (fast feedback)
        const typeCheck = await this.fastTypeCheck(session, changes);

        if (!typeCheck.success) {
            // Step 2: Generate targeted patch for type errors
            const patches = await this.generateErrorPatches(
                session,
                typeCheck.errors,
                changes
            );

            // Step 3: Apply validated patches
            for (const patch of patches) {
                if (patch.confidence > 0.8) {
                    await this.applyPatch(session, patch);
                }
            }
        }

        session.lastBuildTime = new Date();
    }

    /**
     * Fast TypeScript check on changed files only
     */
    private async fastTypeCheck(
        session: HotReloadSession,
        changes: FileChange[]
    ): Promise<{ success: boolean; errors: LiveError[] }> {
        const errors: LiveError[] = [];

        for (const change of changes) {
            try {
                // Run tsc on single file for fast feedback
                const tscResult = spawnSync("npx", ["tsc", "--noEmit", "--skipLibCheck", change.path], {
                    cwd: session.workspacePath,
                    timeout: 5000,
                    encoding: "utf-8"
                });
                if (tscResult.status !== 0) {
                    throw Object.assign(new Error("tsc failed"), { stdout: tscResult.stdout, message: tscResult.stderr || tscResult.stdout });
                }
            } catch (error: any) {
                // Parse TypeScript errors
                const output = error.stdout?.toString() || error.message;
                const parsedErrors = this.parseTypeScriptErrors(output, change.path);
                errors.push(...parsedErrors);
            }
        }

        session.errorState = {
            hasErrors: errors.length > 0,
            errors,
            lastErrorCheck: new Date()
        };

        return { success: errors.length === 0, errors };
    }

    /**
     * Parse TypeScript compiler output
     */
    private parseTypeScriptErrors(output: string, filePath: string): LiveError[] {
        const errors: LiveError[] = [];
        const lines = output.split("\n");

        for (const line of lines) {
            // Parse: file.ts(line,col): error TS1234: message
            const match = line.match(/(\w+\.tsx?)[\(](\d+),(\d+)[\)]:\s*(error|warning)\s*(TS\d+)?:\s*(.+)/);
            if (match) {
                errors.push({
                    file: match[1],
                    line: parseInt(match[2], 10),
                    column: parseInt(match[3], 10),
                    severity: match[4] as "error" | "warning",
                    code: match[5],
                    message: match[6]
                });
            }
        }

        return errors;
    }

    /**
     * Generate targeted patches for errors
     */
    private async generateErrorPatches(
        session: HotReloadSession,
        errors: LiveError[],
        changes: FileChange[]
    ): Promise<GeneratedPatch[]> {
        const patches: GeneratedPatch[] = [];

        // Group errors by file
        const errorsByFile = new Map<string, LiveError[]>();
        for (const error of errors) {
            if (!errorsByFile.has(error.file)) {
                errorsByFile.set(error.file, []);
            }
            errorsByFile.get(error.file)!.push(error);
        }

        // Generate patch for each file with errors
        for (const [filePath, fileErrors] of errorsByFile) {
            const fullPath = path.resolve(session.workspacePath, filePath);
            if (!fullPath.startsWith(session.workspacePath + path.sep)) {
                logger.warn("Path traversal attempt blocked", { filePath });
                continue;
            }
            const content = await fs.readFile(fullPath, "utf-8");

            const patch = await this.generatePatchWithAI(
                session,
                filePath,
                content,
                fileErrors
            );

            if (patch) {
                patches.push(patch);
            }
        }

        return patches;
    }

    /**
     * Generate patch using AI
     */
    private async generatePatchWithAI(
        session: HotReloadSession,
        filePath: string,
        content: string,
        errors: LiveError[]
    ): Promise<GeneratedPatch | null> {
        const systemPrompt = `You are an expert TypeScript/React developer fixing compilation errors.

Generate a minimal, targeted patch that fixes the errors. Output as JSON:
{
    "targetFile": "path",
    "originalRange": { "start": lineNumber, "end": lineNumber },
    "replacement": "new code",
    "explanation": "why this fixes it",
    "confidence": 0.9
}

Rules:
1. Fix the root cause, not just the symptoms
2. Keep changes minimal - only modify what's necessary
3. Ensure TypeScript type safety
4. Maintain React best practices
5. If unsure, return lower confidence`;

        const errorContext = errors.map(e =>
            `Line ${e.line}, Col ${e.column}: ${e.message} (${e.code || "TS Error"})`
        ).join("\n");

        const userPrompt = `File: ${filePath}

Errors:
${errorContext}

File content (first 200 lines):
${content.split("\n").slice(0, 200).join("\n")}

Generate a patch to fix these errors.`;

        try {
            const result = await aiRateLimiter.execute(
                "google" as AIProvider,
                session.organizationId,
                async () => {
                    return orgJsonCompletion({ organizationId: session.organizationId, systemPrompt, userPrompt, temperature: 0.1 });
                },
                {
                    priority: 1, // High priority for hot reload
                    estimatedTokens: { input: 2000, output: 500 },
                    model: "gemini-2.5-flash"
                }
            );

            if (result.confidence < 0.7) {
                logger.info("Patch confidence too low, skipping", {
                    filePath,
                    confidence: result.confidence
                });
                return null;
            }

            return {
                id: `patch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                targetFile: filePath,
                originalRange: result.originalRange,
                replacement: result.replacement,
                explanation: result.explanation,
                confidence: result.confidence,
                isValidated: false
            };

        } catch (error) {
            logger.error("Patch generation failed", { error, filePath });
            return null;
        }
    }

    /**
     * Apply a generated patch
     */
    private async applyPatch(session: HotReloadSession, patch: GeneratedPatch): Promise<void> {
        const fullPath = path.join(session.workspacePath, patch.targetFile);

        try {
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");

            // Extract lines to replace (1-indexed to 0-indexed)
            const start = patch.originalRange.start - 1;
            const end = patch.originalRange.end;

            // Create new content
            const newLines = [
                ...lines.slice(0, start),
                patch.replacement,
                ...lines.slice(end)
            ];

            // Validate TypeScript before applying
            const tempContent = newLines.join("\n");
            const tempFile = `${fullPath}.temp`;
            await fs.writeFile(tempFile, tempContent, "utf-8");

            try {
                const tscResult = spawnSync("npx", ["tsc", "--noEmit", "--skipLibCheck", tempFile], {
                    cwd: session.workspacePath,
                    timeout: 5000,
                    encoding: "utf-8"
                });
                if (tscResult.status !== 0) {
                    throw new Error(tscResult.stderr || tscResult.stdout || "tsc failed");
                }

                // Validation passed, apply the patch
                await fs.writeFile(fullPath, tempContent, "utf-8");
                await fs.unlink(tempFile);

                patch.isValidated = true;

                logger.info("Patch applied successfully", {
                    sessionId: session.id,
                    file: patch.targetFile,
                    patchId: patch.id
                });

            } catch (validationError) {
                // Validation failed, discard patch
                await fs.unlink(tempFile);
                logger.warn("Patch validation failed, discarded", {
                    file: patch.targetFile,
                    patchId: patch.id
                });
            }

        } catch (error) {
            logger.error("Failed to apply patch", { error, patchId: patch.id });
        }
    }

    /**
     * Get session status
     */
    getSession(sessionId: string): HotReloadSession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Stop a hot-reload session
     */
    async stopSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        session.isActive = false;

        // Stop watcher
        const watcher = this.watchers.get(sessionId);
        if (watcher) {
            await watcher.close();
            this.watchers.delete(sessionId);
        }

        this.sessions.delete(sessionId);

        logger.info("Hot-reload session stopped", { sessionId });
    }

    /**
     * Force immediate check and fix cycle
     */
    async forceCheck(sessionId: string): Promise<{ errors: LiveError[]; patchesApplied: number }> {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(`Session ${sessionId} not found`);

        // Trigger immediate processing
        const typeCheck = await this.fastTypeCheck(session, []);

        let patchesApplied = 0;
        if (!typeCheck.success) {
            const patches = await this.generateErrorPatches(
                session,
                typeCheck.errors,
                []
            );

            for (const patch of patches) {
                if (patch.confidence > 0.8) {
                    await this.applyPatch(session, patch);
                    patchesApplied++;
                }
            }
        }

        return {
            errors: typeCheck.errors,
            patchesApplied
        };
    }
}

// Singleton instance
export const forgeHotReloadService = new ForgeHotReloadService();

export default forgeHotReloadService;
