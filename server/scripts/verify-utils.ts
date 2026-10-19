
import { db } from "../database_service.js";
import { pipelines, jobs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

/**
 * Shared utilities for verification scripts.
 */
export const verifyUtils = {
    /**
     * Finds a pipeline by its name. 
     * Useful for stable testing when IDs might change across seeds.
     */
    async findPipelineByName(name: string) {
        const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.name, name)).limit(1);
        return pipeline;
    },

    /**
     * Finds a job by its name.
     */
    async findJobByName(name: string) {
        const [job] = await db.select().from(jobs).where(eq(jobs.name, name)).limit(1);
        return job;
    },

    /**
     * Standard success/fail logger with timestamps.
     */
    logResult(testName: string, success: boolean, message?: string) {
        const timestamp = new Date().toLocaleTimeString();
        if (success) {
            console.log(`[${timestamp}] ✅ SUCCESS: ${testName} ${message ? `- ${message}` : ''}`);
        } else {
            console.error(`[${timestamp}] ❌ FAILED: ${testName} ${message ? `- ${message}` : ''}`);
        }
    },

    /**
     * Common cleanup logic for test data.
     */
    async cleanupPipeline(pipelineId: number) {
        // Implementation depends on cascade or manual cleanup
        // For now, just log that we are cleaning up
        console.log(`[Cleanup] Removing test pipeline ${pipelineId}...`);
    }
};

