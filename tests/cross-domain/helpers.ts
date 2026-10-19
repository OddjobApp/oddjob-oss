/**
 * Integration test helpers
 *
 * PRINCIPLE: Do NOT reset the database. Test data must be surgically added and deleted.
 * - Add: Insert only the specific rows needed for the test (use test_user_ prefix or test org).
 * - Delete: Remove only the data created by the test (by ID or by test-run identifier).
 * - Never truncate tables or delete without a filter.
 */

import { db } from "@server/database_service.js";
import {
    pipelineExecutions,
    pipelineStepExecutions,
    pipelineInputParams,
    pipelines,
    pipelineSteps,
    graphSchemaDefs,
    jobs,
    users,
    knowledgeNodes,
    knowledgeEdges,
    missionRuns,
    datasets,
    datasetItems,
    knowledgeDocuments
} from "@shared/schema/index.js";

import { eq, isNull, and, notInArray, like, or, inArray, sql } from "drizzle-orm";

/** Pattern to identify test data: organizationId is NULL or createdBy starts with 'test_user_' */
const isTestData = (table: any) => {
    const conditions = [];
    if ('organizationId' in table) {
        conditions.push(isNull(table.organizationId));
    }
    if ('createdBy' in table) {
        conditions.push(like(table.createdBy, "test_user_%"));
    }
    return conditions.length > 0 ? or(...conditions) : sql`TRUE`;
};

/**
 * Names used by integration tests, deleted surgically when the org is set.
 *
 * isTestData() recognises a row by `organization_id IS NULL` or
 * `created_by LIKE 'test_user_%'` — but createTestUser stores the user's UUID in
 * created_by, not the username, so the LIKE never matches and null-org was doing all
 * the work. Suites that must run under a real organization (pipeline execution now
 * requires one) therefore fall out of cleanup entirely and collide on the unique
 * (organization_id, name) indexes the next run. Listing their fixture names here is
 * what keeps them re-runnable.
 */
const TEST_PIPELINE_NAMES = [
    "Enrichment Pipeline",
    "KG Test Pipeline",
    "simple-test",
    "failing-pipeline",
    "api-pipeline",
    "Integration Test Pipeline",
    "Tracing Test Pipeline",
];

/** Job fixture names, cleaned for the same reason as TEST_PIPELINE_NAMES. */
const TEST_JOB_NAMES = [
    "Simple Test Job",
    "Failing Job",
    "API Call Job",
    "Test Selenium Job",
];

/**
 * Surgically clear only test-created pipeline data.
 * Does NOT truncate tables. Deletes only rows matching test criteria.
 */
