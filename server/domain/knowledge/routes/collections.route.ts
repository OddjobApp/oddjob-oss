import { Router } from "express";
import { insertJobCollectionSchema, jobCollections, jobs, jobCollectionItems, datasets, knowledgeTopics, governorPolicies, missions } from "@shared/schema/index.js";
import { z } from "zod";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { eq, and, sql, inArray } from "drizzle-orm";

import { collectionService } from "@domain/knowledge/core/collection.service.js";
import { collectionTemplatesService } from "@domain/knowledge/core/collection-templates.service.js";
import { smartCollectionsService } from "@domain/knowledge/core/smart-collections.service.js";

const logger = createLogger("CollectionsRouter");

export const collectionsRouter = Router();

// GET /api/collections - List all collections for the user's org (or all if admin/global)
collectionsRouter.get("/", requireAuth, async (req: any, res) => {
    const orgContext = await getUserOrgContext(req);

    try {
        const result = await collectionService.listCollections(orgContext);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/collections - Create new collection
collectionsRouter.post("/", requireAuth, async (req: any, res) => {
    const orgContext = await getUserOrgContext(req);
    const user = req.user as any;

    try {
        const data = insertJobCollectionSchema.parse(req.body);

        if (!orgContext.organizationId && !orgContext.isSuperAdmin) {
            return res.status(400).json({ message: "Organization not selected" });
        }

        const collection = await collectionService.create(data, orgContext);
        res.json(collection);
    } catch (err: any) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: "Invalid data", errors: err.errors });
        }
        res.status(500).json({ message: err.message });
    }
});

