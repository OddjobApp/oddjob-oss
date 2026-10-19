import { db } from "../../../../database_service.js";
import { datasets, appRecords, type Dataset } from "@shared/schema/index.js";
import { and, eq, sql } from "drizzle-orm";
import { createLogger } from "../../../../utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "../../../jobs/job.service.js";
import { getOrgConditions } from "../../../../utils/index.js";
import { coreService } from "./core-service.js";

const logger = createLogger("DatasetPlatformService");

export const platformService = {
    /**
     * Distinct app-record collection names held by an organization.
     *
     * These are the names a platform block binds to — the `collection` prop of
     * PlatformDatasetTableBlock, resolved at runtime through
     * `/api/oddjob/datasets?collection=<name>` — so they come from app_records,
     * not from the `datasets` table.
     *
     * Takes a resolved `orgId` rather than an OrgContext on purpose:
     * `app_records.org_id` is NOT NULL, so there is no global/shared row for a
     * null-org caller to legitimately see, and getOrgConditions' super-admin
     * branch returns no filter at all — which here would list every tenant's
     * collection names. The caller resolves the org with requireOrgId instead.
     */
    async listCollections(orgId: number): Promise<string[]> {
        return withQueryTracking("datasetService.listCollections", async () => {
            const rows = await db
                .selectDistinct({ collection: appRecords.collection })
                .from(appRecords)
                .where(eq(appRecords.orgId, orgId))
                .orderBy(appRecords.collection);
            return rows.map((r) => r.collection).filter(Boolean);
        });
    },

    /**
     * Ensure a platform-specific dataset exists (Get or Create)
     */
    async ensurePlatformDataset(platform: string, orgContext: OrgContext): Promise<Dataset> {
        return withQueryTracking("datasetService.ensurePlatformDataset", async () => {
            const platformTag = `platform:${platform.toLowerCase()}`;

            // 1. Try to find existing dataset by tag
            const conditions = [
                sql`${datasets.tags} @> ARRAY[${platformTag}]::text[]`,
                ...getOrgConditions(orgContext)
            ];

            let [dataset] = await db
                .select()
                .from(datasets)
                .where(and(...conditions))
                .limit(1);

            if (dataset) return dataset;

            // 2. Create if not found
            const platformNames: Record<string, string> = {
                'jira': 'Jira Issues',
                'confluence': 'Confluence Pages',
                'github': 'GitHub Activities',
                'slack': 'Slack Messages'
            };

            const name = platformNames[platform.toLowerCase()] || `${platform.charAt(0).toUpperCase() + platform.slice(1)} Data`;

            // Default Knowledge Config for Confluence
            let knowledgeConfig: any = {};
            if (platform.toLowerCase() === 'confluence') {
                knowledgeConfig = {
                    entityRules: [{
                        id: 'confluence-page',
                        name: 'Confluence Page',
                        entityType: 'ConfluencePage',
                        label: 'ConfluencePage',
                        rootPath: '$',
                        mappings: {
                            name: '$.data.title',
                            externalId: '$.data.id',
                            data: '$.data'
                        },
                        includeFullSourceData: true
                    }]
                };
            }

            return await coreService.create({
                name,
                description: `Automatically created dataset for ${platform} integration.`,
                tags: [platformTag, 'auto-created'],
                schemaMapping: {
                    autoFlatten: true
                },
                knowledgeConfig
            }, orgContext);
        }, { table: "datasets", operation: "insert" });
    },
};


