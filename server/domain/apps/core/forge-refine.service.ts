
import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "@server/utils/logger.js";
import { forgeFoundationService } from "./forge-foundation.service.js";
import { FORGE_REFINE_PROMPT } from "./forge-prompts.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { AIClientFactory } from "../../ai/core/ai-client.service.js";
import type { DevelopmentPlan } from "./forge-plan.service.js";
import { db } from "../../../../server/database_service.js";
import { apps } from "../../../../shared/schema/index.js";
import { eq } from "drizzle-orm";
import { redis } from "../../core/infrastructure/redis/redis-client.js";
import { resolveForgeWorkspacePath, isWithinDirectory } from "./forge-paths.js";

const logger = createLogger("ForgeRefineService");

export interface RefineOptions {
    appId: number;
    appSlug: string;
    newPlan: DevelopmentPlan;
    userRequest: string;
    organizationId?: number;
    jobId?: string;
}

export const forgeRefineService = {
    /**
     * Surgically refine an existing app based on an updated plan.
     */
    async refineApp(options: RefineOptions) {
        const jobId = options.jobId || `refine-${options.appSlug}-${Date.now()}`;
        const workspacePath = await resolveForgeWorkspacePath(options.appSlug);

        logger.info(`[Refine] Starting refinement for ${options.appSlug} (Job: ${jobId})`);

        // 1. Initial State
        await redis.set(`forge:job:${jobId}`, JSON.stringify({
            status: 'building',
            progress: 10,
            message: 'Refinement initiated. Analyzing current codebase...',
            updatedAt: new Date().toISOString()
        }), 'EX', 3600);

        try {
            // 2. Load Current State
            const [appRecord] = await db.select().from(apps).where(eq(apps.id, options.appId));
            if (!appRecord) throw new Error("App not found");

            const oldPlan = appRecord.lastApprovedPlan || appRecord.developmentPlan;
            const snapshot = await forgeFoundationService.snapshotDirectory(workspacePath, 32000);
            const snapshotStr = Object.entries(snapshot).map(([p, c]) => `FILE: ${p}\nCONTENT:\n${c}`).join("\n\n---\n\n");

            // 3. AI Refinement Pass
            await redis.set(`forge:job:${jobId}`, JSON.stringify({
                status: 'building',
                progress: 40,
                message: 'Synthesizing surgical patches...',
                updatedAt: new Date().toISOString()
            }), 'EX', 3600);

            const aiConfig = await systemAiService.getAiConfig('codegen', options.organizationId);
            if (!aiConfig) throw new Error("AI Configuration (codegen) not found");
            const client = AIClientFactory.getClient(aiConfig as any);

            const userPrompt = JSON.stringify({
                currentCode: snapshotStr,
                oldPlan,
                newPlan: options.newPlan,
                userRequest: options.userRequest
            }, null, 2);

            const result = await client.execute({
                model: aiConfig.model,
                systemPrompt: FORGE_REFINE_PROMPT,
                userPrompt,
                requestType: "json",
                responseType: "json",
                maxTokens: 8192
            } as any, undefined, aiConfig.apiKey ?? "");

            if (!result.success || !result.output) {
                throw new Error(`Refinement synthesis failed: ${result.error}`);
            }

            const patches = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
            
            // 4. Apply Patches
            let applied = 0;
            const filesModified: string[] = [];
            for (const [relPath, content] of Object.entries(patches)) {
                if (typeof content !== 'string') continue;
                const fullPath = path.resolve(workspacePath, relPath as string);
                
                // Safety check: ensure we stay in workspace
                if (!isWithinDirectory(workspacePath, fullPath)) continue;

                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                await fs.writeFile(fullPath, content, "utf-8");
                applied++;
                filesModified.push(relPath);
            }

            // 5. Update Database
            await db.update(apps)
                .set({ 
                    developmentPlan: options.newPlan,
                    lastApprovedPlan: options.newPlan,
                    updatedAt: new Date()
                })
                .where(eq(apps.id, options.appId));

            await redis.set(`forge:job:${jobId}`, JSON.stringify({
                status: 'completed',
                progress: 100,
                message: `Refinement successful. Applied ${applied} patches.`,
                updatedAt: new Date().toISOString(),
                filesModified
            }), 'EX', 3600);

            logger.info(`[Refine] Completed refinement for ${options.appSlug}. Applied ${applied} patches.`);
            return { success: true, jobId, filesModified };

        } catch (err: any) {
            logger.error(`[Refine] Refinement failed: ${err.message}`);
            await redis.set(`forge:job:${jobId}`, JSON.stringify({
                status: 'failed',
                error: err.message,
                updatedAt: new Date().toISOString()
            }), 'EX', 3600 * 24);
            return { success: false, error: err.message };
        }
    }
};
