import crypto from "crypto";
import {
  CINEMATIC_HERO_RECIPE,
  type ComfyWorkflowTemplate,
} from "@shared/media-studio.js";
import { ODDJOB_ADAPTER_NODE_SPECS } from "@shared/media-adapter-nodes.js";

export interface CompileShotWorkflowInput {
  template?: ComfyWorkflowTemplate;
  prompt: string;
  negativePrompt?: string | null;
  seed?: number | null;
  durationSeconds?: number;
  aspectRatio?: string;
  referenceKeyframeUrl?: string | null;
  endKeyframeUrl?: string | null;
  characterFaceIdUrl?: string | null;
  characterAnchorId?: string | null;
  characterOntologyRef?: {
    objectTypeId: string;
    instanceId: string;
    faceKeyframeUrl: string;
  } | null;
  cameraMotion?: string | null;
  documentId?: string | null;
  stationKey?: string | null;
  shotNumber?: number | null;
  traceparent?: string | null;
  costLimitUsd?: number | null;
  productionId?: string | null;
}

export interface XrayNodeSpec {
  nodeId: string;
  classType: string;
  label: string;
  fingerprint: string;
  oddjobBadge?: string;
  dependencies: string[];
}

export interface CompiledWorkflowResult {
  templateId: string;
  engine: "comfyui";
  promptPayload: Record<string, any>;
  nodeHashes: Record<string, string>;
  xraySpecs: XrayNodeSpec[];
  estimatedSteps: number;
}

/**
 * Normalizes camera motion keywords from Scribe script directions into
 * ComfyUI CameraCtrl/Motion parameters.
 */
export function normalizeCameraMotion(rawMotion?: string | null): { motion_type: string; speed: number } {
  if (!rawMotion) return { motion_type: "static", speed: 1.0 };
  const lower = rawMotion.toLowerCase().trim();

  if (lower.includes("pan") && lower.includes("left")) return { motion_type: "pan_left", speed: 1.0 };
  if (lower.includes("pan") && lower.includes("right")) return { motion_type: "pan_right", speed: 1.0 };
  if (lower.includes("tilt") && lower.includes("up")) return { motion_type: "tilt_up", speed: 1.0 };
  if (lower.includes("tilt") && lower.includes("down")) return { motion_type: "tilt_down", speed: 1.0 };
  if (lower.includes("zoom") || lower.includes("push") || lower.includes("dolly")) return { motion_type: "zoom_in", speed: 1.2 };
  if (lower.includes("pull") || lower.includes("back")) return { motion_type: "zoom_out", speed: 1.0 };
  if (lower.includes("orbit")) return { motion_type: "orbit_clockwise", speed: 1.1 };
  if (lower.includes("handheld")) return { motion_type: "handheld_jitter", speed: 0.8 };

  return { motion_type: "static", speed: 1.0 };
}

/**
 * Computes deterministic SHA256 hash of a node's inputs for execution cache tracking.
 */
export function computeNodeHash(nodeId: string, node: { class_type: string; inputs: Record<string, any> }): string {
  const serialized = JSON.stringify({
    nodeId,
    class_type: node.class_type,
    inputs: node.inputs,
  });
  return crypto.createHash("sha256").update(serialized).digest("hex").slice(0, 16);
}

/**
 * Compiles high-level Scribe shot parameters into an execution-ready ComfyUI API graph.
 */
