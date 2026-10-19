/**
 * Integration tests for knowledge-temporal API routes.
 * Tests route-level behavior: HTTP status codes, parameter parsing,
 * correct service delegation, and error handling.
 *
 * @vitest-environment node
 * Task 12.6: Write integration tests for all new API endpoints
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response } from "express";

// ─── Mock service modules ────────────────────────────────────────────────────

const mockGetNodeVersionRange = vi.fn();
const mockGetNodeAtTimestamp = vi.fn();
const mockGetEdgeDiff = vi.fn();

vi.mock("../domain/knowledge/core/temporal/temporal-version-store.service.js", () => ({
    temporalVersionStoreService: {
        getNodeVersionRange: (...args: any[]) => mockGetNodeVersionRange(...args),
        getNodeAtTimestamp: (...args: any[]) => mockGetNodeAtTimestamp(...args),
        getEdgeDiff: (...args: any[]) => mockGetEdgeDiff(...args),
    },
}));

const mockCreateCausalEdge = vi.fn();
const mockCounterfactual = vi.fn();

vi.mock("../domain/knowledge/core/causal/belief-propagation-engine.service.js", () => ({
    beliefPropagationEngine: {
        createCausalEdge: (...args: any[]) => mockCreateCausalEdge(...args),
        counterfactual: (...args: any[]) => mockCounterfactual(...args),
    },
    isCounterfactualError: (result: any) => "error" in result,
}));

const mockRunPrediction = vi.fn();
const mockApprovePrediction = vi.fn();
const mockRejectPrediction = vi.fn();

vi.mock("../domain/knowledge/core/prediction/link-predictor.service.js", () => ({
    linkPredictorService: {
        runPrediction: (...args: any[]) => mockRunPrediction(...args),
        approvePrediction: (...args: any[]) => mockApprovePrediction(...args),
        rejectPrediction: (...args: any[]) => mockRejectPrediction(...args),
    },
}));

const mockGetVersionHistory = vi.fn();
vi.mock("../domain/knowledge/core/ontology/custom-ontology-store.service.js", () => ({
    customOntologyStoreService: {
        getVersionHistory: (...args: any[]) => mockGetVersionHistory(...args),
    },
}));

const mockAddProperty = vi.fn();
const mockRemoveProperty = vi.fn();
const mockChangePropertyType = vi.fn();
vi.mock("../domain/knowledge/core/ontology/ontology-migration.service.js", () => ({
    ontologyMigrationService: {
        addProperty: (...args: any[]) => mockAddProperty(...args),
        removeProperty: (...args: any[]) => mockRemoveProperty(...args),
        changePropertyType: (...args: any[]) => mockChangePropertyType(...args),
    },
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue([]),
    },
}));

vi.mock("@shared/schema/index.js", () => ({
    knowledgePredictedLinks: {},
}));

vi.mock("drizzle-orm", () => ({
    eq: vi.fn(),
    and: vi.fn(),
    desc: vi.fn(),
}));

// Mock auth middleware and org context
const mockOrgContext = { userId: "user-1", organizationId: 1, isAdmin: true, isSuperAdmin: false, isOrgAdmin: true };
vi.mock("@domain/core/auth/security.service.js", () => ({
    requireAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../utils/auth-context.js", () => ({
    getUserOrgContext: vi.fn().mockResolvedValue({ userId: "user-1", organizationId: 1, isAdmin: true, isSuperAdmin: false, isOrgAdmin: true }),
}));
vi.mock("@server/middleware/error-handler.js", () => ({
    asyncHandler: (fn: any) => fn,
}));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockReq(overrides: Partial<Request> = {}): Partial<Request> {
    return {
        params: {},
        query: {},
        body: {},
        headers: {},
        session: { userId: "user-1" } as any,
        user: { id: "user-1", username: "testuser" },
        ...overrides,
    } as Partial<Request>;
}

function createMockRes() {
    const res: Partial<Response> = {
        status: vi.fn().mockImplementation((_code: number) => res),
        json: vi.fn().mockImplementation((_data: any) => res),
    };
    return { res };
}

// ─── Route Handlers ──────────────────────────────────────────────────────────
// We import the route handlers dynamically after mocks are established.
// Since Express router is hard to test in isolation, we'll test the handler logic
// by importing the module and exercising its exported router via supertest-like approach.
// Given the project structure, we test the handler functions directly.

// We need to import the route module after mocks are set
// The route file uses asyncHandler which wraps the handler, so we import & call directly

import router from "./knowledge-temporal.js";

describe("Knowledge Temporal API Routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── GET /knowledge/nodes/:id/history ────────────────────────────────

    describe("GET /knowledge/nodes/:id/history", () => {
        it("returns 400 for invalid node ID", async () => {
            const handler = getRouteHandler(router, "get", "/knowledge/nodes/:id/history");
            const req = createMockReq({ params: { id: "abc" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
        });

        it("returns 400 when from/to query params are missing", async () => {
            const handler = getRouteHandler(router, "get", "/knowledge/nodes/:id/history");
            const req = createMockReq({ params: { id: "1" }, query: {} });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 400 for invalid timestamp format", async () => {
            const handler = getRouteHandler(router, "get", "/knowledge/nodes/:id/history");
            const req = createMockReq({
                params: { id: "1" },
                query: { from: "not-a-date", to: "also-not-a-date" },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns versions on valid request", async () => {
            const handler = getRouteHandler(router, "get", "/knowledge/nodes/:id/history");
            const mockVersions = [{ id: 1, nodeId: 1, timestamp: new Date() }];
            mockGetNodeVersionRange.mockResolvedValue(mockVersions);
            const req = createMockReq({
                params: { id: "1" },
                query: { from: "2024-01-01T00:00:00Z", to: "2024-12-31T23:59:59Z" },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(mockGetNodeVersionRange).toHaveBeenCalledWith(1, expect.any(Date), expect.any(Date));
            expect(res.json).toHaveBeenCalledWith({ versions: mockVersions });
        });
    });

    // ─── GET /knowledge/nodes/:id/at/:timestamp ──────────────────────────

    describe("GET /knowledge/nodes/:id/at/:timestamp", () => {
        it("returns 400 for invalid node ID", async () => {
            const handler = getRouteHandler(router, "get", "/knowledge/nodes/:id/at/:timestamp");
            const req = createMockReq({ params: { id: "xyz", timestamp: "2024-01-01T00:00:00Z" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 404 when no history is available", async () => {
            const handler = getRouteHandler(router, "get", "/knowledge/nodes/:id/at/:timestamp");
            mockGetNodeAtTimestamp.mockResolvedValue({ found: false, reason: "no_history_available" });
            const req = createMockReq({ params: { id: "1", timestamp: "2024-01-01T00:00:00Z" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it("returns state and version on valid request", async () => {
            const handler = getRouteHandler(router, "get", "/knowledge/nodes/:id/at/:timestamp");
            const mockResult = { found: true, state: { name: "Test" }, version: { id: 1 } };
            mockGetNodeAtTimestamp.mockResolvedValue(mockResult);
            const req = createMockReq({ params: { id: "5", timestamp: "2024-06-15T12:00:00Z" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(mockGetNodeAtTimestamp).toHaveBeenCalledWith(5, expect.any(Date));
            expect(res.json).toHaveBeenCalledWith({ state: { name: "Test" }, version: { id: 1 } });
        });
    });

    // ─── GET /knowledge/edges/diff ───────────────────────────────────────

    describe("GET /knowledge/edges/diff", () => {
        it("returns 400 when from/to are missing", async () => {
            const handler = getRouteHandler(router, "get", "/knowledge/edges/diff");
            const req = createMockReq({ query: {} });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns diff results on valid request", async () => {
            const handler = getRouteHandler(router, "get", "/knowledge/edges/diff");
            const mockResult = { entries: [], truncated: false, nextCursor: null };
            mockGetEdgeDiff.mockResolvedValue(mockResult);
            const req = createMockReq({
                query: { from: "2024-01-01T00:00:00Z", to: "2024-12-31T23:59:59Z" },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(mockGetEdgeDiff).toHaveBeenCalledWith(1, expect.any(Date), expect.any(Date), undefined);
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });
    });

    // ─── POST /knowledge/causal-edges ────────────────────────────────────

    describe("POST /knowledge/causal-edges", () => {
        it("returns 400 when sourceNodeId or targetNodeId is missing", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/causal-edges");
            const req = createMockReq({ body: { causalStrength: 0.8 } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 400 for invalid causalStrength", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/causal-edges");
            const req = createMockReq({
                body: {
                    sourceNodeId: 1, targetNodeId: 2,
                    causalStrength: 1.5, propagationDirection: "forward", lagDurationSeconds: 0,
                },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 400 for invalid propagationDirection", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/causal-edges");
            const req = createMockReq({
                body: {
                    sourceNodeId: 1, targetNodeId: 2,
                    causalStrength: 0.5, propagationDirection: "sideways", lagDurationSeconds: 0,
                },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 201 with edge on successful creation", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/causal-edges");
            const mockEdge = { id: 10, sourceId: 1, targetId: 2, relation: "CAUSES" };
            mockCreateCausalEdge.mockResolvedValue({ success: true, edge: mockEdge });
            const req = createMockReq({
                body: {
                    sourceNodeId: 1, targetNodeId: 2,
                    causalStrength: 0.7, propagationDirection: "forward", lagDurationSeconds: 60,
                },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({ edge: mockEdge });
        });

        it("returns 400 when service returns error", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/causal-edges");
            mockCreateCausalEdge.mockResolvedValue({ success: false, error: "source and target must be different" });
            const req = createMockReq({
                body: {
                    sourceNodeId: 1, targetNodeId: 2,
                    causalStrength: 0.7, propagationDirection: "forward", lagDurationSeconds: 60,
                },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    // ─── POST /knowledge/counterfactual ──────────────────────────────────

    describe("POST /knowledge/counterfactual", () => {
        it("returns 400 when targetNodeId is missing", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/counterfactual");
            const req = createMockReq({ body: { hypotheticalState: { status: "active" } } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 400 when hypotheticalState is missing or not an object", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/counterfactual");
            const req = createMockReq({ body: { targetNodeId: 1, hypotheticalState: "invalid" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 404 when counterfactual returns error", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/counterfactual");
            mockCounterfactual.mockResolvedValue({ error: "node not found" });
            const req = createMockReq({
                body: { targetNodeId: 999, hypotheticalState: { status: "active" } },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it("returns counterfactual result on success", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/counterfactual");
            const mockResult = {
                affectedNodes: [{ nodeId: 2, projectedState: {}, cumulativeConfidence: 0.7, hopDistance: 1 }],
                computationDurationMs: 12,
                graphSizeExceeded: false,
            };
            mockCounterfactual.mockResolvedValue(mockResult);
            const req = createMockReq({
                body: { targetNodeId: 1, hypotheticalState: { status: "degraded" }, maxHops: 5 },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });
    });

    // ─── POST /knowledge/predictions/run ─────────────────────────────────

    describe("POST /knowledge/predictions/run", () => {
        it("calls runPrediction with org ID and returns results", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/predictions/run");
            const mockResult = { predictions: [], metadata: { totalNodesEmbedded: 0, skipped: true } };
            mockRunPrediction.mockResolvedValue(mockResult);
            const req = createMockReq({ body: { confidenceThreshold: 0.8 } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(mockRunPrediction).toHaveBeenCalledWith(1, { confidenceThreshold: 0.8 });
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });
    });

    // ─── POST /knowledge/predictions/:id/approve ─────────────────────────

    describe("POST /knowledge/predictions/:id/approve", () => {
        it("returns 400 for non-numeric prediction ID", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/predictions/:id/approve");
            const req = createMockReq({ params: { id: "abc" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 404 when prediction not found", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/predictions/:id/approve");
            mockApprovePrediction.mockRejectedValue(new Error("Prediction not found"));
            const req = createMockReq({ params: { id: "99" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it("returns edge on successful approval", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/predictions/:id/approve");
            const mockEdge = { id: 5, sourceId: 1, targetId: 2, relation: "RELATED_TO" };
            mockApprovePrediction.mockResolvedValue(mockEdge);
            const req = createMockReq({ params: { id: "7" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.json).toHaveBeenCalledWith({ edge: mockEdge });
        });
    });

    // ─── POST /knowledge/predictions/:id/reject ──────────────────────────

    describe("POST /knowledge/predictions/:id/reject", () => {
        it("returns 400 for non-numeric prediction ID", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/predictions/:id/reject");
            const req = createMockReq({ params: { id: "xyz" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 404 when prediction not found", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/predictions/:id/reject");
            mockRejectPrediction.mockRejectedValue(new Error("Prediction not found"));
            const req = createMockReq({ params: { id: "99" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it("returns success on valid rejection", async () => {
            const handler = getRouteHandler(router, "post", "/knowledge/predictions/:id/reject");
            mockRejectPrediction.mockResolvedValue(undefined);
            const req = createMockReq({ params: { id: "3" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.json).toHaveBeenCalledWith({ success: true });
        });
    });

    // ─── GET /ontology/types/:id/versions ────────────────────────────────

    describe("GET /ontology/types/:id/versions", () => {
        it("returns 400 for non-numeric type ID", async () => {
            const handler = getRouteHandler(router, "get", "/ontology/types/:id/versions");
            const req = createMockReq({ params: { id: "abc" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns version history on success", async () => {
            const handler = getRouteHandler(router, "get", "/ontology/types/:id/versions");
            const mockVersions = [{ id: 1, version: 1, objectTypeId: 5 }];
            mockGetVersionHistory.mockResolvedValue(mockVersions);
            const req = createMockReq({ params: { id: "5" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(mockGetVersionHistory).toHaveBeenCalledWith(5, 1);
            expect(res.json).toHaveBeenCalledWith({ versions: mockVersions });
        });
    });

    // ─── POST /ontology/types/:id/migrate ────────────────────────────────

    describe("POST /ontology/types/:id/migrate", () => {
        it("returns 400 for non-numeric type ID", async () => {
            const handler = getRouteHandler(router, "post", "/ontology/types/:id/migrate");
            const req = createMockReq({ params: { id: "abc" }, body: { action: "addProperty", propertyName: "foo" } });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 400 for invalid action", async () => {
            const handler = getRouteHandler(router, "post", "/ontology/types/:id/migrate");
            const req = createMockReq({
                params: { id: "1" },
                body: { action: "invalidAction", propertyName: "foo" },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 400 when propertyName is missing", async () => {
            const handler = getRouteHandler(router, "post", "/ontology/types/:id/migrate");
            const req = createMockReq({
                params: { id: "1" },
                body: { action: "addProperty" },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns 400 when propertySchema is missing for addProperty", async () => {
            const handler = getRouteHandler(router, "post", "/ontology/types/:id/migrate");
            const req = createMockReq({
                params: { id: "1" },
                body: { action: "addProperty", propertyName: "foo" },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it("returns success for addProperty action", async () => {
            const handler = getRouteHandler(router, "post", "/ontology/types/:id/migrate");
            mockAddProperty.mockResolvedValue(undefined);
            const req = createMockReq({
                params: { id: "1" },
                body: { action: "addProperty", propertyName: "age", propertySchema: { type: "integer" } },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(mockAddProperty).toHaveBeenCalledWith(1, "age", { type: "integer" }, expect.any(String));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, action: "addProperty" }));
        });

        it("returns success for removeProperty action", async () => {
            const handler = getRouteHandler(router, "post", "/ontology/types/:id/migrate");
            mockRemoveProperty.mockResolvedValue(undefined);
            const req = createMockReq({
                params: { id: "2" },
                body: { action: "removeProperty", propertyName: "oldField" },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(mockRemoveProperty).toHaveBeenCalledWith(2, "oldField", expect.any(String));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, action: "removeProperty" }));
        });

        it("returns migration result for changePropertyType", async () => {
            const handler = getRouteHandler(router, "post", "/ontology/types/:id/migrate");
            mockChangePropertyType.mockResolvedValue({ success: true, checkedCount: 5, remainingCount: 0 });
            const req = createMockReq({
                params: { id: "3" },
                body: { action: "changePropertyType", propertyName: "count", newType: "string" },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(mockChangePropertyType).toHaveBeenCalledWith(3, "count", "string", expect.any(String));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                action: "changePropertyType",
                propertyName: "count",
                newType: "string",
            }));
        });

        it("returns 404 when ontology type not found", async () => {
            const handler = getRouteHandler(router, "post", "/ontology/types/:id/migrate");
            mockAddProperty.mockRejectedValue(new Error("Ontology type with id 99 not found in registry"));
            const req = createMockReq({
                params: { id: "99" },
                body: { action: "addProperty", propertyName: "x", propertySchema: { type: "string" } },
            });
            const { res } = createMockRes();
            await handler(req as Request, res as Response);
            expect(res.status).toHaveBeenCalledWith(404);
        });
    });
});

// ─── Utility: extract route handler from Express router ──────────────────────

function getRouteHandler(routerInstance: any, method: string, path: string): any {
    // Express stores route definitions in router.stack
    const stack = routerInstance.stack || [];
    for (const layer of stack) {
        if (layer.route) {
            const routePath = layer.route.path;
            const routeMethod = Object.keys(layer.route.methods)[0];
            if (routeMethod === method && routePath === path) {
                // Get the last handler in the route stack (after middleware)
                const handlers = layer.route.stack;
                const lastHandler = handlers[handlers.length - 1];
                return lastHandler.handle;
            }
        }
    }
    throw new Error(`Route handler not found: ${method.toUpperCase()} ${path}`);
}
