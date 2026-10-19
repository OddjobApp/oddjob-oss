/**
 * Self-Improving App Forge Service
 *
 * Research backing (ICLR 2026 Workshop): Recursive self-improvement (RSI)
 * where LLM agents analyze runtime errors and automatically suggest fixes.
 *
 * Features:
 * - Error pattern analysis from .client-errors.log and container logs
 * - AI-powered root cause analysis
 * - Automatic patch generation
 * - Fix validation and deployment
 * - Success rate tracking
 */

import path from "node:path";
import fs from "node:fs/promises";
import { db } from "@server/database_service.js";
import { appDeployments, appInstances, apps } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { dockerBridgeService } from "@domain/core/infrastructure/docker/docker-bridge.service.js";
import { createLogger } from "@server/utils/logger.js";
import { aiRateLimiter, type AIProvider } from "@server/utils/ai-rate-limiter.js";
import { spawnSync } from "child_process";
import { FORGE_WORKSPACE_ROOT } from "./forge-paths.js";
import { orgJsonCompletion } from "@domain/ai/core/org-json-completion.js";

const logger = createLogger("ForgeSelfHeal");

export interface ErrorPattern {
    id: string;
    pattern: string;
    errorType: string;
    frequency: number;
    firstSeen: Date;
    lastSeen: Date;
    affectedFiles: string[];
    suggestedFix?: string;
}

export interface GeneratedFix {
    id: string;
    appId: number;
    errorPattern: ErrorPattern;
    originalCode: string;
    fixedCode: string;
    filePath: string;
    explanation: string;
    confidence: number;
    status: "pending" | "validated" | "applied" | "failed" | "reverted";
    createdAt: Date;
    appliedAt?: Date;
}

export interface FixMetrics {
    totalFixes: number;
    successRate: number;
    avgTimeToFix: number; // minutes
    topErrorPatterns: ErrorPattern[];
    fixesByType: Record<string, number>;
}

/**
 * Self-Healing Forge Service
 */
