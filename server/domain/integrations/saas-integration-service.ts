import { db } from "@server/database_service.js";
import { datasets, graphSchemaDefs } from "@shared/schema/index.js";
import { eq, and, sql, isNull } from "drizzle-orm";
import { queueExtractionJob } from "../knowledge/knowledge-queue.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SaaSIntegrationService");

/**
 * Service to handle integration with SaaS platforms.
 */
export const saasIntegrationService = {
    /**
     * Triggers Knowledge Graph extraction from a SaaS platform's dataset.
     */
    triggerPlatformExtraction: async (platform: string, organizationId: number, userId: string) => {
        try {
            logger.info("Triggering platform extraction", { platform, organizationId });

            const orgCondition = organizationId === null ? isNull(datasets.organizationId) : eq(datasets.organizationId, organizationId);
            const schemaOrgCondition = organizationId === null ? isNull(graphSchemaDefs.organizationId) : eq(graphSchemaDefs.organizationId, organizationId);

            // 1. Find the platform-specific dataset
            const platformTag = `platform:${platform.toLowerCase()}`;
            const allDatasets = await db.select().from(datasets).where(orgCondition);
            const dataset = allDatasets.find(ds => ds.tags?.includes(platformTag));

            if (!dataset) {
                logger.warn("No dataset found for platform extraction", { platform, organizationId });
                return { success: false, message: `No dataset found for platform: ${platform}` };
            }

            // 2. Find a suitable graph schema
            let [schema] = await db
                .select()
                .from(graphSchemaDefs)
                .where(and(
                    schemaOrgCondition,
                    sql`LOWER(name) LIKE ${`%${platform.toLowerCase()}%`}`
                ))
                .orderBy(sql`id DESC`)
                .limit(1);

            if (!schema) {
                // Fallback to "Default extraction" or "General Knowledge" schema
                [schema] = await db
                    .select()
                    .from(graphSchemaDefs)
                    .where(and(
                        schemaOrgCondition,
                        sql`LOWER(name) IN ('default', 'general', 'standard', 'general knowledge', 'knowledge', 'default jira schema')`
                    ))
                    .orderBy(sql`id DESC`)
                    .limit(1);
            }

            if (!schema) {
                logger.warn("No graph schema found for platform extraction", { platform, organizationId });
                return { success: false, message: "No graph schema found for extraction" };
            }

            // 3. Queue the extraction job
            await queueExtractionJob({
                type: 'dataset',
                extractionId: 0, // 0 for synthetic/batch dataset extraction
                datasetId: dataset.id,
                schemaId: schema.id,
                organizationId
            });

            logger.info("SaaS extraction job queued successfully", { datasetId: dataset.id, schemaId: schema.id });
            return { success: true, message: "Extraction job queued successfully" };

        } catch (error: any) {
            logger.error("Failed to trigger platform extraction", error);
            return { success: false, message: error.message };
        }
    }
};