// GET /api/collections/:id - Get detail
collectionsRouter.get("/:id", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("Invalid ID");
    const orgContext = await getUserOrgContext(req);

    try {
        const collectionWithJobs = await collectionService.getCollectionById(id, orgContext);
        res.json(collectionWithJobs);
    } catch (err: any) {
        if (err.name === 'NotFoundError') return res.status(404).send(err.message);
        if (err.name === 'ForbiddenError') return res.status(403).send(err.message);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/collections/:id/items - Get collection items with resources (scoped view)
collectionsRouter.get("/:id/items", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("Invalid ID");
    const orgContext = await getUserOrgContext(req);

    try {
        const itemDetails = await collectionService.getCollectionItems(id, orgContext);
        res.json(itemDetails);
    } catch (err: any) {
        if (err.name === 'NotFoundError') return res.status(404).send(err.message);
        if (err.name === 'ForbiddenError') return res.status(403).send(err.message);
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/collections/:id - Update
collectionsRouter.put("/:id", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("Invalid ID");
    const orgContext = await getUserOrgContext(req);

    try {
        const data = insertJobCollectionSchema.partial().parse(req.body);
        const updated = await collectionService.updateCollection(id, data, orgContext);
        res.json(updated);
    } catch (err: any) {
        if (err.name === 'NotFoundError') return res.status(404).send(err.message);
        res.status(500).json({ message: err.message });
    }
});

// DELETE /api/collections/:id - Delete
collectionsRouter.delete("/:id", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("Invalid ID");
    const orgContext = await getUserOrgContext(req);

    try {
        await collectionService.deleteCollection(id, orgContext);
        res.sendStatus(200);
    } catch (err: any) {
        if (err.name === 'NotFoundError') return res.status(404).send(err.message);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/collections/:id/jobs - Add jobs
collectionsRouter.post("/:id/jobs", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    const { jobIds } = req.body;
    const orgContext = await getUserOrgContext(req);

    if (isNaN(id) || !Array.isArray(jobIds)) return res.status(400).send("Invalid data");

    try {
        const result = await collectionService.addJobsToCollection(id, jobIds, orgContext);
        res.json(result);
    } catch (err: any) {
        if (err.name === 'NotFoundError') return res.status(404).send(err.message);
        res.status(500).json({ message: err.message });
    }
});

// DELETE /api/collections/:id/jobs/:jobId - Remove job
collectionsRouter.delete("/:id/jobs/:jobId", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    const jobId = parseInt(req.params.jobId);
    const orgContext = await getUserOrgContext(req);

    if (isNaN(id) || isNaN(jobId)) return res.status(400).send("Invalid IDs");

    try {
        await collectionService.removeJobFromCollection(id, jobId, orgContext);

        // Cleanup if now empty
        const { jobService } = await import("@domain/jobs/job.service.js");
        await jobService.cleanupEmptyCollections(orgContext);

        res.sendStatus(200);
    } catch (err: any) {
        if (err.name === 'NotFoundError') return res.status(404).send(err.message);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/collections/:id/test-all - Trigger tests for all jobs in collection
collectionsRouter.post("/:id/test-all", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("Invalid ID");
    const orgContext = await getUserOrgContext(req);

    try {
        const { collection, jobs: rawJobs } = await collectionService.getCollectionForTesting(id, orgContext);

        const MAX_TEST_JOBS = 15;
        const jobsToTest = rawJobs.slice(0, MAX_TEST_JOBS);
        const results = [];

        const { jobTestService } = await import("@domain/jobs/core/job-test.service.js");

        // Process in small batches to avoid blocking the event loop or overwhelming the system
        const BATCH_SIZE = 3;
        for (let i = 0; i < jobsToTest.length; i += BATCH_SIZE) {
            const batch = jobsToTest.slice(i, i + BATCH_SIZE);

            const batchPromises = batch.map(async (jobData: any) => {
                let config = typeof jobData.config === 'string' ? JSON.parse(jobData.config) : jobData.config;
                let result: any;
                const capture = { captureInput: false, captureOutput: false, input: null };

                try {
                    if (jobData.type === "human_approval") {
                        await collectionService.recordTestSuccess(jobData.id);
                        result = { success: true, output: null, metadata: { method: "FORM", status: "Simulated" } };
                    } else if (jobData.type === "curl" || jobData.type === "api") {
                        result = await jobTestService.testCurlJob(jobData, config, capture);
                    } else if (jobData.type === "openapi") {
                        result = await jobTestService.testOpenAPIJob(jobData, config, capture);
                    } else if (jobData.type === "ai_api_call") {
                        result = await jobTestService.testAIAPICallJob(jobData, config, capture);
                    } else if (jobData.type === "ai_agent") {
                        result = await jobTestService.testAIAgentJob(jobData, config, capture);
                    } else {
                        result = await jobTestService.testGenericJob(jobData, config, capture);
                    }

                    await jobTestService.saveOutputToDataset(jobData, result);
                } catch (err: any) {
                    logger.error(`Failed to test job ${jobData.id} in collection ${id}: ${err.message}`);
                    result = { success: false, error: err.message };
                }
                return { jobId: jobData.id, jobName: jobData.name, ...result };
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        const summary = {
            success: true,
            totalJobs: rawJobs.length,
            testedJobs: jobsToTest.length,
            results: results
        };

        if (rawJobs.length > MAX_TEST_JOBS) {
            (summary as any).message = `Only the first ${MAX_TEST_JOBS} jobs were tested to ensure stability. Please run heavy collections via the task scheduler.`;
        }

        res.json(summary);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION TEMPLATES ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/collections/templates - List all available templates
collectionsRouter.get("/templates/all", requireAuth, async (req: any, res) => {
    try {
        const templates = collectionTemplatesService.getAllTemplates();
        const categories = collectionTemplatesService.getCategories();
        res.json({ templates, categories });
    } catch (err: any) {
        logger.error(`Failed to get templates: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/collections/templates/:id - Get specific template
collectionsRouter.get("/templates/:id", requireAuth, async (req: any, res) => {
    const templateId = req.params.id;
    try {
        const template = collectionTemplatesService.getTemplateById(templateId);
        if (!template) return res.status(404).send("Template not found");
        res.json(template);
    } catch (err: any) {
        logger.error(`Failed to get template: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/collections/from-template - Create collection from template
collectionsRouter.post("/from-template", requireAuth, async (req: any, res) => {
    const orgContext = await getUserOrgContext(req);
    const { templateId, name, description, customize } = req.body;

    try {
        const template = collectionTemplatesService.getTemplateById(templateId);
        if (!template) return res.status(404).send("Template not found");

        // Create collection with template reference
        const collection = await collectionService.create({
            name: name || `${template.name} (from template)`,
            description: description || template.description,
            templateId: template.id,
            templateData: customize || {},
            governorSettings: template.defaultConfig?.governorEnabled !== undefined ? {
                enabled: template.defaultConfig.governorEnabled,
                mode: template.defaultConfig.governorMode || 'ADVISORY'
            } : undefined,
        }, orgContext);

        // Optionally create the default agents from template
        if (customize?.createAgents !== false) {
            const { jobService } = await import("@domain/jobs/job.service.js");
            const createdJobIds: number[] = [];

            for (const agentTemplate of template.defaultAgents) {
                const job = await jobService.create({
                    name: agentTemplate.name!,
                    description: agentTemplate.description,
                    type: agentTemplate.type!,
                    config: agentTemplate.config || {},
                }, orgContext);
                createdJobIds.push(job.id);
            }

            // Add created agents to collection
            if (createdJobIds.length > 0) {
                await collectionService.addJobsToCollection(collection.id, createdJobIds, orgContext);
            }
        }

        res.json({ success: true, collection, message: `Collection created from ${template.name} template` });
    } catch (err: any) {
        logger.error(`Failed to create from template: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SMART COLLECTIONS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/collections/smart/presets - Get smart collection presets
collectionsRouter.get("/smart/presets", requireAuth, async (req: any, res) => {
    try {
        const presets = smartCollectionsService.getSmartPresets();
        res.json(presets);
    } catch (err: any) {
        logger.error(`Failed to get smart presets: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/collections/smart - Create smart collection
collectionsRouter.post("/smart", requireAuth, async (req: any, res) => {
    const orgContext = await getUserOrgContext(req);
    const { name, description, rules, presetId } = req.body;

    try {
        let smartRules = rules;
        if (presetId) {
            const presets = smartCollectionsService.getSmartPresets();
            const preset = presets.find(p => p.id === presetId);
            if (preset) smartRules = preset.rules;
        }

        const collection = await collectionService.create({
            name,
            description,
            isSmart: 1,
            smartRules,
        }, orgContext);

        // Initial sync to populate the collection
        await smartCollectionsService.syncCollection(collection.id, orgContext);

        res.json({ success: true, collection, rules: smartRules });
    } catch (err: any) {
        logger.error(`Failed to create smart collection: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/collections/:id/sync - Sync smart collection
collectionsRouter.post("/:id/sync", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("Invalid ID");
    const orgContext = await getUserOrgContext(req);

    try {
        const changes = await smartCollectionsService.syncCollection(id, orgContext);
        res.json({ success: true, changes });
    } catch (err: any) {
        logger.error(`Failed to sync collection: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION STATS & ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/collections/:id/stats - Get collection statistics
collectionsRouter.get("/:id/stats", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("Invalid ID");
    const orgContext = await getUserOrgContext(req);

    try {
        const stats = await collectionService.getCollectionStats(id, orgContext);
        res.json(stats);
    } catch (err: any) {
        if (err.name === 'NotFoundError') return res.status(404).send(err.message);
        if (err.name === 'ForbiddenError') return res.status(403).send(err.message);
        logger.error(`Failed to get collection stats: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/collections/:id/dependencies - Get dependency graph
collectionsRouter.get("/:id/dependencies", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("Invalid ID");
    const orgContext = await getUserOrgContext(req);

    try {
        const graph = await collectionService.getDependencyGraph(id, orgContext);
        res.json(graph);
    } catch (err: any) {
        if (err.name === 'NotFoundError') return res.status(404).send(err.message);
        if (err.name === 'ForbiddenError') return res.status(403).send(err.message);
        logger.error(`Failed to get dependency graph: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH & FILTER
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/collections/search - Search collections
collectionsRouter.get("/search", requireAuth, async (req: any, res) => {
    const orgContext = await getUserOrgContext(req);
    const query = req.query.q as string || "";
    const tags = req.query.tags ? (req.query.tags as string).split(",") : [];

    try {
        const results = await collectionService.searchCollections(query, tags, orgContext);
        res.json(results);
    } catch (err: any) {
        logger.error(`Failed to search collections: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MISSION-COLLECTION EXECUTION TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/collections/:id/execute - Execute collection and record mission context
collectionsRouter.post("/:id/execute", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("Invalid ID");
    const orgContext = await getUserOrgContext(req);
    const { missionId, missionRunId, triggeredBy = 'manual', executionType = 'test' } = req.body;

    try {
        // Validate mission context if provided
        if (missionId && missionRunId) {
            // Record the execution start
            const execution = await collectionService.recordMissionExecution({
                missionId,
                missionRunId,
                collectionId: id,
                triggeredBy,
                executionType,
                status: 'running',
            }, orgContext);

            // Run the collection tests
            const testResults = await fetch(`/api/collections/${id}/test-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }).then(r => r.json());

            // Calculate success metrics
            const successfulJobs = testResults.results?.filter((r: any) => r.success).length || 0;
            const totalJobs = testResults.testedJobs || 0;
            const durationMs = testResults.results?.reduce((acc: number, r: any) => acc + (r.duration || 0), 0) || 0;

            // Determine status
            let status: string;
            if (successfulJobs === totalJobs) status = 'success';
            else if (successfulJobs === 0) status = 'failed';
            else status = 'partial';

            // Update execution record
            await collectionService.updateMissionExecution(
                execution.id,
                status,
                {
                    ...testResults,
                    durationMs,
                    successRate: totalJobs > 0 ? (successfulJobs / totalJobs) * 100 : 0,
                },
                orgContext
            );

            res.json({
                success: true,
                executionId: execution.id,
                status,
                results: testResults,
                missionContext: { missionId, missionRunId }
            });
        } else {
            // No mission context, just run tests
            const testResults = await fetch(`/api/collections/${id}/test-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }).then(r => r.json());

            res.json({
                success: true,
                results: testResults,
                missionContext: null
            });
        }
    } catch (err: any) {
        logger.error(`Failed to execute collection in mission context: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/collections/:id/executions - Get execution history for a collection
collectionsRouter.get("/:id/executions", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("Invalid ID");
    const orgContext = await getUserOrgContext(req);
    const limit = parseInt(req.query.limit as string) || 20;

    try {
        const executions = await collectionService.getCollectionExecutionHistory(id, limit, orgContext);
        res.json(executions);
    } catch (err: any) {
        if (err.name === 'NotFoundError') return res.status(404).send(err.message);
        if (err.name === 'ForbiddenError') return res.status(403).send(err.message);
        logger.error(`Failed to get collection execution history: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/missions/:missionId/collections - Get collections executed as part of a mission
collectionsRouter.get("/by-mission/:missionId", requireAuth, async (req: any, res) => {
    const missionId = parseInt(req.params.missionId);
    if (isNaN(missionId)) return res.status(400).send("Invalid Mission ID");
    const orgContext = await getUserOrgContext(req);

    try {
        const collections = await collectionService.getCollectionsByMission(missionId, orgContext);
        res.json(collections);
    } catch (err: any) {
        logger.error(`Failed to get collections by mission: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

export default collectionsRouter;


