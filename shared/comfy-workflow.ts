/**
 * A ComfyUI workflow imported into a production, and what a take fills in.
 *
 * The graph is kept exactly as ComfyUI exports it in API format (Workflow → Export
 * (API)): node id → { class_type, inputs }, where an input is a value or a link
 * [nodeId, outputIndex]. A take sets only the inputs the mapping names: the prompt,
 * the negative prompt, the seeds, the start and end images, and the number of frames.
 * Everything else (models, sampler, the node that saves the video) renders as exported.
 */

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export type ComfyGraph = Record<string, ComfyNode>;

export interface ComfyInputRef {
  nodeId: string;
  input: string;
}

export interface ComfyMapping {
  prompt: ComfyInputRef;
  negativePrompt: ComfyInputRef | null;
  /** Every sampler seed, set to the take's seed. */
  seeds: ComfyInputRef[];
  startImage: ComfyInputRef | null;
  endImage: ComfyInputRef | null;
  frames: ComfyInputRef | null;
}

export interface ComfyWorkflow {
  name: string;
  graph: ComfyGraph;
  mapping: ComfyMapping;
  /** Frames a second the workflow saves at: a shot's length becomes frames at this rate. */
  fps: number;
}

/** A workflow as the studio shows it, without the graph itself. */
export interface ComfyWorkflowSummary {
  name: string;
  nodeCount: number;
  nodeTypes: string[];
  mapping: ComfyMapping;
  fps: number;
}

/** Nodes that save a video file: ComfyUI's own, and Video Helper Suite's. */
export const COMFY_VIDEO_OUTPUT_NODES = ["SaveVideo", "SaveWEBM", "VHS_VideoCombine"] as const;

const EXPORT_HINT = "Export the workflow from ComfyUI with Workflow → Export (API) and import that file.";
const isLink = (value: unknown): value is [string, number] => Array.isArray(value) && value.length === 2 && typeof value[0] === "string";
const byId = (a: string, b: string) => (Number(a) - Number(b)) || a.localeCompare(b);
const titleOf = (node: ComfyNode) => (node._meta?.title ?? "").toLowerCase();

/** A workflow graph from an API export, or why it is not one. */
export function parseComfyGraph(input: unknown): { graph: ComfyGraph; error?: undefined } | { graph?: undefined; error: string } {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { error: `That is not JSON. ${EXPORT_HINT}` };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `That is not a ComfyUI workflow. ${EXPORT_HINT}` };
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.nodes) && Array.isArray(record.links)) {
    return { error: "This is ComfyUI's editor format. Export the workflow with Workflow → Export (API) instead, and import that file." };
  }
  const entries = Object.entries(record);
  if (!entries.length) return { error: "The workflow has no nodes." };
  const graph: ComfyGraph = {};
  for (const [id, raw] of entries) {
    const node = raw as Partial<ComfyNode> | null;
    if (!node || typeof node !== "object" || typeof node.class_type !== "string" || !node.inputs || typeof node.inputs !== "object" || Array.isArray(node.inputs)) {
      return { error: `Node ${id} is not a ComfyUI node: it needs a class_type and inputs. ${EXPORT_HINT}` };
    }
    graph[id] = {
      class_type: node.class_type,
      inputs: { ...node.inputs },
      ...(node._meta?.title ? { _meta: { title: String(node._meta.title) } } : {}),
    };
  }
  return { graph };
}

/**
 * Which inputs a take fills in, found in the graph. The sampler's positive and negative
 * links say which text is which; titles and order decide otherwise. Problems say what
 * the workflow lacks before it can render a take.
 */
