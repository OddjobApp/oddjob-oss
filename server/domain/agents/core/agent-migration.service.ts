
import { db } from "@server/database_service.js";
import { jobs, agentDeployments } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { AgentDeploymentService } from "../agent-deployment.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AgentMigrationService");

export class AgentMigrationService {
    /**
     * Migrates legacy RBAC settings for a specific job into a deployment record.
     */
    static async migrateLegacyAgent(jobId: number): Promise<{ success: boolean; deploymentId?: number; message?: string }> {
        logger.info(`Starting migration for jobId: ${jobId}`);

        try {
            const job = await db.query.jobs.findFirst({
                where: eq(jobs.id, jobId)
            });

            if (!job) {
                return { success: false, message: "Job not found" };
            }

            const config = job.config as any;
            const rbac = config?.rbac;

            if (!rbac) {
                return { success: false, message: "No legacy RBAC settings found in job config" };
            }

            // Map legacy RBAC to deployment fields
            const deploymentData = {
                jobId: job.id,
                organizationId: job.organizationId!,
                title: job.name,
                slug: `${job.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${job.id}`,
                allowedTopicIds: rbac.topicIds || [],
                allowedDatasetIds: rbac.datasetIds || [],
                allowedPipelineIds: rbac.pipelineIds || [],
                allowedTools: rbac.allowedTools || [],
                isActive: true,
                createdBy: job.createdBy || 'system_migration',
            };

            const deployment = await AgentDeploymentService.upsert(deploymentData);

            logger.info(`Successfully migrated job ${jobId} to deployment ${deployment.id}`);
            return { success: true, deploymentId: deployment.id };

        } catch (error: any) {
            logger.error(`Migration failed for job ${jobId}:`, error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Batch migrates all agents of type 'agent_ai' or those containing 'rbac' in config.
     */
    static async batchMigrateLegacyAgents(organizationId?: number): Promise<{ total: number; successful: number; failed: number }> {
        logger.info("Starting batch migration of legacy agents");

        const legacyJobs = await db.select().from(jobs).where(
            organizationId ? eq(jobs.organizationId, organizationId) : undefined
        );

        let total = 0;
        let successful = 0;
        let failed = 0;

        for (const job of legacyJobs) {
            const config = job.config as any;
            if (job.type === 'agent_ai' || config?.rbac) {
                total++;
                const result = await this.migrateLegacyAgent(job.id);
                if (result.success) {
                    successful++;
                    // Optional: If 'agent_ai', convert to 'ai_agent'
                    if (job.type === 'agent_ai') {
                        await db.update(jobs)
                            .set({ type: 'ai_agent' })
                            .where(eq(jobs.id, job.id));
                    }
                } else {
                    failed++;
                }
            }
        }

        logger.info(`Batch migration complete. Total: ${total}, Success: ${successful}, Failed: ${failed}`);
        return { total, successful, failed };
    }
}
