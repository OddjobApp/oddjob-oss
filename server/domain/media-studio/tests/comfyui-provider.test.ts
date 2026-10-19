/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { createComfyUIProvider } from "../core/comfyui-provider.js";
import { detectComfyMapping, parseComfyGraph, type ComfyWorkflow } from "@shared/comfy-workflow.js";

const BASE = "http://comfy.test:8188";
const graph = {
  "3": { class_type: "KSampler", inputs: { seed: 1, steps: 20, positive: ["6", 0], negative: ["7", 0], latent_image: ["50", 0] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "placeholder" } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry" } },
  "50": { class_type: "WanImageToVideo", inputs: { length: 81, start_image: ["52", 0] } },
  "52": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "57": { class_type: "CreateVideo", inputs: { images: ["3", 0], fps: 16 } },
  "58": { class_type: "SaveVideo", inputs: { video: ["57", 0] } },
};
const workflow = (): ComfyWorkflow => {
  const parsed = parseComfyGraph(graph).graph!;
  const detected = detectComfyMapping(parsed);
  return { name: "Wan i2v", graph: parsed, mapping: detected.mapping!, fps: detected.fps };
};
const installed = Object.fromEntries(["KSampler", "CLIPTextEncode", "WanImageToVideo", "LoadImage", "CreateVideo", "SaveVideo"].map((name) => [name, {}]));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A ComfyUI server answering by path. */
function server(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.slice(BASE.length);
    calls.push({ path, init });
    const route = Object.keys(routes).find((prefix) => path === prefix || path.startsWith(prefix));
    return route ? routes[route](init) : new Response("not found", { status: 404 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const take = { prompt: "Elena runs", negativePrompt: "text overlays", seed: 42, imageUrl: "oddjob-a.png", endImageUrl: null, durationSeconds: 5, aspectRatio: "16:9", generateAudio: true };

describe("ComfyUI takes", () => {
  it("does nothing without a server, and charges nothing unless told to", async () => {
    const off = createComfyUIProvider({ baseUrl: "" });
    expect(off.configured).toBe(false);
    await expect(off.submit({ ...take, workflow: workflow() })).rejects.toMatchObject({
      billed: false, message: "ComfyUI is not configured on this platform (no COMFYUI_BASE_URL), so nothing was rendered.",
    });
    expect(createComfyUIProvider({ baseUrl: BASE }).estimateCents(5)).toBe(0);
    expect(createComfyUIProvider({ baseUrl: BASE, centsPerSecond: 12 }).estimateCents(5)).toBe(60);
  });

  it("checks the server's nodes, fills in the take and queues the workflow", async () => {
    const comfy = server({ "/object_info": () => json(installed), "/prompt": () => json({ prompt_id: "p-1", number: 3, node_errors: {} }) });
    const provider = createComfyUIProvider({ baseUrl: `${BASE}/`, fetch: comfy.fetch });
    expect(await provider.submit({ ...take, workflow: workflow() })).toEqual({ endpoint: `${BASE}/prompt`, requestId: "p-1" });

    const queued = comfy.calls.find((c) => c.path === "/prompt")!;
    const body = JSON.parse(String(queued.init!.body));
    expect(body.client_id).toMatch(/^oddjob-/);
    expect(body.prompt["6"].inputs.text).toBe("Elena runs");
    expect(body.prompt["7"].inputs.text).toBe("blurry, text overlays");
    expect(body.prompt["3"].inputs.seed).toBe(42);
    expect(body.prompt["52"].inputs.image).toBe("oddjob-a.png");
    expect(body.prompt["50"].inputs.length).toBe(81);
  });

  it("names nodes the server lacks before queueing, and says why ComfyUI refused a workflow", async () => {
    const lacking = server({ "/object_info": () => json({ ...installed, SaveVideo: undefined, WanImageToVideo: undefined }), "/prompt": () => json({ prompt_id: "never" }) });
    const partial = { ...installed } as Record<string, unknown>;
    delete partial.SaveVideo;
    delete partial.WanImageToVideo;
    const missing = server({ "/object_info": () => json(partial), "/prompt": () => json({ prompt_id: "never" }) });
    await expect(createComfyUIProvider({ baseUrl: BASE, fetch: missing.fetch }).submit({ ...take, workflow: workflow() })).rejects.toMatchObject({
      billed: false, message: "ComfyUI is missing these nodes: SaveVideo, WanImageToVideo. Install them on the server, or import a workflow exported from it.",
    });
    expect(missing.calls.some((c) => c.path === "/prompt")).toBe(false);
    expect(lacking.calls).toHaveLength(0);

    const refusing = server({
      "/object_info": () => json(installed),
      "/prompt": () => json({
        error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
        node_errors: { "52": { class_type: "LoadImage", errors: [{ message: "Invalid image file", details: "image - Invalid image file: oddjob-a.png" }] } },
      }, 400),
    });
    await expect(createComfyUIProvider({ baseUrl: BASE, fetch: refusing.fetch }).submit({ ...take, workflow: workflow() })).rejects.toMatchObject({
      billed: false,
      message: "ComfyUI refused the workflow: Prompt outputs failed validation; node 52 (LoadImage): Invalid image file — image - Invalid image file: oddjob-a.png",
    });
  });

  it("uploads a keyframe under the name LoadImage will use", async () => {
    const comfy = server({ "/upload/image": () => json({ name: "oddjob-x.png", subfolder: "media", type: "input" }) });
    expect(await createComfyUIProvider({ baseUrl: BASE, fetch: comfy.fetch }).uploadImage(Buffer.from("png"), "image/png")).toBe("media/oddjob-x.png");
    const form = comfy.calls[0].init!.body as FormData;
    expect(form.get("type")).toBe("input");
    expect((form.get("image") as File).name).toMatch(/^oddjob-.+\.png$/);
  });

  it("follows the prompt through the queue to its saved video, and reports an execution error", async () => {
    let history: unknown = {};
    let queue: unknown = { queue_running: [], queue_pending: [[4, "p-1", {}, {}, []]] };
    const comfy = server({
      "/history/": () => json(history),
      "/queue": () => json(queue),
      "/view": () => new Response(Buffer.from("mp4-bytes")),
    });
    const provider = createComfyUIProvider({ baseUrl: BASE, fetch: comfy.fetch });
    expect(await provider.status(`${BASE}/prompt`, "p-1")).toEqual({ state: "queued" });
    queue = { queue_running: [[4, "p-1", {}, {}, []]], queue_pending: [] };
    expect(await provider.status(`${BASE}/prompt`, "p-1")).toMatchObject({ state: "running" });

    history = { "p-1": { status: { status_str: "success", completed: true, messages: [] }, outputs: { "58": { images: [{ filename: "ComfyUI_00001_.mp4", subfolder: "video", type: "output" }], animated: [true] } } } };
    expect(await provider.status(`${BASE}/prompt`, "p-1")).toEqual({ state: "completed" });
    const result = await provider.result(`${BASE}/prompt`, "p-1");
    expect(result).toEqual({ videoUrl: `${BASE}/view?filename=ComfyUI_00001_.mp4&subfolder=video&type=output`, mimeType: "video/mp4" });
    expect((await provider.download(result.videoUrl)).toString()).toBe("mp4-bytes");
    await expect(provider.download("https://elsewhere.test/view?filename=x.mp4")).rejects.toMatchObject({ message: "The finished video's address is not on the ComfyUI server." });

    history = { "p-1": { status: { status_str: "error", completed: false, messages: [["execution_start", {}], ["execution_error", { node_id: "3", node_type: "KSampler", exception_message: "CUDA out of memory" }]] }, outputs: {} } };
    expect(await provider.status(`${BASE}/prompt`, "p-1")).toEqual({ state: "failed", error: "KSampler node 3: CUDA out of memory" });

    history = { "p-1": { status: { status_str: "success", completed: true }, outputs: { "9": { images: [{ filename: "frame.png", subfolder: "", type: "output" }] } } } };
    await expect(provider.result(`${BASE}/prompt`, "p-1")).rejects.toMatchObject({
      billed: true, message: "ComfyUI finished without saving a video. The workflow must save MP4 or WebM, with SaveVideo, SaveWEBM or VHS_VideoCombine.",
    });
    provider.close();
  });

  it("tracks step progress and computes ETC dynamically", async () => {
    const { ComfyUIProgressTracker } = await import("../core/comfyui-provider.js");
    const tracker = new ComfyUIProgressTracker("");
    tracker.describeNodes("prompt-1", { "3": { class_type: "KSampler", inputs: {} } });
    tracker.updateNode("prompt-1", "3", "3");
    expect(tracker.getProgress("prompt-1")).toMatchObject({
      currentStep: 0,
      totalSteps: 0,
      percent: 0,
      activeNodeId: "3",
      activeNodeTitle: "KSampler",
    });

    tracker.updateStep("prompt-1", 5, 20, "3");
    const p1 = tracker.getProgress("prompt-1");
    expect(p1).toMatchObject({
      currentStep: 5,
      totalSteps: 20,
      percent: 25,
      activeNodeId: "3",
    });
    expect(typeof p1?.etaSeconds).toBe("number");
    expect(typeof p1?.etc).toBe("string");

    tracker.updateStep("prompt-1", 20, 20, "3");
    const p2 = tracker.getProgress("prompt-1");
    expect(p2).toMatchObject({
      currentStep: 20,
      totalSteps: 20,
      percent: 100,
      etaSeconds: 0,
    });
    tracker.close();
  });
    it("names the running node from the graph, not from display_node", async () => {
        // ComfyUI's display_node is another node id, never a title, so a live render
        // read "node 3 3" where the reader should see the sampler's name.
        const { ComfyUIProgressTracker } = await import("../core/comfyui-provider.js");
        const tracker = new ComfyUIProgressTracker("");
        tracker.describeNodes("p1", {
            "3": { class_type: "KSampler", inputs: {} },
            "7": { class_type: "CLIPTextEncode", inputs: {}, _meta: { title: "CLIP Text Encode (Negative Prompt)" } },
        });

        tracker.updateNode("p1", "7", "7");
        expect(tracker.getProgress("p1")?.activeNodeTitle).toBe("CLIP Text Encode (Negative Prompt)");

        tracker.updateStep("p1", 4, 20, "3");
        expect(tracker.getProgress("p1")?.activeNodeTitle).toBe("KSampler");

        // A node the graph does not describe still says something useful.
        tracker.updateStep("p1", 5, 20, "99");
        expect(tracker.getProgress("p1")?.activeNodeTitle).toBe("Node 99");
        tracker.close();
    });

    it("claims no step count for a take that has only just started", async () => {
        const { ComfyUIProgressTracker } = await import("../core/comfyui-provider.js");
        const tracker = new ComfyUIProgressTracker("");
        tracker.markRunning("p2");
        // Not 20: a guessed denominator is a number the server never sent.
        expect(tracker.getProgress("p2")).toMatchObject({ step: 0, totalSteps: 0, percent: 0 });
        expect(tracker.getProgress("p2")?.activeNodeTitle).toBeUndefined();
        tracker.close();
    });
});