export const forgeSelfHealService = {
    /**
     * Analyze errors from an app and generate fixes
     */
    async analyzeAndFix(appId: number, organizationId: number): Promise<{
        patterns: ErrorPattern[];
        fixes: GeneratedFix[];
        applied: number;
    }> {
        const startTime = Date.now();
        logger.info("Starting self-heal analysis", { appId, organizationId });

        // Step 1: Fetch and analyze error logs
        const patterns = await this.analyzeErrorPatterns(appId, organizationId);
        logger.info(`Found ${patterns.length} error patterns`, { appId });

        // Step 2: Generate fixes for each pattern
        const fixes: GeneratedFix[] = [];
        for (const pattern of patterns.slice(0, 5)) { // Limit to top 5 patterns
            const fix = await this.generateFix(appId, pattern, organizationId);
            if (fix && fix.confidence > 0.7) {
                fixes.push(fix);
            }
        }

        // Step 3: Validate and apply fixes
        let applied = 0;
        for (const fix of fixes) {
            const success = await this.validateAndApplyFix(fix, appId, organizationId);
            if (success) applied++;
        }

        const duration = Date.now() - startTime;
        logger.info("Self-heal cycle complete", {
            appId,
            patternsFound: patterns.length,
            fixesGenerated: fixes.length,
            fixesApplied: applied,
            durationMs: duration
        });

        return { patterns, fixes, applied };
    },

    /**
     * Fetch and analyze error patterns from logs
     */
    async analyzeErrorPatterns(appId: number, organizationId: number): Promise<ErrorPattern[]> {
        const workspacePath = path.join(FORGE_WORKSPACE_ROOT, `app_${appId}`);
        const errors: string[] = [];

        // Fetch container logs
        try {
            const [deployment] = await db
                .select({ id: appDeployments.id })
                .from(appDeployments)
                .where(and(
                    eq(appDeployments.appId, appId),
                    eq(appDeployments.status, "active")
                ))
                .limit(1);

            if (deployment) {
                const [instance] = await db
                    .select({ containerId: appInstances.containerId })
                    .from(appInstances)
                    .where(and(
                        eq(appInstances.deploymentId, deployment.id),
                        eq(appInstances.status, "running")
                    ))
                    .limit(1);

                if (instance?.containerId) {
                    const logs = await dockerBridgeService.getLogs(instance.containerId, 200);
                    errors.push(...this.extractErrorsFromLogs(logs));
                }
            }
        } catch (err: any) {
            logger.warn(`Could not fetch container logs: ${err.message}`, { appId });
        }

        // Fetch client-side errors
        try {
            const clientLogPath = path.join(workspacePath, ".client-errors.log");
            const raw = await fs.readFile(clientLogPath, "utf-8");
            const entries = raw.trim().split("\n").filter(Boolean).slice(-100);
            errors.push(...entries);
        } catch {
            // No client errors log
        }

        // Analyze patterns using AI
        return this.identifyPatternsWithAI(errors, appId, organizationId);
    },

    /**
     * Extract structured errors from raw logs
     */
    extractErrorsFromLogs(logs: string[]): string[] {
        const errorPatterns = [
            /Error:|error:|ERROR:/,
            /Exception|EXCEPTION/,
            /TypeError|ReferenceError|SyntaxError/,
            /failed|Failed|FAILED/,
            /cannot|Cannot|CANNOT/,
            /undefined is not/,
            /Cannot read property/,
            /Module not found/,
            /404|500|503/
        ];

        return logs.filter(line =>
            errorPatterns.some(pattern => pattern.test(line))
        );
    },

    /**
     * Use AI to identify patterns in errors
     */
    async identifyPatternsWithAI(
        errors: string[],
        appId: number,
        organizationId: number
    ): Promise<ErrorPattern[]> {
        if (errors.length === 0) return [];

        const systemPrompt = `You are an error analysis expert. Analyze these error messages and identify distinct error patterns.

For each pattern, provide:
1. Pattern name (e.g., "Missing Import", "TypeError in Component")
2. Error type/category
3. Most common form of the error
4. Files likely affected (guess based on error context)

Output as JSON array:
[
    {
        "pattern": "descriptive name",
        "errorType": "category",
        "frequency": number,
        "affectedFiles": ["file1.tsx", "file2.ts"]
    }
]

Focus on actionable patterns that can be automatically fixed.`;

        try {
            const result = await aiRateLimiter.execute(
                "google" as AIProvider,
                organizationId,
                async () => {
                    const patterns = await orgJsonCompletion<any>({
                        organizationId,
                        systemPrompt,
                        userPrompt: `Errors:\n${errors.slice(0, 50).join('\n')}`,
                        temperature: 0.3,
                    });
                    return (patterns.patterns || patterns) as ErrorPattern[];
                },
                {
                    priority: 2,
                    estimatedTokens: { input: 2000, output: 500 },
                    model: "gemini-2.5-flash"
                }
            );

            const now = new Date();
            return result.map((p: ErrorPattern) => ({
                ...p,
                id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                frequency: p.frequency || 1,
                firstSeen: now,
                lastSeen: now
            }));

        } catch (error) {
            logger.error("Pattern analysis failed", { error, appId });
            return [];
        }
    },

    /**
     * Generate a fix for an error pattern
     */
    async generateFix(
        appId: number,
        pattern: ErrorPattern,
        organizationId: number
    ): Promise<GeneratedFix | null> {
        const workspacePath = path.join(FORGE_WORKSPACE_ROOT, `app_${appId}`);

        // Read affected files
        const fileContents: Record<string, string> = {};
        for (const filePath of pattern.affectedFiles.slice(0, 3)) {
            try {
                const fullPath = path.resolve(workspacePath, filePath);
                if (!fullPath.startsWith(workspacePath + path.sep)) {
                    logger.warn("Path traversal attempt blocked in generateFix", { filePath });
                    continue;
                }
                const content = await fs.readFile(fullPath, 'utf-8');
                fileContents[filePath] = content;
            } catch {
                // File may not exist
            }
        }

        if (Object.keys(fileContents).length === 0) return null;

        const systemPrompt = `You are an expert TypeScript/React developer who fixes code errors.

Given an error pattern and source code, generate a fix that:
1. Addresses the root cause of the error
2. Maintains type safety
3. Follows React/Next.js best practices
4. Includes clear comments explaining the fix

Output as JSON:
{
    "filePath": "path to file",
    "originalCode": "the problematic code section",
    "fixedCode": "the corrected code",
    "explanation": "why this fixes the error",
    "confidence": 0.85 // 0-1 confidence score
}`;

        const userPrompt = `Error Pattern: ${pattern.pattern}
Error Type: ${pattern.errorType}

Files to fix:
${Object.entries(fileContents).map(([fp, content]) => `
--- ${fp} ---
${content.substring(0, 3000)}
`).join('\n')}

Generate a fix for the most critical error in these files.`;

        try {
            const result = await aiRateLimiter.execute(
                "google" as AIProvider,
                organizationId,
                async () => {
                    return orgJsonCompletion({ organizationId, systemPrompt, userPrompt, temperature: 0.2 });
                },
                {
                    priority: 2,
                    estimatedTokens: { input: 4000, output: 1500 },
                    model: "gemini-2.5-flash"
                }
            );

            if (result.confidence < 0.7) {
                logger.info("Fix confidence too low, skipping", { appId, confidence: result.confidence });
                return null;
            }

            const fix: GeneratedFix = {
                id: `fix_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                appId,
                errorPattern: pattern,
                originalCode: result.originalCode,
                fixedCode: result.fixedCode,
                filePath: result.filePath,
                explanation: result.explanation,
                confidence: result.confidence,
                status: "pending",
                createdAt: new Date()
            };

            // Note: Fix storage would require forge_fixes table
            // For now, fixes are stored in memory and logged

            return fix;

        } catch (error) {
            logger.error("Fix generation failed", { error, appId, pattern: pattern.pattern });
            return null;
        }
    },

    /**
     * Validate and apply a generated fix
     */
    async validateAndApplyFix(
        fix: GeneratedFix,
        appId: number,
        organizationId: number
    ): Promise<boolean> {
        const workspacePath = path.join(FORGE_WORKSPACE_ROOT, `app_${appId}`);
        const fullPath = path.resolve(workspacePath, fix.filePath);
        if (!fullPath.startsWith(workspacePath + path.sep)) {
            logger.warn("Path traversal attempt blocked in validateAndApplyFix", { filePath: fix.filePath });
            return false;
        }

        try {
            // Read current file content
            const currentContent = await fs.readFile(fullPath, 'utf-8');

            // Verify the original code appears exactly once (safety: don't patch ambiguous content)
            const occurrences = currentContent.split(fix.originalCode).length - 1;
            if (occurrences === 0) {
                logger.warn("Original code not found, fix may be stale", {
                    appId,
                    filePath: fix.filePath
                });
                return false;
            }
            if (occurrences > 1) {
                logger.warn("Original code is ambiguous (multiple occurrences), skipping fix", {
                    appId,
                    filePath: fix.filePath,
                    occurrences
                });
                return false;
            }

            // Apply the fix (exactly one occurrence confirmed above)
            const newContent = currentContent.replace(fix.originalCode, fix.fixedCode);
            await fs.writeFile(fullPath, newContent, 'utf-8');

            // Validate TypeScript syntax
            try {
                const tscResult = spawnSync("npx", ["tsc", "--noEmit", "--skipLibCheck", fullPath], {
                    cwd: workspacePath,
                    timeout: 30000,
                    encoding: "utf-8"
                });
                if (tscResult.status !== 0) {
                    throw new Error(tscResult.stderr || tscResult.stdout || "tsc failed");
                }
            } catch (error) {
                // TypeScript validation failed, revert
                await fs.writeFile(fullPath, currentContent, 'utf-8');
                logger.error("Fix failed TypeScript validation, reverted", {
                    appId,
                    filePath: fix.filePath
                });

                return false;
            }

            // Note: Fix status tracking would require forge_fixes table

            // Note: Fix attempt tracking would require forge_fix_attempts table

            logger.info("Fix applied successfully", {
                appId,
                filePath: fix.filePath,
                fixId: fix.id
            });

            return true;

        } catch (error) {
            logger.error("Failed to apply fix", { error, appId, fixId: fix.id });
            return false;
        }
    },

    /**
     * Get fix metrics for an organization
     */
    async getFixMetrics(_organizationId: number, _since?: Date): Promise<FixMetrics> {
        throw new Error("Not implemented: getFixMetrics requires forge_fixes and forge_fix_attempts tables");
    },

    /**
     * Trigger a self-heal cycle for all apps in an organization
     */
    async runSelfHealForOrganization(organizationId: number): Promise<{
        appsProcessed: number;
        totalFixesApplied: number;
    }> {
        const orgApps = await db.select()
            .from(apps)
            .where(eq(apps.organizationId, organizationId));

        let totalFixesApplied = 0;

        for (const app of orgApps) {
            try {
                const result = await this.analyzeAndFix(app.id, organizationId);
                totalFixesApplied += result.applied;
            } catch (error) {
                logger.error(`Self-heal failed for app ${app.id}`, { error });
            }
        }

        return {
            appsProcessed: orgApps.length,
            totalFixesApplied
        };
    }
};

export default forgeSelfHealService;
