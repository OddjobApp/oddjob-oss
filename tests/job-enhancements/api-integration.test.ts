/**
 * Job Enhancements API Integration Tests
 * Tests the route layer with mocked services.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";

// Mock all services before importing the app
vi.mock("@domain/jobs/core/request-history.service.js", () => ({
    requestHistoryService: {
        getJobHistory: vi.fn().mockResolvedValue([{ id: 1, responseStatus: 200 }]),
        getRequestStats: vi.fn().mockResolvedValue({ totalRequests: 5, successfulRequests: 4, failedRequests: 1, successRate: 80 }),
        replayRequest: vi.fn().mockResolvedValue({ success: true, dryRun: true }),
        getRequestById: vi.fn().mockResolvedValue({ id: 1 }),
    },
}));

vi.mock("@domain/jobs/core/token-tracking.service.js", () => ({
    tokenTrackingService: {
        getJobTokenUsage: vi.fn().mockResolvedValue({ totalRequests: 10, totalCost: 0.05, byModel: {}, byDay: [] }),
        getOrgTokenUsage: vi.fn().mockResolvedValue({ totalRequests: 20, totalCost: 0.10, dailyTrend: [] }),
        getSupportedModels: vi.fn().mockReturnValue([{ name: "gpt-4o", inputPrice: 0.0025, outputPrice: 0.01 }]),
        getCostEstimate: vi.fn().mockReturnValue({ inputCost: 0.005, outputCost: 0.01, totalCost: 0.015 }),
    },
    TOKEN_PRICING: { "gpt-4o": { input: 0.0025, output: 0.01 }, "default": { input: 0.001, output: 0.003 } },
}));

// getLogs, getChannelId and subscribe are what the routes actually call. The
// double declared getRunLogs, which is not a method this service has ever had,
// so the logs route reached an undefined and answered 500.
vi.mock("@domain/jobs/core/streaming-logs.service.js", () => ({
    streamingLogsService: {
        getActiveRuns: vi.fn().mockResolvedValue([]),
        getLogs: vi.fn().mockResolvedValue([]),
        getChannelId: vi.fn().mockResolvedValue("channel-1"),
        subscribe: vi.fn().mockReturnValue(() => {}),
    },
}));

// The org-scoped routes read getUserOrgContext, which resolves the session
// against the database. createApp's shim sets req.user but not the
// req.session.userId this reads, so every org route saw an anonymous caller with
// no organization and correctly refused with a 400. This file tests the route
// layer against mocked services, so the context is mocked to match.
// importOriginal, not a bare factory: this module has ten exports and replacing
// it wholesale would leave the rest undefined for anything else that imports it.
vi.mock("@server/utils/auth-context.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@server/utils/auth-context.js")>()),
    getUserOrgContext: vi.fn().mockResolvedValue({
        userId: "1",
        organizationId: 1,
        isAdmin: true,
        isSuperAdmin: false,
        isOrgAdmin: true,
    }),
}));

vi.mock("@domain/jobs/core/job-health.service.js", () => ({
    jobHealthService: {
        calculateHealthScore: vi.fn().mockResolvedValue({ overall: 95, successRate: 100, avgResponseTimeScore: 100, errorRateTrend: 100, recencyScore: 100 }),
        getHealthTrend: vi.fn().mockResolvedValue({ direction: "stable", changePercent: 0, periodDays: 14 }),
        getHealthStatus: vi.fn().mockReturnValue({ label: "Excellent", color: "#22c55e", icon: "CheckCircle" }),
        getOrgHealthSummary: vi.fn().mockResolvedValue({ totalJobs: 5, healthyJobs: 4, atRiskJobs: 1, criticalJobs: 0, averageHealthScore: 80 }),
    },
}));

vi.mock("@domain/integrations/core/hil-enhancements.service.js", () => ({
    hilEnhancementsService: {
        getOrCreateConfig: vi.fn().mockResolvedValue({ id: 1, escalationEnabled: 1, autoApprovalEnabled: 0, escalationTimeoutMinutes: 60 }),
        updateConfig: vi.fn().mockResolvedValue({ id: 1, escalationTimeoutMinutes: 30 }),
        getJobApprovalAnalytics: vi.fn().mockResolvedValue({ totalPatterns: 0, reliablePatterns: 0, escalationStats: { totalEscalations: 0, byType: {} } }),
        checkEscalation: vi.fn().mockResolvedValue({ shouldEscalate: false }),
    },
}));

vi.mock("@domain/jobs/core/job-test.service.js", () => ({
    jobTestService: {},
}));

import { createApp } from "@server/app.js";

describe("Job Enhancements API", () => {
    let app: any;
    const authHeader = { Authorization: "Bearer test-token" };
    const testJobId = 1;

    beforeAll(async () => {
        app = await createApp();
    });

    describe("Request History Endpoints", () => {
        it("GET /api/jobs/:id/history - should return history with auth", async () => {
            const response = await request(app)
                .get(`/api/jobs/${testJobId}/history`)
                .set(authHeader)
                .expect(200);
            expect(Array.isArray(response.body)).toBe(true);
        });

        it("GET /api/jobs/:id/history - should reject without auth", async () => {
            await request(app).get(`/api/jobs/${testJobId}/history`).expect(401);
        });

        it("GET /api/jobs/:id/history/stats - should return statistics", async () => {
            const response = await request(app)
                .get(`/api/jobs/${testJobId}/history/stats?days=30`)
                .set(authHeader)
                .expect(200);
            expect(response.body).toHaveProperty("totalRequests");
            expect(response.body).toHaveProperty("successRate");
        });

        it("POST /api/jobs/:id/replay - should replay request", async () => {
            const response = await request(app)
                .post(`/api/jobs/${testJobId}/replay`)
                .set(authHeader)
                .send({ requestId: 1, dryRun: true })
                .expect(200);
            expect(response.body).toHaveProperty("dryRun");
        });
    });

    describe("Token Tracking Endpoints", () => {
        it("GET /api/jobs/:id/tokens - should return token usage", async () => {
            const response = await request(app)
                .get(`/api/jobs/${testJobId}/tokens?days=30`)
                .set(authHeader)
                .expect(200);
            expect(response.body).toHaveProperty("totalRequests");
            expect(response.body).toHaveProperty("byModel");
        });

        it("GET /api/org/tokens - should return org-wide usage", async () => {
            const response = await request(app)
                .get("/api/org/tokens?days=30")
                .set(authHeader)
                .expect(200);
            expect(response.body).toHaveProperty("totalCost");
            expect(response.body).toHaveProperty("dailyTrend");
        });

        it("GET /api/tokens/pricing - should return pricing info", async () => {
            const response = await request(app)
                .get("/api/tokens/pricing")
                .set(authHeader)
                .expect(200);
            expect(response.body).toHaveProperty("models");
            expect(Array.isArray(response.body.models)).toBe(true);
        });

        it("POST /api/tokens/estimate - should estimate cost", async () => {
            const response = await request(app)
                .post("/api/tokens/estimate")
                .set(authHeader)
                .send({ model: "gpt-4o", inputTokens: 2000, outputTokens: 500 })
                .expect(200);
            expect(response.body).toHaveProperty("totalCost");
            expect(response.body).toHaveProperty("inputCost");
            expect(response.body).toHaveProperty("outputCost");
        });
    });

    describe("Health Score Endpoints", () => {
        it("GET /api/jobs/:id/health - should return health score", async () => {
            const response = await request(app)
                .get(`/api/jobs/${testJobId}/health`)
                .set(authHeader)
                .expect(200);
            expect(response.body).toHaveProperty("overall");
            expect(response.body).toHaveProperty("successRate");
            expect(response.body).toHaveProperty("status");
        });

        it("GET /api/jobs/:id/health/trend - should return trend", async () => {
            const response = await request(app)
                .get(`/api/jobs/${testJobId}/health/trend?days=14`)
                .set(authHeader)
                .expect(200);
            expect(response.body).toHaveProperty("direction");
            expect(response.body).toHaveProperty("changePercent");
        });

        it("GET /api/org/health - should return org summary", async () => {
            const response = await request(app)
                .get("/api/org/health")
                .set(authHeader)
                .expect(200);
            expect(response.body).toHaveProperty("totalJobs");
            expect(response.body).toHaveProperty("healthyJobs");
            expect(response.body).toHaveProperty("averageHealthScore");
        });
    });

    describe("HIL Enhancements Endpoints", () => {
        it("GET /api/jobs/:id/hil/config - should return HIL config", async () => {
            const response = await request(app)
                .get(`/api/jobs/${testJobId}/hil/config`)
                .set(authHeader)
                .expect(200);
            expect(response.body).toHaveProperty("escalationEnabled");
            expect(response.body).toHaveProperty("autoApprovalEnabled");
        });

        it("PUT /api/jobs/:id/hil/config - should update config", async () => {
            const response = await request(app)
                .put(`/api/jobs/${testJobId}/hil/config`)
                .set(authHeader)
                .send({ escalationEnabled: true, escalationTimeoutMinutes: 30 })
                .expect(200);
            expect(response.body).toHaveProperty("escalationTimeoutMinutes");
        });

        it("GET /api/jobs/:id/hil/analytics - should return analytics", async () => {
            const response = await request(app)
                .get(`/api/jobs/${testJobId}/hil/analytics`)
                .set(authHeader)
                .expect(200);
            expect(response.body).toHaveProperty("totalPatterns");
            expect(response.body).toHaveProperty("escalationStats");
        });

        it("POST /api/approvals/:id/check-escalation - should check escalation", async () => {
            const response = await request(app)
                .post("/api/approvals/1/check-escalation")
                .set(authHeader)
                .expect(200);
            expect(response.body).toHaveProperty("shouldEscalate");
        });
    });

    describe("Streaming Logs Endpoints", () => {
        it("GET /api/jobs/:id/runs - should return active runs", async () => {
            const response = await request(app)
                .get(`/api/jobs/${testJobId}/runs`)
                .set(authHeader)
                .expect(200);
            expect(Array.isArray(response.body)).toBe(true);
        });

        it("GET /api/jobs/:id/runs/:runId/logs - should return logs", async () => {
            const response = await request(app)
                .get(`/api/jobs/${testJobId}/runs/1/logs`)
                .set(authHeader)
                .expect(200);
            expect(Array.isArray(response.body)).toBe(true);
        });

        it("GET /api/jobs/:id/stream - should require valid job run", async () => {
            await request(app)
                .get(`/api/jobs/${testJobId}/stream?jobRunId=invalid`)
                .set(authHeader)
                .expect(400);
        });
    });

    describe("Error Handling", () => {
        it("should handle invalid job IDs", async () => {
            await request(app).get("/api/jobs/invalid/health").set(authHeader).expect(400);
        });

        it("should handle missing resources gracefully", async () => {
            await request(app).get("/api/jobs/99999/tokens").set(authHeader).expect(200);
        });
    });
});
