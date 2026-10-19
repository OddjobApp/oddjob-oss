import { describe, it, expect } from "vitest";
import {
  ODDJOB_ADAPTER_NODE_SPECS,
  ODDJOB_CHARACTER_ADAPTER_SPEC,
  ODDJOB_SCRIBE_SCENE_ADAPTER_SPEC,
  ODDJOB_CAMERA_MOTION_ADAPTER_SPEC,
  ODDJOB_HIL_GATE_ADAPTER_SPEC,
  ODDJOB_DATASET_SINK_ADAPTER_SPEC,
} from "./media-adapter-nodes";

describe("Oddjob Native Adapter Node Specs", () => {
  it("contains all 5 core platform adapter nodes", () => {
    const keys = Object.keys(ODDJOB_ADAPTER_NODE_SPECS);
    expect(keys).toHaveLength(5);
    expect(keys).toContain("Oddjob_CharacterAdapter");
    expect(keys).toContain("Oddjob_ScribeSceneAdapter");
    expect(keys).toContain("Oddjob_CameraMotionAdapter");
    expect(keys).toContain("Oddjob_HILGateAdapter");
    expect(keys).toContain("Oddjob_DatasetSinkAdapter");
  });

  it("CharacterAdapter specifies Ontology face inputs and conditioning outputs", () => {
    expect(ODDJOB_CHARACTER_ADAPTER_SPEC.inputs.characterId.required).toBe(true);
    expect(ODDJOB_CHARACTER_ADAPTER_SPEC.outputs.faceImage.type).toBe("IMAGE");
    expect(ODDJOB_CHARACTER_ADAPTER_SPEC.outputs.conditioning.type).toBe("CONDITIONING");
    expect(ODDJOB_CHARACTER_ADAPTER_SPEC.oddjobBadge).toBe("Ontology Anchor");
  });

  it("ScribeSceneAdapter specifies narrative station inputs and audio stem outputs", () => {
    expect(ODDJOB_SCRIBE_SCENE_ADAPTER_SPEC.inputs.documentId.required).toBe(true);
    expect(ODDJOB_SCRIBE_SCENE_ADAPTER_SPEC.inputs.stationKey.required).toBe(true);
    expect(ODDJOB_SCRIBE_SCENE_ADAPTER_SPEC.outputs.dialogueAudio.type).toBe("AUDIO");
    expect(ODDJOB_SCRIBE_SCENE_ADAPTER_SPEC.outputs.visualPrompt.type).toBe("STRING");
  });

  it("HILGateAdapter specifies budget ceiling and W3C traceparent inputs", () => {
    expect(ODDJOB_HIL_GATE_ADAPTER_SPEC.inputs.productionId.required).toBe(true);
    expect(ODDJOB_HIL_GATE_ADAPTER_SPEC.inputs.traceparent.type).toBe("TRACEPARENT");
    expect(ODDJOB_HIL_GATE_ADAPTER_SPEC.outputs.governedLatent.type).toBe("LATENT");
  });

  it("DatasetSinkAdapter specifies dataset collection and catalog URN", () => {
    expect(ODDJOB_DATASET_SINK_ADAPTER_SPEC.inputs.videoFile.required).toBe(true);
    expect(ODDJOB_DATASET_SINK_ADAPTER_SPEC.inputs.datasetCollection.defaultValue).toBe("media_takes_catalog");
    expect(ODDJOB_DATASET_SINK_ADAPTER_SPEC.outputs.datasetUrn.type).toBe("STRING");
  });
});
