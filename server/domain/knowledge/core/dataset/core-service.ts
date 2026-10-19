import { db } from "../../../../database_service.js";
import { datasets, type Dataset } from "@shared/schema/index.js";
import { eq, and, desc, inArray, type SQL } from "drizzle-orm";
import { NotFoundError, ConflictError } from "@server/utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "../../../../domain/jobs/job.service.js";
import { getOrgConditions } from "../../../../utils/index.js";
import type { CreateDatasetInput, UpdateDatasetInput, DatasetListOptions } from "./types.js";

const logger = createLogger("DatasetCoreService");

export const coreService = {
    /**
     * List datasets
     */
    async list(orgContext: OrgContext, options: DatasetListOptions = {}): Promise<Dataset[]> {
        return withQueryTracking("datasetService.list", async () => {
            const conditions: SQL[] = getOrgConditions(orgContext);

            if (options.datasetIds && options.datasetIds.length > 0) {
                conditions.push(inArray(datasets.id, options.datasetIds));
            }

            let query = db
                .select()
                .from(datasets)
                .where(and(...conditions))
                .orderBy(desc(datasets.createdAt));

            if (options.limit) {
                query = query.limit(options.limit) as typeof query;
            }
            if (options.offset) {
                query = query.offset(options.offset) as typeof query;
            }

            return await query;
        }, { table: "datasets", operation: "select" });
    },

    /**
     * Get dataset by ID
     */
    async getById(datasetId: number, orgContext: OrgContext): Promise<Dataset> {
        return withQueryTracking("datasetService.getById", async () => {
            const conditions = [eq(datasets.id, datasetId), ...getOrgConditions(orgContext)];

            const [dataset] = await db.select().from(datasets).where(and(...conditions)).limit(1);
            if (!dataset) {
                throw new NotFoundError("Dataset not found");
            }

            return dataset;
        }, { table: "datasets", operation: "select" });
    },

    /**
     * Create a dataset
     */
    async create(input: CreateDatasetInput, orgContext: OrgContext): Promise<Dataset> {
        return withQueryTracking("datasetService.create", async () => {
            // Dataset names are namespaced per project (datasets_project_name_unique),
            // so two projects may each own a "Fleet Telemetry" dataset, and the
            // duplicate check below must be scoped to the project or it would reject
            // names the database now considers legal.
            //
            // The project arrives from the caller rather than being resolved here:
            // scope belongs at the request boundary (withProjectScope), and resolving
            // it inside the service would add a DB round-trip to every create. With no
            // project supplied the row stays unnamespaced and falls under the
            // datasets_org_name_unique_unassigned partial index — i.e. exactly today's
            // org-wide behaviour.
            const projectId = input.projectId ?? null;

            const existing = await db
                .select()
                .from(datasets)
                .where(and(
                    eq(datasets.name, input.name),
                    // Fall back to the org scope when there is no project, which matches
                    // the datasets_org_name_unique_unassigned partial index.
                    projectId ? eq(datasets.projectId, projectId) : undefined,
                    ...(projectId ? [] : getOrgConditions(orgContext)),
                ))
                .limit(1);

            if (existing.length > 0) {
                throw new ConflictError("Dataset with this name already exists in this project");
            }

            const [dataset] = await db.insert(datasets).values({
                name: input.name,
                description: input.description,
                tags: input.tags || [],
                schemaMapping: input.schemaMapping || {},
                knowledgeConfig: input.knowledgeConfig || {},
                validationRules: input.validationRules || {},
                organizationId: orgContext.organizationId,
                ...(projectId ? { projectId } : {}),
                ...(input.missionId ? { missionId: input.missionId } : {}),
            }).returning();

            logger.info("Dataset created", { datasetId: dataset.id, name: dataset.name });
            return dataset;
        }, { table: "datasets", operation: "insert" });
    },

    /**
     * Update a dataset
     */
    async update(datasetId: number, input: UpdateDatasetInput, orgContext: OrgContext): Promise<Dataset> {
        return withQueryTracking("datasetService.update", async () => {
            const conditions = [eq(datasets.id, datasetId), ...getOrgConditions(orgContext)];

            const [existing] = await db.select().from(datasets).where(and(...conditions)).limit(1);
            if (!existing) {
                throw new NotFoundError("Dataset not found");
            }

            const updateData: any = { ...input };
            // Remove helper fields not in schema
            delete updateData.datasetType;
            delete updateData.config;

            const [updated] = await db
                .update(datasets)
                .set({ ...updateData, updatedAt: new Date() })
                .where(and(...conditions))
                .returning();

            logger.info("Dataset updated", { datasetId });
            return updated;
        }, { table: "datasets", operation: "update" });
    },

    /**
     * Delete a dataset and its items
     */
    async delete(datasetId: number, orgContext: OrgContext): Promise<void> {
        return withQueryTracking("datasetService.delete", async () => {
            // Verify access
            await this.getById(datasetId, orgContext);

            const conditions = [eq(datasets.id, datasetId), ...getOrgConditions(orgContext)];
            await db.delete(datasets).where(and(...conditions));

            logger.info("Dataset deleted", { datasetId });
        }, { table: "datasets", operation: "delete" });
    },
};


