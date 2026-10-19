
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { db } from '../../server/db';
import { datasets, datasetItems, graphSchemaDefs, knowledgeNodes, knowledgeEdges } from "@shared/schema";
import { KnowledgeExtractionService } from '../../server/domain/knowledge/core/extraction/knowledge-extraction';
import { saasIntegrationService } from '../../server/domain/integrations/saas-integration-service';
import { clearPipelineTables, createTestUser, deleteTestUser } from './helpers';
import { sql, eq, isNull } from 'drizzle-orm';

// Mock AI client to avoid real LLM calls
vi.mock('@domain/ai/core/ai-client.service.js', () => ({
    AIClientFactory: {
        getClient: () => ({
            execute: vi.fn().mockResolvedValue({
                success: true,
                output: JSON.stringify({
                    nodes: [
                        { label: "Ticket", name: "JIRA-123", externalId: "JIRA-123", data: { status: "Done" } },
                        { label: "User", name: "John Doe", externalId: "John Doe" }
                    ],
                    edges: [
                        { source: { label: "Ticket", externalId: "JIRA-123" }, target: { label: "User", externalId: "John Doe" }, relation: "ASSIGNED_TO" }
                    ]
                })
            })
        })
    }
}));

// Mock Queue
vi.mock('../../server/domain/knowledge/knowledge-queue', () => ({
    queueExtractionJob: vi.fn().mockResolvedValue({ id: 'test-job-id' })
}));

describe('SaaS Extraction Bridge Integration', () => {
    let user: any;
    let dataset: any;
    let schema: any;
    const createdUserIds: string[] = [];

    beforeEach(async () => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        await clearPipelineTables();
        user = await createTestUser();
        createdUserIds.push(user.id);

        // 1. Create a Platform Dataset
        [dataset] = await db.insert(datasets).values({
            name: `Jira Test Dataset ${Date.now()}`,
            organizationId: null, // Use null for test-surgical cleanup
            tags: ["platform:jira"],
            createdBy: user.username
        }).returning();

        // 2. Add Test Items
        await db.insert(datasetItems).values([
            {
                datasetId: dataset.id,
                data: { key: "JIRA-123", summary: "Fix bug in bridge", assignee: "John Doe" },
                organizationId: null
            }
        ]);

        // 3. Create a Graph Schema
        [schema] = await db.insert(graphSchemaDefs).values({
            name: "Default Jira Schema",
            organizationId: null,
            isActive: true,
            createdBy: user.username,
            mappings: []
        }).returning();
    });

    afterAll(async () => {
        await clearPipelineTables();
        await Promise.all(createdUserIds.map(deleteTestUser));
    });

    it('should process dataset items and create knowledge nodes/edges', async () => {
        const extractionService = new KnowledgeExtractionService();
        
        const stats = await extractionService.processDatasetItems(dataset.id, schema.id, null);
        
        expect(stats.nodes).toBeGreaterThan(0);
        
        // Verify nodes in DB
        const nodes = await db.select().from(knowledgeNodes).where(isNull(knowledgeNodes.organizationId));
        expect(nodes.some(n => n.name === "JIRA-123")).toBe(true);
        expect(nodes.some(n => n.name === "John Doe")).toBe(true);
        
        // Verify edges in DB
        const edges = await db.select().from(knowledgeEdges).where(isNull(knowledgeEdges.organizationId));
        expect(edges.length).toBeGreaterThan(0);
        expect(edges[0].relation).toBe("ASSIGNED_TO");
    });

    it('should trigger platform extraction and queue a job', async () => {
        const { queueExtractionJob } = await import('../../server/domain/knowledge/knowledge-queue');
        
        const result = await saasIntegrationService.triggerPlatformExtraction("jira", null as any, user.username);
        
        expect(result.success).toBe(true);
        expect(queueExtractionJob).toHaveBeenCalledWith(expect.objectContaining({
            type: 'dataset',
            datasetId: dataset.id,
            schemaId: schema.id
        }));
    });

    it('should fallback to general schema if platform schema is missing', async () => {
        // Delete the jira-specific schema
        await db.delete(graphSchemaDefs).where(eq(graphSchemaDefs.id, schema.id));
        
        // Create a "General Knowledge" schema
        const [generalSchema] = await db.insert(graphSchemaDefs).values({
            name: "General Knowledge",
            organizationId: null,
            isActive: true,
            createdBy: user.username,
            mappings: []
        }).returning();

        const result = await saasIntegrationService.triggerPlatformExtraction("jira", null as any, user.username);
        
        expect(result.success).toBe(true);
        const { queueExtractionJob } = await import('../../server/domain/knowledge/knowledge-queue');
        expect(queueExtractionJob).toHaveBeenCalledWith(expect.objectContaining({
            schemaId: generalSchema.id
        }));
    });
});
