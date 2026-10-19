/**
 * AgentOptimizationService Unit Tests
 * Tests pure/utility methods that don't require DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all DB-dependent modules
vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) })
        }),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis()
    }
}));

vi.mock("drizzle-orm", () => ({
    eq: vi.fn(),
    desc: vi.fn(),
    and: vi.fn(),
    isNotNull: vi.fn(),
    inArray: vi.fn()
}));

vi.mock("@shared/schema/agent", () => ({
    optimizationSuggestions: {},
    agentRunSteps: {},
    agentChatMessages: {}
}));

vi.mock("@shared/schema", () => ({
    jobs: {},
    pipelines: {},
    datasets: {},
    knowledgeTopics: {},
    documentTemplates: {}
}));

vi.mock("@domain/tools/v1/tool-registry.service.js", () => ({
    AGENT_TOOLS: {
        "sql_query": { description: "SQL", group: "data" },
        "google_search": { description: "Search", group: "web" }
    }
}));

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: { getClient: vi.fn() }
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
    systemAiService: { getAiConfig: vi.fn().mockResolvedValue(null) }
}));

vi.mock("@server/utils/errors.js", () => ({
    NotFoundError: class NotFoundError extends Error { },
    BadRequestError: class BadRequestError extends Error { },
    JobNotFoundError: class JobNotFoundError extends Error { }
}));

vi.mock("@server/utils/circuit-breaker.js", () => ({
    CircuitBreaker: {
        isOpen: vi.fn().mockReturnValue(false),
        recordSuccess: vi.fn(),
        recordFailure: vi.fn()
    }
}));

vi.mock("@domain/audit/core/audit-service.js", () => ({
    auditService: { log: vi.fn().mockResolvedValue(undefined) }
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
    })
}));

import { AgentOptimizationService } from "@domain/agents/agent-optimization.service.js";

describe("AgentOptimizationService", () => {
    let service: AgentOptimizationService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AgentOptimizationService();
    });

    describe("formatTraceForAnalysis", () => {
        it("should format steps into readable trace", () => {
            const steps = [
                { type: "thought", content: "Plan the work", toolName: null, toolArgs: null },
                { type: "tool_call", content: "Search done", toolName: "google_search", toolArgs: { query: "test" } }
            ];

            const trace = service.formatTraceForAnalysis(steps);

            expect(trace).toContain("[1] THOUGHT: Plan the work");
            expect(trace).toContain("[2] TOOL_CALL (google_search): Search done");
            expect(trace).toContain("Args:");
        });

        it("should truncate long content", () => {
            const longContent = "x".repeat(3000);
            const steps = [{ type: "thought", content: longContent, toolName: null, toolArgs: null }];

            const trace = service.formatTraceForAnalysis(steps);
            expect(trace.length).toBeLessThan(3500);
        });

        it("should handle empty steps array", () => {
            const trace = service.formatTraceForAnalysis([]);
            expect(trace).toBe("");
        });
    });

    describe("formatContextForPrompt", () => {
        it("should include agent configuration section", () => {
            const context: any = {
                jobConfig: { systemPrompt: "You help users.", goal: "Find bugs" },
                availableTools: [{ name: "sql_query", description: "SQL", group: "data" }],
                allowedPipelines: [],
                allowedDatasets: [],
                allowedTopics: [],
                documentTemplates: []
            };

            const result = service.formatContextForPrompt(context);

            expect(result).toContain("## AGENT CONFIGURATION");
            expect(result).toContain("You help users.");
            expect(result).toContain("Find bugs");
            expect(result).toContain("sql_query");
        });

        it("should include pipelines when present", () => {
            const context: any = {
                jobConfig: {},
                availableTools: [],
                allowedPipelines: [{ id: 1, name: "My Pipeline", description: "Does stuff" }],
                allowedDatasets: [],
                allowedTopics: [],
                documentTemplates: []
            };

            const result = service.formatContextForPrompt(context);
            expect(result).toContain("My Pipeline");
            expect(result).toContain("Available Pipelines");
        });

        it("should group tools by their group property", () => {
            const context: any = {
                jobConfig: {},
                availableTools: [
                    { name: "sql_query", description: "SQL", group: "data" },
                    { name: "google_search", description: "Search", group: "web" }
                ],
                allowedPipelines: [],
                allowedDatasets: [],
                allowedTopics: [],
                documentTemplates: []
            };

            const result = service.formatContextForPrompt(context);
            expect(result).toContain("data:");
            expect(result).toContain("web:");
        });
    });

    describe("getAgentContext", () => {
        it("should return base context when jobId is null", async () => {
            const result = await service.getAgentContext(null);
            expect(result).not.toBeNull();
            expect(result!.jobConfig).toEqual({});
            expect(result!.allowedPipelines).toEqual([]);
        });

        it("should return base context when jobId is 0", async () => {
            const result = await service.getAgentContext(0);
            expect(result).not.toBeNull();
            expect(result!.allowedDatasets).toEqual([]);
        });

        it("should return base context when job is not found in DB", async () => {
            const result = await service.getAgentContext(999);
            expect(result).not.toBeNull();
        });
    });
});
