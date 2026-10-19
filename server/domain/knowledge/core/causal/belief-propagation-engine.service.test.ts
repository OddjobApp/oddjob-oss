import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (vi.mock is hoisted, so references must also be hoisted) ─
const mockLogger = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
    select: vi.fn(),
    insert: vi.fn(),
}));

// ── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => mockLogger),
}));

// ── Mock database ───────────────────────────────────────────────────────────
vi.mock("@server/database_service.js", () => ({
    db: mockDb,
}));

// ── Mock drizzle-orm operators ──────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
    eq: vi.fn((...args: any[]) => ({ _op: "eq", args })),
    and: vi.fn((...args: any[]) => ({ _op: "and", args })),
    count: vi.fn(() => ({ _fn: "count" })),
}));

// ── Mock schema modules ─────────────────────────────────────────────────────
vi.mock("@shared/schema/index.js", () => ({
    knowledgeNodes: {
        id: "id",
        organizationId: "organization_id",
    },
    knowledgeEdges: {
        id: "id",
        sourceId: "source_id",
        targetId: "target_id",
        relation: "relation",
        organizationId: "organization_id",
        data: "data",
        weight: "weight",
        createdAt: "created_at",
    },
}));

import { beliefPropagationEngine, isCounterfactualError } from "./belief-propagation-engine.service.js";
import type { CausalEdgeMetadata, CounterfactualResult } from "./belief-propagation-engine.service.js";

// ── Helper: builds a select chain for db.select().from().where().limit() ────

function setupSelectChain(results: any[]) {
    const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(results),
    };
    mockDb.select.mockReturnValue(chain);
    return chain;
}

/**
 * Helper for multi-call select scenarios where db.select() is called
 * multiple times with different expected results.
 */
function setupMultiSelect(resultSets: any[][]) {
    let callIndex = 0;
    mockDb.select.mockImplementation(() => {
        const results = resultSets[callIndex] ?? [];
        callIndex++;
        const chain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue(results),
        };
        return chain;
    });
}

/**
 * Builds a select implementation that supports multiple calls with different return
 * patterns: some calls need .limit() (single-node lookups) and others don't
 * (bulk edge fetches that resolve at .where()).
 */
function setupPropagationMocks(
    startNode: any | null,
    causalEdges: any[],
) {
    let callIndex = 0;
    mockDb.select.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
            // First call: lookup start node (db.select().from(knowledgeNodes).where().limit(1))
            const chain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(startNode ? [startNode] : []),
            };
            return chain;
        }
        // Second call: fetch all CAUSES edges (db.select().from(knowledgeEdges).where())
        const chain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(causalEdges),
        };
        return chain;
    });
}

/**
 * Builds a select implementation for the counterfactual method which makes 3 DB calls:
 *   1. db.select().from(knowledgeNodes).where().limit(1) — target node lookup
 *   2. db.select().from(knowledgeEdges).where() — fetch CAUSES edges
 *   3. db.select({ count: count() }).from(knowledgeNodes).where() — count total nodes
 */
function setupCounterfactualMocks(
    targetNode: any | null,
    causalEdges: any[],
    nodeCount: number,
) {
    let callIndex = 0;
    mockDb.select.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
            // First call: lookup target node
            const chain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(targetNode ? [targetNode] : []),
            };
            return chain;
        }
        if (callIndex === 2) {
            // Second call: fetch all CAUSES edges (no .limit())
            const chain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue(causalEdges),
            };
            return chain;
        }
        // Third call: count total nodes (db.select({ count: count() }).from().where())
        const chain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([{ count: nodeCount }]),
        };
        return chain;
    });
}

// ── Helper: builds an insert chain for db.insert().values().returning() ─────