export function detectComfyMapping(graph: ComfyGraph): { mapping: ComfyMapping | null; fps: number; problems: string[] } {
  const ids = Object.keys(graph).sort(byId);
  const problems: string[] = [];

  const linkedAs = (name: string) => new Set(ids.flatMap((id) => {
    const value = graph[id].inputs[name];
    return isLink(value) ? [value[0]] : [];
  }));
  const textNodes = ids.filter((id) => typeof graph[id].inputs.text === "string");
  const positives = linkedAs("positive");
  const negatives = linkedAs("negative");
  const negativeId = textNodes.find((id) => negatives.has(id)) ?? textNodes.find((id) => titleOf(graph[id]).includes("negative")) ?? null;
  const promptId = textNodes.find((id) => positives.has(id) && id !== negativeId)
    ?? textNodes.find((id) => id !== negativeId && /positive|prompt/.test(titleOf(graph[id])))
    ?? textNodes.find((id) => id !== negativeId)
    ?? null;
  if (!promptId) problems.push("No prompt was found: the workflow needs a text encoder, such as CLIPTextEncode, with its prompt written in.");

  const seeds = ids.flatMap((id) => ["seed", "noise_seed"]
    .filter((input) => typeof graph[id].inputs[input] === "number")
    .map((input) => ({ nodeId: id, input })));

  const images = ids.filter((id) => graph[id].class_type === "LoadImage" && typeof graph[id].inputs.image === "string");
  const endId = images.find((id) => /\b(end|last|final)\b/.test(titleOf(graph[id]))) ?? (images.length > 1 ? images[1] : null);
  const startId = images.find((id) => id !== endId) ?? null;

  const frames = ids.flatMap((id) => ["length", "num_frames", "frame_count", "video_frames"]
    .filter((input) => typeof graph[id].inputs[input] === "number")
    .map((input) => ({ nodeId: id, input })))[0] ?? null;

  const outputs = ids.filter((id) => (COMFY_VIDEO_OUTPUT_NODES as readonly string[]).includes(graph[id].class_type));
  if (!outputs.length) problems.push("No video is saved: the workflow needs a SaveVideo, SaveWEBM or VHS_VideoCombine node.");
  const rate = ids.map((id) => graph[id].inputs.fps ?? graph[id].inputs.frame_rate).find((value) => typeof value === "number" && value > 0);

  return {
    mapping: promptId
      ? {
        prompt: { nodeId: promptId, input: "text" },
        negativePrompt: negativeId ? { nodeId: negativeId, input: "text" } : null,
        seeds,
        startImage: startId ? { nodeId: startId, input: "image" } : null,
        endImage: endId ? { nodeId: endId, input: "image" } : null,
        frames,
      }
      : null,
    fps: typeof rate === "number" ? rate : 24,
    problems,
  };
}

export const comfyNodeTypes = (graph: ComfyGraph) => [...new Set(Object.values(graph).map((node) => node.class_type))].sort();

export const summarizeComfyWorkflow = (workflow: ComfyWorkflow): ComfyWorkflowSummary => ({
  name: workflow.name,
  nodeCount: Object.keys(workflow.graph).length,
  nodeTypes: comfyNodeTypes(workflow.graph),
  mapping: workflow.mapping,
  fps: workflow.fps,
});

/**
 * A length in seconds as frames at the workflow's rate. When the exported count is one
 * more than a multiple of 8 or 4 (as Wan's and LTX's are), the result keeps that step.
 */
export function comfyFrameCount(workflow: ComfyWorkflow, durationSeconds: number): number | null {
  const ref = workflow.mapping.frames;
  if (!ref) return null;
  const exported = workflow.graph[ref.nodeId]?.inputs[ref.input];
  const wanted = Math.max(1, Math.round(durationSeconds * workflow.fps));
  for (const step of [8, 4]) {
    if (typeof exported === "number" && exported > step && (exported - 1) % step === 0) {
      return step * Math.max(1, Math.round((wanted - 1) / step)) + 1;
    }
  }
  return wanted;
}

export interface ComfyTakeInputs {
  prompt: string;
  negativePrompt?: string | null;
  seed: number;
  /** Uploaded file names, as ComfyUI's LoadImage takes them. */
  startImage?: string | null;
  endImage?: string | null;
  durationSeconds: number;
}