export function compileShotWorkflow(input: CompileShotWorkflowInput): CompiledWorkflowResult {
  const template = input.template ?? CINEMATIC_HERO_RECIPE;
  const graph: Record<string, any> = JSON.parse(JSON.stringify(template.graphJson));
  const params = template.parameters;

  // 1. Positive Prompt
  if (graph[params.promptNodeId]) {
    graph[params.promptNodeId].inputs = {
      ...graph[params.promptNodeId].inputs,
      text: input.prompt,
    };
  }

  // 2. Negative Prompt
  if (params.negativePromptNodeId && graph[params.negativePromptNodeId]) {
    const neg = input.negativePrompt ?? "blurry, distorted, morphing, low quality, artifacts";
    graph[params.negativePromptNodeId].inputs = {
      ...graph[params.negativePromptNodeId].inputs,
      text: neg,
    };
  }

  // 3. Seed
  if (params.seedNodeId && graph[params.seedNodeId]) {
    const seedVal = input.seed != null ? input.seed : Math.floor(Math.random() * 1000000);
    graph[params.seedNodeId].inputs = {
      ...graph[params.seedNodeId].inputs,
      seed: seedVal,
    };
  }

  // 4. Keyframe Image Reference
  if (params.imageInputNodeId && graph[params.imageInputNodeId]) {
    if (input.referenceKeyframeUrl) {
      graph[params.imageInputNodeId].inputs = {
        ...graph[params.imageInputNodeId].inputs,
        image: input.referenceKeyframeUrl,
      };
    }
  }

  // 5. Character Identity / Face Embedding
  if (params.characterEmbeddingNodeId && graph[params.characterEmbeddingNodeId]) {
    if (input.characterFaceIdUrl) {
      graph[params.characterEmbeddingNodeId].inputs = {
        ...graph[params.characterEmbeddingNodeId].inputs,
        face_image: input.characterFaceIdUrl,
        weight: 0.85,
      };
    }
  }

  // 6. Camera Motion
  if (params.cameraMotionNodeId && graph[params.cameraMotionNodeId]) {
    const motion = normalizeCameraMotion(input.cameraMotion);
    graph[params.cameraMotionNodeId].inputs = {
      ...graph[params.cameraMotionNodeId].inputs,
      motion_type: motion.motion_type,
      speed: motion.speed,
    };
  }

  // 7. Inject Oddjob Native Adapter Nodes
  // a) Scribe Scene Adapter
  if (input.documentId || input.stationKey) {
    graph["oddjob_scribe_adapter"] = {
      class_type: ODDJOB_ADAPTER_NODE_SPECS.Oddjob_ScribeSceneAdapter.classType,
      inputs: {
        documentId: input.documentId || "doc_current",
        stationKey: input.stationKey || "station_current",
        shotNumber: input.shotNumber || 1,
      },
    };
  }

  // b) Character Continuity Adapter
  const charId = input.characterAnchorId || input.characterOntologyRef?.instanceId;
  if (charId) {
    graph["oddjob_character_adapter"] = {
      class_type: ODDJOB_ADAPTER_NODE_SPECS.Oddjob_CharacterAdapter.classType,
      inputs: {
        characterId: charId,
        faceWeight: 0.85,
        expressionMode: "neutral",
        faceImage: input.characterFaceIdUrl || input.characterOntologyRef?.faceKeyframeUrl || "",
      },
    };
  }

  // c) Camera Motion Adapter
  if (input.cameraMotion) {
    graph["oddjob_camera_adapter"] = {
      class_type: ODDJOB_ADAPTER_NODE_SPECS.Oddjob_CameraMotionAdapter.classType,
      inputs: {
        motionType: input.cameraMotion,
        speed: 1.0,
      },
    };
  }

  // d) HIL Governance Gate Adapter
  graph["oddjob_hil_gate"] = {
    class_type: ODDJOB_ADAPTER_NODE_SPECS.Oddjob_HILGateAdapter.classType,
    inputs: {
      productionId: input.productionId || "prod_active",
      costLimitUsd: input.costLimitUsd || 15.0,
      traceparent: input.traceparent || `00-${crypto.randomBytes(16).toString("hex")}-${crypto.randomBytes(8).toString("hex")}-01`,
    },
  };

  // e) Dataset Sink Adapter
  graph["oddjob_dataset_sink"] = {
    class_type: ODDJOB_ADAPTER_NODE_SPECS.Oddjob_DatasetSinkAdapter.classType,
    inputs: {
      datasetCollection: "media_takes_catalog",
      promptSnapshot: input.prompt,
      tags: `${input.aspectRatio || "16:9"},${input.cameraMotion || "static"}`,
    },
  };

  // Calculate node hashes and X-Ray specs for cache & architecture tracking
  const nodeHashes: Record<string, string> = {};
  const xraySpecs: XrayNodeSpec[] = [];

  for (const [nodeId, node] of Object.entries(graph)) {
    const hash = computeNodeHash(nodeId, node);
    nodeHashes[nodeId] = hash;

    const isOddjob = typeof node.class_type === "string" && node.class_type.startsWith("Oddjob_");
    const oddjobSpec = isOddjob ? (ODDJOB_ADAPTER_NODE_SPECS as any)[node.class_type] : null;

    xraySpecs.push({
      nodeId,
      classType: node.class_type,
      label: oddjobSpec?.displayName || nodeId.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      fingerprint: hash,
      oddjobBadge: oddjobSpec?.oddjobBadge,
      dependencies: Object.values(node.inputs || {})
        .filter((v) => Array.isArray(v) && typeof v[0] === "string")
        .map((v: any) => v[0]),
    });
  }

  // Estimated sampling steps
  const samplerNode = params.seedNodeId ? graph[params.seedNodeId] : null;
  const estimatedSteps = typeof samplerNode?.inputs?.steps === "number" ? samplerNode.inputs.steps : 25;

  return {
    templateId: template.id,
    engine: "comfyui",
    promptPayload: graph,
    nodeHashes,
    xraySpecs,
    estimatedSteps,
  };
}
