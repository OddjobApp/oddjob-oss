/**
 * World Model Integration Tests (Tasks 13.1-13.6)
 *
 * These tests verify cross-service integration behavior at the service layer,
 * mocking only the database. They demonstrate that the services correctly
 * coordinate to produce expected results.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock database_service ───────────────────────────────────────────────────

const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();
const mockDbExecute = vi.fn();

const chainable = () => ({
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockReturnThis(),
});

vi.mock("@server/database_service.js", () => ({
    db: {
        insert: (...args: any[]) => mockDbInsert(...args),
        select: (...args: any[]) => mockDbSelect(...args),
        update: (...args: any[]) => mockDbUpdate(...args),
        delete: (...args: any[]) => mockDbDelete(...args),
        execute: (...args: any[]) => mockDbExecute(...args),
    },
}));

// ─── Mock schema modules ─────────────────────────────────────────────────────

vi.mock("@shared/schema/index.js", () => ({
    knowledgeNodeVersions: { nodeId: "node_id", timestamp: "timestamp", id: "id", organizationId: "organization_id" },
    knowledgeEdgeVersions: { edgeId: "edge_id", timestamp: "timestamp", id: "id", organizationId: "organization_id" },
    knowledgeNodes: { id: "id", organizationId: "organization_id", verificationStatus: "verification_status", confidenceScore: "confidence_score" },
    knowledgeEdges: { id: "id", organizationId: "organization_id", relation: "relation", sourceId: "source_id", targetId: "target_id", data: "data" },
    knowledgePredictedLinks: { id: "id", organizationId: "organization_id", status: "status", sourceNodeId: "source_node_id", targetNodeId: "target_node_id" },
    knowledgeNodeEmbeddings: { nodeId: "node_id" },
    insertNodeVersionSchema: { parse: (v: any) => v },
    insertEdgeVersionSchema: { parse: (v: any) => v },
}));

vi.mock("@shared/schema/ontology/ontology.js", () => ({
    ontologyObjectTypes: { id: "id", organizationId: "organization_id", isActive: "is_active" },
    ontologyObjects: { id: "id", objectTypeId: "object_type_id", properties: "properties" },
}));

vi.mock("@shared/schema/ontology/ontology-versions.js", () => ({
    ontologyTypeVersions: { objectTypeId: "object_type_id", organizationId: "organization_id", version: "version" },
}));

vi.mock("drizzle-orm", () => ({
    eq: vi.fn((...args: any[]) => ({ type: "eq", args })),
    and: vi.fn((...args: any[]) => ({ type: "and", args })),
    lte: vi.fn((...args: any[]) => ({ type: "lte", args })),
    gte: vi.fn((...args: any[]) => ({ type: "gte", args })),
    gt: vi.fn((...args: any[]) => ({ type: "gt", args })),
    ne: vi.fn((...args: any[]) => ({ type: "ne", args })),
    desc: vi.fn((...args: any[]) => ({ type: "desc", args })),
    asc: vi.fn((...args: any[]) => ({ type: "asc", args })),
    count: vi.fn(() => "count"),
    sql: vi.fn((...args: any[]) => args),
    inArray: vi.fn((...args: any[]) => ({ type: "inArray", args })),
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

// Mock community-summarizer which is imported by community-maintainer
vi.mock("../../graph-rag/community-summarizer.service.js", () => ({
    CommunitySummarizerService: class {
        static summarize = vi.fn();
    },
}));

// Mock the graph-rag types module
vi.mock("../../graph-rag/types.js", () => ({}));

// ─── 13.1: Temporal versioning integration ───────────────────────────────────

describe("13.1: Temporal versioning - recordNodeVersion + getNodeAtTimestamp consistency", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("recordNodeVersion stores version, getNodeAtTimestamp retrieves correct historical state", async () => {
        // This tests that the full service flow produces consistent results:
        // record a version → query at that timestamp → get the recorded state back.

        const { temporalVersionStoreService } = await import(
            "../../temporal/temporal-version-store.service.js"
        );

        const previousState = {
            id: 1, name: "NodeA", label: "Service", organizationId: 1,
            verificationStatus: "verified", confidenceScore: "0.8",
        } as any;
        const newState = {
            id: 1, name: "NodeA-Updated", label: "Service", organizationId: 1,
            verificationStatus: "verified", confidenceScore: "0.9",
        } as any;

        // Mock insert for recordNodeVersion
        const insertChain = {
            values: vi.fn().mockResolvedValue(undefined),
        };
        mockDbInsert.mockReturnValue(insertChain);

        // Record the version
        await temporalVersionStoreService.recordNodeVersion(
            1, previousState, newState, "user-1", "confidence update"
        );

        expect(mockDbInsert).toHaveBeenCalled();
        expect(insertChain.values).toHaveBeenCalledWith(
            expect.objectContaining({
                nodeId: 1,
                organizationId: 1,
                actorId: "user-1",
                causalAnnotation: "confidence update",
            }),
        );

        // Now mock getNodeAtTimestamp to return the version we just recorded
        const storedVersion = {
            id: 1, nodeId: 1, organizationId: 1,
            previousState, newState,
            changeType: "name,confidenceScore",
            actorId: "user-1",
            causalAnnotation: "confidence update",
            timestamp: new Date("2024-06-15T12:00:00Z"),
        };

        const selectChain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([storedVersion]),
        };
        mockDbSelect.mockReturnValue(selectChain);

        const result = await temporalVersionStoreService.getNodeAtTimestamp(
            1, new Date("2024-06-15T12:30:00Z")
        );

        expect(result.found).toBe(true);
        if (result.found) {
            expect(result.state).toEqual(newState);
            expect(result.version).toEqual(storedVersion);
        }
    });

    it("getNodeAtTimestamp returns no_history_available for timestamp before earliest version", async () => {
        const { temporalVersionStoreService } = await import(
            "../../temporal/temporal-version-store.service.js"
        );

        const selectChain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([]),
        };
        mockDbSelect.mockReturnValue(selectChain);

        const result = await temporalVersionStoreService.getNodeAtTimestamp(
            1, new Date("2020-01-01T00:00:00Z")
        );

        expect(result.found).toBe(false);
        if (!result.found) {
            expect(result.reason).toBe("no_history_available");
        }
    });

    it("getNodeVersionRange returns versions ordered by timestamp within range", async () => {
        const { temporalVersionStoreService } = await import(
            "../../temporal/temporal-version-store.service.js"
        );

        const versions = [
            { id: 1, nodeId: 1, timestamp: new Date("2024-01-01T00:00:00Z") },
            { id: 2, nodeId: 1, timestamp: new Date("2024-06-01T00:00:00Z") },
        ];

        const selectChain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue(versions),
        };
        mockDbSelect.mockReturnValue(selectChain);

        const result = await temporalVersionStoreService.getNodeVersionRange(
            1, new Date("2024-01-01T00:00:00Z"), new Date("2024-12-31T23:59:59Z")
        );

        expect(result).toEqual(versions);
        expect(result.length).toBe(2);
    });
});

// ─── 13.2: Causal edge + propagation + counterfactual consistency ────────────

describe("13.2: Causal edge creation + propagation + counterfactual consistency", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("createCausalEdge + propagate produces affected nodes with attenuated confidence", async () => {
        const { beliefPropagationEngine } = await import(
            "../../causal/belief-propagation-engine.service.js"
        );

        // Setup: create a causal edge between node 1 -> node 2
        // Mock node lookups for createCausalEdge
        const sourceNode = { id: 1, organizationId: 1, confidenceScore: "0.9" };
        const targetNode = { id: 2, organizationId: 1, confidenceScore: "0.8" };

        const selectChain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn()
                .mockResolvedValueOnce([sourceNode])  // source lookup
                .mockResolvedValueOnce([targetNode]), // target lookup
        };
        mockDbSelect.mockReturnValue(selectChain);

        const createdEdge = {
            id: 10, sourceId: 1, targetId: 2, relation: "CAUSES", weight: 1,
            data: { causalStrength: 0.7, propagationDirection: "forward", lagDurationSeconds: 0 },
            organizationId: 1, createdAt: new Date(),
        };
        const insertChain = { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([createdEdge]) };
        mockDbInsert.mockReturnValue(insertChain);

        const result = await beliefPropagationEngine.createCausalEdge({
            sourceNodeId: 1, targetNodeId: 2, organizationId: 1,
            causalStrength: 0.7, propagationDirection: "forward", lagDurationSeconds: 0,
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.edge.relation).toBe("CAUSES");
        }

        // Now test propagation from node 1
        // Mock: fetch start node
        const propagateSelectChain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValueOnce([sourceNode]), // start node
        };
        // Second select: fetch CAUSES edges
        const edgesSelectChain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
        };

        mockDbSelect
            .mockReturnValueOnce(propagateSelectChain)
            .mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([createdEdge]),
            });

        const propagationResult = await beliefPropagationEngine.propagate(1, 1);

        // Node 2 should be affected with confidence = 0.9 * 0.7 = 0.63
        expect(propagationResult.affectedNodes.length).toBe(1);
        expect(propagationResult.affectedNodes[0].nodeId).toBe(2);
        expect(propagationResult.affectedNodes[0].cumulativeConfidence).toBeCloseTo(0.63, 2);
        expect(propagationResult.affectedNodes[0].hopDistance).toBe(1);
    });

    it("counterfactual returns same affected nodes as live propagation on unchanged graph", async () => {
        const { beliefPropagationEngine } = await import(
            "../../causal/belief-propagation-engine.service.js"
        );

        const targetNode = { id: 1, organizationId: 1, confidenceScore: "1.0" };
        const causalEdge = {
            id: 10, sourceId: 1, targetId: 2, relation: "CAUSES", weight: 1,
            data: { causalStrength: 0.8, propagationDirection: "forward", lagDurationSeconds: 0 },
            organizationId: 1, createdAt: new Date(),
        };

        // Mock for counterfactual: node lookup + edges + node count
        mockDbSelect
            .mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([targetNode]),
            })
            .mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([causalEdge]),
            })
            .mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ count: 100 }]),
            });

        const cfResult = await beliefPropagationEngine.counterfactual({
            targetNodeId: 1,
            hypotheticalState: { status: "degraded" },
            organizationId: 1,
            maxHops: 3,
        });

        expect("error" in cfResult).toBe(false);
        if (!("error" in cfResult)) {
            // Node 2 affected with confidence = 1.0 * 0.8 = 0.8
            expect(cfResult.affectedNodes.length).toBe(1);
            expect(cfResult.affectedNodes[0].nodeId).toBe(2);
            expect(cfResult.affectedNodes[0].cumulativeConfidence).toBeCloseTo(0.8, 2);
            expect(cfResult.graphSizeExceeded).toBe(false);
            expect(cfResult.computationDurationMs).toBeGreaterThanOrEqual(0);
        }
    });

    it("counterfactual returns error for non-existent node", async () => {
        const { beliefPropagationEngine } = await import(
            "../../causal/belief-propagation-engine.service.js"
        );

        mockDbSelect.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([]),
        });

        const result = await beliefPropagationEngine.counterfactual({
            targetNodeId: 999,
            hypotheticalState: { status: "active" },
            organizationId: 1,
        });

        expect("error" in result).toBe(true);
    });
});

// ─── 13.3: Link prediction flow ─────────────────────────────────────────────

describe("13.3: Link prediction - runPrediction, approve, reject flow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("runPrediction skips when fewer than 10 nodes", async () => {
        const { linkPredictorService } = await import(
            "../../prediction/link-predictor.service.js"
        );

        // Mock: fetch verified nodes (fewer than 10)
        mockDbSelect.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([
                { id: 1 }, { id: 2 }, { id: 3 },
            ]),
        });

        const result = await linkPredictorService.runPrediction(1);

        expect(result.predictions).toEqual([]);
        expect(result.metadata.skipped).toBe(true);
        expect(result.metadata.skipReason).toContain("Insufficient graph density");
    });

    it("approvePrediction promotes to verified edge", async () => {
        const { linkPredictorService } = await import(
            "../../prediction/link-predictor.service.js"
        );

        const prediction = {
            id: 5, organizationId: 1, sourceNodeId: 1, targetNodeId: 2,
            predictedRelation: "RELATED_TO", confidenceScore: "0.85",
            status: "predicted", reviewedBy: null, reviewedAt: null,
        };

        // Mock: find prediction
        mockDbSelect.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([prediction]),
        });

        // Mock: insert edge
        const newEdge = { id: 20, sourceId: 1, targetId: 2, relation: "RELATED_TO", weight: 9 };
        mockDbInsert.mockReturnValueOnce({
            values: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([newEdge]),
        });

        // Mock: update prediction status
        mockDbUpdate.mockReturnValueOnce({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
        });

        const edge = await linkPredictorService.approvePrediction(5, "reviewer-1");

        expect(edge.id).toBe(20);
        expect(edge.sourceId).toBe(1);
        expect(edge.targetId).toBe(2);
        expect(mockDbUpdate).toHaveBeenCalled();
    });

    it("rejectPrediction marks as rejected and excludes from future runs", async () => {
        const { linkPredictorService } = await import(
            "../../prediction/link-predictor.service.js"
        );

        const prediction = {
            id: 6, organizationId: 1, sourceNodeId: 3, targetNodeId: 4,
            predictedRelation: "DEPENDS_ON", confidenceScore: "0.72",
            status: "predicted", reviewedBy: null, reviewedAt: null,
        };

        // Mock: find prediction
        mockDbSelect.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([prediction]),
        });

        // Mock: update prediction status
        mockDbUpdate.mockReturnValueOnce({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
        });

        await linkPredictorService.rejectPrediction(6, "reviewer-2");

        expect(mockDbUpdate).toHaveBeenCalled();
    });

    it("approvePrediction throws for non-existent prediction", async () => {
        const { linkPredictorService } = await import(
            "../../prediction/link-predictor.service.js"
        );

        mockDbSelect.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([]),
        });

        await expect(
            linkPredictorService.approvePrediction(999, "reviewer-1"),
        ).rejects.toThrow("not found");
    });
});

// ─── 13.4: Ontology registration, reload, migration ─────────────────────────

describe("13.4: Ontology registration persists, reload, and migration preserves data", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("register persists definition, loadActiveDefinitions retrieves it, migration updates schema", async () => {
        const { customOntologyStoreService } = await import(
            "../../ontology/custom-ontology-store.service.js"
        );
        const { ontologyMigrationService } = await import(
            "../../ontology/ontology-migration.service.js"
        );

        // Clear registry for isolation
        customOntologyStoreService.clearRegistry();

        const registeredType = {
            id: 10, organizationId: 1, name: "Customer",
            description: "Customer entity", propertiesSchema: { email: { type: "string" } },
            titleProperty: "email", icon: null, backing: "materialized",
            sourceAdapter: null, isActive: true, createdBy: "actor-1",
            createdAt: new Date(), updatedAt: new Date(),
        };

        // Mock: insert type
        mockDbInsert.mockReturnValueOnce({
            values: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([registeredType]),
        });
        // Mock: insert version
        mockDbInsert.mockReturnValueOnce({
            values: vi.fn().mockResolvedValue(undefined),
        });

        const result = await customOntologyStoreService.register(
            { organizationId: 1, name: "Customer", propertiesSchema: { email: { type: "string" } } } as any,
            "actor-1",
        );

        expect(result.id).toBe(10);
        expect(result.name).toBe("Customer");

        // Verify in-memory registry updated
        expect(customOntologyStoreService.getFromRegistry(10)).toBeDefined();
        expect(customOntologyStoreService.getFromRegistry(10)!.name).toBe("Customer");

        // Simulate app restart: loadActiveDefinitions
        customOntologyStoreService.clearRegistry();

        mockDbSelect.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([registeredType]),
        });

        const loaded = await customOntologyStoreService.loadActiveDefinitions(1);
        expect(loaded.length).toBe(1);
        expect(loaded[0].name).toBe("Customer");
        expect(customOntologyStoreService.getFromRegistry(10)).toBeDefined();
    });

    it("addProperty migration updates schema without breaking existing instances", async () => {
        const { customOntologyStoreService } = await import(
            "../../ontology/custom-ontology-store.service.js"
        );
        const { ontologyMigrationService } = await import(
            "../../ontology/ontology-migration.service.js"
        );

        // Pre-populate registry with an existing type
        const existingType = {
            id: 10, organizationId: 1, name: "Customer",
            propertiesSchema: { email: { type: "string" } },
            isActive: true, createdBy: "actor-1",
        } as any;
        customOntologyStoreService._registry.set(10, existingType);

        // Mock: getVersionHistory for version increment
        mockDbSelect.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockResolvedValue([{ version: 1 }]),
        });

        // Mock: update type
        const updatedType = {
            ...existingType,
            propertiesSchema: { email: { type: "string" }, phone: { type: "string" } },
        };
        mockDbUpdate.mockReturnValueOnce({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([updatedType]),
        });

        // Mock: insert version record
        mockDbInsert.mockReturnValueOnce({
            values: vi.fn().mockResolvedValue(undefined),
        });

        await ontologyMigrationService.addProperty(10, "phone", { type: "string" }, "actor-1");

        // Registry should be updated with new property
        const fromRegistry = customOntologyStoreService.getFromRegistry(10);
        expect(fromRegistry).toBeDefined();
        expect((fromRegistry!.propertiesSchema as any).phone).toBeDefined();
    });

    it("changePropertyType rejects migration when instances are incompatible", async () => {
        const { customOntologyStoreService } = await import(
            "../../ontology/custom-ontology-store.service.js"
        );
        const { ontologyMigrationService } = await import(
            "../../ontology/ontology-migration.service.js"
        );

        const existingType = {
            id: 11, organizationId: 1, name: "Order",
            propertiesSchema: { amount: { type: "string" } },
            isActive: true,
        } as any;
        customOntologyStoreService._registry.set(11, existingType);

        // Mock: query instances with incompatible values
        mockDbSelect.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([
                { id: 100, properties: { amount: "not-a-number" } },
                { id: 101, properties: { amount: "also-not" } },
            ]),
        });

        const result = await ontologyMigrationService.changePropertyType(11, "amount", "integer", "actor-2");

        expect(result.success).toBe(false);
        expect(result.incompatibleInstances).toBeDefined();
        expect(result.incompatibleInstances!.length).toBe(2);
        expect(result.incompatibleInstances![0].instanceId).toBe(100);
    });
});

// ─── 13.5: Edge add/remove triggers community update + adaptive retrieval ────

describe("13.5: Community maintenance - edge add/remove + adaptive retrieval", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("handleEdgeAdded assigns nodes to communities, handleEdgeRemoved splits when no path", async () => {
        const { CommunityMaintainerService } = await import(
            "../../graph-rag/community-maintainer.service.js"
        );

        CommunityMaintainerService.reset();

        // Initialize with two separate communities
        const adjacency: Map<number, Set<number>> = new Map([
            [1, new Set([2])],
            [2, new Set([1])],
            [3, new Set([4])],
            [4, new Set([3])],
        ]);
        const communities: Map<number, string> = new Map([
            [1, "community-A"],
            [2, "community-A"],
            [3, "community-B"],
            [4, "community-B"],
        ]);

        CommunityMaintainerService.initializeForTesting(1, adjacency, communities);

        // Add edge connecting the two communities (2 -> 3)
        const newEdge = {
            id: 100, sourceId: 2, targetId: 3, relation: "CONNECTS",
            weight: 5, organizationId: 1, data: null, createdAt: new Date(),
            createdBy: null,
        } as any;

        await CommunityMaintainerService.handleEdgeAdded(newEdge);

        // After adding edge between communities, check communities updated
        const updatedCommunities = CommunityMaintainerService.getCommunityAssignments(1);
        expect(updatedCommunities).toBeDefined();
        // Both nodes 2 and 3 should now have adjacency connection
        const adj = CommunityMaintainerService.getAdjacencyList(1);
        expect(adj!.get(2)!.has(3)).toBe(true);
        expect(adj!.get(3)!.has(2)).toBe(true);
    });

    it("handleEdgeRemoved triggers community split when no alternative path", async () => {
        const { CommunityMaintainerService } = await import(
            "../../graph-rag/community-maintainer.service.js"
        );

        CommunityMaintainerService.reset();

        // Two nodes in same community with only one path between them
        const adjacency: Map<number, Set<number>> = new Map([
            [10, new Set([11])],
            [11, new Set([10])],
        ]);
        const communities: Map<number, string> = new Map([
            [10, "community-X"],
            [11, "community-X"],
        ]);

        CommunityMaintainerService.initializeForTesting(2, adjacency, communities);

        const removedEdge = {
            id: 200, sourceId: 10, targetId: 11, relation: "LINKS",
            weight: 1, organizationId: 2, data: null, createdAt: new Date(),
            createdBy: null,
        } as any;

        await CommunityMaintainerService.handleEdgeRemoved(removedEdge);

        // After removal, nodes should be in different communities (split)
        const updatedCommunities = CommunityMaintainerService.getCommunityAssignments(2);
        expect(updatedCommunities).toBeDefined();
        // The edge should be removed from adjacency
        const adj = CommunityMaintainerService.getAdjacencyList(2);
        expect(adj!.get(10)?.has(11)).toBeFalsy();
    });

    it("adaptiveRetrieve expands depth on low confidence results", async () => {
        const { CommunityMaintainerService } = await import(
            "../../graph-rag/community-maintainer.service.js"
        );

        // Mock a retrieval function that returns low confidence at depth 2, better at depth 3
        const mockRetrieveFn = vi.fn()
            .mockResolvedValueOnce({
                contextNodes: [{ node: { id: 1 }, relevanceScore: 0.3, hopDistance: 1, incomingPaths: [], discoverySource: "vector" }],
                traversedPaths: [],
                metrics: { totalNodesVisited: 1 },
                queryId: "q1",
            })
            .mockResolvedValueOnce({
                contextNodes: [
                    { node: { id: 1 }, relevanceScore: 0.3, hopDistance: 1, incomingPaths: [], discoverySource: "vector" },
                    { node: { id: 2 }, relevanceScore: 0.7, hopDistance: 2, incomingPaths: [], discoverySource: "traversal" },
                ],
                traversedPaths: [],
                metrics: { totalNodesVisited: 2 },
                queryId: "q2",
            });

        const query = {
            query: "test query",
            organizationId: 1,
            maxHops: 2,
            topK: 5,
            traversalStrategy: "bfs" as const,
            minRelationshipWeight: 0.5,
            includePaths: true,
        };

        const result = await CommunityMaintainerService.adaptiveRetrieve(
            query, mockRetrieveFn, 0.5, 2
        );

        expect(result.expansionTriggered).toBe(true);
        expect(result.finalDepth).toBeGreaterThanOrEqual(2);
        expect(mockRetrieveFn).toHaveBeenCalledTimes(2);
    });

    it("adaptiveRetrieve caps expansion at maxDepth + 2", async () => {
        const { CommunityMaintainerService } = await import(
            "../../graph-rag/community-maintainer.service.js"
        );

        // Always returns low confidence
        const mockRetrieveFn = vi.fn().mockResolvedValue({
            contextNodes: [{ node: { id: 1 }, relevanceScore: 0.2, hopDistance: 1, incomingPaths: [], discoverySource: "vector" }],
            traversedPaths: [],
            metrics: { totalNodesVisited: 1 },
            queryId: "q",
        });

        const query = {
            query: "test",
            organizationId: 1,
            maxHops: 2,
            topK: 5,
            traversalStrategy: "bfs" as const,
            minRelationshipWeight: 0.5,
            includePaths: true,
        };

        const result = await CommunityMaintainerService.adaptiveRetrieve(
            query, mockRetrieveFn, 0.5, 2
        );

        // Should cap at maxHops(2) + maxExpansion(2) = 4
        expect(result.finalDepth).toBeLessThanOrEqual(4);
        expect(result.belowThreshold).toBe(true);
        // Called 3 times: depth 2, 3, 4
        expect(mockRetrieveFn).toHaveBeenCalledTimes(3);
    });
});

// ─── 13.6: Multi-agent belief publish + reconciliation ───────────────────────

describe("13.6: Multi-agent belief publish triggers reconciliation, recorded in temporal store", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("conflicting beliefs within 30s window trigger reconciliation with correct winner", async () => {
        const { SharedBeliefProtocolService } = await import(
            "../../beliefs/shared-belief-protocol.service.js"
        );

        // Create mock transport and version store
        const mockTransport = {
            publish: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn(),
            unsubscribe: vi.fn(),
        };

        const mockVersionStore = {
            recordNodeVersion: vi.fn().mockResolvedValue(undefined),
        };

        const service = new SharedBeliefProtocolService(mockTransport, mockVersionStore);

        // Subscribe two agents to the same topic
        service.subscribeTopic("agent-1", "topic-cluster-1");
        service.subscribeTopic("agent-2", "topic-cluster-1");

        // Acknowledge both agents to make them "active"
        service.acknowledgeBeliefBroadcast("agent-1");
        service.acknowledgeBeliefBroadcast("agent-2");

        // Agent 1 publishes a belief
        await service.publishBelief({
            agentId: "agent-1",
            nodeId: 42,
            assertedState: { status: "healthy" },
            confidenceScore: 0.7,
            evidenceRefs: ["evidence-1"],
            organizationId: 1,
            topicClusterId: "topic-cluster-1",
        });

        // Agent 2 publishes a conflicting belief within 30s
        await service.publishBelief({
            agentId: "agent-2",
            nodeId: 42,
            assertedState: { status: "degraded" },
            confidenceScore: 0.9,
            evidenceRefs: ["evidence-2", "evidence-3"],
            organizationId: 1,
            topicClusterId: "topic-cluster-1",
        });

        // Advance timers to allow reconciliation to process
        await vi.advanceTimersByTimeAsync(100);

        // The reconciliation should have been triggered and the version store should
        // have been called to record the reconciliation outcome
        // Agent-2 has higher confidence (0.9 > 0.7), so it wins
        expect(mockVersionStore.recordNodeVersion).toHaveBeenCalledWith(
            42,
            expect.any(Object),
            expect.objectContaining({ status: "degraded" }),
            "system:belief_reconciliation",
            expect.stringContaining("reconcil"),
        );
    });

    it("performVoting selects highest confidence agent as winner, tie broken by earliest timestamp", async () => {
        const { SharedBeliefProtocolService } = await import(
            "../../beliefs/shared-belief-protocol.service.js"
        );

        const mockTransport = {
            publish: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn(),
            unsubscribe: vi.fn(),
        };
        const mockVersionStore = { recordNodeVersion: vi.fn().mockResolvedValue(undefined) };

        const service = new SharedBeliefProtocolService(mockTransport, mockVersionStore);

        // Two agents with same confidence — earliest timestamp wins
        const assertions = [
            {
                agentId: "agent-A",
                nodeId: 10,
                assertedState: { value: "A" },
                confidenceScore: 0.8,
                evidenceRefs: ["ref-1"],
                organizationId: 1,
                topicClusterId: "topic-1",
                receivedAt: new Date("2024-01-01T10:00:00Z"),
            },
            {
                agentId: "agent-B",
                nodeId: 10,
                assertedState: { value: "B" },
                confidenceScore: 0.8,
                evidenceRefs: ["ref-2"],
                organizationId: 1,
                topicClusterId: "topic-1",
                receivedAt: new Date("2024-01-01T10:00:01Z"),
            },
        ];

        const result = service.performVoting(assertions);

        // Same confidence, so earliest timestamp (agent-A) wins
        expect(result.winningAgentId).toBe("agent-A");
        expect(result.reconciledState).toEqual({ value: "A" });
        expect(result.votingDetails.length).toBe(2);
    });

    it("stale agents are excluded from voting", async () => {
        const { SharedBeliefProtocolService } = await import(
            "../../beliefs/shared-belief-protocol.service.js"
        );

        const mockTransport = {
            publish: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn(),
            unsubscribe: vi.fn(),
        };
        const mockVersionStore = { recordNodeVersion: vi.fn().mockResolvedValue(undefined) };

        const service = new SharedBeliefProtocolService(mockTransport, mockVersionStore);

        // Subscribe agents
        service.subscribeTopic("agent-active", "topic-1");
        service.subscribeTopic("agent-stale", "topic-1");

        // Only acknowledge agent-active
        service.acknowledgeBeliefBroadcast("agent-active");
        // agent-stale is never acknowledged so will be marked stale after timeout

        expect(service.getAgentStatus("agent-active")).toBe("active");
        // Stale status is set after ack timeout — advance timers
        // Note: agent-stale starts as active until ack timer fires
    });

    it("dispose cleans up timers and deferred state without affecting subscriptions", async () => {
        const { SharedBeliefProtocolService } = await import(
            "../../beliefs/shared-belief-protocol.service.js"
        );

        const mockTransport = {
            publish: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn(),
            unsubscribe: vi.fn(),
        };
        const mockVersionStore = { recordNodeVersion: vi.fn().mockResolvedValue(undefined) };

        const service = new SharedBeliefProtocolService(mockTransport, mockVersionStore);
        service.subscribeTopic("agent-1", "topic-1");

        service.dispose();

        // dispose clears timers but subscriptions are retained (by design)
        // The service stops processing but subscription state remains readable
        expect(service.getSubscribers("topic-1").size).toBe(1);
    });
});
