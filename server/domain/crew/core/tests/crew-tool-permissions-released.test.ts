import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CrewToolsService } from "../crew-tools.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";
import type { ToolContext } from "@domain/tools/v1/capabilities/types.js";

// Mock capability registry
vi.mock("@domain/tools/v1/capabilities/index.js", () => ({
  getAgentTools: () => ({
    execute_custom_pipeline: {
      name: "execute_custom_pipeline",
      label: "Execute Pipeline",
      description: "Triggers custom pipeline with parameters",
      parameters: z.object({
        pipelineId: z.string(),
        environment: z.string().default("staging"),
      }),
      execute: async (params: any) => ({
        success: true,
        pipelineId: params.pipelineId,
        status: "running",
      }),
    },
    run_dependency_audit: {
      name: "run_dependency_audit",
      label: "Run Dependency Audit",
      description: "Runs vulnerability audit on workspace dependencies",
      parameters: z.object({}),
      execute: async () => ({
        vulnerabilities: 0,
        status: "clean",
      }),
    },
    mount_builder_pod: {
      name: "mount_builder_pod",
      label: "Mount Builder Pod",
      description: "Mounts adaptive builder pod in chat",
      parameters: z.object({
        stageId: z.string(),
        podComponent: z.string(),
      }),
      execute: async (params: any) => ({
        success: true,
        type: "assistant_app",
        module: params.podComponent,
        title: `Configure ${params.stageId}`,
      }),
    },
    discover_capabilities: {
      name: "discover_capabilities",
      label: "Discover Capabilities",
      description: "Discovers available missions and capabilities",
      parameters: z.object({ query: z.string().optional() }),
      execute: async () => "Found 4 capabilities",
    },
    list_installed_apps: {
      name: "list_installed_apps",
      label: "List Installed Apps",
      description: "Lists installed apps in org",
      parameters: z.object({}),
      execute: async () => "Installed apps list",
    },
    update_blackboard: {
      name: "update_blackboard",
      label: "Update Blackboard",
      description: "Updates shared mission working memory",
      parameters: z.object({ content: z.record(z.any()), reason: z.string() }),
      execute: async () => "Blackboard updated successfully",
    },
    request_help: {
      name: "request_help",
      label: "Request Help",
      description: "Delegates task to swarm marketplace",
      parameters: z.object({ task_description: z.string() }),
      execute: async () => ({ status: "success", output: "Help posted" }),
    },
    generate_presentation_deck: {
      name: "generate_presentation_deck",
      label: "Generate Presentation Deck",
      description: "Generates presentation deck deliverable",
      parameters: z.object({
        title: z.string(),
        content: z.string(),
        sourceQuery: z.object({ id: z.number().nullable().optional(), name: z.string() }).optional(),
      }),
      riskLevel: "low",
      idempotency: "read-safe",
      execute: async (params: any) => JSON.stringify({
        type: "presentation_deck",
        title: "Test Deck",
        ...(params.sourceQuery ? {
          lineage: {
            source: { type: "saved_query", id: params.sourceQuery.id ?? null, name: params.sourceQuery.name },
          },
        } : {}),
      }),
    },
    generate_pdf: {
      name: "generate_pdf",
      label: "Generate PDF",
      description: "Generates PDF document",
      parameters: z.object({ path: z.string(), content: z.string() }),
      riskLevel: "low",
      idempotency: "read-safe",
      execute: async () => "PDF generated",
    },
    generate_excel: {
      name: "generate_excel",
      label: "Generate Excel",
      description: "Generates Excel document",
      parameters: z.object({ path: z.string(), data: z.array(z.any()) }),
      riskLevel: "low",
      idempotency: "read-safe",
      execute: async () => "Excel generated",
    },
    request_mcp_tool: {
      name: "request_mcp_tool",
      label: "Request MCP Tool",
      description: "Requests activation of inactive MCP tool",
      parameters: z.object({ toolName: z.string(), reason: z.string() }),
      execute: async () => "Requested MCP tool activation",
    },
  }),
}));

/**
 * An agent card with every column the record type requires.
 *
 * The tests below care about `tools` and `capabilities`; spelling out the other
 * dozen columns in each literal buries that. Overrides stay type-checked, so a
 * renamed column still fails here.
 */