/** The workflow's graph with a take's inputs filled in. The imported graph is left as it was. */
export function applyComfyInputs(workflow: ComfyWorkflow, values: ComfyTakeInputs): ComfyGraph {
  const graph: ComfyGraph = JSON.parse(JSON.stringify(workflow.graph));
  const set = (ref: ComfyInputRef | null | undefined, value: unknown) => {
    if (ref && graph[ref.nodeId]) graph[ref.nodeId].inputs[ref.input] = value;
  };
  const { mapping } = workflow;
  set(mapping.prompt, values.prompt);
  const avoid = values.negativePrompt?.trim();
  if (avoid && mapping.negativePrompt) {
    const exported = graph[mapping.negativePrompt.nodeId]?.inputs[mapping.negativePrompt.input];
    set(mapping.negativePrompt, typeof exported === "string" && exported.trim() ? `${exported.trim()}, ${avoid}` : avoid);
  }
  for (const seed of mapping.seeds) set(seed, values.seed);
  if (values.startImage) set(mapping.startImage, values.startImage);
  if (values.endImage) set(mapping.endImage, values.endImage);
  const frames = comfyFrameCount(workflow, values.durationSeconds);
  if (frames != null) set(mapping.frames, frames);

  const activeModel = getComfyModelName(graph) ?? "";
  const isT2V = activeModel.toLowerCase().includes("t2v");
  if (!values.startImage || isT2V) {
    for (const node of Object.values(graph)) {
      if (node.class_type === "WanImageToVideo" && "start_image" in node.inputs) {
        delete node.inputs.start_image;
      }
    }
  }

  return graph;
}

/**
 * Canonical Wan 2.1 Image-to-Video workflow graph in ComfyUI API export format.
 * Ready-to-use default starter template for local ComfyUI servers.
 */
export const DEFAULT_WAN_WORKFLOW_GRAPH: ComfyGraph = {
  "3": { class_type: "KSampler", inputs: { seed: 123, steps: 20, cfg: 6, sampler_name: "uni_pc", scheduler: "simple", denoise: 1, model: ["37", 0], positive: ["50", 0], negative: ["50", 1], latent_image: ["50", 2] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "cinematic shot", clip: ["38", 0] }, _meta: { title: "CLIP Text Encode (Positive Prompt)" } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, static, distorted", clip: ["38", 0] }, _meta: { title: "CLIP Text Encode (Negative Prompt)" } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["39", 0] } },
  "37": { class_type: "UNETLoader", inputs: { unet_name: "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors", weight_dtype: "default" } },
  "38": { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" } },
  "39": { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" } },
  "50": { class_type: "WanImageToVideo", inputs: { width: 832, height: 480, length: 81, batch_size: 1, positive: ["6", 0], negative: ["7", 0], vae: ["39", 0], start_image: ["52", 0] } },
  "52": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "57": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: 16 } },
  "58": { class_type: "SaveVideo", inputs: { video: ["57", 0], filename_prefix: "video/ComfyUI", format: "auto", codec: "auto" } },
};

/** Finds the name of the diffusion model or checkpoint configured in the workflow graph. */
export function getComfyModelName(graph: ComfyGraph): string | null {
  for (const node of Object.values(graph)) {
    if ((node.class_type === "UNETLoader" || node.class_type === "UNETLoaderGGUF") && typeof node.inputs?.unet_name === "string") {
      return node.inputs.unet_name;
    }
    if ((node.class_type === "CheckpointLoaderSimple" || node.class_type === "CheckpointLoader") && typeof node.inputs?.ckpt_name === "string") {
      return node.inputs.ckpt_name;
    }
  }
  return null;
}

/** Returns a clone of the graph with the diffusion model or checkpoint updated to `modelName`. */
export function setComfyModelName(graph: ComfyGraph, modelName: string): ComfyGraph {
  const updated: ComfyGraph = JSON.parse(JSON.stringify(graph));
  for (const node of Object.values(updated)) {
    if (node.class_type === "UNETLoader" || node.class_type === "UNETLoaderGGUF") {
      node.inputs.unet_name = modelName;
    } else if (node.class_type === "CheckpointLoaderSimple" || node.class_type === "CheckpointLoader") {
      node.inputs.ckpt_name = modelName;
    }
  }
  return updated;
}


