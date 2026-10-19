/**
 * Knowledge Graph tests — aligned with docs/specs/oddjob_feature_reference.md, docs/feature-documentation/03-knowledge-system.md
 */
import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';
import { clearPipelineTables, createTestUser, deleteTestUser, ensurePipelineRuntimeReady } from '../../../../../tests/cross-domain/helpers.js';
import { pipelineService } from '@server/domain/pipeline/core/pipeline.service.js';
import { pipelineExecutor } from '@server/core/pipeline-executor.js';
import { db } from '@server/database_service.js';
import { sql } from 'drizzle-orm';
import { jobs, knowledgeNodes, knowledgeEdges, graphSchemaDefs } from "@shared/schema/index.js";

const mockedApiResponse = JSON.stringify({
    users: [
        { id: "u100", name: "Test Alice", email: "alice@test.com", managerId: "u101" },
        { id: "u101", name: "Test Bob", email: "bob@test.com", managerId: null }
    ]
});

// Mock Qdrant embedding service to avoid API calls or errors
vi.mock('../../server/knowledge/knowledge-graph-service.js', () => ({
    embedKnowledgeNode: vi.fn().mockResolvedValue(true)
}));

describe('Knowledge Graph Integration', () => {
    let user: any;
    let job: any;
    const createdUserIds: string[] = [];

    beforeEach(async () => {
        vi.restoreAllMocks();
        // Disable Queue to force synchronous execution in the same process
        process.env.DISABLE_JOB_QUEUE = 'true';

        // These tests run real pipeline steps, so the executor registry must be
        // populated — production does this at bootstrap, which tests never run.
        await ensurePipelineRuntimeReady();



        await clearPipelineTables();
        user = await createTestUser();
        createdUserIds.push(user.id);

        // Stub global fetch to return our mock response (must have .text(), .json(), .headers for gateways)
        const createMockResponse = (status: number, body: string) => ({
            ok: status >= 200 && status < 300,
            status,
            headers: new Headers(),
            text: async () => body,
            json: async () => JSON.parse(body),
        });
        vi.stubGlobal('fetch', vi.fn(async () => createMockResponse(200, mockedApiResponse)));

        // Create a REAL API job
        const [testJob] = await db.insert(jobs).values({
            // Unique per run: jobs has a UNIQUE (organization_id, name) index, which
            // did not constrain this row while organizationId was NULL. Now that the
            // fixture is org-scoped, a fixed name collides on the second beforeEach.
            name: `API Extraction Job ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: "api",
            tool: "http",
            config: {
                url: "https://example.com/api/users",
                method: "GET"
            },
            // Must match the org the pipeline runs under: job lookup is org-scoped, so
            // a null-org job is "not found or not accessible" from an org-1 pipeline.
            organizationId: 1,
            createdBy: user.id
        }).returning();
        job = testJob;
    });

    afterAll(async () => {
        await clearPipelineTables();
        await Promise.all(createdUserIds.map(deleteTestUser));
        vi.unstubAllGlobals();
    });

    it('should extract knowledge graph nodes and edges using explicit rules', async () => {
        // Org 1 is the baseline org seeded by `npm run test:db:setup`. This was
        // `organizationId: null`, which predates the executor requiring an
        // organization context — the pipeline now aborts with "Organization context
        // required" before running a single step. The sibling enrichment test below
        // already uses org 1.
        const orgContext = { organizationId: 1, userId: user.id, isAdmin: true, isOrgAdmin: true, isSuperAdmin: false };

        const pipeline = await pipelineService.create({
            name: "KG Test Pipeline",
            description: "Testing KG Extraction",
            isActive: true,
            triggerType: "manual",
            enableKnowledgeGraph: true,
            steps: [
                {
                    jobId: job.id,
                    order: 0,
                    knowledgeGraphConfig: {
                        entityRules: [
                            {
                                id: "rule-users",
                                name: "Extract Users",
                                entityType: "User",
                                label: "User",
                                rootPath: "$.users[*]",
                                mappings: {
                                    name: "$.name",
                                    externalId: "$.id"
                                },
                                includeFullSourceData: true
                            }
                        ],
                        relationshipRules: [
                            {
                                sourceEntity: "rule-users",
                                targetEntity: "rule-users",
                                relation: "REPORTS_TO",
                                sourcePath: "$.managerId",
                                targetPath: "$.id"
                            }
                        ]
                    }
                }
            ]
        }, orgContext);

        const executionResult = await pipelineExecutor.executePipeline(pipeline.id, user.id);

        expect(executionResult.success).toBe(true);

        const nodes = await db.select().from(knowledgeNodes);
        expect(nodes.length).toBeGreaterThan(0);

        const edges = await db.select().from(knowledgeEdges);
        expect(edges.length).toBeGreaterThan(0);

        // Verify Node Content
        const alice = nodes.find((n: any) => n.externalId === "u100");
        expect(alice).toBeDefined();
        if (alice) {
            expect(alice.name).toBe("Test Alice");
            expect(alice.label).toBe("User");
            expect(alice.data as any).toMatchObject({ email: "alice@test.com", managerId: "u101" });
        }

        // Verify Edge Content
        const reportEdge = edges.find((e: any) => e.relation === "REPORTS_TO");
        expect(reportEdge).toBeDefined();
        if (reportEdge) {
            // Alice (u100) -> Bob (u101)
            const bob = nodes.find((n: any) => n.externalId === "u101");
            expect(reportEdge.sourceId).toBe(alice!.id);
            expect(reportEdge.targetId).toBe(bob!.id);
        }
    }, 30000);


    it('should perform semantic enrichment using global schema rules', async () => {
        // 1. Setup Global Schema Rule (Regex for Issue #...)
        await db.insert(graphSchemaDefs).values({
            organizationId: 1, // Default test org
            name: "Issue Extractor",
            description: "Extracts Issue IDs from text",
            isActive: true,
            createdBy: 'test_user_kg',
            mappings: [{
                // Adhering to the shape expected by processSemanticEnrichment
                id: "map_1",
                source_key: "issue_regex",
                is_active: true,
                node_label: "Issue",
                relationship: "MENTIONS_ISSUE",
                extraction_type: "regex",
                config: {
                    regex: "Issue #(\\d+)"
                }
            }] as any // Cast to jsonb/any to bypass strict schema check if needed
        });

        // 2. Create Job with unstructured text output
        const textJob = await db.insert(jobs).values({
            name: 'Text Output Job',
            type: 'api', // Reuse API type but mock response
            tool: 'http',
            organizationId: 1,
            config: {
                url: 'https://api.example.com/text',
                method: 'GET'
            },
            createdBy: 'test_user_kg'
        }).returning();

        // 3. Create Pipeline
        const pipeline = await pipelineService.create({
            name: 'Enrichment Pipeline',
            triggerType: 'manual', // Required field
            steps: [
                {
                    jobId: textJob[0].id,
                    order: 0,
                    // No explicit KG config - relying on automatic enrichment
                }
            ]
        }, { organizationId: 1, userId: user.id, isAdmin: true, isOrgAdmin: true, isSuperAdmin: false });

        // 4. Mock API Response with text content
        const mockTextResponse = JSON.stringify({
            id: "doc-1",
            title: "Project Status Update",
            description: "We are currently failing to resolve Issue #999 due to unexpected behavior."
        });

        const createMockResponse = (status: number, body: string) => ({
            ok: status >= 200 && status < 300,
            status,
            headers: new Headers(),
            text: async () => body,
            json: async () => JSON.parse(body),
        });
        vi.stubGlobal('fetch', vi.fn(async () => createMockResponse(200, mockTextResponse)));

        // 5. Execute
        const executionResult = await pipelineExecutor.executePipeline(pipeline.id, user.id);
        expect(executionResult.success).toBe(true);

        // 6. Verify Enrichment
        // Should have created an anchor node for "doc-1" (Project Status Update)
        const nodes = await db.select().from(knowledgeNodes);
        const docNode = nodes.find((n: any) => n.externalId === "doc-1");
        expect(docNode).toBeDefined();

        // Should have created an extracted node for "Issue #999" -> Name "999" (from capture group)
        // externalId logic involves "sem:Issue:999"
        const issueNode = nodes.find((n: any) => n.label === "Issue" && n.name === "999");
        expect(issueNode).toBeDefined();

        // Verify Edge
        const edges = await db.select().from(knowledgeEdges);
        const mentionEdge = edges.find((e: any) =>
            e.sourceId === docNode!.id &&
            e.targetId === issueNode!.id &&
            e.relation === "MENTIONS_ISSUE"
        );
        expect(mentionEdge).toBeDefined();

    }, 30000);
});
