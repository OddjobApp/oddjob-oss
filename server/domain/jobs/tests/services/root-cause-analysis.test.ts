/**
 * RootCauseAnalysisService Tests — pure method coverage via class prototype
 *
 * Tests: detectOutputAnomaly, summarizeOutput, generateSummary, mapToNode
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));
vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@shared/schema", () => ({
    pipelineStepExecutions: {},
    pipelineSteps: {},
    jobs: {},
}));
vi.mock("drizzle-orm", () => ({
    eq: vi.fn(), and: vi.fn(), sql: vi.fn(), desc: vi.fn(),
}));

import { RootCauseAnalysisService } from "@domain/analytics/core/rca.service.js";

// Access private methods via prototype cast
const svc = new RootCauseAnalysisService() as any;

describe("RootCauseAnalysisService – pure helpers", () => {

    // ─── detectOutputAnomaly ──────────────────────────────────────────

    describe("detectOutputAnomaly", () => {
        it("returns 0.6 for null output", () => {
            expect(svc.detectOutputAnomaly(null)).toBe(0.6);
        });

        it("returns 0.6 for undefined output", () => {
            expect(svc.detectOutputAnomaly(undefined)).toBe(0.6);
        });

        it("returns 0.7 for empty object", () => {
            expect(svc.detectOutputAnomaly({})).toBe(0.7);
        });

        it("returns 0.8 for object with error key", () => {
            expect(svc.detectOutputAnomaly({ error: "something failed" })).toBe(0.8);
        });

        it("returns 0.8 for object with errors array", () => {
            expect(svc.detectOutputAnomaly({ errors: ["a", "b"] })).toBe(0.8);
        });

        it("returns 0.8 for object with errorMessage", () => {
            expect(svc.detectOutputAnomaly({ errorMessage: "oops" })).toBe(0.8);
        });

        it("returns 0.9 for object with success: false", () => {
            expect(svc.detectOutputAnomaly({ success: false })).toBe(0.9);
        });

        it("returns 0.7 for empty array (hits empty-object branch since typeof [] === 'object')", () => {
            // Note: In JS, typeof [] is 'object' and Object.keys([]).length is 0,
            // so the empty-object check is hit first, returning 0.7
            expect(svc.detectOutputAnomaly([])).toBe(0.7);
        });

        it("returns 0 for normal object with data", () => {
            expect(svc.detectOutputAnomaly({ data: [1, 2, 3], status: "ok" })).toBe(0);
        });

        it("returns 0 for non-empty array", () => {
            expect(svc.detectOutputAnomaly([1, 2, 3])).toBe(0);
        });

        it("returns 0 for primitive string output", () => {
            expect(svc.detectOutputAnomaly("some result text")).toBe(0);
        });
    });

    // ─── summarizeOutput ────────────────────────────────────────────

    describe("summarizeOutput", () => {
        it("returns 'No output' for null", () => {
            expect(svc.summarizeOutput(null)).toBe("No output");
        });

        it("returns 'No output' for undefined", () => {
            expect(svc.summarizeOutput(undefined)).toBe("No output");
        });

        it("truncates long string output at 50 chars with ellipsis", () => {
            const long = "a".repeat(100);
            const result = svc.summarizeOutput(long);
            expect(result.length).toBe(53); // 50 + "..."
            expect(result.endsWith("...")).toBe(true);
        });

        it("returns short string as-is without ellipsis", () => {
            expect(svc.summarizeOutput("hello")).toBe("hello");
        });

        it("JSON-stringifies object output and truncates", () => {
            const obj = { very: "long", data: "x".repeat(100) };
            const result = svc.summarizeOutput(obj);
            expect(result.length).toBeLessThanOrEqual(53);
            expect(result.endsWith("...")).toBe(true);
        });
    });

    // ─── mapToNode ────────────────────────────────────────────────

    describe("mapToNode", () => {
        it("maps a step to a RootCauseNode with all fields", () => {
            const step = {
                id: 42,
                name: "ProcessData",
                stepId: 5,
                status: "failed",
                error: "Timeout",
                output: { result: "partial" },
                executionTimeMs: 1200,
                createdAt: new Date("2024-06-01T10:00:00Z"),
            };
            const node = svc.mapToNode(step, "root_cause", 0.9);
            expect(node.stepExecutionId).toBe(42);
            expect(node.stepName).toBe("ProcessData");
            expect(node.stepId).toBe(5);
            expect(node.status).toBe("failed");
            expect(node.error).toBe("Timeout");
            expect(node.impactScore).toBe(0.9);
            expect(node.relation).toBe("root_cause");
            expect(node.outputSummary).toBeDefined();
        });
    });

    // ─── generateSummary ────────────────────────────────────────────

    describe("generateSummary", () => {
        it("returns self-originated message when root is victim", () => {
            const root = { relation: "victim", stepName: "SendEmail" };
            const trace = [root];
            const result = svc.generateSummary(root, trace);
            expect(result).toContain("originated in the step");
            expect(result).toContain("SendEmail");
            expect(result).toContain("No upstream failures detected");
        });

        it("identifies root cause step when relation is root_cause", () => {
            const root = { relation: "root_cause", stepName: "FetchData", status: "failed" };
            const trace = [root];
            const result = svc.generateSummary(root, trace);
            expect(result).toContain("Root cause identified");
            expect(result).toContain("FetchData");
            expect(result).toContain("(failed)");
        });

        it("includes contributor count when contributors exist", () => {
            const root = { relation: "root_cause", stepName: "FetchData", status: "failed" };
            const trace = [
                root,
                { relation: "contributor", stepName: "ParseConfig" },
                { relation: "contributor", stepName: "ValidateInput" },
            ];
            const result = svc.generateSummary(root, trace);
            expect(result).toContain("2 earlier steps showed anomalies");
        });

        it("omits contributor text when no contributors exist", () => {
            const root = { relation: "root_cause", stepName: "Transform", status: "cancelled" };
            const trace = [root];
            const result = svc.generateSummary(root, trace);
            expect(result).not.toContain("earlier steps showed anomalies");
        });
    });
});
