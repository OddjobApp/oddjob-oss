/**
 * AgentTools Unit Tests
 * Focus: pure functions (normalizeToolName, getToolMetadata) that don't require DB
 */

import { describe, it, expect, vi } from "vitest";

// Mock DB module to prevent initialization
vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([])
    }
}));

// Mock drizzle (full set of exports used)
vi.mock("drizzle-orm", () => ({
    eq: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    sql: vi.fn(),
    inArray: vi.fn(),
    isNull: vi.fn(),
    desc: vi.fn(),
    gt: vi.fn()
}));

// Mock schema
vi.mock("@shared/schema", () => ({
    saasConnectors: {},
    apiSpecs: {}
}));

// Mock tools registry
vi.mock("@domain/tools/v1/capabilities/index.js", () => ({
    AGENT_TOOLS: {
        "sql_query": { description: "Execute SQL queries.", label: "SQL Query", group: "Data" },
        "google_search": { description: "Search the web.", label: "Google Search", group: "Web & Search" }
    }
}));

// Mock job schemas
vi.mock("@server/config/jobs/schemas", () => ({
    JOB_SCHEMAS: {}
}));

import { normalizeToolName, getToolMetadata, TOOL_ALIASES } from "@domain/tools/v1/tool-registry.service.js";

describe("AgentTools", () => {
    describe("normalizeToolName", () => {
        it("should return the same name if no alias exists", () => {
            expect(normalizeToolName("sql_query")).toBe("sql_query");
        });

        it("should resolve 'browsing' alias to 'browse_web'", () => {
            expect(normalizeToolName("browsing")).toBe("browse_web");
        });

        it("should resolve 'search' alias to 'google_search'", () => {
            expect(normalizeToolName("search")).toBe("google_search");
        });

        it("should normalize spaces to underscores", () => {
            expect(normalizeToolName("web search")).toBe("google_search");
        });

        it("should normalize hyphens to underscores", () => {
            expect(normalizeToolName("browse-web")).toBe("browse_web");
        });

        it("should convert to lowercase", () => {
            expect(normalizeToolName("SQL_QUERY")).toBe("sql_query");
        });

        it("should resolve 'python_interpreter' to 'python'", () => {
            expect(normalizeToolName("python_interpreter")).toBe("python");
        });

        it("should resolve 'terminal' to 'shell'", () => {
            expect(normalizeToolName("terminal")).toBe("shell");
        });

        it("should resolve 'bash' to 'shell'", () => {
            expect(normalizeToolName("bash")).toBe("shell");
        });

        it("should resolve 'google' to 'google_search'", () => {
            expect(normalizeToolName("google")).toBe("google_search");
        });
    });

    describe("getToolMetadata", () => {
        it("should return metadata for known tool from AGENT_TOOLS", () => {
            const meta = getToolMetadata("sql_query");
            expect(meta.name).toBe("sql_query");
            expect(meta.description).toContain("SQL");
            expect(meta.group).toBe("Data");
        });

        it("should return virtual metadata for 'browse_web'", () => {
            const meta = getToolMetadata("browse_web");
            expect(meta.name).toBe("browse_web");
            expect(meta.description).toContain("Browse");
        });

        it("should return virtual metadata for 'shell'", () => {
            const meta = getToolMetadata("shell");
            expect(meta.name).toBe("shell");
            expect(meta.adminOnly).toBe(true);
        });

        it("should return virtual metadata for 'python'", () => {
            const meta = getToolMetadata("python");
            expect(meta.name).toBe("python");
            expect(meta.description).toContain("Python");
        });

        it("should return external fallback for unknown tools", () => {
            const meta = getToolMetadata("my_exotic_tool");
            expect(meta.name).toBe("my_exotic_tool");
            expect(meta.group).toBe("External");
        });

        it("should normalize alias before looking up ('bash' -> 'shell')", () => {
            const meta = getToolMetadata("bash");
            expect(meta.name).toBe("shell");
            expect(meta.adminOnly).toBe(true);
        });
    });

    describe("TOOL_ALIASES", () => {
        it("should map 'browsing' to 'browse_web'", () => {
            expect(TOOL_ALIASES["browsing"]).toBe("browse_web");
        });

        it("should map 'bash' to 'shell'", () => {
            expect(TOOL_ALIASES["bash"]).toBe("shell");
        });

        it("should map 'python_interpreter' to 'python'", () => {
            expect(TOOL_ALIASES["python_interpreter"]).toBe("python");
        });

        it("should map 'knowledge_base' to 'search_unified_knowledge'", () => {
            expect(TOOL_ALIASES["knowledge_base"]).toBe("search_unified_knowledge");
        });
    });
});
