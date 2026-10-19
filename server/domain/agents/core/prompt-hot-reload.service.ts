/**
 * Prompt Hot-Reload Service
 * 
 * Watches for changes to agent system prompt files and reloads them
 * into the job config without requiring a full cycle reinstall.
 * 
 * Multi-org safety:
 * - Reload operations are scoped to a specific orgId
 * - Validates that the prompt file hasn't been corrupted (min length, no binary)
 * - Logs all prompt changes for audit trail
 * - Previous prompt is preserved in metadata for rollback
 */

import { db } from "@server/database_service.js";
import { jobs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PromptHotReload");

// Minimum prompt length to prevent accidental blank/corrupt overwrite
const MIN_PROMPT_LENGTH = 50;
// Maximum prompt length (safety valve)
const MAX_PROMPT_LENGTH = 100000;

export const promptHotReloadService = {
    /**
     * Reload all agent system prompts for an organization.
     * Validates content before applying.
     */
    async reloadAll(orgId: number): Promise<{ reloaded: number; failed: number; skipped: number; errors: string[] }> {
        let reloaded = 0;
        let failed = 0;
        let skipped = 0;
        const errors: string[] = [];

        const { inArray } = await import("drizzle-orm");
        const agentJobs = await db.select({ id: jobs.id, name: jobs.name, config: jobs.config })
            .from(jobs)
            .where(and(eq(jobs.organizationId, orgId), inArray(jobs.type, ["ai_agent", "agent_ai"])));

        for (const job of agentJobs) {
            const config = job.config as any;
            if (!config?.systemPromptSource || !config.systemPromptSource.startsWith("file://")) {
                skipped++;
                continue;
            }

            try {
                const newContent = await this.readPromptFile(config.systemPromptSource);
                
                // Validate content
                const validation = this.validatePromptContent(newContent, job.name);
                if (!validation.valid) {
                    failed++;
                    errors.push(`${job.name}: ${validation.reason}`);
                    continue;
                }

                if (newContent === config.systemPrompt) {
                    skipped++; // No change
                    continue;
                }

                // Store previous prompt for rollback capability
                const previousPrompt = config.systemPrompt;
                
                await db.update(jobs)
                    .set({
                        config: { 
                            ...config, 
                            systemPrompt: newContent,
                            _previousPrompt: previousPrompt,
                            _promptReloadedAt: new Date().toISOString(),
                        },
                        updatedAt: new Date()
                    })
                    .where(eq(jobs.id, job.id));
                
                reloaded++;
                logger.info(`[PromptHotReload] Reloaded prompt for "${job.name}" (org ${orgId}) from ${config.systemPromptSource}`);
            } catch (err: any) {
                failed++;
                errors.push(`${job.name}: ${err.message}`);
                logger.warn(`[PromptHotReload] Failed to reload prompt for "${job.name}": ${err.message}`);
            }
        }

        logger.info(`[PromptHotReload] Org ${orgId}: reloaded=${reloaded}, skipped=${skipped}, failed=${failed}`);
        return { reloaded, failed, skipped, errors };
    },

    /**
     * Reload a single agent's system prompt by job ID.
     * Validates org ownership before modifying.
     */
    async reloadAgent(jobId: number, requestingOrgId?: number): Promise<{ success: boolean; error?: string }> {
        const [job] = await db.select({ config: jobs.config, name: jobs.name, organizationId: jobs.organizationId })
            .from(jobs).where(eq(jobs.id, jobId)).limit(1);

        if (!job) return { success: false, error: "Job not found" };

        // Org isolation check
        if (requestingOrgId && job.organizationId !== requestingOrgId) {
            return { success: false, error: "Access denied: job belongs to a different organization" };
        }

        const config = job.config as any;
        if (!config?.systemPromptSource || !config.systemPromptSource.startsWith("file://")) {
            return { success: false, error: "No file-based system prompt source configured" };
        }

        try {
            const newContent = await this.readPromptFile(config.systemPromptSource);
            
            const validation = this.validatePromptContent(newContent, job.name || "unknown");
            if (!validation.valid) {
                return { success: false, error: validation.reason };
            }

            const previousPrompt = config.systemPrompt;
            
            await db.update(jobs)
                .set({
                    config: { 
                        ...config, 
                        systemPrompt: newContent,
                        _previousPrompt: previousPrompt,
                        _promptReloadedAt: new Date().toISOString(),
                    },
                    updatedAt: new Date()
                })
                .where(eq(jobs.id, jobId));

            logger.info(`[PromptHotReload] Reloaded prompt for "${job.name}" (job ${jobId})`);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    },

    /**
     * Rollback a prompt to its previous version.
     */
    async rollback(jobId: number, requestingOrgId?: number): Promise<{ success: boolean; error?: string }> {
        const [job] = await db.select({ config: jobs.config, name: jobs.name, organizationId: jobs.organizationId })
            .from(jobs).where(eq(jobs.id, jobId)).limit(1);

        if (!job) return { success: false, error: "Job not found" };
        if (requestingOrgId && job.organizationId !== requestingOrgId) {
            return { success: false, error: "Access denied" };
        }

        const config = job.config as any;
        if (!config?._previousPrompt) {
            return { success: false, error: "No previous prompt version available for rollback" };
        }

        await db.update(jobs)
            .set({
                config: {
                    ...config,
                    systemPrompt: config._previousPrompt,
                    _previousPrompt: config.systemPrompt, // Swap so you can un-rollback
                    _promptRolledBackAt: new Date().toISOString(),
                },
                updatedAt: new Date()
            })
            .where(eq(jobs.id, jobId));

        logger.info(`[PromptHotReload] Rolled back prompt for "${job.name}" (job ${jobId})`);
        return { success: true };
    },

    /**
     * Validate prompt content before applying.
     */
    validatePromptContent(content: string | null, agentName: string): { valid: boolean; reason?: string } {
        if (!content) {
            return { valid: false, reason: `File not found or empty for ${agentName}` };
        }
        if (content.length < MIN_PROMPT_LENGTH) {
            return { valid: false, reason: `Prompt too short (${content.length} chars < ${MIN_PROMPT_LENGTH} minimum) for ${agentName}. Possible corruption.` };
        }
        if (content.length > MAX_PROMPT_LENGTH) {
            return { valid: false, reason: `Prompt too long (${content.length} chars > ${MAX_PROMPT_LENGTH} maximum) for ${agentName}.` };
        }
        // Check for binary/garbage content
        const nonPrintableRatio = (content.match(/[^\x20-\x7E\n\r\t]/g) || []).length / content.length;
        if (nonPrintableRatio > 0.1) {
            return { valid: false, reason: `Prompt appears to contain binary data (${(nonPrintableRatio * 100).toFixed(1)}% non-printable) for ${agentName}.` };
        }
        return { valid: true };
    },

    /**
     * Read a prompt file from the file:// reference.
     */
    async readPromptFile(source: string): Promise<string | null> {
        const relativePath = source.replace("file://", "");
        const projectRoot = path.resolve(process.cwd());

        const candidates = [
            path.resolve(projectRoot, relativePath),
            path.resolve(projectRoot, "server/cycles", relativePath),
            path.resolve(projectRoot, "knowledge", relativePath.replace("knowledge/", "")),
        ];

        for (const candidate of candidates) {
            // Reject any path that escapes the project root
            if (!candidate.startsWith(projectRoot + path.sep)) continue;
            try {
                const content = await fs.readFile(candidate, "utf-8");
                return content;
            } catch {
                continue;
            }
        }

        return null;
    },
};