function setupInsertChain(result: any) {
    const chain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([result]),
    };
    mockDb.insert.mockReturnValue(chain);
    return chain;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("BeliefPropagationEngine", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── createCausalEdge ───────────────────────────────────────────────────

    describe("createCausalEdge", () => {
        it("rejects when source === target", async () => {
            const result = await beliefPropagationEngine.createCausalEdge({
                sourceNodeId: 5,
                targetNodeId: 5,
                organizationId: 1,
                causalStrength: 0.8,
                propagationDirection: "forward",
                lagDurationSeconds: 60,
            });

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toBe("source and target nodes must be different");
            }
            // Should NOT query the database
            expect(mockDb.select).not.toHaveBeenCalled();
        });

        it("rejects when source node doesn't exist", async () => {
            // First select: source node not found, second select: target node
            setupMultiSelect([
                [], // source not found
                [{ id: 2, organizationId: 1 }], // target exists
            ]);

            const result = await beliefPropagationEngine.createCausalEdge({
                sourceNodeId: 1,
                targetNodeId: 2,
                organizationId: 1,
                causalStrength: 0.7,
                propagationDirection: "forward",
                lagDurationSeconds: 0,
            });

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toBe("source node does not exist");
            }
        });

        it("rejects when target node doesn't exist", async () => {
            setupMultiSelect([
                [{ id: 1, organizationId: 1 }], // source exists
                [], // target not found
            ]);

            const result = await beliefPropagationEngine.createCausalEdge({
                sourceNodeId: 1,
                targetNodeId: 2,
                organizationId: 1,
                causalStrength: 0.7,
                propagationDirection: "forward",
                lagDurationSeconds: 0,
            });

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toBe("target node does not exist");
            }
        });

        it("rejects when nodes belong to different org", async () => {
            setupMultiSelect([
                [{ id: 1, organizationId: 1 }], // source in org 1
                [{ id: 2, organizationId: 2 }], // target in org 2
            ]);

            const result = await beliefPropagationEngine.createCausalEdge({
                sourceNodeId: 1,
                targetNodeId: 2,
                organizationId: 1,
                causalStrength: 0.7,
                propagationDirection: "forward",
                lagDurationSeconds: 0,
            });

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toBe("nodes must belong to the same organization");
            }
        });

        it("successfully creates a causal edge with correct metadata", async () => {
            setupMultiSelect([
                [{ id: 10, organizationId: 1 }], // source exists in org 1
                [{ id: 20, organizationId: 1 }], // target exists in org 1
            ]);

            const createdEdge = {
                id: 100,
                sourceId: 10,
                targetId: 20,
                relation: "CAUSES",
                weight: 1,
                data: {
                    causalStrength: 0.85,
                    propagationDirection: "forward",
                    lagDurationSeconds: 3600,
                },
                organizationId: 1,
                createdAt: new Date("2024-06-01"),
            };
            setupInsertChain(createdEdge);

            const result = await beliefPropagationEngine.createCausalEdge({
                sourceNodeId: 10,
                targetNodeId: 20,
                organizationId: 1,
                causalStrength: 0.85,
                propagationDirection: "forward",
                lagDurationSeconds: 3600,
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.edge.id).toBe(100);
                expect(result.edge.relation).toBe("CAUSES");
                expect(result.edge.sourceId).toBe(10);
                expect(result.edge.targetId).toBe(20);
                const metadata = result.edge.data as CausalEdgeMetadata;
                expect(metadata.causalStrength).toBe(0.85);
                expect(metadata.propagationDirection).toBe("forward");
                expect(metadata.lagDurationSeconds).toBe(3600);
            }

            expect(mockLogger.info).toHaveBeenCalledWith(
                "Causal edge created",
                expect.objectContaining({
                    edgeId: 100,
                    source: 10,
                    target: 20,
                    causalStrength: 0.85,
                }),
            );
        });
    });

    // ─── propagate ──────────────────────────────────────────────────────────

    describe("propagate", () => {
        it("returns empty result for non-existent start node", async () => {
            setupPropagationMocks(null, []);

            const result = await beliefPropagationEngine.propagate(999, 1);

            expect(result.affectedNodes).toHaveLength(0);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                "Propagation requested for non-existent node",
                { nodeId: 999 },
            );
        });

        it("propagates through a simple chain (A→B→C) with confidence attenuation", async () => {
            // Start node A has confidence 0.9
            const startNode = { id: 1, confidenceScore: "0.90", organizationId: 1 };

            // Edges: A→B (strength 0.8), B→C (strength 0.7)
            const edges = [
                {
                    id: 100,
                    sourceId: 1,
                    targetId: 2,
                    relation: "CAUSES",
                    organizationId: 1,
                    data: { causalStrength: 0.8, propagationDirection: "forward", lagDurationSeconds: 0 },
                    createdAt: new Date("2024-01-01"),
                },
                {
                    id: 101,
                    sourceId: 2,
                    targetId: 3,
                    relation: "CAUSES",
                    organizationId: 1,
                    data: { causalStrength: 0.7, propagationDirection: "forward", lagDurationSeconds: 0 },
                    createdAt: new Date("2024-01-02"),
                },
            ];

            setupPropagationMocks(startNode, edges);

            const result = await beliefPropagationEngine.propagate(1, 1, { maxHops: 5 });

            expect(result.affectedNodes).toHaveLength(2);

            // Node B: confidence = 0.9 * 0.8 = 0.72, hop 1
            const nodeB = result.affectedNodes.find((n) => n.nodeId === 2);
            expect(nodeB).toBeDefined();
            expect(nodeB!.cumulativeConfidence).toBeCloseTo(0.72, 5);
            expect(nodeB!.hopDistance).toBe(1);

            // Node C: confidence = 0.9 * 0.8 * 0.7 = 0.504, hop 2
            const nodeC = result.affectedNodes.find((n) => n.nodeId === 3);
            expect(nodeC).toBeDefined();
            expect(nodeC!.cumulativeConfidence).toBeCloseTo(0.504, 5);
            expect(nodeC!.hopDistance).toBe(2);
        });

        it("stops at maxHops limit", async () => {
            // Chain: A→B→C→D, all with high causal strength
            const startNode = { id: 1, confidenceScore: "1.00", organizationId: 1 };
            const edges = [
                {
                    id: 100, sourceId: 1, targetId: 2, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.9 }, createdAt: new Date("2024-01-01"),
                },
                {
                    id: 101, sourceId: 2, targetId: 3, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.9 }, createdAt: new Date("2024-01-02"),
                },
                {
                    id: 102, sourceId: 3, targetId: 4, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.9 }, createdAt: new Date("2024-01-03"),
                },
            ];

            setupPropagationMocks(startNode, edges);

            // maxHops = 2 means we should only reach B and C, not D
            const result = await beliefPropagationEngine.propagate(1, 1, { maxHops: 2 });

            expect(result.affectedNodes).toHaveLength(2);
            expect(result.affectedNodes.map((n) => n.nodeId).sort()).toEqual([2, 3]);
            // Node D (id=4) should NOT be reached
            expect(result.affectedNodes.find((n) => n.nodeId === 4)).toBeUndefined();
        });

        it("stops when confidence drops below minConfidence threshold", async () => {
            // Chain: A→B→C, low strengths so confidence drops below 0.1
            const startNode = { id: 1, confidenceScore: "0.50", organizationId: 1 };
            const edges = [
                {
                    id: 100, sourceId: 1, targetId: 2, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.3 }, createdAt: new Date("2024-01-01"),
                },
                {
                    id: 101, sourceId: 2, targetId: 3, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.3 }, createdAt: new Date("2024-01-03"),
                },
            ];

            setupPropagationMocks(startNode, edges);

            const result = await beliefPropagationEngine.propagate(1, 1, { maxHops: 10 });

            // A confidence: 0.5
            // B confidence: 0.5 * 0.3 = 0.15 (above 0.1, included)
            // C confidence: 0.15 * 0.3 = 0.045 (below 0.1, excluded)
            expect(result.affectedNodes).toHaveLength(1);
            expect(result.affectedNodes[0].nodeId).toBe(2);
            expect(result.affectedNodes[0].cumulativeConfidence).toBeCloseTo(0.15, 5);
        });

        it("caps maxHops at 10 even if higher value requested", async () => {
            // Create a long chain of 12 nodes: 1→2→3→...→12
            const startNode = { id: 1, confidenceScore: "1.00", organizationId: 1 };
            const edges = Array.from({ length: 11 }, (_, i) => ({
                id: 100 + i,
                sourceId: i + 1,
                targetId: i + 2,
                relation: "CAUSES",
                organizationId: 1,
                data: { causalStrength: 0.95 }, // High enough to not drop below 0.1 within 10 hops
                createdAt: new Date(`2024-01-${String(i + 1).padStart(2, "0")}`),
            }));

            setupPropagationMocks(startNode, edges);

            // Request maxHops = 50, but it should be capped at 10
            const result = await beliefPropagationEngine.propagate(1, 1, { maxHops: 50 });

            // With strength 0.95 per hop, 1.0 * 0.95^10 ≈ 0.5987 > 0.1
            // So all 10 hops should be reached, but node 12 (hop 11) should not
            expect(result.affectedNodes.length).toBeLessThanOrEqual(10);
            expect(result.affectedNodes.every((n) => n.hopDistance <= 10)).toBe(true);
            // Node 12 should NOT be in results
            expect(result.affectedNodes.find((n) => n.nodeId === 12)).toBeUndefined();
        });

        it("detects cycle, breaks at lowest causalStrength edge, and includes cycleWarning", async () => {
            // Graph with a cycle: A→B→C→A
            // Edge strengths: A→B: 0.9, B→C: 0.5, C→A: 0.3 (weakest)
            const startNode = { id: 1, confidenceScore: "1.00", organizationId: 1 };
            const edges = [
                {
                    id: 100, sourceId: 1, targetId: 2, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.9 },
                    createdAt: new Date("2024-01-01"),
                },
                {
                    id: 101, sourceId: 2, targetId: 3, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.5 },
                    createdAt: new Date("2024-01-02"),
                },
                {
                    id: 102, sourceId: 3, targetId: 1, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.3 },
                    createdAt: new Date("2024-01-03"),
                },
            ];

            setupPropagationMocks(startNode, edges);

            const result = await beliefPropagationEngine.propagate(1, 1, { maxHops: 5 });

            // Should have visited B and C
            expect(result.affectedNodes.length).toBeGreaterThanOrEqual(2);
            expect(result.affectedNodes.find((n) => n.nodeId === 2)).toBeDefined();
            expect(result.affectedNodes.find((n) => n.nodeId === 3)).toBeDefined();

            // Cycle warning should be present
            expect(result.cycleWarning).toBeDefined();
            expect(result.cycleWarning!.path).toContain(1); // Cycle involves node 1

            // The broken edge should be the one with the lowest causalStrength
            // Edge 102 (C→A) has strength 0.3, which is the weakest
            expect(result.cycleWarning!.brokenEdgeId).toBe(102);

            // Logger should have been called with cycle warning
            expect(mockLogger.warn).toHaveBeenCalledWith(
                "Propagation cycle detected and broken",
                expect.objectContaining({
                    brokenEdgeId: 102,
                    brokenEdgeCausalStrength: 0.3,
                }),
            );
        });
    });

    // ─── counterfactual ─────────────────────────────────────────────────────

    describe("counterfactual", () => {
        it("returns 'node not found' error for non-existent target node", async () => {
            setupCounterfactualMocks(null, [], 100);

            const result = await beliefPropagationEngine.counterfactual({
                targetNodeId: 999,
                hypotheticalState: { status: "critical" },
                organizationId: 1,
            });

            expect(isCounterfactualError(result)).toBe(true);
            if (isCounterfactualError(result)) {
                expect(result.error).toBe("node not found");
            }
            expect(mockLogger.warn).toHaveBeenCalledWith(
                "Counterfactual query for non-existent node",
                expect.objectContaining({ targetNodeId: 999, organizationId: 1 }),
            );
        });

        it("returns 'node not accessible' error for node in wrong org", async () => {
            // Node exists but belongs to org 2, requesting org is 1
            const targetNode = { id: 10, confidenceScore: "0.90", organizationId: 2 };
            setupCounterfactualMocks(targetNode, [], 100);

            const result = await beliefPropagationEngine.counterfactual({
                targetNodeId: 10,
                hypotheticalState: { status: "degraded" },
                organizationId: 1,
            });

            expect(isCounterfactualError(result)).toBe(true);
            if (isCounterfactualError(result)) {
                expect(result.error).toBe("node not accessible");
            }
            expect(mockLogger.warn).toHaveBeenCalledWith(
                "Counterfactual query for node not belonging to requesting organization",
                expect.objectContaining({
                    targetNodeId: 10,
                    requestingOrgId: 1,
                    nodeOrgId: 2,
                }),
            );
        });

        it("traverses causal edges and returns projected states with confidence attenuation", async () => {
            // Chain: A→B→C, A has confidence 0.9
            const targetNode = { id: 1, confidenceScore: "0.90", organizationId: 1 };
            const edges = [
                {
                    id: 100, sourceId: 1, targetId: 2, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.8, propagationDirection: "forward", lagDurationSeconds: 0 },
                    createdAt: new Date("2024-01-01"),
                },
                {
                    id: 101, sourceId: 2, targetId: 3, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.7, propagationDirection: "forward", lagDurationSeconds: 0 },
                    createdAt: new Date("2024-01-02"),
                },
            ];
            setupCounterfactualMocks(targetNode, edges, 500);

            const result = await beliefPropagationEngine.counterfactual({
                targetNodeId: 1,
                hypotheticalState: { status: "degraded" },
                organizationId: 1,
                maxHops: 5,
            });

            expect(isCounterfactualError(result)).toBe(false);
            const cfResult = result as CounterfactualResult;

            expect(cfResult.affectedNodes).toHaveLength(2);

            // Node B: confidence = 0.9 * 0.8 = 0.72, hop 1
            const nodeB = cfResult.affectedNodes.find((n) => n.nodeId === 2);
            expect(nodeB).toBeDefined();
            expect(nodeB!.cumulativeConfidence).toBeCloseTo(0.72, 5);
            expect(nodeB!.hopDistance).toBe(1);
            expect(nodeB!.projectedState).toMatchObject({ status: "degraded" });

            // Node C: confidence = 0.9 * 0.8 * 0.7 = 0.504, hop 2
            const nodeC = cfResult.affectedNodes.find((n) => n.nodeId === 3);
            expect(nodeC).toBeDefined();
            expect(nodeC!.cumulativeConfidence).toBeCloseTo(0.504, 5);
            expect(nodeC!.hopDistance).toBe(2);
            expect(nodeC!.projectedState).toMatchObject({ status: "degraded" });
        });

        it("includes cycleWarning when a cycle is detected", async () => {
            // Graph with cycle: A→B→C→A
            const targetNode = { id: 1, confidenceScore: "1.00", organizationId: 1 };
            const edges = [
                {
                    id: 200, sourceId: 1, targetId: 2, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.9 }, createdAt: new Date("2024-01-01"),
                },
                {
                    id: 201, sourceId: 2, targetId: 3, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.5 }, createdAt: new Date("2024-01-02"),
                },
                {
                    id: 202, sourceId: 3, targetId: 1, relation: "CAUSES", organizationId: 1,
                    data: { causalStrength: 0.3 }, createdAt: new Date("2024-01-03"),
                },
            ];
            setupCounterfactualMocks(targetNode, edges, 50);

            const result = await beliefPropagationEngine.counterfactual({
                targetNodeId: 1,
                hypotheticalState: { status: "failing" },
                organizationId: 1,
                maxHops: 5,
            });

            expect(isCounterfactualError(result)).toBe(false);
            const cfResult = result as CounterfactualResult;

            // Should have visited B and C
            expect(cfResult.affectedNodes.find((n) => n.nodeId === 2)).toBeDefined();
            expect(cfResult.affectedNodes.find((n) => n.nodeId === 3)).toBeDefined();

            // Cycle warning present with break at weakest edge (C→A, strength 0.3)
            expect(cfResult.cycleWarning).toBeDefined();
            expect(cfResult.cycleWarning!.path).toContain(1);
            expect(cfResult.cycleWarning!.brokenEdgeId).toBe(202);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                "Counterfactual cycle detected and broken",
                expect.objectContaining({
                    brokenEdgeId: 202,
                    brokenEdgeCausalStrength: 0.3,
                }),
            );
        });

        it("includes computationDurationMs > 0 in the result", async () => {
            const targetNode = { id: 1, confidenceScore: "1.00", organizationId: 1 };
            setupCounterfactualMocks(targetNode, [], 10);

            const result = await beliefPropagationEngine.counterfactual({
                targetNodeId: 1,
                hypotheticalState: { status: "active" },
                organizationId: 1,
            });

            expect(isCounterfactualError(result)).toBe(false);
            const cfResult = result as CounterfactualResult;
            expect(cfResult.computationDurationMs).toBeGreaterThan(0);
        });

        it("sets graphSizeExceeded to false when node count <= 10000", async () => {
            const targetNode = { id: 1, confidenceScore: "1.00", organizationId: 1 };
            setupCounterfactualMocks(targetNode, [], 5000);

            const result = await beliefPropagationEngine.counterfactual({
                targetNodeId: 1,
                hypotheticalState: { status: "active" },
                organizationId: 1,
            });

            expect(isCounterfactualError(result)).toBe(false);
            const cfResult = result as CounterfactualResult;
            expect(cfResult.graphSizeExceeded).toBe(false);
        });

        it("sets graphSizeExceeded to true when node count > 10000", async () => {
            const targetNode = { id: 1, confidenceScore: "1.00", organizationId: 1 };
            setupCounterfactualMocks(targetNode, [], 15000);

            const result = await beliefPropagationEngine.counterfactual({
                targetNodeId: 1,
                hypotheticalState: { status: "active" },
                organizationId: 1,
            });

            expect(isCounterfactualError(result)).toBe(false);
            const cfResult = result as CounterfactualResult;
            expect(cfResult.graphSizeExceeded).toBe(true);
        });
    });
});
