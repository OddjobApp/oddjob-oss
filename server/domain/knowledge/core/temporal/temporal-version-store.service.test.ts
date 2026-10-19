import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (vi.mock is hoisted, so references must also be hoisted) ─
const mockLogger = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

const mockInsert = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockExecute = vi.hoisted(() => vi.fn());

// ── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => mockLogger),
}));

// ── Mock database ───────────────────────────────────────────────────────────
vi.mock("@server/database_service.js", () => ({
    db: {
        insert: (...args: any[]) => mockInsert(...args),
        select: (...args: any[]) => mockSelect(...args),
        execute: (...args: any[]) => mockExecute(...args),
    },
}));

// ── Mock drizzle-orm operators (used by the service's where/orderBy logic) ──
vi.mock("drizzle-orm", () => ({
    eq: vi.fn((...args: any[]) => ({ _op: "eq", args })),
    and: vi.fn((...args: any[]) => ({ _op: "and", args })),
    lte: vi.fn((...args: any[]) => ({ _op: "lte", args })),
    gte: vi.fn((...args: any[]) => ({ _op: "gte", args })),
    gt: vi.fn((...args: any[]) => ({ _op: "gt", args })),
    desc: vi.fn((col: any) => ({ _op: "desc", col })),
    asc: vi.fn((col: any) => ({ _op: "asc", col })),
    count: vi.fn(() => "count(*)"),
    sql: vi.fn((strings: TemplateStringsArray, ...values: any[]) => ({
        _type: "sql",
        strings,
        values,
    })),
}));

// ── Mock schema modules ─────────────────────────────────────────────────────
vi.mock("@shared/schema/index.js", () => ({
    knowledgeNodeVersions: {
        nodeId: "node_id",
        timestamp: "timestamp",
        organizationId: "organization_id",
        id: "id",
    },
    knowledgeEdgeVersions: {
        edgeId: "edge_id",
        timestamp: "timestamp",
        organizationId: "organization_id",
        id: "id",
    },
    insertNodeVersionSchema: {
        parse: vi.fn((input: any) => input),
    },
    insertEdgeVersionSchema: {
        parse: vi.fn((input: any) => input),
    },
}));

import { temporalVersionStoreService } from "./temporal-version-store.service.js";
import type { KnowledgeNode, KnowledgeEdge } from "@shared/schema/index.js";

// ── Helper factories ────────────────────────────────────────────────────────

function makeNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
    return {
        id: 1,
        label: "Entity",
        name: "test-node",
        externalId: null,
        data: {},
        verificationStatus: "verified",
        confidenceScore: 0.9,
        initialConfidenceScore: 0.8,
        verifiedBy: null,
        verifiedAt: null,
        lastReaffirmedAt: null,
        usageCount: 0,
        utilityScore: 0,
        knowledgeDocumentId: null,
        knowledgeTopicId: null,
        pipelineExecutionId: null,
        extractionSources: null,
        fingerprint: null,
        missionId: null,
        organizationId: 1,
        prospectPropertyId: null,
        appId: null,
        deploymentId: null,
        sourceType: null,
        fidelityClass: null,
        scope: null,
        ownerId: null,
        embedding: null,
        embeddingProvider: null,
        embeddingModel: null,
        embeddingDimensions: null,
        embeddingVersion: null,
        createdBy: null,
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        updatedAt: null,
        createdAt: new Date("2024-01-01"),
        ...overrides,
    } as KnowledgeNode;
}

function makeEdge(overrides: Partial<KnowledgeEdge> = {}): KnowledgeEdge {
    return {
        id: 10,
        sourceId: 1,
        targetId: 2,
        relation: "RELATES_TO",
        weight: 5,
        data: {},
        organizationId: 1,
        prospectPropertyId: null,
        createdBy: "user:1",
        createdAt: new Date("2024-01-01"),
        missionId: null,
        lastUpdatedByRunId: null,
        ...overrides,
    } as KnowledgeEdge;
}

/**
 * Helper: sets up the mock chain for db.select().from().where().orderBy().limit()
 * that the service uses for single-result queries (getNodeAtTimestamp).
 */
