// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  BUILTIN_WORKFLOW_RECIPES,
  CINEMATIC_HERO_RECIPE,
  PREVIZ_ANIMATIC_RECIPE,
  DIALOGUE_PERFORMANCE_RECIPE,
  type ComfyWorkflowTemplate,
  type TakeWorkflowSnapshot,
} from "./media-studio";

describe("ComfyUI Media Studio Contracts", () => {
  it("exports built-in workflow recipes with valid parameter mappings", () => {
    expect(BUILTIN_WORKFLOW_RECIPES).toHaveLength(3);

    for (const recipe of BUILTIN_WORKFLOW_RECIPES) {
      expect(recipe.id).toBeTruthy();
      expect(recipe.name).toBeTruthy();
      expect(recipe.engine).toBe("comfyui");
      expect(recipe.graphJson).toBeDefined();

      // Ensure mapped parameter nodes exist in the graphJson
      const { parameters, graphJson } = recipe;
      expect(graphJson[parameters.promptNodeId]).toBeDefined();
      if (parameters.seedNodeId) {
        expect(graphJson[parameters.seedNodeId]).toBeDefined();
      }
      if (parameters.imageInputNodeId) {
        expect(graphJson[parameters.imageInputNodeId]).toBeDefined();
      }
      if (parameters.characterEmbeddingNodeId) {
        expect(graphJson[parameters.characterEmbeddingNodeId]).toBeDefined();
      }
      if (parameters.cameraMotionNodeId) {
        expect(graphJson[parameters.cameraMotionNodeId]).toBeDefined();
      }
    }
  });

  it("verifies cinematic hero recipe has IP-Adapter and CameraCtrl conditioning", () => {
    const hero = CINEMATIC_HERO_RECIPE;
    expect(hero.category).toBe("cinematic");
    expect(hero.graphJson.node_ip_adapter.class_type).toBe("IPAdapterApplyFaceID");
    expect(hero.graphJson.node_camera_ctrl.class_type).toBe("CameraCtrlPoseInterpolation");
  });

  it("structures take workflow snapshots with cached node telemetry", () => {
    const snapshot: TakeWorkflowSnapshot = {
      templateId: CINEMATIC_HERO_RECIPE.id,
      resolvedGraphJson: CINEMATIC_HERO_RECIPE.graphJson,
      cachedNodes: ["node_keyframe_loader", "node_ip_adapter"],
      executionTimeMs: 1420,
      engine: "comfyui",
    };

    expect(snapshot.cachedNodes).toContain("node_ip_adapter");
    expect(snapshot.engine).toBe("comfyui");
  });
});
