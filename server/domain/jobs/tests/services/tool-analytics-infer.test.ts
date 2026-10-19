/**
 * toolAnalyticsService.inferTaskType Tests — pure keyword matcher
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@shared/schema/agent/tool-analytics", () => ({
    agentToolUsage: {},
    agentToolExamples: {},
}));
vi.mock("drizzle-orm", () => ({
    eq: vi.fn(), and: vi.fn(), desc: vi.fn(), sql: vi.fn(),
}));
vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));

import { toolAnalyticsService } from "@domain/agents/core/tool-analytics.service.js";

describe("toolAnalyticsService.inferTaskType", () => {

    it("returns 'data_analysis' for goals mentioning 'analyze'", () => {
        expect(toolAnalyticsService.inferTaskType("Analyze sales data for Q4")).toBe("data_analysis");
    });

    it("returns 'data_analysis' for goals mentioning 'data'", () => {
        expect(toolAnalyticsService.inferTaskType("Process data from CSV")).toBe("data_analysis");
    });

    it("returns 'data_analysis' for goals mentioning 'pattern'", () => {
        expect(toolAnalyticsService.inferTaskType("Identify patterns in user behavior")).toBe("data_analysis");
    });

    it("returns 'web_research' for goals mentioning 'search'", () => {
        expect(toolAnalyticsService.inferTaskType("Search for competitor pricing")).toBe("web_research");
    });

    it("returns 'web_research' for goals mentioning 'web'", () => {
        expect(toolAnalyticsService.inferTaskType("Browse the web for recent news")).toBe("web_research");
    });

    it("returns 'web_research' for goals mentioning 'find'", () => {
        expect(toolAnalyticsService.inferTaskType("Find the latest reports online")).toBe("web_research");
    });

    it("returns 'content_creation' for goals mentioning 'create'", () => {
        expect(toolAnalyticsService.inferTaskType("Create a marketing email")).toBe("content_creation");
    });

    it("returns 'content_creation' for goals mentioning 'generate'", () => {
        expect(toolAnalyticsService.inferTaskType("Generate a summary report")).toBe("content_creation");
    });

    it("returns 'content_creation' for goals mentioning 'write'", () => {
        expect(toolAnalyticsService.inferTaskType("Write documentation for API")).toBe("content_creation");
    });

    it("returns 'debugging' for goals mentioning 'debug'", () => {
        expect(toolAnalyticsService.inferTaskType("Debug the login flow")).toBe("debugging");
    });

    it("returns 'debugging' for goals mentioning 'fix'", () => {
        expect(toolAnalyticsService.inferTaskType("Fix the broken pipeline")).toBe("debugging");
    });

    it("returns 'debugging' for goals mentioning 'error'", () => {
        expect(toolAnalyticsService.inferTaskType("Resolve the error in step 3")).toBe("debugging");
    });

    it("returns 'testing' for goals mentioning 'test'", () => {
        expect(toolAnalyticsService.inferTaskType("Test the new feature")).toBe("testing");
    });

    it("returns 'testing' for goals mentioning 'verify'", () => {
        expect(toolAnalyticsService.inferTaskType("Verify the output is correct")).toBe("testing");
    });

    it("returns 'testing' for goals mentioning 'validate'", () => {
        expect(toolAnalyticsService.inferTaskType("Validate input parameters")).toBe("testing");
    });

    it("returns 'etl' for goals mentioning 'extract'", () => {
        expect(toolAnalyticsService.inferTaskType("Extract records from Jira")).toBe("etl");
    });

    it("returns 'etl' for goals mentioning 'transform'", () => {
        expect(toolAnalyticsService.inferTaskType("Transform JSON to CSV")).toBe("etl");
    });

    it("returns 'etl' for goals mentioning 'load'", () => {
        expect(toolAnalyticsService.inferTaskType("Load records into the system")).toBe("etl");
    });

    it("returns 'general' for unrecognized goals", () => {
        expect(toolAnalyticsService.inferTaskType("Do something interesting")).toBe("general");
    });

    it("is case insensitive", () => {
        expect(toolAnalyticsService.inferTaskType("ANALYZE THE DATA")).toBe("data_analysis");
    });
});