const baseCard = {
  id: 1,
  organizationId: 1,
  name: "Agent",
  description: "",
  personaType: "general",
  modelBindingProviderId: null,
  modelBindingModelId: null,
  capabilities: [],
  tools: [],
  topicAffinities: [],
  intentAffinities: [],
  enabled: true,
  isDefault: false,
  oceanTraits: null,
  soulArchetype: null,
  legend: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as AgentCardRecord;

const makeCard = (over: Partial<AgentCardRecord>): AgentCardRecord => ({ ...baseCard, ...over });

describe("CREW Room Agent Tool Permission Release", () => {
  const service = new CrewToolsService();

  const mockContext: ToolContext = {
    userId: "1",
    organizationId: 1,
    projectId: 1,
    userRole: "admin",
    // Required by ToolContext: the resolver reads these when expanding
    // {{named.x}} / {{0}} placeholders.
    named: {},
    positional: {},
  };

  it("releases permissions on all explicitly declared agent card tools (including write/action tools)", async () => {
    const card = makeCard({
      id: 42,
      name: "DevOps Engineer",
      description: "Pipeline and deployment specialist",
      personaType: "devops",
      capabilities: ["pipeline", "deploy"],
      tools: ["execute_custom_pipeline", "run_dependency_audit"],
      soulArchetype: "Relentless Builder",
      legend: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const resolved = await service.resolveForCard(card);
    const names = resolved.map((r) => r.definition.name);

    // Verify declared write/action tools are fully admitted
    expect(names).toContain("execute_custom_pipeline");
    expect(names).toContain("run_dependency_audit");

    const pipelineTool = resolved.find((r) => r.definition.name === "execute_custom_pipeline");
    expect(pipelineTool?.reason).toBe("declared-agent-tool");

    const auditTool = resolved.find((r) => r.definition.name === "run_dependency_audit");
    expect(auditTool?.reason).toBe("declared-agent-tool");
  });

  it("universally admits discovery, listing, blackboard, and delegation tools for all agents", async () => {
    const emptyCard = makeCard({
      id: 99,
      name: "Basic Agent",
      description: "Agent with no explicit custom tools declared",
      personaType: "general",
      capabilities: [],
      tools: [],
      soulArchetype: null,
      legend: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const resolved = await service.resolveForCard(emptyCard);
    const names = resolved.map((r) => r.definition.name);

    // Asset & Capability discovery
    expect(names).toContain("discover_capabilities");
    expect(names).toContain("list_installed_apps");

    // Presentation & Document Deliverable Generation
    expect(names).toContain("generate_presentation_deck");
    expect(names).toContain("generate_pdf");
    expect(names).toContain("generate_excel");

    // Collaboration, shared working memory & delegation
    expect(names).toContain("update_blackboard");
    expect(names).toContain("request_help");
    expect(names).toContain("request_mcp_tool");
  });

  it("executes declared action tools directly without read-only denial", async () => {
    const card = makeCard({
      id: 42,
      name: "DevOps Engineer",
      description: "Pipeline and deployment specialist",
      personaType: "devops",
      capabilities: ["pipeline"],
      tools: ["execute_custom_pipeline"],
      soulArchetype: null,
      legend: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const resolved = await service.resolveForCard(card);

    const { record, output } = await service.execute(
      "execute_custom_pipeline",
      { pipelineId: "pipe-990", environment: "production" },
      resolved,
      mockContext
    );

    expect(record.ok).toBe(true);
    expect(output).toContain("pipe-990");
    expect(output).toContain("running");
  });

  it("executes generate_presentation_deck and surfaces a presentation artifact", async () => {
    const emptyCard = makeCard({
      id: 99,
      name: "Presenter Agent",
      description: "Presentation creator",
      personaType: "general",
      capabilities: [],
      tools: [],
      soulArchetype: null,
      legend: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const resolved = await service.resolveForCard(emptyCard);

    const { record, output, artifact } = await service.execute(
      "generate_presentation_deck",
      {
        title: "Quarterly Strategy",
        content: "# Goals\nAchieve 99.9% SLO",
        sourceQuery: { id: 11, name: "Open Incidents" },
      },
      resolved,
      mockContext
    );

    expect(record.ok).toBe(true);
    expect(artifact).not.toBeNull();
    expect(artifact?.payload?.type).toBe("presentation_deck");
    expect((artifact?.payload as any)?.lineage?.source).toEqual({ type: "saved_query", id: 11, name: "Open Incidents" });
    expect(output).toContain('Rendered a "presentation_deck" surface');
  });
});
