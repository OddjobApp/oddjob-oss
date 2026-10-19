import { z } from "zod";

/**
 * Socket data types supported by Oddjob Native ComfyUI Adapter Nodes.
 */
export type OddjobNodeSocketType =
  | "STRING"
  | "INT"
  | "FLOAT"
  | "BOOLEAN"
  | "IMAGE"
  | "LATENT"
  | "AUDIO"
  | "CONDITIONING"
  | "ONTOLOGY_REF"
  | "TRACEPARENT";

export interface OddjobNodeSocket {
  name: string;
  type: OddjobNodeSocketType;
  description: string;
  required?: boolean;
  defaultValue?: any;
}

export interface OddjobAdapterNodeSpec {
  classType: string;
  displayName: string;
  category: "Oddjob/Continuity" | "Oddjob/Narrative" | "Oddjob/Motion" | "Oddjob/Governance" | "Oddjob/Catalog";
  description: string;
  inputs: Record<string, OddjobNodeSocket>;
  outputs: Record<string, OddjobNodeSocket>;
  oddjobBadge: string;
}

/**
 * 1. Oddjob_CharacterAdapter: Ingests Character Ontology anchor and outputs face tensor and LoRA styling.
 */
export const ODDJOB_CHARACTER_ADAPTER_SPEC: OddjobAdapterNodeSpec = {
  classType: "Oddjob_CharacterAdapter",
  displayName: "Oddjob Character Continuity Adapter",
  category: "Oddjob/Continuity",
  description: "Resolves canonical character identity from Oddjob Knowledge Graph and outputs face conditioning and styling prompts.",
  oddjobBadge: "Ontology Anchor",
  inputs: {
    characterId: { name: "characterId", type: "STRING", description: "Ontology entity identifier (e.g. char_elena)", required: true },
    faceWeight: { name: "faceWeight", type: "FLOAT", description: "IP-Adapter face injection strength (0.0 - 1.0)", defaultValue: 0.85 },
    expressionMode: { name: "expressionMode", type: "STRING", description: "Target facial expression / emotion", defaultValue: "neutral" },
  },
  outputs: {
    faceImage: { name: "faceImage", type: "IMAGE", description: "Canonical face reference keyframe image" },
    characterPrompt: { name: "characterPrompt", type: "STRING", description: "Injected visual appearance tokens and LoRA trigger words" },
    conditioning: { name: "conditioning", type: "CONDITIONING", description: "Adapted character CLIP embedding" },
  },
};

/**
 * 2. Oddjob_ScribeSceneAdapter: Pulls scene headings, camera cues, and dialogue audio stems from Scribe Studio.
 */
export const ODDJOB_SCRIBE_SCENE_ADAPTER_SPEC: OddjobAdapterNodeSpec = {
  classType: "Oddjob_ScribeSceneAdapter",
  displayName: "Oddjob Scribe Scene Adapter",
  category: "Oddjob/Narrative",
  description: "Ingests Scribe Studio script stations, extracting visual sluglines, camera framing, and dialogue audio stems.",
  oddjobBadge: "Scribe Manuscript",
  inputs: {
    documentId: { name: "documentId", type: "STRING", description: "Scribe manuscript document ID", required: true },
    stationKey: { name: "stationKey", type: "STRING", description: "Scribe script scene / station key", required: true },
    shotNumber: { name: "shotNumber", type: "INT", description: "Script shot index [SHOT n]", defaultValue: 1 },
  },
  outputs: {
    visualPrompt: { name: "visualPrompt", type: "STRING", description: "Compiled scene description and atmospheric lighting cues" },
    cameraCue: { name: "cameraCue", type: "STRING", description: "Extracted camera movement direction" },
    dialogueAudio: { name: "dialogueAudio", type: "AUDIO", description: "Synchronized dialogue audio stem for lip-sync" },
    targetDuration: { name: "targetDuration", type: "FLOAT", description: "Suggested shot duration in seconds" },
  },
};

/**
 * 3. Oddjob_CameraMotionAdapter: Maps human director terminology into 3D camera pose trajectories.
 */
