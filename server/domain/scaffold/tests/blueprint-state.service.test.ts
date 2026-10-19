import { describe, it, expect, beforeEach } from "vitest";
import { DAGResolver } from "../dag-resolver.js";
import {
  AssemblyBlueprintSchema,
  type BlueprintStage,
  type BlueprintStageInput,
  type AssemblyBlueprintInput,
} from "@shared/schema/assembly-blueprint.js";

describe("DAGResolver", () => {
  let resolver: DAGResolver;

  const sampleStageInputs: BlueprintStageInput[] = [
    {
      id: "stage-db",
      name: "1. Database Schema",
      type: "scaffold_pack",
      requires: [],
      provides: ["database"],
      conflicts: [],
      podComponent: "ScaffoldPackPod",
      defaultConfig: {},
      completionCriteria: { type: "pack_selected" },
    },
    {
      id: "stage-pipeline",
      name: "2. Trigger Pipeline",
      type: "pipeline",
      requires: ["stage-db"],
      provides: ["pipeline"],
      conflicts: [],
      podComponent: "PipelineBuilderPod",
      defaultConfig: {},
      completionCriteria: { type: "pipeline_valid" },
    },
    {
      id: "stage-hil",
      name: "3. HIL Approval Gate",
      type: "hil_governance",
      requires: ["stage-pipeline"],
      provides: ["governance"],
      conflicts: [],
      podComponent: "PlatformHILApprovalBlock",
      defaultConfig: {},
      completionCriteria: { type: "hil_gate_configured" },
    },
  ];

  const sampleBlueprintInput: AssemblyBlueprintInput = {
    id: "incident-cycle-bp",
    name: "Incident Response Cycle Blueprint",
    version: "1.0.0",
    category: "operational_cycle",
    description: "Automated triage cycle with HIL approval gate",
    layout: { type: "chat_inline", defaultVisualization: "mermaid_flowchart" },
    stages: sampleStageInputs,
    scaffoldPacks: ["core-node-express", "data-postgres-drizzle"],
    variables: {},
  };

  // z.infer is z.output: `.default()` fields are REQUIRED on the way out and
  // optional on the way in. Parse the input fixtures rather than hand-writing the
  // defaulted shape, which is what made these fixtures stop type-checking.
  const sampleBlueprint = AssemblyBlueprintSchema.parse(sampleBlueprintInput);
  const sampleStages: BlueprintStage[] = sampleBlueprint.stages;

  beforeEach(() => {
    resolver = new DAGResolver();
  });

  describe("DAGResolver (Stages)", () => {
    it("should topologically sort stages based on requirements", () => {
      // Pass shuffled stages
      const shuffled = [sampleStages[2], sampleStages[0], sampleStages[1]];
      const sorted = resolver.resolveStageOrder(shuffled);

      expect(sorted.map(s => s.id)).toEqual(["stage-db", "stage-pipeline", "stage-hil"]);
    });

    it("should throw an error when a stage references a nonexistent prerequisite", () => {
      const invalidStage: BlueprintStageInput = {
        id: "stage-broken",
        name: "Broken Stage",
        type: "scaffold_pack",
        requires: ["stage-nonexistent"],
        provides: [],
        conflicts: [],
        podComponent: "ScaffoldPackPod",
        defaultConfig: {},
        completionCriteria: { type: "pack_selected" },
      };

      expect(() => resolver.resolveStageOrder([
        AssemblyBlueprintSchema.shape.stages.element.parse(invalidStage),
      ])).toThrowError(
        /nonexistent prerequisite stage/
      );
    });

    it("should throw an error on circular stage dependencies", () => {
      const cycleStageInputs: BlueprintStageInput[] = [
        {
          id: "stage-a",
          name: "Stage A",
          type: "scaffold_pack",
          requires: ["stage-b"],
          provides: [],
          conflicts: [],
          podComponent: "ScaffoldPackPod",
          defaultConfig: {},
          completionCriteria: { type: "pack_selected" },
        },
        {
          id: "stage-b",
          name: "Stage B",
          type: "scaffold_pack",
          requires: ["stage-a"],
          provides: [],
          conflicts: [],
          podComponent: "ScaffoldPackPod",
          defaultConfig: {},
          completionCriteria: { type: "pack_selected" },
        },
      ];

      expect(() => resolver.resolveStageOrder(
        cycleStageInputs.map((st) => AssemblyBlueprintSchema.shape.stages.element.parse(st)),
      )).toThrowError(
        /Circular dependency detected/
      );
    });

    it("should correctly compute stage readiness for initial and in-progress states", () => {
      const initialReport = resolver.computeStageReadiness(sampleStages, new Set());
      expect(initialReport[0].readiness).toBe("ready");
      expect(initialReport[1].readiness).toBe("blocked");
      expect(initialReport[1].missingPrerequisites).toEqual(["stage-db"]);
      expect(initialReport[2].readiness).toBe("blocked");

      // Verify after stage-db is completed
      const midReport = resolver.computeStageReadiness(sampleStages, new Set(["stage-db"]));
      expect(midReport[0].readiness).toBe("verified");
      expect(midReport[1].readiness).toBe("ready");
      expect(midReport[2].readiness).toBe("blocked");
    });
  });

  // The BlueprintStateService cases that lived here moved to
  // tests/integration/blueprint-session.integration.test.ts: stage state is now
  // owned by the server and persisted, so exercising it needs a real database.
  // Asserting it against a stubbed store would only re-test the stub.
});
