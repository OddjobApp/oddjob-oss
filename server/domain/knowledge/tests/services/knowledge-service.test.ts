/**
 * Knowledge Service Unit Tests
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Helper to create a chainable mock query
const createMockQuery = (result: any = []) => {
    const query = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        // Upsert terminators. graph-service uses both (.onConflictDoUpdate for node
        // merges, .onConflictDoNothing before .returning() for edges); omitting them
        // made the chain break at runtime with "is not a function" rather than
        // failing an assertion, which reads like a service bug but is a mock gap.
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(result),
        execute: vi.fn().mockResolvedValue(result),
        then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
        catch: (onRejected: any) => Promise.resolve(result).catch(onRejected)
    };
    return query;
};

// Mock database
vi.mock("@server/database_service.js", () => {
    return {
        db: {
            select: vi.fn(() => createMockQuery()),
            selectDistinct: vi.fn(() => createMockQuery()),
            insert: vi.fn(() => createMockQuery()),
            update: vi.fn(() => createMockQuery()),
            delete: vi.fn(() => createMockQuery()),
            values: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue({ rows: [] }),
        },
    };
});

vi.mock("@domain/knowledge/core/query-monitor.service.js", () => ({
    withQueryTracking: vi.fn((name, fn) => fn()),
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

import { knowledgeService } from "@server/domain/knowledge/knowledge.service.js";
import { db } from "@server/database_service.js";
import type { OrgContext } from "@server/domain/jobs/job.service.js";

describe("KnowledgeService", () => {
    const mockOrgContext: OrgContext = {
        userId: "user-123",
        organizationId: 1,
        isAdmin: true,
        isSuperAdmin: false,
        isOrgAdmin: true
    };

    beforeEach(() => {
        vi.resetAllMocks();
        // Re-apply implementations after reset
        (db.select as Mock).mockImplementation(() => createMockQuery());
        (db.selectDistinct as Mock).mockImplementation(() => createMockQuery());
        (db.insert as Mock).mockImplementation(() => createMockQuery());
        (db.update as Mock).mockImplementation(() => createMockQuery());
        (db.delete as Mock).mockImplementation(() => createMockQuery());
    });

    describe("searchNodes", () => {
        it("should return nodes matching query", async () => {
            const mockNodes = [
                { id: 1, name: "Customer", label: "entity" },
                { id: 2, name: "CustomerOrder", label: "entity" },
            ];

            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([{ count: 2 }]))
                .mockReturnValueOnce(createMockQuery(mockNodes));

            const result = await knowledgeService.searchNodes(mockOrgContext, { query: "Customer" });
            expect(result.nodes).toEqual(mockNodes);
            expect(result.total).toBe(2);
        });

        it("should filter by node type", async () => {
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([{ count: 1 }]))
                .mockReturnValueOnce(createMockQuery([{ id: 1, label: "entity" }]));
            await knowledgeService.searchNodes(mockOrgContext, { label: "entity" });
            expect(db.select).toHaveBeenCalled();
        });

        it("should filter by topic", async () => {
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([{ count: 1 }]))
                .mockReturnValueOnce(createMockQuery([{ id: 1, label: "entity" }]));
            await knowledgeService.searchNodes(mockOrgContext, { knowledgeTopicId: 1 });
            expect(db.select).toHaveBeenCalled();
        });

        it("should filter by multiple topics", async () => {
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([{ count: 1 }]))
                .mockReturnValueOnce(createMockQuery([{ id: 1, label: "entity" }]));
            await knowledgeService.searchNodes(mockOrgContext, { knowledgeTopicIds: [1, 2] });
            expect(db.select).toHaveBeenCalled();
        });
    });

    describe("createNode", () => {
        it("should create node with properties", async () => {
            const input = {
                name: "New Entity",
                label: "entity",
                properties: { description: "Test entity" },
            };

            const mockNode = { id: 1, name: "New Entity", label: "entity" };
            (db.insert as Mock).mockReturnValueOnce(createMockQuery([mockNode]));

            const result = await knowledgeService.createNode(input as any, mockOrgContext);
            expect(result).toBeDefined();
            expect(db.insert).toHaveBeenCalled();
        });
    });

    describe("createEdge", () => {
        it("should verify both nodes exist", async () => {
            const input = {
                sourceNodeId: 1,
                targetNodeId: 2,
                relation: "relates_to",
            };

            // Mock node lookups
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([{ id: 1 }]))
                .mockReturnValueOnce(createMockQuery([{ id: 2 }]));

            (db.insert as Mock).mockReturnValueOnce(createMockQuery([{ id: 1 }]));

            await knowledgeService.createEdge(input, mockOrgContext);
            expect(db.insert).toHaveBeenCalled();
        });

        it("should throw if source node not found", async () => {
            (db.select as Mock).mockReturnValueOnce(createMockQuery([]));

            await expect(knowledgeService.createEdge({
                sourceNodeId: 999,
                targetNodeId: 1,
                relation: "relates_to",
            }, mockOrgContext)).rejects.toThrow("Node not found");
        });
    });

    describe("deleteNode", () => {
        it("should delete node and its edges", async () => {
            // Mock getNodeById
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: 1 }]));

            await knowledgeService.deleteNode(1, mockOrgContext);
            expect(db.delete).toHaveBeenCalledTimes(2); // edges + node
        });
    });

    describe("getNodeEdges", () => {
        it("should return edges for node", async () => {
            const mockEdges = [
                { id: 1, sourceId: 1, targetId: 2, relation: "relates_to" },
            ];

            (db.select as Mock)
                // getNodeById
                .mockReturnValueOnce(createMockQuery([{ id: 1 }]))
                // getNodeEdges
                .mockReturnValueOnce(createMockQuery(mockEdges));

            const result = await knowledgeService.getNodeEdges(1, mockOrgContext);
            expect(result).toEqual(mockEdges);
        });

        it("should filter by direction", async () => {
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([{ id: 1 }]))
                .mockReturnValueOnce(createMockQuery([]));

            await knowledgeService.getNodeEdges(1, mockOrgContext, "outgoing");
            expect(db.select).toHaveBeenCalledTimes(2);
        });
    });

    describe("traverseGraph", () => {
        it("should traverse graph to specified depth", async () => {
            const startNode = { id: 1, name: "Start", label: "entity", organizationId: 1 };
            const connectedNode = { id: 2, name: "Connected", label: "entity", organizationId: 1 };
            const edges = [{ id: 1, sourceId: 1, targetId: 2, relation: "relates_to" }];

            // Mock getNodeById for start
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([startNode]))
                // getNodeEdges call 1
                .mockReturnValueOnce(createMockQuery([startNode]))
                .mockReturnValueOnce(createMockQuery(edges))
                // getNodeById for connected
                .mockReturnValueOnce(createMockQuery([connectedNode]))
                // getNodeEdges for connected (empty to stop)
                .mockReturnValueOnce(createMockQuery([connectedNode]))
                .mockReturnValueOnce(createMockQuery([]));

            const result = await knowledgeService.traverseGraph(1, mockOrgContext, { depth: 2 });
            expect(result.nodes.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("getStats", () => {
        it("should return graph statistics", async () => {
            const mockNodes = [
                { id: 1, label: "entity" },
                { id: 2, label: "entity" },
                { id: 3, label: "concept" },
            ];

            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([{ count: 3 }])) // count for searchNodes
                .mockReturnValueOnce(createMockQuery(mockNodes))      // results for searchNodes
                .mockReturnValueOnce(createMockQuery([]));           // edges in getStats

            const stats = await knowledgeService.getStats(mockOrgContext);
            expect(stats.totalNodes).toBe(3);
            expect(stats.nodesByType.entity).toBe(2);
            expect(stats.nodesByType.concept).toBe(1);
        });
    });

    describe("listDocuments", () => {
        it("should filter by multiple topic IDs", async () => {
            const mockDocIds = [{ documentId: 1 }];
            const mockDocs = [{
                document: { id: 1, title: "Doc 1", organizationId: 1 },
                extraction: { status: "completed", progress: 100 }
            }];
            const mockTopicMapRows = [{ documentId: 1, topicId: 1, topicName: "Topic 1" }];

            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery(mockDocIds))
                .mockReturnValueOnce(createMockQuery(mockDocs))
                .mockReturnValueOnce(createMockQuery(mockTopicMapRows)); // Enrichment call

            const result = await knowledgeService.listDocuments(mockOrgContext, { topicIds: [1, 2] });
            expect(result[0]).toMatchObject({
                id: 1,
                title: "Doc 1",
                topics: [{ id: 1, name: "Topic 1" }]
            });
        });
    });

    describe("Direct Methods", () => {
        it("should throw error if organizationId is missing", async () => {
            const contextNoOrg = { userId: "1", organizationId: null };
            await expect(knowledgeService.suggestSchema("test", contextNoOrg as any)).rejects.toThrow("Organization context required");
            await expect(knowledgeService.semanticQuery("test", contextNoOrg as any)).rejects.toThrow("Organization context required");
            await expect(knowledgeService.searchUnified("test", contextNoOrg as any, { limit: 10 })).rejects.toThrow("Organization context required");
        });
    });
});