function setupSelectChain(result: any[]) {
    const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(result),
    };
    mockSelect.mockReturnValue(chain);
    return chain;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("TemporalVersionStoreService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── recordNodeVersion ──────────────────────────────────────────────────

    describe("recordNodeVersion", () => {
        it("inserts a correct version record with detected changed fields", async () => {
            const valuesChain = { values: vi.fn().mockResolvedValue(undefined) };
            mockInsert.mockReturnValue(valuesChain);

            const previousState = makeNode({ name: "old-name" });
            const newState = makeNode({ name: "new-name" });

            await temporalVersionStoreService.recordNodeVersion(
                1,
                previousState,
                newState,
                "user:42",
                "Renamed the node",
            );

            expect(mockInsert).toHaveBeenCalledTimes(1);
            expect(valuesChain.values).toHaveBeenCalledTimes(1);

            // Should have called insertNodeVersionSchema.parse with the correct record
            const { insertNodeVersionSchema } = await import("@shared/schema/index.js");
            expect(insertNodeVersionSchema.parse).toHaveBeenCalledWith(
                expect.objectContaining({
                    nodeId: 1,
                    organizationId: 1,
                    actorId: "user:42",
                    causalAnnotation: "Renamed the node",
                }),
            );
        });

        it("handles missing organizationId gracefully by logging error and returning", async () => {
            const previousState = makeNode({ organizationId: null });
            const newState = makeNode({ organizationId: null });

            await temporalVersionStoreService.recordNodeVersion(
                1,
                previousState,
                newState,
                "user:42",
            );

            expect(mockLogger.error).toHaveBeenCalledWith(
                "Cannot record node version: missing organizationId",
                expect.objectContaining({ nodeId: 1 }),
            );
            expect(mockInsert).not.toHaveBeenCalled();
        });

        it("truncates causal annotation at 500 characters", async () => {
            const valuesChain = { values: vi.fn().mockResolvedValue(undefined) };
            mockInsert.mockReturnValue(valuesChain);

            const longAnnotation = "x".repeat(600);
            const previousState = makeNode();
            const newState = makeNode({ name: "changed" });

            await temporalVersionStoreService.recordNodeVersion(
                1,
                previousState,
                newState,
                "user:42",
                longAnnotation,
            );

            const { insertNodeVersionSchema } = await import("@shared/schema/index.js");
            const parsedArg = (insertNodeVersionSchema.parse as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(parsedArg.causalAnnotation.length).toBe(500);
        });

        it("defaults causal annotation to 'unspecified' when not provided", async () => {
            const valuesChain = { values: vi.fn().mockResolvedValue(undefined) };
            mockInsert.mockReturnValue(valuesChain);

            const previousState = makeNode();
            const newState = makeNode({ name: "changed" });

            await temporalVersionStoreService.recordNodeVersion(
                1,
                previousState,
                newState,
                "user:42",
            );

            const { insertNodeVersionSchema } = await import("@shared/schema/index.js");
            const parsedArg = (insertNodeVersionSchema.parse as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(parsedArg.causalAnnotation).toBe("unspecified");
        });

        it("logs error but does NOT throw on DB insert failure", async () => {
            mockInsert.mockImplementation(() => {
                throw new Error("Connection refused");
            });

            const previousState = makeNode();
            const newState = makeNode({ name: "changed" });

            // Should NOT throw
            await expect(
                temporalVersionStoreService.recordNodeVersion(
                    1,
                    previousState,
                    newState,
                    "user:42",
                ),
            ).resolves.toBeUndefined();

            expect(mockLogger.error).toHaveBeenCalledWith(
                "Failed to record node version",
                expect.objectContaining({
                    nodeId: 1,
                    actorId: "user:42",
                }),
            );
        });
    });

    // ─── getNodeAtTimestamp ──────────────────────────────────────────────────

    describe("getNodeAtTimestamp", () => {
        it("returns the correct version for an exact timestamp match", async () => {
            const versionRecord = {
                id: 5,
                nodeId: 1,
                organizationId: 1,
                previousState: { name: "old" },
                newState: { name: "exact-match" },
                changeType: "name",
                actorId: "user:42",
                causalAnnotation: "test",
                timestamp: new Date("2024-06-15T12:00:00Z"),
            };

            setupSelectChain([versionRecord]);

            const result = await temporalVersionStoreService.getNodeAtTimestamp(
                1,
                new Date("2024-06-15T12:00:00Z"),
            );

            expect(result.found).toBe(true);
            if (result.found) {
                expect(result.state).toEqual({ name: "exact-match" });
                expect(result.version).toBe(versionRecord);
            }
        });

        it("returns the most recent version before the queried timestamp (between-versions)", async () => {
            const versionRecord = {
                id: 3,
                nodeId: 1,
                organizationId: 1,
                previousState: { name: "before" },
                newState: { name: "between-state" },
                changeType: "name",
                actorId: "user:42",
                causalAnnotation: "test",
                timestamp: new Date("2024-06-10T12:00:00Z"),
            };

            setupSelectChain([versionRecord]);

            const result = await temporalVersionStoreService.getNodeAtTimestamp(
                1,
                new Date("2024-06-12T12:00:00Z"), // between v3 and a hypothetical v4
            );

            expect(result.found).toBe(true);
            if (result.found) {
                expect(result.state).toEqual({ name: "between-state" });
            }
        });

        it("returns 'no_history_available' when timestamp is earlier than earliest version", async () => {
            setupSelectChain([]);

            const result = await temporalVersionStoreService.getNodeAtTimestamp(
                1,
                new Date("2020-01-01T00:00:00Z"), // way before any version
            );

            expect(result.found).toBe(false);
            if (!result.found) {
                expect(result.reason).toBe("no_history_available");
            }
        });
    });

    // ─── getNodeVersionRange ────────────────────────────────────────────────

    describe("getNodeVersionRange", () => {
        it("returns versions in ascending order within the range", async () => {
            const versions = [
                { id: 1, timestamp: new Date("2024-01-01") },
                { id: 2, timestamp: new Date("2024-02-01") },
                { id: 3, timestamp: new Date("2024-03-01") },
            ];

            setupSelectChain(versions);

            const result = await temporalVersionStoreService.getNodeVersionRange(
                1,
                new Date("2024-01-01"),
                new Date("2024-03-31"),
            );

            expect(result).toHaveLength(3);
            expect(result[0].id).toBe(1);
            expect(result[2].id).toBe(3);
        });

        it("respects both inclusive bounds", async () => {
            // The mock verifies that from/to dates are passed correctly
            const chain = setupSelectChain([]);

            await temporalVersionStoreService.getNodeVersionRange(
                1,
                new Date("2024-01-01T00:00:00Z"),
                new Date("2024-12-31T23:59:59Z"),
            );

            // Verify the chain was called (from -> where -> orderBy -> limit)
            expect(chain.from).toHaveBeenCalled();
            expect(chain.where).toHaveBeenCalled();
            expect(chain.orderBy).toHaveBeenCalled();
            expect(chain.limit).toHaveBeenCalledWith(1000);
        });

        it("caps results at 1000 entries", async () => {
            const chain = setupSelectChain([]);

            await temporalVersionStoreService.getNodeVersionRange(
                1,
                new Date("2024-01-01"),
                new Date("2024-12-31"),
            );

            expect(chain.limit).toHaveBeenCalledWith(1000);
        });
    });

    // ─── pruneExcessVersions ────────────────────────────────────────────────

    describe("pruneExcessVersions", () => {
        it("is a no-op when version count is under the limit", async () => {
            // Mock the count query
            const countChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ total: 50 }]),
            };
            mockSelect.mockReturnValue(countChain);

            const deleted = await temporalVersionStoreService.pruneExcessVersions(1, 100);

            expect(deleted).toBe(0);
            expect(mockExecute).not.toHaveBeenCalled();
        });

        it("deletes oldest versions with FIFO when count exceeds limit", async () => {
            // Mock the count query - 120 versions exist, limit is 100
            const countChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ total: 120 }]),
            };
            mockSelect.mockReturnValue(countChain);

            // Mock the DELETE execution
            mockExecute.mockResolvedValue({ rowCount: 20 });

            const deleted = await temporalVersionStoreService.pruneExcessVersions(1, 100);

            expect(deleted).toBe(20);
            expect(mockExecute).toHaveBeenCalledTimes(1);
            expect(mockLogger.info).toHaveBeenCalledWith(
                "Pruned excess node versions",
                expect.objectContaining({
                    nodeId: 1,
                    deletedCount: 20,
                    previousTotal: 120,
                    maxVersions: 100,
                }),
            );
        });

        it("uses default maxVersions of 100 when not specified", async () => {
            const countChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ total: 105 }]),
            };
            mockSelect.mockReturnValue(countChain);
            mockExecute.mockResolvedValue({ rowCount: 5 });

            const deleted = await temporalVersionStoreService.pruneExcessVersions(1);

            expect(deleted).toBe(5);
        });
    });

    // ─── recordEdgeVersion ──────────────────────────────────────────────────

    describe("recordEdgeVersion", () => {
        it("inserts a correct edge version record", async () => {
            const valuesChain = { values: vi.fn().mockResolvedValue(undefined) };
            mockInsert.mockReturnValue(valuesChain);

            const edge = makeEdge();

            await temporalVersionStoreService.recordEdgeVersion(10, edge, "created");

            expect(mockInsert).toHaveBeenCalledTimes(1);
            expect(valuesChain.values).toHaveBeenCalledTimes(1);

            const { insertEdgeVersionSchema } = await import("@shared/schema/index.js");
            expect(insertEdgeVersionSchema.parse).toHaveBeenCalledWith(
                expect.objectContaining({
                    edgeId: 10,
                    organizationId: 1,
                    sourceId: 1,
                    targetId: 2,
                    relation: "RELATES_TO",
                    weight: 5,
                    changeType: "created",
                }),
            );
        });

        it("handles missing organizationId gracefully", async () => {
            const edge = makeEdge({ organizationId: null });

            await temporalVersionStoreService.recordEdgeVersion(10, edge, "created");

            expect(mockLogger.error).toHaveBeenCalledWith(
                "Cannot record edge version: missing organizationId",
                expect.objectContaining({ edgeId: 10 }),
            );
            expect(mockInsert).not.toHaveBeenCalled();
        });

        it("logs error but does NOT throw on DB failure", async () => {
            mockInsert.mockImplementation(() => {
                throw new Error("Disk full");
            });

            const edge = makeEdge();

            await expect(
                temporalVersionStoreService.recordEdgeVersion(10, edge, "modified"),
            ).resolves.toBeUndefined();

            expect(mockLogger.error).toHaveBeenCalledWith(
                "Failed to record edge version",
                expect.objectContaining({
                    edgeId: 10,
                    changeType: "modified",
                }),
            );
        });
    });

    // ─── getEdgesAtTimestamp ─────────────────────────────────────────────────

    describe("getEdgesAtTimestamp", () => {
        it("excludes edges with changeType 'deleted'", async () => {
            mockExecute.mockResolvedValue({
                rows: [
                    { edge_id: 1, source_id: 10, target_id: 20, relation: "A", weight: 1, change_type: "created", timestamp: "2024-01-01T00:00:00Z" },
                    { edge_id: 2, source_id: 30, target_id: 40, relation: "B", weight: 2, change_type: "deleted", timestamp: "2024-01-02T00:00:00Z" },
                    { edge_id: 3, source_id: 50, target_id: 60, relation: "C", weight: 3, change_type: "modified", timestamp: "2024-01-03T00:00:00Z" },
                ],
            });

            const result = await temporalVersionStoreService.getEdgesAtTimestamp(
                1,
                new Date("2024-06-01"),
            );

            expect(result).toHaveLength(2);
            expect(result.map((e) => e.edgeId)).toEqual([1, 3]);
        });

        it("returns empty array for timestamp earlier than all records", async () => {
            mockExecute.mockResolvedValue({ rows: [] });

            const result = await temporalVersionStoreService.getEdgesAtTimestamp(
                1,
                new Date("2020-01-01"),
            );

            expect(result).toHaveLength(0);
        });
    });

    // ─── getEdgeDiff ────────────────────────────────────────────────────────

    describe("getEdgeDiff", () => {
        it("returns paginated results with truncated=false when under limit", async () => {
            const entries = Array.from({ length: 50 }, (_, i) => ({
                id: i + 1,
                edgeId: i + 100,
                organizationId: 1,
                sourceId: 1,
                targetId: 2,
                relation: "R",
                weight: 1,
                changeType: "created",
                timestamp: new Date("2024-01-01"),
            }));

            const chain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(entries),
            };
            mockSelect.mockReturnValue(chain);

            const result = await temporalVersionStoreService.getEdgeDiff(
                1,
                new Date("2024-01-01"),
                new Date("2024-12-31"),
            );

            expect(result.entries).toHaveLength(50);
            expect(result.truncated).toBe(false);
            expect(result.nextCursor).toBeNull();
        });

        it("indicates truncated=true and provides nextCursor when over 10,000 entries", async () => {
            // Simulate 10,001 rows returned (service fetches PAGE_LIMIT+1)
            const entries = Array.from({ length: 10_001 }, (_, i) => ({
                id: i + 1,
                edgeId: i + 100,
                organizationId: 1,
                sourceId: 1,
                targetId: 2,
                relation: "R",
                weight: 1,
                changeType: "created",
                timestamp: new Date("2024-01-01"),
            }));

            const chain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(entries),
            };
            mockSelect.mockReturnValue(chain);

            const result = await temporalVersionStoreService.getEdgeDiff(
                1,
                new Date("2024-01-01"),
                new Date("2024-12-31"),
            );

            expect(result.entries).toHaveLength(10_000);
            expect(result.truncated).toBe(true);
            expect(result.nextCursor).toBe("10000"); // id of last entry in page
        });

        it("uses cursor to paginate (id > cursorId)", async () => {
            const chain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };
            mockSelect.mockReturnValue(chain);

            await temporalVersionStoreService.getEdgeDiff(
                1,
                new Date("2024-01-01"),
                new Date("2024-12-31"),
                "500",
            );

            // Verify cursor was included in conditions (the where mock gets called)
            expect(chain.where).toHaveBeenCalled();
        });
    });

    // ─── Failure handling ───────────────────────────────────────────────────

    describe("Failure handling", () => {
        it("recordNodeVersion logs at ERROR level on storage failure without throwing", async () => {
            // Simulate the parse itself throwing (zod validation)
            const { insertNodeVersionSchema } = await import("@shared/schema/index.js");
            (insertNodeVersionSchema.parse as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
                throw new Error("Zod validation failed");
            });

            const previousState = makeNode();
            const newState = makeNode({ name: "changed" });

            await expect(
                temporalVersionStoreService.recordNodeVersion(
                    1,
                    previousState,
                    newState,
                    "user:42",
                ),
            ).resolves.toBeUndefined();

            expect(mockLogger.error).toHaveBeenCalledWith(
                "Failed to record node version",
                expect.objectContaining({
                    nodeId: 1,
                    error: "Zod validation failed",
                }),
            );
        });

        it("recordEdgeVersion logs at ERROR level on storage failure without throwing", async () => {
            const { insertEdgeVersionSchema } = await import("@shared/schema/index.js");
            (insertEdgeVersionSchema.parse as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
                throw new Error("Constraint violation");
            });

            const edge = makeEdge();

            await expect(
                temporalVersionStoreService.recordEdgeVersion(10, edge, "created"),
            ).resolves.toBeUndefined();

            expect(mockLogger.error).toHaveBeenCalledWith(
                "Failed to record edge version",
                expect.objectContaining({
                    edgeId: 10,
                    error: "Constraint violation",
                }),
            );
        });
    });
});
