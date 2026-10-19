import { describe, expect, it } from "vitest";
import { applyComfyInputs, comfyFrameCount, comfyNodeTypes, detectComfyMapping, getComfyModelName, parseComfyGraph, setComfyModelName, type ComfyWorkflow } from "./comfy-workflow";

/** Wan 2.1 image-to-video as ComfyUI exports it in API format. */
export const wanGraph = {
  "3": { class_type: "KSampler", inputs: { seed: 123, steps: 20, cfg: 6, sampler_name: "uni_pc", scheduler: "simple", denoise: 1, model: ["37", 0], positive: ["50", 0], negative: ["50", 1], latent_image: ["50", 2] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "a fox in the snow", clip: ["38", 0] }, _meta: { title: "CLIP Text Encode (Positive Prompt)" } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, static", clip: ["38", 0] }, _meta: { title: "CLIP Text Encode (Negative Prompt)" } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["39", 0] } },
  "37": { class_type: "UNETLoader", inputs: { unet_name: "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors", weight_dtype: "default" } },
  "38": { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" } },
  "39": { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" } },
  "50": { class_type: "WanImageToVideo", inputs: { width: 832, height: 480, length: 81, batch_size: 1, positive: ["6", 0], negative: ["7", 0], vae: ["39", 0], start_image: ["52", 0] } },
  "52": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "57": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: 16 } },
  "58": { class_type: "SaveVideo", inputs: { video: ["57", 0], filename_prefix: "video/ComfyUI", format: "auto", codec: "auto" } },
};

const workflowOf = (graph: object, name = "Wan i2v"): ComfyWorkflow => {
  const parsed = parseComfyGraph(graph);
  if (!parsed.graph) throw new Error(parsed.error);
  const detected = detectComfyMapping(parsed.graph);
  return { name, graph: parsed.graph, mapping: detected.mapping!, fps: detected.fps };
};

describe("ComfyUI workflows", () => {
  it("reads an API export, from an object or its JSON, and refuses the editor format", () => {
    expect(parseComfyGraph(wanGraph).graph?.["52"]).toEqual({ class_type: "LoadImage", inputs: { image: "example.png" } });
    expect(parseComfyGraph(JSON.stringify(wanGraph)).graph).toBeDefined();
    expect(parseComfyGraph({ nodes: [], links: [] }).error).toBe("This is ComfyUI's editor format. Export the workflow with Workflow → Export (API) instead, and import that file.");
    expect(parseComfyGraph("{nope").error).toMatch(/^That is not JSON\./);
    expect(parseComfyGraph({ "1": { inputs: {} } }).error).toMatch(/^Node 1 is not a ComfyUI node/);
  });

  it("finds the prompt and negative by the sampler's links, the seed, the start image, the frame count and the rate", () => {
    const { mapping, fps, problems } = detectComfyMapping(parseComfyGraph(wanGraph).graph!);
    expect(problems).toEqual([]);
    expect(fps).toBe(16);
    expect(mapping).toEqual({
      prompt: { nodeId: "6", input: "text" },
      negativePrompt: { nodeId: "7", input: "text" },
      seeds: [{ nodeId: "3", input: "seed" }],
      startImage: { nodeId: "52", input: "image" },
      endImage: null,
      frames: { nodeId: "50", input: "length" },
    });
    expect(comfyNodeTypes(parseComfyGraph(wanGraph).graph!)).toContain("WanImageToVideo");
  });

  it("says what a workflow lacks before it can render a take", () => {
    const { mapping, problems } = detectComfyMapping(parseComfyGraph({ "1": { class_type: "UNETLoader", inputs: { unet_name: "x" } } }).graph!);
    expect(mapping).toBeNull();
    expect(problems).toEqual([
      "No prompt was found: the workflow needs a text encoder, such as CLIPTextEncode, with its prompt written in.",
      "No video is saved: the workflow needs a SaveVideo, SaveWEBM or VHS_VideoCombine node.",
    ]);
  });

  it("counts frames at the workflow's rate, keeping Wan's one-more-than-a-multiple step", () => {
    const wan = workflowOf(wanGraph);
    expect(comfyFrameCount(wan, 5)).toBe(81);
    expect(comfyFrameCount(wan, 4)).toBe(65);
    const plain = workflowOf({ ...wanGraph, "50": { ...wanGraph["50"], inputs: { ...wanGraph["50"].inputs, length: 48 } } });
    expect(comfyFrameCount(plain, 3)).toBe(48);
  });

  it("fills in a take's prompt, negative, seed, image and length without changing the imported graph", () => {
    const wan = workflowOf(wanGraph);
    const graph = applyComfyInputs(wan, { prompt: "Elena runs", negativePrompt: "text overlays", seed: 42, startImage: "oddjob-1.png", durationSeconds: 4 });
    expect(graph["6"].inputs.text).toBe("Elena runs");
    expect(graph["7"].inputs.text).toBe("blurry, static, text overlays");
    expect(graph["3"].inputs.seed).toBe(42);
    expect(graph["52"].inputs.image).toBe("oddjob-1.png");
    expect(graph["50"].inputs.length).toBe(65);
    expect(graph["3"].inputs.model).toEqual(["37", 0]);
    expect(wan.graph["6"].inputs.text).toBe("a fox in the snow");
  });

  it("reads and updates the diffusion model in a workflow graph", () => {
    expect(getComfyModelName(wanGraph)).toBe("wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors");
    const updated = setComfyModelName(wanGraph, "wan2.1_i2v_480p_14B_fp8_scaled.safetensors");
    expect(getComfyModelName(updated)).toBe("wan2.1_i2v_480p_14B_fp8_scaled.safetensors");
    expect(updated["37"].inputs.unet_name).toBe("wan2.1_i2v_480p_14B_fp8_scaled.safetensors");
    // Leaves original untouched
    expect(wanGraph["37"].inputs.unet_name).toBe("wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors");
  });
});

