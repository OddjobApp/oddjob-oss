/**
 * CapabilityDiscoveryService.formatCapabilityCatalog Tests — pure formatter
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@shared/schema", () => ({
    pipelines: {}, pipelineSteps: {}, jobs: {},
    knowledgeTopics: {}, datasets: {},
}));
// Spread the real module and override only the operators this suite stubs. The
// previous hand-written list omitted `sql`, which the service under test uses, so
// the file failed to collect and ran zero tests. drizzle-orm is pure query-builder
// code, so importing it for real is safe and cannot drift again.
vi.mock("drizzle-orm", async (importOriginal) => {
    const actual = await importOriginal<typeof import("drizzle-orm")>();
    return {
        ...actual,
        eq: vi.fn(), inArray: vi.fn(), asc: vi.fn(), and: vi.fn(),
    };
});
vi.mock("@domain/core/infrastructure/input-validation-service.service.js", () => ({ InputValidationService: {} }));
vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));
vi.mock("../../server/domain/tools/v1/tool-registry.service.js", () => ({ AGENT_TOOLS: {} }));
vi.mock("@domain/core/infrastructure/agent-persona-service.service.js", () => ({ AgentPersonaService: {} }));

import { CapabilityDiscoveryService, type DiscoveredCapability } from "@domain/core/infrastructure/capability-discovery.service.js";

describe("CapabilityDiscoveryService.formatCapabilityCatalog", () => {

    it("returns 'No workers available.' for empty array", () => {
        expect(CapabilityDiscoveryService.formatCapabilityCatalog([])).toBe("No workers available.");
    });

    it("formats a single capability with all fields", () => {
        const cap: DiscoveredCapability = {
            name: "Data Processor",
            description: "Processes raw data into structured output.",
            id: 42,
            parameters: "input_file: string (required)\nformat: csv | json",
            specialties: ["ETL", "Data Cleaning"],
            knowledgeTopics: ["Data Engineering"],
            datasets: ["customer_records"],
            tools: [
                { name: "sql_query", description: "Run SQL queries" },
                { name: "file_read", description: "Read files" },
            ],
            personaLabel: "Data Engineer",
            credentials: [],
        };

        const result = CapabilityDiscoveryService.formatCapabilityCatalog([cap]);

        expect(result).toContain("### WORKER: [Data Processor](#tool:42)");
        expect(result).toContain("**Role**: Data Engineer");
        expect(result).toContain("**Description**: Processes raw data");
        expect(result).toContain("**Specialties**: ETL, Data Cleaning");
        expect(result).toContain("Topics: Data Engineering");
        expect(result).toContain("Datasets: customer_records");
        expect(result).toContain("Tools: sql_query, file_read");
        expect(result).toContain("**Required Inputs**:");
    });

    it("omits Role when personaLabel is undefined", () => {
        const cap: DiscoveredCapability = {
            name: "Simple Worker", description: "Does stuff", id: 1,
            parameters: "", specialties: [], knowledgeTopics: [], datasets: [], tools: [],
            credentials: [],
        };
        const result = CapabilityDiscoveryService.formatCapabilityCatalog([cap]);
        expect(result).not.toContain("**Role**:");
    });

    it("omits Knowledge & Tools section when all arrays empty", () => {
        const cap: DiscoveredCapability = {
            name: "Bare", description: "Minimal", id: 2,
            parameters: "", specialties: [], knowledgeTopics: [], datasets: [], tools: [],
            credentials: [],
        };
        const result = CapabilityDiscoveryService.formatCapabilityCatalog([cap]);
        expect(result).not.toContain("**Knowledge & Tools Access**:");
    });

    it("separates multiple capabilities with ---", () => {
        const caps: DiscoveredCapability[] = [
            { name: "A", description: "Cap A", id: 1, parameters: "", specialties: [], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
            { name: "B", description: "Cap B", id: 2, parameters: "", specialties: [], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
        ];
        const result = CapabilityDiscoveryService.formatCapabilityCatalog(caps);
        expect(result).toContain("---");
    });

    it("omits Required Inputs section when parameters is empty string", () => {
        const cap: DiscoveredCapability = {
            name: "X", description: "Y", id: 3,
            parameters: "", specialties: [], knowledgeTopics: [], datasets: [], tools: [],
            credentials: [],
        };
        const result = CapabilityDiscoveryService.formatCapabilityCatalog([cap]);
        expect(result).not.toContain("**Required Inputs**:");
    });

    it("includes only Topics when datasets and tools are empty", () => {
        const cap: DiscoveredCapability = {
            name: "T", description: "Topic only", id: 4,
            parameters: "", specialties: [], knowledgeTopics: ["Finance"], datasets: [], tools: [],
            credentials: [],
        };
        const result = CapabilityDiscoveryService.formatCapabilityCatalog([cap]);
        expect(result).toContain("Topics: Finance");
        expect(result).not.toContain("Datasets:");
        expect(result).not.toContain("Tools:");
    });
});

describe("CapabilityDiscoveryService.rankAndPruneCapabilities", () => {

    it("returns all capabilities if intent is empty or fewer items than limit", () => {
        const caps: DiscoveredCapability[] = [
            { name: "A", description: "", id: 1, parameters: "", specialties: [], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
            { name: "B", description: "", id: 2, parameters: "", specialties: [], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
        ];
        expect(CapabilityDiscoveryService.rankAndPruneCapabilities(caps, "", 10).length).toBe(2);
        expect(CapabilityDiscoveryService.rankAndPruneCapabilities(caps, "do something", 10).length).toBe(2);
    });

    it("ranks capabilities based on exact keyword overlap in name, specialties, and personaLabel", () => {
        const caps: DiscoveredCapability[] = [
            { name: "Generic Data Tools", description: "", id: 1, parameters: "", specialties: [], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
            { name: "Financial Advisor", personaLabel: "Finance Expert", description: "", id: 2, parameters: "", specialties: ["accounting", "finance"], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
            { name: "IT Support", personaLabel: "Tech Support", description: "", id: 3, parameters: "", specialties: ["networking"], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
        ];

        const result = CapabilityDiscoveryService.rankAndPruneCapabilities(caps, "I need help with some finance and accounting tasks", 2);

        expect(result.length).toBe(2);
        // "Financial Advisor" should definitely be first due to "finance" in personaLabel, name, specialties + "accounting" in specialties
        expect(result[0].id).toBe(2);
    });

    it("prunes capabilities beyond the maxLimit", () => {
        const caps: DiscoveredCapability[] = [
            { name: "DB 1", description: "", id: 1, parameters: "", specialties: ["database"], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
            { name: "DB 2", description: "", id: 2, parameters: "", specialties: ["database"], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
            { name: "DB 3", description: "", id: 3, parameters: "", specialties: ["database"], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
            { name: "DB 4", description: "", id: 4, parameters: "", specialties: ["database"], knowledgeTopics: [], datasets: [], tools: [], credentials: [] },
        ];

        const result = CapabilityDiscoveryService.rankAndPruneCapabilities(caps, "Fix the database", 2);
        expect(result.length).toBe(2);
    });

});