export async function clearPipelineTables() {
    const isTestEnv = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
    if (!isTestEnv && !process.env.FORCE_CLEAR_DB) {
        console.error("FATAL: clearPipelineTables called in non-test environment! Blocked for safety.");
        return;
    }

    console.log("🧹 Surgically clearing pipeline tables for test...");

    // 1. Get test pipeline IDs (isTestData OR known test pipeline names)
    const testPipelines = await db
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(
            or(isTestData(pipelines), inArray(pipelines.name, TEST_PIPELINE_NAMES))
        );
    const testPipelineIds = testPipelines.map((p: any) => p.id);
    if (testPipelineIds.length === 0) {
        // No test pipelines; still clear other test data
    }

    // 2. Get test job IDs (jobs referenced by step executions must be cleared before job delete)
    const testJobs = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(or(isTestData(jobs), inArray(jobs.name, TEST_JOB_NAMES)));
    const testJobIds = testJobs.map((j: any) => j.id);

    // 3. Delete child rows only for test pipelines (surgical)
    if (testPipelineIds.length > 0) {
        const testExecutions = await db
            .select({ id: pipelineExecutions.id })
            .from(pipelineExecutions)
            .where(inArray(pipelineExecutions.pipelineId, testPipelineIds));
        const executionIds = testExecutions.map((e: any) => e.id);

        if (executionIds.length > 0) {
            // Knowledge edges reference pipeline_executions; must clear/null before deleting executions
            await db
                .update(knowledgeEdges)
                .set({ lastUpdatedByRunId: null })
                .where(inArray(knowledgeEdges.lastUpdatedByRunId, executionIds));
            await db.delete(pipelineStepExecutions).where(
                inArray(pipelineStepExecutions.pipelineExecutionId, executionIds)
            );
        }
        await db.delete(pipelineExecutions).where(inArray(pipelineExecutions.pipelineId, testPipelineIds));
        await db.delete(pipelineInputParams).where(inArray(pipelineInputParams.pipelineId, testPipelineIds));
        await db.delete(pipelineSteps).where(inArray(pipelineSteps.pipelineId, testPipelineIds));
    }

    // 4. Delete pipeline_step_executions that reference test jobs (e.g. from pipelines with orgId set)
    if (testJobIds.length > 0) {
        await db.delete(pipelineStepExecutions).where(
            inArray(pipelineStepExecutions.jobId, testJobIds)
        );
    }

    // 5. Delete test pipelines, missions and jobs (filtered)
    await db.delete(missionRuns).where(isTestData(missionRuns));
    await db.delete(pipelines).where(
        or(isTestData(pipelines), inArray(pipelines.name, TEST_PIPELINE_NAMES))
    );
    await db.delete(jobs).where(or(isTestData(jobs), inArray(jobs.name, TEST_JOB_NAMES)));

    // 4. Knowledge data (filtered by test pattern; edges/nodes may reference test org)
    await db.delete(knowledgeEdges).where(isTestData(knowledgeEdges));
    await db.delete(knowledgeNodes).where(isTestData(knowledgeNodes));
    await db.delete(graphSchemaDefs).where(isTestData(graphSchemaDefs));
    
    // Datasets don't have createdBy, so we filter by organizationId is null (test pattern)
    await db.delete(knowledgeDocuments).where(isTestData(knowledgeDocuments));
    await db.delete(datasets).where(isNull(datasets.organizationId));

    // Reset sequences to prevent pkey violations during rapid test cycles
    await db.execute(sql`SELECT setval('knowledge_documents_id_seq', COALESCE((SELECT MAX(id) FROM knowledge_documents), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('knowledge_nodes_id_seq', COALESCE((SELECT MAX(id) FROM knowledge_nodes), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('knowledge_edges_id_seq', COALESCE((SELECT MAX(id) FROM knowledge_edges), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('graph_schema_defs_id_seq', COALESCE((SELECT MAX(id) FROM graph_schema_defs), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('datasets_id_seq', COALESCE((SELECT MAX(id) FROM datasets), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('dataset_items_id_seq', COALESCE((SELECT MAX(id) FROM dataset_items), 0) + 1, false)`);
}

/**
 * Bring the pipeline runtime up to the state production boots it into.
 *
 * Two registration steps live in the entrypoints (server/index.ts and
 * worker-entrypoint.ts) rather than in the modules that need them, so a test that
 * imports the pipeline executor directly gets neither:
 *
 *  - the job-executor registry is EMPTY, so every step fails with "Unknown or
 *    unsupported job type: <type>" — which reads like a missing executor rather
 *    than a missing bootstrap step;
 *  - execution hooks are unregistered, so onStepComplete work such as
 *    KnowledgeGraphHook never runs. That one fails SILENTLY: the pipeline reports
 *    success and simply produces no knowledge nodes.
 *
 * Both underlying calls are idempotent, so suites can call this freely.
 */
export async function ensurePipelineRuntimeReady(): Promise<void> {
    const { jobExecutorRegistry } = await import("@server/domain/jobs/core/executors/index.js");
    await (jobExecutorRegistry as any).autoRegister();

    const { initializeHooks } = await import("@server/domain/pipeline/hooks/index.js");
    initializeHooks();
}

export async function createTestUser() {
    const testUsername = `test_user_${Date.now()}`;
    const [user] = await db.insert(users).values({
        username: testUsername,
        password: "password123"
    }).returning();
    return { ...user, username: testUsername };
}

/** Surgically delete a test user by ID. Safe to call even if already deleted. */
export async function deleteTestUser(userId: string) {
    if (!userId) return;
    await db.delete(users).where(eq(users.id, userId)).catch(() => {});
}

/**
 * @param organizationId Defaults to null. Pass a real org for anything that EXECUTES
 * the job: pipeline step execution calls assertOrgId and rejects a null org with
 * "Organization context required".
 */
export async function createTestJob(userId: string, organizationId: number | null = null) {
    const [job] = await db.insert(jobs).values({
        name: "Test Selenium Job",
        description: "A job for integration testing",
        type: "selenium", // Match supported type
        config: {
            steps: [] // Simple config
        },
        organizationId,
        createdBy: userId,
        tool: "selenium-scraper" // Required field probably?
    }).returning();
    return job;
}

export async function closeDbConnection() {
    // drizzle-orm/node-postgres doesn't expose easy close on the pool from the db object
    // but we can import pool from server/db if exported, or just let it hang in watch mode
    // For CI, we might need to close it.
    // server/db exports 'pool'
}