export const ODDJOB_CAMERA_MOTION_ADAPTER_SPEC: OddjobAdapterNodeSpec = {
  classType: "Oddjob_CameraMotionAdapter",
  displayName: "Oddjob Camera Motion Adapter",
  category: "Oddjob/Motion",
  description: "Translates human director instructions (Orbit, Pan, Tilt, Dolly) into CameraCtrl / AnimateDiff pose tensors.",
  oddjobBadge: "Director Camera",
  inputs: {
    motionType: { name: "motionType", type: "STRING", description: "Director camera instruction (e.g. Orbit Left 45°)", defaultValue: "Static" },
    speed: { name: "speed", type: "FLOAT", description: "Camera movement velocity scalar", defaultValue: 1.0 },
    smoothing: { name: "smoothing", type: "FLOAT", description: "Trajectory ease-in/ease-out dampening factor", defaultValue: 0.5 },
  },
  outputs: {
    cameraCtrlPose: { name: "cameraCtrlPose", type: "CONDITIONING", description: "Interpolated camera trajectory conditioning tensor" },
  },
};

/**
 * 4. Oddjob_HILGateAdapter: Deterministic pre-execution gate checking budget ceilings and W3C trace contexts.
 */
export const ODDJOB_HIL_GATE_ADAPTER_SPEC: OddjobAdapterNodeSpec = {
  classType: "Oddjob_HILGateAdapter",
  displayName: "Oddjob HIL Governance Gate",
  category: "Oddjob/Governance",
  description: "Enforces production budget limits, records W3C distributed tracing context, and gates generation on human review.",
  oddjobBadge: "HIL Governance",
  inputs: {
    latentInput: { name: "latentInput", type: "LATENT", description: "Generated latent tensor prior to final decode", required: true },
    productionId: { name: "productionId", type: "STRING", description: "Film production project identifier", required: true },
    costLimitUsd: { name: "costLimitUsd", type: "FLOAT", description: "Maximum allowed generation cost", defaultValue: 15.0 },
    traceparent: { name: "traceparent", type: "TRACEPARENT", description: "W3C distributed trace context" },
  },
  outputs: {
    governedLatent: { name: "governedLatent", type: "LATENT", description: "Approved latent tensor released for VAE decoding" },
    approvalStatus: { name: "approvalStatus", type: "STRING", description: "Approval decision (auto_approved | hil_cleared)" },
  },
};

/**
 * 5. Oddjob_DatasetSinkAdapter: Catalogs generated video latents, prompts, and hashes into Oddjob Knowledge Datasets.
 */
export const ODDJOB_DATASET_SINK_ADAPTER_SPEC: OddjobAdapterNodeSpec = {
  classType: "Oddjob_DatasetSinkAdapter",
  displayName: "Oddjob Knowledge Dataset Sink",
  category: "Oddjob/Catalog",
  description: "Automatically indexes rendered take video, SHA-256 node hashes, and aesthetic tags into Oddjob Datasets for semantic search.",
  oddjobBadge: "Knowledge Garden",
  inputs: {
    videoFile: { name: "videoFile", type: "STRING", description: "Path or URL to the rendered video file", required: true },
    promptSnapshot: { name: "promptSnapshot", type: "STRING", description: "Full prompt and seed configuration" },
    datasetCollection: { name: "datasetCollection", type: "STRING", description: "Oddjob Dataset collection name", defaultValue: "media_takes_catalog" },
    tags: { name: "tags", type: "STRING", description: "Comma-separated aesthetic and scene tags" },
  },
  outputs: {
    datasetUrn: { name: "datasetUrn", type: "STRING", description: "Unique Oddjob Knowledge Garden asset URN" },
    indexedStatus: { name: "indexedStatus", type: "STRING", description: "Cataloging and vector embedding status" },
  },
};

export const ODDJOB_ADAPTER_NODE_SPECS = {
  Oddjob_CharacterAdapter: ODDJOB_CHARACTER_ADAPTER_SPEC,
  Oddjob_ScribeSceneAdapter: ODDJOB_SCRIBE_SCENE_ADAPTER_SPEC,
  Oddjob_CameraMotionAdapter: ODDJOB_CAMERA_MOTION_ADAPTER_SPEC,
  Oddjob_HILGateAdapter: ODDJOB_HIL_GATE_ADAPTER_SPEC,
  Oddjob_DatasetSinkAdapter: ODDJOB_DATASET_SINK_ADAPTER_SPEC,
} as const;

export type OddjobAdapterClassType = keyof typeof ODDJOB_ADAPTER_NODE_SPECS;
