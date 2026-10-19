import { describe, it, expect } from "vitest";
import {
  ScaffoldPackPod,
  PipelineBuilderPod,
  AgenticHRPod,
  HILGovernancePod,
  MissionBriefPod,
  DatasetSchemaPod,
} from "../../server/domain/core/ui/components/packaged/index.js";

describe("Adaptive Fulfillment Builder Pods (Phase 3)", () => {
  it("exports all 6 Builder Pod components from packaged library", () => {
    expect(ScaffoldPackPod).toBeDefined();
    expect(PipelineBuilderPod).toBeDefined();
    expect(AgenticHRPod).toBeDefined();
    expect(HILGovernancePod).toBeDefined();
    expect(MissionBriefPod).toBeDefined();
    expect(DatasetSchemaPod).toBeDefined();
  });

  it("ScaffoldPackPod is a valid React component function", () => {
    expect(typeof ScaffoldPackPod).toBe("function");
    expect(ScaffoldPackPod.name).toBe("ScaffoldPackPod");
  });

  it("PipelineBuilderPod is a valid React component function", () => {
    expect(typeof PipelineBuilderPod).toBe("function");
    expect(PipelineBuilderPod.name).toBe("PipelineBuilderPod");
  });

  it("AgenticHRPod is a valid React component function", () => {
    expect(typeof AgenticHRPod).toBe("function");
    expect(AgenticHRPod.name).toBe("AgenticHRPod");
  });

  it("HILGovernancePod is a valid React component function", () => {
    expect(typeof HILGovernancePod).toBe("function");
    expect(HILGovernancePod.name).toBe("HILGovernancePod");
  });

  it("MissionBriefPod is a valid React component function", () => {
    expect(typeof MissionBriefPod).toBe("function");
    expect(MissionBriefPod.name).toBe("MissionBriefPod");
  });

  it("DatasetSchemaPod is a valid React component function", () => {
    expect(typeof DatasetSchemaPod).toBe("function");
    expect(DatasetSchemaPod.name).toBe("DatasetSchemaPod");
  });
});
