import { db } from "@server/database_service.js";
import {
    jobCollections,
    jobCollectionItems,
    jobs,
    operationalCycles,
    missions,
    missionCollectionExecutions,
    type JobCollection,
    type InsertJobCollection,
    type InsertMissionCollectionExecution,
} from "@shared/schema/index.js";
import { eq, and, or, sql, desc, inArray } from "drizzle-orm";
import { orgs } from "@shared/schema/index.js";
import { NotFoundError, UnauthorizedError, ForbiddenError } from "@server/utils/errors.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { getOrgConditions } from "@server/utils/org-conditions.js";

/**
 * Service for managing job collections
 */
export const collectionService = {
    /**
     * List collections for an organization, enriched with Cycle and Mission metadata
     */
    async listCollections(orgContext: OrgContext): Promise<any[]> {
        const baseOrgConditions = getOrgConditions(orgContext, jobCollections, true);

        // Include Oddjob System Organization collections if present
        const [systemOrg] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.name, "Oddjob System")).limit(1);

        const conditions = [...baseOrgConditions];
        // An empty base means "every org" (super admin, no org selected) —
        // OR-ing the system org onto it would narrow that to the system org.
        if (systemOrg && systemOrg.id !== orgContext.organizationId && baseOrgConditions.length > 0) {
            conditions.push(eq(jobCollections.organizationId, systemOrg.id));
        }

        const query = db
            .select({
                id: jobCollections.id,
                name: jobCollections.name,
                description: jobCollections.description,
                organizationId: jobCollections.organizationId,
                createdBy: jobCollections.createdBy,
                createdAt: jobCollections.createdAt,
                updatedAt: jobCollections.updatedAt,
                missionId: jobCollections.missionId,
                cycleId: jobCollections.cycleId,
                tags: jobCollections.tags,
                templateId: jobCollections.templateId,
                isSmart: jobCollections.isSmart,
                cycleName: operationalCycles.name,
                missionName: missions.name,
            })
            .from(jobCollections)
            .leftJoin(operationalCycles, eq(jobCollections.cycleId, operationalCycles.id))
            .leftJoin(missions, eq(jobCollections.missionId, missions.id))
            .where(conditions.length > 0 ? or(...conditions) : undefined)
            .orderBy(desc(jobCollections.updatedAt));

        let collections = await query;

        // Auto-seed default collections grouped by Cycle & Mission if none exist
        if (collections.length === 0 && orgContext.organizationId != null) {
            try {
                // Fetch active cycles & missions strictly scoped to this organization
                const activeCycles = await db
                    .select()
                    .from(operationalCycles)
                    .where(eq(operationalCycles.organizationId, orgContext.organizationId))
                    .limit(5);
                const activeMissions = await db
                    .select()
                    .from(missions)
                    .where(eq(missions.organizationId, orgContext.organizationId))
                    .limit(5);
                const availableJobs = await db
                    .select()
                    .from(jobs)
                    .where(eq(jobs.organizationId, orgContext.organizationId))
                    .limit(10);

                if (activeCycles.length > 0 || activeMissions.length > 0) {
                    // Create a collection per cycle/mission combo or default cycle
                    for (const cycle of activeCycles) {
                        const [newCol] = await db.insert(jobCollections).values({
                            name: `${cycle.name} - Agent Fleet`,
                            description: `Auto-grouped agent collection for operational cycle: ${cycle.name}`,
                            organizationId: orgContext.organizationId,
                            createdBy: "system",
                            cycleId: cycle.id,
                            tags: ["Cycle", "Active"],
                        }).returning();

                        // Add available jobs to collection
                        if (newCol && availableJobs.length > 0) {
                            await db.insert(jobCollectionItems).values(
                                availableJobs.slice(0, 3).map((j) => ({
                                    collectionId: newCol.id,
                                    jobId: j.id,
                                }))
                            ).catch(() => {});
                        }
                    }
                } else {
                    // Fallback default collection
                    const [defaultCol] = await db.insert(jobCollections).values({
                        name: "Default Operational Cycle Collection",
                        description: "Default agent collection grouped by Operational Cycle & Mission",
                        organizationId: orgContext.organizationId,
                        createdBy: "system",
                        tags: ["Cycle", "General"],
                    }).returning();

                    if (defaultCol && availableJobs.length > 0) {
                        await db.insert(jobCollectionItems).values(
                            availableJobs.map((j) => ({
                                collectionId: defaultCol.id,
                                jobId: j.id,
                            }))
                        ).catch(() => {});
                    }
                }

                // Re-query collections
                collections = await query;
            } catch (seedErr: any) {
                console.warn("[CollectionService] Failed to auto-seed default collections:", seedErr.message);
            }
        }

        if (collections.length === 0) return [];

        const collectionIds = collections.map((c) => c.id);
        const allItems = await db
            .select({ collectionId: jobCollectionItems.collectionId, jobId: jobCollectionItems.jobId })
            .from(jobCollectionItems)
            .where(inArray(jobCollectionItems.collectionId, collectionIds));

        const itemsByCollection = new Map<number, number[]>();
        for (const item of allItems) {
            const list = itemsByCollection.get(item.collectionId) ?? [];
            list.push(item.jobId);
            itemsByCollection.set(item.collectionId, list);
        }

        return collections.map((c) => ({
            ...c,
            cycleName: c.cycleName || (c.cycleId ? `Cycle #${c.cycleId}` : "Unassigned Cycle"),
            missionName: c.missionName || (c.missionId ? `Mission #${c.missionId}` : "General Mission"),
            jobCount: itemsByCollection.get(c.id)?.length ?? 0,
            jobIds: itemsByCollection.get(c.id) ?? [],
        }));
    },

    /**
     * Create a new collection
     */
    async create(input: InsertJobCollection, orgContext: OrgContext): Promise<JobCollection> {
        const [collection] = await db.insert(jobCollections).values({
            ...input,
            organizationId: orgContext.organizationId,
            createdBy: "system", // Fallback or extract from context if available
        }).returning();

        return collection;
    },

    /**
     * Get collection detail with jobs
     */
    async getCollectionById(id: number, orgContext: OrgContext): Promise<any> {
        const [collection] = await db.select().from(jobCollections).where(eq(jobCollections.id, id)).limit(1);

        if (!collection) throw new NotFoundError("Collection not found");

        if (collection.organizationId && collection.organizationId !== orgContext.organizationId && !orgContext.isSuperAdmin) {
            throw new ForbiddenError("Access denied");
        }

        const items = await db
            .select({
                job: {
                    id: jobs.id,
                    name: jobs.name,
                    isActive: jobs.isActive,
                    type: jobs.type,
                    createdAt: jobs.createdAt,
                    updatedAt: jobs.updatedAt
                }
            })
            .from(jobCollectionItems)
            .innerJoin(jobs, eq(jobs.id, jobCollectionItems.jobId))
            .where(eq(jobCollectionItems.collectionId, id));
        return { ...collection, jobs: items.map(i => i.job) };
    },

    /**
     * Get collection and full job records for testing
     */
    async getCollectionForTesting(id: number, orgContext: OrgContext): Promise<{ collection: JobCollection; jobs: any[] }> {
        const conditions = [eq(jobCollections.id, id), ...getOrgConditions(orgContext, jobCollections, false)];

        const [collection] = await db.select().from(jobCollections).where(and(...conditions));
        if (!collection) throw new NotFoundError("Collection not found or access denied");

        const items = await db
            .select({ job: jobs })
            .from(jobCollectionItems)
            .innerJoin(jobs, eq(jobs.id, jobCollectionItems.jobId))
            .where(eq(jobCollectionItems.collectionId, id));

        return { collection, jobs: items.map(i => i.job) };
    },

    /**
     * Update collection
     */
    async updateCollection(id: number, data: Partial<InsertJobCollection>, orgContext: OrgContext): Promise<JobCollection> {
        const conditions = [eq(jobCollections.id, id), ...getOrgConditions(orgContext, jobCollections, false)];

        const [updated] = await db.update(jobCollections)
            .set({ ...data, updatedAt: new Date() })
            .where(and(...conditions))
            .returning();

        if (!updated) throw new NotFoundError("Collection not found or access denied");
        return updated;
    },

    /**
     * Delete collection
     */
    async deleteCollection(id: number, orgContext: OrgContext): Promise<void> {
        const conditions = [eq(jobCollections.id, id), ...getOrgConditions(orgContext, jobCollections, false)];

        const result = await db.delete(jobCollections).where(and(...conditions));
        if (result.rowCount === 0) throw new NotFoundError("Collection not found or access denied");
    },

    /**
     * Add jobs to collection
     */
    async addJobsToCollection(id: number, jobIds: number[], orgContext: OrgContext): Promise<{ added: number }> {
        // Check collection existence and ownership
        const conditions = [eq(jobCollections.id, id), ...getOrgConditions(orgContext, jobCollections, false)];

        const [collection] = await db.select().from(jobCollections).where(and(...conditions)).limit(1);
        if (!collection) throw new NotFoundError("Collection not found or access denied");

        const existing = await db.select().from(jobCollectionItems).where(and(eq(jobCollectionItems.collectionId, id), inArray(jobCollectionItems.jobId, jobIds)));
        const existingJobIds = new Set(existing.map(e => e.jobId));

        const toInsert = jobIds.filter(jid => !existingJobIds.has(jid)).map(jid => ({
            collectionId: id,
            jobId: jid
        }));

        if (toInsert.length > 0) {
            await db.insert(jobCollectionItems).values(toInsert);
        }

        return { added: toInsert.length };
    },

    /**
     * Remove job from collection
     */
    async removeJobFromCollection(id: number, jobId: number, orgContext: OrgContext): Promise<void> {
        const conditions = [eq(jobCollections.id, id), ...getOrgConditions(orgContext, jobCollections, false)];

        const [collection] = await db.select().from(jobCollections).where(and(...conditions)).limit(1);
        if (!collection) throw new NotFoundError("Collection not found or access denied");

        await db.delete(jobCollectionItems)
            .where(and(eq(jobCollectionItems.collectionId, id), eq(jobCollectionItems.jobId, jobId)));
    },

    /**
     * Search collections by tags or name
     */
    async searchCollections(query: string, tags: string[], orgContext: OrgContext): Promise<any[]> {
        const conditions = [...getOrgConditions(orgContext, jobCollections, true)];

        // Text search on name/description
        if (query) {
            conditions.push(or(
                sql`LOWER(${jobCollections.name}) LIKE ${`%${query.toLowerCase()}%`}`,
                sql`LOWER(${jobCollections.description}) LIKE ${`%${query.toLowerCase()}%`}`
            )!);
        }

        // Tag filter
        if (tags && tags.length > 0) {
            for (const tag of tags) {
                conditions.push(sql`${jobCollections.tags} @> ${JSON.stringify([tag])}`);
            }
        }

        const collections = await db.select()
            .from(jobCollections)
            .where(and(...conditions))
            .orderBy(desc(jobCollections.updatedAt));

        if (collections.length === 0) return [];

        const collectionIds = collections.map(c => c.id);
        const allItems = await db.select({ collectionId: jobCollectionItems.collectionId, jobId: jobCollectionItems.jobId })
            .from(jobCollectionItems)
            .where(inArray(jobCollectionItems.collectionId, collectionIds));

        const itemsByCollection = new Map<number, number[]>();
        for (const item of allItems) {
            const list = itemsByCollection.get(item.collectionId) ?? [];
            list.push(item.jobId);
            itemsByCollection.set(item.collectionId, list);
        }

        return collections.map(c => ({
            ...c,
            jobCount: itemsByCollection.get(c.id)?.length ?? 0,
            jobIds: itemsByCollection.get(c.id) ?? [],
        }));
    },

    /**
     * Get collection execution statistics
     */
    async getCollectionStats(id: number, orgContext: OrgContext): Promise<any> {
        const [collection] = await db.select().from(jobCollections).where(eq(jobCollections.id, id)).limit(1);
        if (!collection) throw new NotFoundError("Collection not found");

        if (collection.organizationId && collection.organizationId !== orgContext.organizationId && !orgContext.isSuperAdmin) {
            throw new ForbiddenError("Access denied");
        }

        // Get all jobs in collection with their runs
        const items = await db
            .select({ job: jobs })
            .from(jobCollectionItems)
            .innerJoin(jobs, eq(jobs.id, jobCollectionItems.jobId))
            .where(eq(jobCollectionItems.collectionId, id));

        const jobIds = items.map(i => i.job.id);
        const jobList = items.map(i => i.job);

        // Aggregate stats (would need jobRuns table for real implementation)
        const totalAgents = jobList.length;
        const activeAgents = jobList.filter(j => j.isActive).length;
        const agentsWithSchedule = jobList.filter(j => (j.config as any)?.schedule).length;

        // Calculate resource usage from agent configs
        const datasetsUsed = new Set<number>();
        const knowledgeTopicsUsed = new Set<number>();
        const toolsUsed = new Set<string>();

        for (const job of jobList) {
            const config = job.config as any;
            if (job.outputDatasetId) datasetsUsed.add(job.outputDatasetId);
            if (config?.datasetId) datasetsUsed.add(config.datasetId);
            if (job.outputKnowledgeTopicId) knowledgeTopicsUsed.add(job.outputKnowledgeTopicId);
            if (config?.knowledgeTopicId) knowledgeTopicsUsed.add(config.knowledgeTopicId);
            if (job.tool && job.tool !== "None") toolsUsed.add(job.tool);
            if (config?.tool) toolsUsed.add(config.tool);
        }

        return {
            collection: {
                id: collection.id,
                name: collection.name,
                isSmart: collection.isSmart,
                templateId: collection.templateId,
            },
            agents: {
                total: totalAgents,
                active: activeAgents,
                withSchedule: agentsWithSchedule,
                list: jobList.map(j => ({
                    id: j.id,
                    name: j.name,
                    isActive: j.isActive,
                    type: j.type,
                })),
            },
            resources: {
                datasets: datasetsUsed.size,
                knowledgeTopics: knowledgeTopicsUsed.size,
                tools: Array.from(toolsUsed),
            },
            // Placeholder for execution metrics (would need jobRuns table)
            execution: {
                totalRuns: 0,
                successRate: 0,
                lastRunAt: null,
                avgDuration: 0,
            },
        };
    },

    /**
     * Get agent dependency graph for a collection
     */
    async getDependencyGraph(id: number, orgContext: OrgContext): Promise<any> {
        const [collection] = await db.select().from(jobCollections).where(eq(jobCollections.id, id)).limit(1);
        if (!collection) throw new NotFoundError("Collection not found");

        if (collection.organizationId && collection.organizationId !== orgContext.organizationId && !orgContext.isSuperAdmin) {
            throw new ForbiddenError("Access denied");
        }

        // Get all jobs in collection with full config
        const items = await db
            .select({ job: jobs })
            .from(jobCollectionItems)
            .innerJoin(jobs, eq(jobs.id, jobCollectionItems.jobId))
            .where(eq(jobCollectionItems.collectionId, id));

        const jobsList = items.map(i => i.job);

        // Build nodes
        const nodes = jobsList.map(job => ({
            id: `agent-${job.id}`,
            type: "agent",
            label: job.name,
            data: {
                id: job.id,
                name: job.name,
                isActive: job.isActive,
                type: job.type,
            },
        }));

        // Add resource nodes
        const resourceNodes: any[] = [];
        const edges: any[] = [];

        for (const job of jobsList) {
            const config = job.config as any;

            // Dataset outputs
            if (job.outputDatasetId) {
                const datasetNodeId = `dataset-${job.outputDatasetId}`;
                if (!resourceNodes.find(n => n.id === datasetNodeId)) {
                    resourceNodes.push({
                        id: datasetNodeId,
                        type: "dataset",
                        label: `Dataset ${job.outputDatasetId}`,
                    });
                }
                edges.push({
                    id: `edge-${job.id}-${job.outputDatasetId}`,
                    source: `agent-${job.id}`,
                    target: datasetNodeId,
                    label: "outputs to",
                });
            }

            // Dataset inputs
            if (config?.datasetId) {
                const datasetNodeId = `dataset-${config.datasetId}`;
                if (!resourceNodes.find(n => n.id === datasetNodeId)) {
                    resourceNodes.push({
                        id: datasetNodeId,
                        type: "dataset",
                        label: `Dataset ${config.datasetId}`,
                    });
                }
                edges.push({
                    id: `edge-${config.datasetId}-${job.id}`,
                    source: datasetNodeId,
                    target: `agent-${job.id}`,
                    label: "feeds",
                });
            }

            // Knowledge topics
            if (job.outputKnowledgeTopicId) {
                const topicNodeId = `topic-${job.outputKnowledgeTopicId}`;
                if (!resourceNodes.find(n => n.id === topicNodeId)) {
                    resourceNodes.push({
                        id: topicNodeId,
                        type: "knowledge",
                        label: `Knowledge ${job.outputKnowledgeTopicId}`,
                    });
                }
                edges.push({
                    id: `edge-${job.id}-${job.outputKnowledgeTopicId}`,
                    source: `agent-${job.id}`,
                    target: topicNodeId,
                    label: "learns",
                });
            }
        }

        return {
            nodes: [...nodes, ...resourceNodes],
            edges,
            metadata: {
                totalAgents: jobsList.length,
                totalResources: resourceNodes.length,
                totalConnections: edges.length,
            },
        };
    },

    /**
     * Record a collection execution as part of a mission
     */
    async recordMissionExecution(
        data: InsertMissionCollectionExecution,
        orgContext: OrgContext
    ): Promise<any> {
        const [execution] = await db.insert(missionCollectionExecutions).values({
            ...data,
            organizationId: orgContext.organizationId,
        }).returning();
        return execution;
    },

    /**
     * Update execution status and results
     */
    async updateMissionExecution(
        executionId: number,
        status: string,
        results?: any,
        orgContext?: OrgContext
    ): Promise<any> {
        const [execution] = await db.update(missionCollectionExecutions)
            .set({
                status,
                results,
                completedAt: new Date(),
                durationMs: results?.durationMs,
            })
            .where(eq(missionCollectionExecutions.id, executionId))
            .returning();
        return execution;
    },

    /**
     * Get collections executed as part of a mission
     */
    async getCollectionsByMission(missionId: number, orgContext: OrgContext): Promise<any[]> {
        const conditions = [
            eq(missionCollectionExecutions.missionId, missionId),
            ...getOrgConditions(orgContext, missionCollectionExecutions, false),
        ];

        const executions = await db
            .select({
                execution: missionCollectionExecutions,
                collection: jobCollections,
            })
            .from(missionCollectionExecutions)
            .innerJoin(jobCollections, eq(jobCollections.id, missionCollectionExecutions.collectionId))
            .where(and(...conditions))
            .orderBy(desc(missionCollectionExecutions.startedAt));

        return executions.map(e => ({
            ...e.execution,
            collection: e.collection,
        }));
    },

    /**
     * Get missions that have executed a collection
     */
    async getMissionsByCollection(collectionId: number, orgContext: OrgContext): Promise<any[]> {
        const [collection] = await db.select().from(jobCollections).where(eq(jobCollections.id, collectionId)).limit(1);
        if (!collection) throw new NotFoundError("Collection not found");

        if (collection.organizationId && collection.organizationId !== orgContext.organizationId && !orgContext.isSuperAdmin) {
            throw new ForbiddenError("Access denied");
        }

        const executions = await db
            .select()
            .from(missionCollectionExecutions)
            .where(eq(missionCollectionExecutions.collectionId, collectionId))
            .orderBy(desc(missionCollectionExecutions.startedAt))
            .limit(50);

        return executions;
    },

    /**
     * Get execution history for a collection with mission context
     */
    async getCollectionExecutionHistory(
        collectionId: number,
        limit: number = 20,
        orgContext: OrgContext
    ): Promise<any[]> {
        const [collection] = await db.select().from(jobCollections).where(eq(jobCollections.id, collectionId)).limit(1);
        if (!collection) throw new NotFoundError("Collection not found");

        if (collection.organizationId && collection.organizationId !== orgContext.organizationId && !orgContext.isSuperAdmin) {
            throw new ForbiddenError("Access denied");
        }

        const executions = await db
            .select()
            .from(missionCollectionExecutions)
            .where(eq(missionCollectionExecutions.collectionId, collectionId))
            .orderBy(desc(missionCollectionExecutions.startedAt))
            .limit(limit);

        return executions;
    },

    /**
     * Get collection items with linked resources
     */
    async getCollectionItems(id: number, orgContext: OrgContext): Promise<any> {
        const [collection] = await db.select().from(jobCollections).where(eq(jobCollections.id, id)).limit(1);
        if (!collection) throw new NotFoundError("Collection not found");
        if (collection.organizationId && collection.organizationId !== orgContext.organizationId && !orgContext.isSuperAdmin) {
            throw new ForbiddenError("Access denied");
        }

        const agentItems = await db
            .select({ job: jobs })
            .from(jobCollectionItems)
            .innerJoin(jobs, eq(jobs.id, jobCollectionItems.jobId))
            .where(eq(jobCollectionItems.collectionId, id));
        const agents = agentItems.map(i => i.job);

        const datasetIds = new Set<number>();
        const topicIds = new Set<number>();
        const policyIds = new Set<number>();
        const tools = new Set<string>();

        for (const agent of agents) {
            const config = agent.config as any;
            if (!config) continue;

            if (agent.outputDatasetId) datasetIds.add(agent.outputDatasetId);
            if (config.datasetId) datasetIds.add(config.datasetId);
            if (config.outputDatasetId) datasetIds.add(config.outputDatasetId);

            if (agent.outputKnowledgeTopicId) topicIds.add(agent.outputKnowledgeTopicId);
            if (config.knowledgeTopicId) topicIds.add(config.knowledgeTopicId);
            if (config.outputTopicId) topicIds.add(config.outputTopicId);
            if (config.topicId) topicIds.add(config.topicId);

            if (agent.governorPolicyId) policyIds.add(agent.governorPolicyId);
            if (config.governorPolicyId) policyIds.add(config.governorPolicyId);
            if (config.policyId) policyIds.add(config.policyId);

            if (agent.tool && agent.tool !== "None") tools.add(agent.tool);
            if (config.tool) tools.add(config.tool);
            if (config.tools?.length) config.tools.forEach((t: string) => tools.add(t));
        }

        const { datasets, knowledgeTopics, governorPolicies, missions } = await import("@shared/schema/index.js");

        let datasetsList: any[] = [];
        let topicsList: any[] = [];
        let policiesList: any[] = [];

        if (datasetIds.size > 0) {
            datasetsList = await db.select().from(datasets).where(inArray(datasets.id, Array.from(datasetIds)));
        }
        if (topicIds.size > 0) {
            topicsList = await db.select().from(knowledgeTopics).where(inArray(knowledgeTopics.id, Array.from(topicIds)));
        }
        if (policyIds.size > 0) {
            policiesList = await db.select().from(governorPolicies).where(inArray(governorPolicies.id, Array.from(policyIds)));
        }

        let mission = null;
        if (collection.missionId) {
            const [missionData] = await db.select({ id: missions.id, name: missions.name, status: missions.status }).from(missions).where(eq(missions.id, collection.missionId)).limit(1);
            mission = missionData;
        }

        return {
            agents,
            resources: {
                datasets: datasetsList,
                knowledgeTopics: topicsList,
                governorPolicies: policiesList,
                tools: Array.from(tools),
            },
            mission
        };
    },

    /**
     * Record a successful test run for a job
     */
    async recordTestSuccess(jobId: number): Promise<void> {
        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: "success" }).where(eq(jobs.id, jobId));
    }
};


