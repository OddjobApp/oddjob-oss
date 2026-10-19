import { describe, it, expect, beforeEach, vi } from "vitest";
import { xrayCompositionService } from "../core/xray-composition.service.js";
import { xrayNodeDetailService } from "../core/xray-node-detail.service.js";
import { db } from "@server/database_service.js";

vi.mock("@server/database_service.js", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    },
  };
});

vi.mock("@domain/knowledge/core/extraction/document-service.js", () => ({
  documentService: { createDocument: vi.fn().mockResolvedValue({ id: 999 }) },
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  },
  getRedisOptions: vi.fn().mockReturnValue({}),
}));

describe("X-Ray Ontology Spec Generation & Composition Graph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects ontology object types and bridges knowledge entity to knowledge graph", async () => {
    const mockTypes = [
      {
        id: 1,
        name: "Mission",
        description: "An autonomous mission run",
        backing: "virtual",
        sourceAdapter: "missions",
        titleProperty: "name",
        propertiesSchema: {},
        icon: "target",
        isActive: true,
      },
      {
        id: 2,
        name: "CustomerRecord",
        description: "Materialized custom customer",
        backing: "materialized",
        sourceAdapter: null,
        titleProperty: "companyName",
        propertiesSchema: { companyName: "string", revenue: "number" },
        icon: "user",
        isActive: true,
      },
      {
        id: 3,
        name: "Knowledge Entity",
        description: "Verified knowledge entity",
        backing: "virtual",
        sourceAdapter: "knowledge_graph",
        titleProperty: "name",
        propertiesSchema: {},
        icon: "brain",
        isActive: true,
      }
    ];

    const selectChain = (rows: any) => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
    });

    // Mock first select for ontologyObjectTypes, second for knowledgeTopics
    (db.select as any)
      .mockReturnValueOnce(selectChain(mockTypes))
      .mockReturnValueOnce(selectChain([{ id: 42, name: "Core Knowledge" }]));

    const result = await xrayCompositionService._collectOntologyTypeEntities(1, ["ontology_object_type"]);

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0].id).toBe("ontology_object_type::1");
    expect(result.nodes[0].type).toBe("ontology_object_type");
    expect(result.nodes[0].label).toBe("Mission");
    expect(result.nodes[0].metadata?.backing).toBe("virtual");
    expect(result.nodes[0].metadata?.sourceAdapter).toBe("missions");

    expect(result.nodes[1].id).toBe("ontology_object_type::2");
    expect(result.nodes[1].metadata?.backing).toBe("materialized");
    expect(result.nodes[1].metadata?.propertyCount).toBe(2);

    // Verify BRIDGES_KG edge
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].relation).toBe("BRIDGES_KG");
    expect(result.edges[0].source).toBe("ontology_object_type::3");
    expect(result.edges[0].target).toBe("knowledge_cluster::42");
  });

  it("collects ontology actions with governance metadata and links to object types & pipelines", async () => {
    const mockActions = [
      {
        id: 10,
        name: "assign_technician",
        description: "Assigns technician to task",
        effect: "write",
        handlerKind: "builtin",
        handlerRef: "assign_tech_handler",
        requiresApproval: true,
        riskLevel: "high",
        objectTypeId: 2,
        parametersSchema: { technicianId: "number" },
        isActive: true,
      },
      {
        id: 11,
        name: "run_reconciliation_pipeline",
        description: "Triggers pipeline execution",
        effect: "write",
        handlerKind: "pipeline",
        handlerRef: "501",
        requiresApproval: false,
        riskLevel: "low",
        objectTypeId: 2,
        parametersSchema: {},
        isActive: true,
      },
    ];

    const mockTypes = [{ id: 2, name: "CustomerRecord" }];

    (db.select as any)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockActions),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockTypes),
        }),
      });

    const result = await xrayCompositionService._collectOntologyActionEntities(1, ["ontology_action"]);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].id).toBe("ontology_action::10");
    expect(result.nodes[0].metadata?.requiresApproval).toBe(true);
    expect(result.nodes[0].metadata?.riskLevel).toBe("high");

    // Edges: 2 ACTS_ON edges + 1 TRIGGERS edge to pipeline 501
    expect(result.edges).toHaveLength(3);
    const actsOnEdges = result.edges.filter(e => e.relation === "ACTS_ON");
    expect(actsOnEdges).toHaveLength(2);
    expect(actsOnEdges[0].source).toBe("ontology_action::10");
    expect(actsOnEdges[0].target).toBe("ontology_object_type::2");

    const triggerEdges = result.edges.filter(e => e.relation === "TRIGGERS");
    expect(triggerEdges).toHaveLength(1);
    expect(triggerEdges[0].source).toBe("ontology_action::11");
    expect(triggerEdges[0].target).toBe("pipeline::501");
  });

  it("collects derived, materialized, and polymorphic ontology link types", async () => {
    const mockLinks = [
      {
        id: 100,
        name: "step_of",
        inverseName: "has_step",
        description: "Step belongs to pipeline",
        cardinality: "one_to_one",
        backing: "derived",
        sourceTypeId: 1,
        targetTypeId: 2,
        sourceProperty: "pipelineId",
        targetProperty: "id",
        targetTypeProperty: null,
        targetTypeMap: {},
        path: [],
        isActive: true,
      },
      {
        id: 101,
        name: "has_resource",
        inverseName: "resource_of",
        description: "Polymorphic project resource link",
        cardinality: "one_to_many",
        backing: "derived",
        sourceTypeId: 1,
        targetTypeId: null,
        sourceProperty: "resourceId",
        targetProperty: "id",
        targetTypeProperty: "resourceType",
        targetTypeMap: { mission: "CustomerRecord" },
        path: [],
        isActive: true,
      },
    ];

    const mockTypes = [
      { id: 1, name: "PipelineStep" },
      { id: 2, name: "CustomerRecord" },
    ];

    (db.select as any)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockLinks),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockTypes),
        }),
      });

    const result = await xrayCompositionService._collectOntologyLinkTypeEntities(1, ["ontology_link_type"]);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].id).toBe("ontology_link_type::100");

    // Link 100 has DEFINES_FORWARD to type 1 and DEFINES_REVERSE to type 2
    // Link 101 has DEFINES_FORWARD to type 1 and TARGETS_OBJECT_TYPE to type 2 (from polymorphic map)
    expect(result.edges).toHaveLength(4);
    expect(result.edges.some(e => e.relation === "DEFINES_FORWARD" && e.target === "ontology_object_type::1")).toBe(true);
    expect(result.edges.some(e => e.relation === "DEFINES_REVERSE" && e.target === "ontology_object_type::2")).toBe(true);
    expect(result.edges.some(e => e.relation === "TARGETS_OBJECT_TYPE" && e.target === "ontology_object_type::2")).toBe(true);
  });

  it("generates rich technical specification markdown for ontology object types and actions", async () => {
    // Test documentation generation for an ontology_object_type
    const mockNode = {
      id: "ontology_object_type::5",
      type: "ontology_object_type" as const,
      label: "CustomerAccount",
      description: "Enterprise customer profile",
      dbId: 5,
    };

    const details = {
      node: mockNode,
      documentation: { content: "", status: "draft" as const, documentationStatus: "missing" as const, tags: [], isAiGenerated: false },
      inbound: [],
      outbound: [
        { node: { id: "ontology_action::10", type: "ontology_action" as const, label: "update_tier" }, relation: "ACTS_ON", label: "action" }
      ],
      specs: {
        backing: "materialized",
        titleProperty: "accountName",
        propertiesSchema: { accountName: "string", tier: "string", annualSpend: "number" },
        materializedInstanceCount: 142,
      },
      telemetry: {},
    };

    vi.spyOn(xrayNodeDetailService, "getNodeDetail").mockResolvedValue(details as any);
    vi.spyOn(xrayNodeDetailService, "saveNodeDocumentation").mockResolvedValue({ id: 1, nodeId: "ontology_object_type::5" } as any);

    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const doc = await xrayNodeDetailService.generateNodeDocumentation("oddjob", "ontology_object_type::5", 1);

    expect(doc.content).toContain("# Technical Summary Document: CustomerAccount (Ontology Object Type)");
    expect(doc.content).toContain("materialized");
    expect(doc.content).toContain("accountName");
    expect(doc.content).toContain("142");
    expect(doc.content).toContain("update_tier");
  });

  it("includes ontology object types, actions, and links in application architecture documents", async () => {
    const mockGraph = {
      scope: { id: "oddjob", name: "Oddjob Platform", type: "platform" as const },
      nodes: [
        { id: "ontology_object_type::1", type: "ontology_object_type" as const, label: "Mission", dbId: 1, metadata: { backing: "virtual", sourceAdapter: "missions", propertyCount: 8 } },
        { id: "ontology_action::10", type: "ontology_action" as const, label: "assign_technician", dbId: 10, metadata: { effect: "write", requiresApproval: true, riskLevel: "high", handlerKind: "builtin" } },
        { id: "ontology_link_type::100", type: "ontology_link_type" as const, label: "step_of (has_step)", dbId: 100, metadata: { cardinality: "one_to_one", backing: "derived", sourceTypeId: 1, targetTypeId: 2 } },
      ],
      edges: [
        { id: "e1", source: "ontology_action::10", target: "ontology_object_type::1", relation: "ACTS_ON" as const, label: "action on Mission" }
      ],
      indexedAt: "2026-08-18T12:00:00.000Z",
    };

    vi.spyOn(xrayCompositionService, "buildGraph").mockResolvedValue(mockGraph as any);
    vi.spyOn(xrayNodeDetailService, "syncBlueprintOrAppDocs").mockResolvedValue({ id: 99, nodeId: "scope::oddjob" } as any);

    const result = await xrayNodeDetailService.generateAppArchitectureDoc("oddjob", 1);

    expect(result.markdown).toContain("| **Ontology Object Types** | 1 |");
    expect(result.markdown).toContain("| **Governed Actions** | 1 |");
    expect(result.markdown).toContain("| **Ontology Link Types** | 1 |");
    expect(result.markdown).toContain("### 3.7 Business Ontology Layer");
    expect(result.markdown).toContain("#### Object Types (1)");
    expect(result.markdown).toContain("Mission");
    expect(result.markdown).toContain("#### Governed Actions (1)");
    expect(result.markdown).toContain("assign_technician");
    expect(result.markdown).toContain("#### Link Types (1)");
    expect(result.markdown).toContain("step_of");
  });
});
