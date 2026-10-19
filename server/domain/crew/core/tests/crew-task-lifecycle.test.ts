import { describe, expect, it, vi } from "vitest";
import { CREW_TASK_PROPOSAL_TOOLS } from "@domain/tools/v1/capabilities/crew-task-proposal-tools.js";
import { classifyReadOnly, PROPOSAL_TOOLS } from "../crew-tools.service.js";
import type { ToolDefinition } from "@domain/tools/v1/capabilities/types.js";

const def = (over: Partial<ToolDefinition> & { name: string }) =>
    ({ description: "", parameters: {} as never, execute: async () => "", ...over }) as ToolDefinition;

describe("CREW In-Room Task Proposal Tools", () => {
    it("admits all in-room task proposal tools in the proposal tier", () => {
        const expectedTools = [
            "propose_mission",
            "propose_mission_synthesis",
            "propose_research_mission",
            "propose_cycle_draft",
            "propose_scenario_simulation",
            "propose_spatial_analysis",
            "propose_calculation_eval",
            "propose_security_audit",
            "propose_knowledge_ingestion",
            "propose_crew_decision",
            "propose_crew_claim",
            "propose_crew_commitment",
        ];

        for (const name of expectedTools) {
            expect(PROPOSAL_TOOLS.has(name), `Expected ${name} to be in PROPOSAL_TOOLS`).toBe(true);
            const reason = classifyReadOnly(def({ name }));
            expect(reason, `Expected ${name} to classify as proposal`).toBe("proposal");
        }
    });

    it("propose_scenario_simulation generates a well-formed approval request payload", async () => {
        const tool = CREW_TASK_PROPOSAL_TOOLS.propose_scenario_simulation;
        expect(tool).toBeDefined();

        const result = await tool.execute(
            {
                objective: "Determine database failover strategy under 10k RPS",
                strategies: ["Immediate Cluster Failover", "Gradual Read-Replica Drain"],
                iterations: 5000,
                reason: "Resolve architectural disagreement between Database Specialist and DevOps Lead",
            },
            {
                organizationId: 42,
                userId: "user-123",
                sessionKey: "room-abc-xyz",
                agentCardId: 7,
            } as any
        );

        const parsed = JSON.parse(result as string);
        expect(parsed.type).toBe("approval_request");
        expect(parsed.kind).toBe("scenario_simulation");
        expect(parsed.objective).toContain("Determine database failover");
        expect(parsed.strategies).toHaveLength(2);
        expect(parsed.iterations).toBe(5000);
        expect(parsed.priority).toBe("urgent");
        expect(parsed.sessionKey).toBe("room-abc-xyz");
    });

    it("propose_spatial_analysis generates a well-formed approval request payload", async () => {
        const tool = CREW_TASK_PROPOSAL_TOOLS.propose_spatial_analysis;
        expect(tool).toBeDefined();

        const result = await tool.execute(
            {
                targetArea: "Austin Downtown Logistics Hub",
                resolution: 9,
                metrics: ["dwell_time", "flux_vector"],
                reason: "Investigate delivery bottleneck and fleet dwell times",
            },
            {
                organizationId: 42,
                userId: "user-123",
                sessionKey: "room-abc-xyz",
            } as any
        );

        const parsed = JSON.parse(result as string);
        expect(parsed.type).toBe("approval_request");
        expect(parsed.kind).toBe("spatial_analysis");
        expect(parsed.targetArea).toBe("Austin Downtown Logistics Hub");
        expect(parsed.resolution).toBe(9);
        expect(parsed.metrics).toEqual(["dwell_time", "flux_vector"]);
    });

    it("propose_calculation_eval generates a well-formed approval request payload", async () => {
        const tool = CREW_TASK_PROPOSAL_TOOLS.propose_calculation_eval;
        expect(tool).toBeDefined();

        const result = await tool.execute(
            {
                formulaName: "dynamic_pricing_optimization",
                constraints: ["margin >= 0.15", "conversion_rate >= 0.08"],
                inputVariables: { base_cost: 120, competitor_price: 155 },
                reason: "Calculate optimal pricing curve without violating margin constraints",
            },
            {
                organizationId: 42,
                userId: "user-123",
                sessionKey: "room-abc-xyz",
            } as any
        );

        const parsed = JSON.parse(result as string);
        expect(parsed.type).toBe("approval_request");
        expect(parsed.kind).toBe("calculation_eval");
        expect(parsed.formulaName).toBe("dynamic_pricing_optimization");
        expect(parsed.constraints).toHaveLength(2);
    });

    it("propose_security_audit generates a well-formed approval request payload", async () => {
        const tool = CREW_TASK_PROPOSAL_TOOLS.propose_security_audit;
        expect(tool).toBeDefined();

        const result = await tool.execute(
            {
                targetPackageOrService: "auth-gateway-docker",
                scope: "dependencies_and_containers",
                reason: "Zero-day vulnerability reported in base alpine image",
            },
            {
                organizationId: 42,
                userId: "user-123",
                sessionKey: "room-abc-xyz",
            } as any
        );

        const parsed = JSON.parse(result as string);
        expect(parsed.type).toBe("approval_request");
        expect(parsed.kind).toBe("security_audit");
        expect(parsed.targetPackageOrService).toBe("auth-gateway-docker");
    });

    it("propose_knowledge_ingestion generates a well-formed approval request payload", async () => {
        const tool = CREW_TASK_PROPOSAL_TOOLS.propose_knowledge_ingestion;
        expect(tool).toBeDefined();

        const result = await tool.execute(
            {
                sourceName: "Jira Escalations - Q3 Infrastructure",
                timeframeOrFilter: "status = Closed AND resolved >= -30d",
                reason: "Enrich knowledge graph with root-cause patterns from recent outages",
            },
            {
                organizationId: 42,
                userId: "user-123",
                sessionKey: "room-abc-xyz",
            } as any
        );

        const parsed = JSON.parse(result as string);
        expect(parsed.type).toBe("approval_request");
        expect(parsed.kind).toBe("knowledge_ingestion");
        expect(parsed.sourceName).toContain("Jira Escalations");
    });
});

