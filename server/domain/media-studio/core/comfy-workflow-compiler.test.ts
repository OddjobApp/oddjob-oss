// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  compileShotWorkflow,
  normalizeCameraMotion,
  computeNodeHash,
} from "./comfy-workflow-compiler";
import { CINEMATIC_HERO_RECIPE, PREVIZ_ANIMATIC_RECIPE } from "@shared/media-studio";

describe("ComfyUI Workflow Compiler", () => {
  it("compiles cinematic hero shot with prompt, seed, keyframe and camera motion", () => {
    const compiled = compileShotWorkflow({
      template: CINEMATIC_HERO_RECIPE,
      prompt: "Elena runs across the neon rooftop",
      negativePrompt: "low quality, bad anatomy",
      seed: 987654,
      cameraMotion: "Dolly in fast",
      referenceKeyframeUrl: "https://storage.oddjob.ai/assets/keyframe_01.png",
      characterFaceIdUrl: "https://storage.oddjob.ai/assets/elena_face.png",
    });

    expect(compiled.engine).toBe("comfyui");
    expect(compiled.templateId).toBe(CINEMATIC_HERO_RECIPE.id);

    const graph = compiled.promptPayload;
    expect(graph.node_positive_prompt.inputs.text).toBe("Elena runs across the neon rooftop");
    expect(graph.node_negative_prompt.inputs.text).toBe("low quality, bad anatomy");
    expect(graph.node_sampler.inputs.seed).toBe(987654);
    expect(graph.node_keyframe_loader.inputs.image).toBe("https://storage.oddjob.ai/assets/keyframe_01.png");
    expect(graph.node_camera_ctrl.inputs.motion_type).toBe("zoom_in");
    expect(graph.node_camera_ctrl.inputs.speed).toBe(1.2);
    expect(graph.node_ip_adapter.inputs.face_image).toBe("https://storage.oddjob.ai/assets/elena_face.png");

    expect(compiled.nodeHashes.node_positive_prompt).toBeDefined();
    expect(compiled.estimatedSteps).toBe(30);
  });

  it("normalizes diverse camera motion directions", () => {
    expect(normalizeCameraMotion("Pan Left slowly")).toEqual({ motion_type: "pan_left", speed: 1.0 });
    expect(normalizeCameraMotion("Camera Tilt Up")).toEqual({ motion_type: "tilt_up", speed: 1.0 });
    expect(normalizeCameraMotion("Smooth Orbit")).toEqual({ motion_type: "orbit_clockwise", speed: 1.1 });
    expect(normalizeCameraMotion("Handheld shaky cam")).toEqual({ motion_type: "handheld_jitter", speed: 0.8 });
    expect(normalizeCameraMotion("Static locked-off shot")).toEqual({ motion_type: "static", speed: 1.0 });
    expect(normalizeCameraMotion(null)).toEqual({ motion_type: "static", speed: 1.0 });
  });

  it("computes deterministic node hashes", () => {
    const node1 = { class_type: "KSampler", inputs: { steps: 20, seed: 100 } };
    const node2 = { class_type: "KSampler", inputs: { steps: 20, seed: 100 } };
    const node3 = { class_type: "KSampler", inputs: { steps: 25, seed: 100 } };

    const hash1 = computeNodeHash("node_sampler", node1);
    const hash2 = computeNodeHash("node_sampler", node2);
    const hash3 = computeNodeHash("node_sampler", node3);

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  it("injects Oddjob Native Adapter Nodes and compiles X-Ray specs", () => {
    const compiled = compileShotWorkflow({
      template: CINEMATIC_HERO_RECIPE,
      prompt: "Elena meets Silas inside the cybernetic workshop",
      documentId: "doc_screenplay_1",
      stationKey: "station_scene_2",
      shotNumber: 3,
      characterAnchorId: "char_elena",
      characterFaceIdUrl: "https://storage.oddjob.ai/assets/elena_face.png",
      cameraMotion: "Orbit Left",
      costLimitUsd: 12.5,
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });

    const graph = compiled.promptPayload;
    expect(graph.oddjob_scribe_adapter).toBeDefined();
    expect(graph.oddjob_scribe_adapter.inputs.stationKey).toBe("station_scene_2");

    expect(graph.oddjob_character_adapter).toBeDefined();
    expect(graph.oddjob_character_adapter.inputs.characterId).toBe("char_elena");

    expect(graph.oddjob_hil_gate).toBeDefined();
    expect(graph.oddjob_hil_gate.inputs.costLimitUsd).toBe(12.5);
    expect(graph.oddjob_hil_gate.inputs.traceparent).toContain("4bf92f3577b34da6a3ce929d0e0e4736");

    expect(graph.oddjob_dataset_sink).toBeDefined();

    // Verify X-Ray specs
    expect(compiled.xraySpecs.length).toBeGreaterThan(5);
    const charXray = compiled.xraySpecs.find((x) => x.nodeId === "oddjob_character_adapter");
    expect(charXray).toBeDefined();
    expect(charXray?.oddjobBadge).toBe("Ontology Anchor");
    expect(charXray?.fingerprint).toBeDefined();
  });
});
