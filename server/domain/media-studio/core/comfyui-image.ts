import { randomUUID } from "node:crypto";
import type { MediaAspectRatio } from "@shared/media-studio.js";
import { ImageGenerationError, type GeneratedImage, type ImageGenerator, type ReferenceImage } from "./gemini-image.js";

const NOT_CONFIGURED = "ComfyUI is not configured on this platform (no COMFYUI_BASE_URL), so nothing was rendered.";

/** Optimal resolutions for SDXL based on aspect ratio */
export const COMFY_ASPECT_RATIO_DIMENSIONS: Record<MediaAspectRatio, { width: number; height: number }> = {
    "16:9": { width: 1344, height: 768 },
    "9:16": { width: 768, height: 1344 },
    "2.39:1": { width: 1536, height: 640 },
    "4:3": { width: 1152, height: 864 },
    "1:1": { width: 1024, height: 1024 },
};

export interface ComfyUIImageGeneratorOptions {
    baseUrl?: string;
    model?: string;
    costCents?: number;
    fetch?: typeof fetch;
}

export function createComfyUIImageGenerator(options: ComfyUIImageGeneratorOptions = {}): ImageGenerator {
    // No localhost fallback — see createComfyUIProvider. With one, `configured` is always
    // true, so the unreachable-server check below never throws and a keyframe request is
    // accepted, stored as `rendering`, and then fails silently in the background.
    const baseUrl = (options.baseUrl ?? process.env.COMFYUI_BASE_URL ?? "").trim().replace(/\/+$/, "");
    const fromEnv = Number(process.env.COMFYUI_IMAGE_COST_CENTS);
    const estimatedCostCents = options.costCents ?? (Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 0);
    const send = options.fetch ?? fetch;

    const call = async (path: string, init: RequestInit = {}, billed = false): Promise<Response> => {
        if (!baseUrl) throw new ImageGenerationError(NOT_CONFIGURED, false);
        try {
            return await send(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(path.startsWith("/view") ? 180_000 : 30_000) });
        } catch (error) {
            throw new ImageGenerationError(`ComfyUI at ${baseUrl} could not be reached: ${(error as Error)?.message ?? error}`, billed);
        }
    };

    const read = async (response: Response, what: string, billed: boolean): Promise<any> => {
        if (!response.ok) {
            const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
            throw new ImageGenerationError(`ComfyUI ${what} failed (${response.status})${detail ? `: ${detail}` : ""}`, billed);
        }
        return response.json();
    };

    const getAvailableCheckpoints = async (): Promise<string[]> => {
        const info = (await read(await call("/object_info"), "listing nodes", false)) as Record<string, any>;
        const ckpts = (info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] as string[]) ?? [];
        return ckpts;
    };

    return {
        configured: Boolean(baseUrl),
        // Namespaced, always. The service reads `generator.model` to decide whether a
        // keyframe row says it came from ComfyUI or from Gemini, so a bare checkpoint
        // filename here (COMFYUI_IMAGE_MODEL=sd_xl_base_1.0.safetensors) stamped every
        // locally rendered still as "gemini". The checkpoint itself is resolved in
        // generate(), which needs the bare name.
        model: `comfyui:${options.model ?? process.env.COMFYUI_IMAGE_MODEL ?? "sdxl"}`,
        estimatedCostCents,

        async generate(prompt: string, aspectRatio: MediaAspectRatio, references: ReferenceImage[] = []): Promise<GeneratedImage> {
            if (!baseUrl) throw new ImageGenerationError(NOT_CONFIGURED, false);

            let checkpointName = options.model ?? process.env.COMFYUI_IMAGE_MODEL;
            if (!checkpointName) {
                const available = await getAvailableCheckpoints();
                checkpointName = available[0];
            }

            if (!checkpointName) {
                throw new ImageGenerationError("No checkpoint found in ComfyUI models/checkpoints. Place an SDXL checkpoint in ComfyUI to render keyframes locally.", false);
            }

            const dims = COMFY_ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? { width: 1024, height: 1024 };
            const isTurboOrLightning = /turbo|lightning|fast/i.test(checkpointName);
            const steps = isTurboOrLightning ? 8 : 25;
            const cfg = isTurboOrLightning ? 2.0 : 7.0;

            let uploadedRefName: string | null = null;
            if (references.length > 0) {
                const ref = references[0];
                const ext = ref.mimeType === "image/png" ? "png" : ref.mimeType === "image/webp" ? "webp" : "jpg";
                const form = new FormData();
                form.append("image", new Blob([ref.content], { type: ref.mimeType }), `ref-${randomUUID()}.${ext}`);
                form.append("type", "input");
                form.append("overwrite", "true");
                const uploadBody = await read(await call("/upload/image", { method: "POST", body: form }), "reference upload", false);
                if (uploadBody?.name) {
                    uploadedRefName = uploadBody.subfolder ? `${uploadBody.subfolder}/${uploadBody.name}` : String(uploadBody.name);
                }
            }

            // Build ComfyUI DAG
            const graph: Record<string, any> = {
                "4": {
                    class_type: "CheckpointLoaderSimple",
                    inputs: { ckpt_name: checkpointName },
                },
                "6": {
                    class_type: "CLIPTextEncode",
                    inputs: { clip: ["4", 1], text: prompt },
                },
                "7": {
                    class_type: "CLIPTextEncode",
                    inputs: { clip: ["4", 1], text: "blurry, low quality, distorted, bad anatomy, deformed, watermark, signature, text overlays" },
                },
                "8": {
                    class_type: "VAEDecode",
                    inputs: { samples: ["3", 0], vae: ["4", 2] },
                },
                "9": {
                    class_type: "SaveImage",
                    inputs: { filename_prefix: "keyframes/Oddjob", images: ["8", 0] },
                },
            };

            if (uploadedRefName) {
                // Character anchor / reference image variation
                graph["10"] = {
                    class_type: "LoadImage",
                    inputs: { image: uploadedRefName },
                };
                graph["11"] = {
                    class_type: "VAEEncode",
                    inputs: { pixels: ["10", 0], vae: ["4", 2] },
                };
                graph["3"] = {
                    class_type: "KSampler",
                    inputs: {
                        model: ["4", 0],
                        positive: ["6", 0],
                        negative: ["7", 0],
                        latent_image: ["11", 0],
                        seed: Math.floor(Math.random() * 2 ** 31),
                        steps,
                        cfg,
                        sampler_name: "euler",
                        scheduler: "normal",
                        denoise: 0.7,
                    },
                };
            } else {
                graph["5"] = {
                    class_type: "EmptyLatentImage",
                    inputs: { width: dims.width, height: dims.height, batch_size: 1 },
                };
                graph["3"] = {
                    class_type: "KSampler",
                    inputs: {
                        model: ["4", 0],
                        positive: ["6", 0],
                        negative: ["7", 0],
                        latent_image: ["5", 0],
                        seed: Math.floor(Math.random() * 2 ** 31),
                        steps,
                        cfg,
                        sampler_name: "euler",
                        scheduler: "normal",
                        denoise: 1.0,
                    },
                };
            }

            const promptResponse = await call("/prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: graph, client_id: "oddjob-media-engine" }),
            });
            const promptBody = await read(promptResponse, "queuing keyframe", false);
            const promptId = promptBody?.prompt_id;
            if (!promptId) throw new ImageGenerationError("ComfyUI did not return a prompt_id for keyframe render.", false);

            const start = Date.now();
            const timeoutMs = 600_000;
            while (Date.now() - start < timeoutMs) {
                await new Promise((r) => setTimeout(r, 1000));
                const historyRes = await read(await call(`/history/${encodeURIComponent(promptId)}`, {}, false), "checking history", false);
                const entry = historyRes?.[promptId];
                if (entry) {
                    if (entry.status?.status_str === "error") {
                        const messages = entry.status?.messages;
                        const execErr = Array.isArray(messages) ? messages.find((m: any) => m[0] === "execution_error") : null;
                        const detail = execErr?.[1]?.exception_message ? `: ${execErr[1].exception_message}` : "";
                        throw new ImageGenerationError(`ComfyUI failed during keyframe generation${detail}.`, false);
                    }
                    if (entry.status?.completed || entry.status?.status_str === "success") {
                        const outputs = entry.outputs ?? {};
                        for (const nodeOutput of Object.values<any>(outputs)) {
                            const images = nodeOutput?.images;
                            if (Array.isArray(images) && images.length > 0) {
                                const img = images[0];
                                const query = new URLSearchParams({
                                    filename: String(img.filename),
                                    subfolder: String(img.subfolder ?? ""),
                                    type: String(img.type ?? "output"),
                                });
                                const imageRes = await call(`/view?${query}`, {}, false);
                                if (!imageRes.ok) throw new ImageGenerationError("Failed to download generated keyframe from ComfyUI.", false);
                                const content = Buffer.from(await imageRes.arrayBuffer());
                                return {
                                    mimeType: "image/png",
                                    content,
                                    model: `comfyui:${checkpointName}`,
                                };
                            }
                        }
                    }
                }
            }
            throw new ImageGenerationError("ComfyUI timed out generating keyframe.", false);
        },
    };
}
