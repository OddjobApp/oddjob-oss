/**
 * Link Predictor Service – Unit Tests
 * @vitest-environment node
 *
 * Tests cover:
 * - Vector math / TransE fundamentals (pure functions, no DB)
 * - runPrediction skip behavior (< 10 verified nodes)
 * - approvePrediction (DB mocked)
 * - rejectPrediction (DB mocked)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock fns ────────────────────────────────────────────────────────

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@server/database_service.js", () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
        insert: (...args: unknown[]) => mockDbInsert(...args),
        update: (...args: unknown[]) => mockDbUpdate(...args),
        delete: (...args: unknown[]) => mockDbDelete(...args),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

vi.mock("@shared/schema/index.js", () => ({
    knowledgeNodes: { id: "id", organizationId: "organization_id", verificationStatus: "verification_status" },
    knowledgeEdges: { organizationId: "organization_id", sourceId: "source_id", targetId: "target_id", relation: "relation" },
    knowledgeNodeEmbeddings: { nodeId: "node_id", organizationId: "organization_id" },
    knowledgePredictedLinks: { id: "id", organizationId: "organization_id", sourceNodeId: "source_node_id", targetNodeId: "target_node_id", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
    eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
    and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
    ne: vi.fn((...args: unknown[]) => ({ type: "ne", args })),
    inArray: vi.fn((...args: unknown[]) => ({ type: "inArray", args })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings, values })),
}));

// ─── Import the service under test ──────────────────────────────────────────

import { linkPredictorService } from "./link-predictor.service.js";

// ─── Helper ─────────────────────────────────────────────────────────────────

function l2Norm(vec: number[]): number {
    let sum = 0;
    for (const v of vec) sum += v * v;
    return Math.sqrt(sum);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("LinkPredictorService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── Vector Math / TransE Fundamentals ──────────────────────────────────

    describe("randomUnitVector", () => {
        it("produces a 128-dimensional vector", () => {
            const vec = linkPredictorService.randomUnitVector();
            expect(vec).toHaveLength(128);
        });

        it("produces a vector with L2 norm ≈ 1", () => {
            const vec = linkPredictorService.randomUnitVector();
            const norm = l2Norm(vec);
            expect(norm).toBeCloseTo(1.0, 5);
        });

        it("produces different vectors on successive calls", () => {
            const v1 = linkPredictorService.randomUnitVector();
            const v2 = linkPredictorService.randomUnitVector();
            // Very unlikely to produce identical vectors
            const same = v1.every((val, i) => val === v2[i]);
            expect(same).toBe(false);
        });

        it("respects a custom dimension parameter", () => {
            const vec = linkPredictorService.randomUnitVector(64);
            expect(vec).toHaveLength(64);
            expect(l2Norm(vec)).toBeCloseTo(1.0, 5);
        });
    });

    describe("normalizeVector", () => {
        it("normalizes a non-unit vector to L2 norm = 1", () => {
            const vec = [3, 4, 0]; // norm = 5
            const normalized = linkPredictorService.normalizeVector(vec);
            expect(l2Norm(normalized)).toBeCloseTo(1.0, 10);
            expect(normalized[0]).toBeCloseTo(0.6, 10);
            expect(normalized[1]).toBeCloseTo(0.8, 10);
        });

        it("returns the zero vector unchanged for a zero vector", () => {
            const vec = [0, 0, 0];
            const normalized = linkPredictorService.normalizeVector(vec);
            expect(normalized).toEqual([0, 0, 0]);
        });

        it("preserves an already-normalized vector", () => {
            const vec = linkPredictorService.randomUnitVector(128);
            const normalized = linkPredictorService.normalizeVector(vec);
            for (let i = 0; i < vec.length; i++) {
                expect(normalized[i]).toBeCloseTo(vec[i], 10);
            }
        });
    });

    describe("scoreTriple (transeScore)", () => {
        it("returns 0 when h + r = t exactly", () => {
            const h = [1, 2, 3];
            const r = [4, 5, 6];
            const t = [5, 7, 9]; // h + r
            const score = linkPredictorService.scoreTriple(h, r, t);
            expect(score).toBeCloseTo(0, 10);
        });

        it("returns a positive distance when h + r ≠ t", () => {
            const h = [1, 0, 0];
            const r = [0, 1, 0];
            const t = [0, 0, 1]; // h + r = [1,1,0], distance to [0,0,1] > 0
            const score = linkPredictorService.scoreTriple(h, r, t);
            expect(score).toBeGreaterThan(0);
        });

        it("returns the correct L2 distance of h + r - t", () => {
            const h = [1, 0];
            const r = [0, 0];
            const t = [0, 1]; // h + r - t = [1, -1], norm = sqrt(2)
            const score = linkPredictorService.scoreTriple(h, r, t);
            expect(score).toBeCloseTo(Math.sqrt(2), 10);
        });
    });

    describe("distanceToConfidence", () => {
        it("returns 1.0 for distance 0", () => {
            expect(linkPredictorService.distanceToConfidence(0)).toBe(1.0);
        });

        it("decreases for larger distances", () => {
            const c1 = linkPredictorService.distanceToConfidence(0.5);
            const c2 = linkPredictorService.distanceToConfidence(1.0);
            const c3 = linkPredictorService.distanceToConfidence(2.0);

            expect(c1).toBeGreaterThan(c2);
            expect(c2).toBeGreaterThan(c3);
        });

        it("approaches 0 for very large distances", () => {
            const c = linkPredictorService.distanceToConfidence(100);
            expect(c).toBeCloseTo(0, 10);
        });

        it("returns exp(-distance)", () => {
            const d = 1.5;
            expect(linkPredictorService.distanceToConfidence(d)).toBeCloseTo(Math.exp(-d), 10);
        });
    });

    describe("l2Distance", () => {
        it("returns 0 for identical vectors", () => {
            const v = [1, 2, 3];
            expect(linkPredictorService.l2Distance(v, v)).toBe(0);
        });

        it("returns correct Euclidean distance", () => {
            const a = [1, 0, 0];
            const b = [0, 1, 0];
            expect(linkPredictorService.l2Distance(a, b)).toBeCloseTo(Math.sqrt(2), 10);
        });
    });

    // ─── runPrediction ──────────────────────────────────────────────────────

    describe("runPrediction", () => {
        it("skips prediction with appropriate message when fewer than 10 verified nodes", async () => {
            // Mock: db.select().from().where() returns 5 nodes (< 10 minimum)
            const mockWhere = vi.fn().mockResolvedValue([
                { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
            ]);
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            mockDbSelect.mockReturnValue({ from: mockFrom });

            const result = await linkPredictorService.runPrediction(1);

            expect(result.predictions).toEqual([]);
            expect(result.metadata.skipped).toBe(true);
            expect(result.metadata.skipReason).toContain("Insufficient graph density");
            expect(result.metadata.skipReason).toContain("5");
            expect(result.metadata.skipReason).toContain("10");
            expect(result.metadata.totalNodesEmbedded).toBe(0);
        });
    });

    // ─── approvePrediction ──────────────────────────────────────────────────

    describe("approvePrediction", () => {
        it("successfully creates edge and updates prediction status to 'approved'", async () => {
            const mockPrediction = {
                id: 42,
                organizationId: 1,
                sourceNodeId: 10,
                targetNodeId: 20,
                predictedRelation: "DEPENDS_ON",
                confidenceScore: "0.850",
                status: "predicted",
                reviewedBy: null,
                reviewedAt: null,
                createdAt: new Date(),
            };

            const mockCreatedEdge = {
                id: 100,
                sourceId: 10,
                targetId: 20,
                relation: "DEPENDS_ON",
                weight: 9,
                organizationId: 1,
                createdBy: "reviewer-1",
                data: { fromPrediction: true, predictionId: 42, confidenceScore: 0.85 },
                createdAt: new Date(),
                prospectPropertyId: null,
                missionId: null,
                lastUpdatedByRunId: null,
            };

            // Mock db.select().from().where().limit() -> returns prediction
            const mockLimit = vi.fn().mockResolvedValue([mockPrediction]);
            const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            mockDbSelect.mockReturnValue({ from: mockFrom });

            // Mock db.insert().values().returning() -> returns created edge
            const mockReturning = vi.fn().mockResolvedValue([mockCreatedEdge]);
            const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
            mockDbInsert.mockReturnValue({ values: mockValues });

            // Mock db.update().set().where() -> void
            const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
            const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
            mockDbUpdate.mockReturnValue({ set: mockSet });

            const result = await linkPredictorService.approvePrediction(42, "reviewer-1");

            expect(result).toEqual(mockCreatedEdge);
            expect(mockDbInsert).toHaveBeenCalled();
            expect(mockDbUpdate).toHaveBeenCalled();
        });

        it("throws error for non-existent prediction", async () => {
            // Mock db.select().from().where().limit() -> returns empty
            const mockLimit = vi.fn().mockResolvedValue([]);
            const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            mockDbSelect.mockReturnValue({ from: mockFrom });

            await expect(
                linkPredictorService.approvePrediction(999, "reviewer-1"),
            ).rejects.toThrow("Prediction with ID 999 not found");
        });

        it("throws error for already approved prediction", async () => {
            const mockPrediction = {
                id: 42,
                organizationId: 1,
                sourceNodeId: 10,
                targetNodeId: 20,
                predictedRelation: "DEPENDS_ON",
                confidenceScore: "0.850",
                status: "approved",
                reviewedBy: "old-reviewer",
                reviewedAt: new Date(),
                createdAt: new Date(),
            };

            const mockLimit = vi.fn().mockResolvedValue([mockPrediction]);
            const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            mockDbSelect.mockReturnValue({ from: mockFrom });

            await expect(
                linkPredictorService.approvePrediction(42, "reviewer-1"),
            ).rejects.toThrow('cannot be approved: current status is "approved"');
        });

        it("throws error for already rejected prediction", async () => {
            const mockPrediction = {
                id: 42,
                organizationId: 1,
                sourceNodeId: 10,
                targetNodeId: 20,
                predictedRelation: "DEPENDS_ON",
                confidenceScore: "0.850",
                status: "rejected",
                reviewedBy: "old-reviewer",
                reviewedAt: new Date(),
                createdAt: new Date(),
            };

            const mockLimit = vi.fn().mockResolvedValue([mockPrediction]);
            const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            mockDbSelect.mockReturnValue({ from: mockFrom });

            await expect(
                linkPredictorService.approvePrediction(42, "reviewer-1"),
            ).rejects.toThrow('cannot be approved: current status is "rejected"');
        });
    });

    // ─── rejectPrediction ───────────────────────────────────────────────────

    describe("rejectPrediction", () => {
        it("updates prediction status to 'rejected'", async () => {
            const mockPrediction = {
                id: 55,
                organizationId: 1,
                sourceNodeId: 10,
                targetNodeId: 20,
                predictedRelation: "USES",
                confidenceScore: "0.720",
                status: "predicted",
                reviewedBy: null,
                reviewedAt: null,
                createdAt: new Date(),
            };

            // Mock db.select().from().where().limit() -> returns prediction
            const mockLimit = vi.fn().mockResolvedValue([mockPrediction]);
            const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            mockDbSelect.mockReturnValue({ from: mockFrom });

            // Mock db.update().set().where() -> void
            const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
            const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
            mockDbUpdate.mockReturnValue({ set: mockSet });

            await linkPredictorService.rejectPrediction(55, "reviewer-2");

            expect(mockDbUpdate).toHaveBeenCalled();
            // Verify the set call includes status "rejected"
            const setArg = mockSet.mock.calls[0][0];
            expect(setArg.status).toBe("rejected");
            expect(setArg.reviewedBy).toBe("reviewer-2");
            expect(setArg.reviewedAt).toBeInstanceOf(Date);
        });

        it("throws error for non-existent prediction", async () => {
            const mockLimit = vi.fn().mockResolvedValue([]);
            const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            mockDbSelect.mockReturnValue({ from: mockFrom });

            await expect(
                linkPredictorService.rejectPrediction(999, "reviewer-2"),
            ).rejects.toThrow("Prediction with ID 999 not found");
        });
    });
});
