/**
 * ToolAnalyticsService — Pure Function Tests
 * `inferTaskType` is a completely synchronous, pure function.
 * We isolate it by mocking all dependencies.
 */

import { describe, it, expect, vi } from "vitest";

// Block all DB/external imports
vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@shared/schema/agent/tool-analytics", () => ({
    agentToolUsage: {},
    agentToolExamples: {}
}));
vi.mock("drizzle-orm", () => ({
    eq: vi.fn(), and: vi.fn(), desc: vi.fn(), sql: vi.fn(), inArray: vi.fn()
}));
vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));

import { toolAnalyticsService } from "@domain/agents/core/tool-analytics.service.js";

describe("toolAnalyticsService.inferTaskType", () => {
    const infer = (goal: string) => toolAnalyticsService.inferTaskType(goal);

    it("should classify 'analyze data patterns' → data_analysis", () => {
        expect(infer("analyze data patterns")).toBe("data_analysis");
    });

    it("should classify 'pattern in dataset' → data_analysis", () => {
        expect(infer("find a pattern in dataset")).toBe("data_analysis");
    });

    it("should classify 'search the web for info' → web_research", () => {
        expect(infer("search the web for info")).toBe("web_research");
    });

    it("should classify 'find the best deal' → web_research", () => {
        expect(infer("find the best deal")).toBe("web_research");
    });

    it("should classify 'create a blog post' → content_creation", () => {
        expect(infer("create a blog post")).toBe("content_creation");
    });

    it("should classify 'generate a report' → content_creation", () => {
        expect(infer("generate a report")).toBe("content_creation");
    });

    it("should classify 'write a summary' → content_creation", () => {
        expect(infer("write a summary")).toBe("content_creation");
    });

    it("should classify 'debug the error in logs' → debugging", () => {
        expect(infer("debug the error in logs")).toBe("debugging");
    });

    it("should classify 'fix the broken login' → debugging", () => {
        expect(infer("fix the broken login")).toBe("debugging");
    });

    it("should classify 'test the checkout flow' → testing", () => {
        expect(infer("test the checkout flow")).toBe("testing");
    });

    it("should classify 'verify and validate schema' → testing", () => {
        expect(infer("verify and validate the schema")).toBe("testing");
    });

    it("should classify 'extract, transform and load records' → etl", () => {
        expect(infer("extract transform and load records")).toBe("etl");
    });

    it("should return 'general' for unrecognized goals", () => {
        expect(infer("do something random")).toBe("general");
    });
});