/**
 * Every tool the crew allowlist names must actually exist in the v1 registry.
 *
 * `list_scaffold_packs` sat in UNIVERSAL_PRESENTATION_TOOLS while its only
 * implementation was an MCP tool, so the name was silently dropped from the
 * offered set. Agents were instructed — by the deployment tool's own refusal
 * message and by the persona prompt — to call a tool they had never been given,
 * so when asked to deploy they invented a pack id instead, and the proposal was
 * rejected as unknown. A missing name must fail here rather than degrade into a
 * capability the room is told it has and does not.
 */
describe("CREW allowlist integrity", () => {
    it("offers no tool name that the v1 registry cannot resolve", async () => {
        const { UNIVERSAL_PRESENTATION_TOOLS } = await import("../crew-tools.service.js");
        // Importing the capabilities index is what registers the static tools.
        await import("@domain/tools/v1/capabilities/index.js");
        const { toolRegistry } = await import("@domain/tools/core/tool-registry.js");

        // Deliberately the static registry rather than getAgentTools(), which
        // merges whatever MCP servers happen to be connected — a name resolving
        // only because an MCP server is up would hide exactly this defect.
        const known = new Set(Object.keys(toolRegistry.getAllTools()));

        const missing = UNIVERSAL_PRESENTATION_TOOLS.filter((n: string) => !known.has(n));
        expect(missing, `Allowlisted but undefined: ${missing.join(", ")}`).toEqual([]);
    });
});

/**
 * The saved-query tools must actually reach an agent.
 *
 * Allowlisting is not enough: resolveForCard still runs each name through
 * classifyReadOnly, and `run_saved_query` begins with "run", a write token. Left
 * to the classifier it would be rejected and silently absent — the same shape as
 * `list_scaffold_packs`, which sat in the allowlist with no registry entry while
 * the prompt told agents to call it.
 */
describe("CREW saved-query tools", () => {
    it("offers both discovery and execution to an agent that declares neither", async () => {
        const { CrewToolsService } = await import("../crew-tools.service.js");
        const service = new CrewToolsService();

        const card = {
            id: 1, organizationId: 1, name: "Analyst", description: "",
            personaType: "general", capabilities: [], tools: [],
            enabled: true, createdAt: new Date(), updatedAt: new Date(),
        } as any;

        const resolved = await service.resolveForCard(card);
        const names = resolved.map((r: any) => r.definition.name);

        expect(names, "an agent told to run a query needs to see what exists").toContain("list_saved_queries");
        expect(names, "run_saved_query must survive the write-token classifier").toContain("run_saved_query");
    });
});

/**
 * The Ontology is the platform's answer to "what does this org have?". The tools
 * existed in AGENT_TOOLS but were in no crew allowlist, so inside a room — where the
 * collaborative work happens — every Object Type was invisible.
 */
describe("CREW ontology tools", () => {
    it("offers ontology reads and governed relationship proposals, while withholding unrestricted actions", async () => {
        const { CrewToolsService } = await import("../crew-tools.service.js");
        const service = new CrewToolsService();

        const card = {
            id: 1, organizationId: 1, name: "Analyst", description: "",
            personaType: "general", capabilities: [], tools: [],
            enabled: true, createdAt: new Date(), updatedAt: new Date(),
        } as any;

        const names = (await service.resolveForCard(card)).map((r: any) => r.definition.name);

        expect(names, "an agent must be able to discover the Object Types before listing one").toContain("ontology_list_object_types");
        expect(names).toContain("ontology_list_objects");
        expect(names).toContain("ontology_get_object");
        expect(names).toContain("ontology_list_link_types");
        expect(names).toContain("ontology_traverse_link");
        expect(names).toContain("ontology_define_link_type");
        expect(names).toContain("ontology_link_objects");
        expect(names).toContain("ontology_unlink_objects");
        for (const name of ["ontology_define_link_type", "ontology_link_objects", "ontology_unlink_objects"]) {
            expect(PROPOSAL_TOOLS.has(name)).toBe(true);
            expect(classifyReadOnly(def({ name }))).toBe("proposal");
        }
        expect(names, "executing a business action is a write, and a separate decision").not.toContain("ontology_execute_action");
    });
});
