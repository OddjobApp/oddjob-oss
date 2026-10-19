import {
  type VideoProvider,
  type VideoRenderInput,
  type ProviderState,
  VideoProviderError,
} from "./video-provider";
import {
  type VideoResolution,
  VIDEO_RESOLUTIONS,
  type MediaStreamFrameEvent,
  BUILTIN_WORKFLOW_RECIPES,
} from "@shared/media-studio.js";
import { compileShotWorkflow } from "./comfy-workflow-compiler";

export interface ComfyVideoProviderOptions {
  baseUrl?: string;
  wsUrl?: string;
  resolution?: VideoResolution;
  fetch?: typeof fetch;
}

export function createComfyVideoProvider(options: ComfyVideoProviderOptions = {}): VideoProvider & {
  getTemplate(id: string): any;
} {
  const baseUrl = options.baseUrl ?? process.env.COMFYUI_BASE_URL ?? "";
  const resolution: VideoResolution = (VIDEO_RESOLUTIONS as readonly string[]).includes(options.resolution ?? "")
    ? (options.resolution as VideoResolution)
    : "720p";
  const send = options.fetch ?? fetch;

  const centsPerSecond = resolution === "1080p" ? 45.0 : 20.0;

  return {
    name: "comfyui",
    configured: Boolean(baseUrl),
    resolution,
    centsPerSecond,
    estimateCents: (durationSeconds: number) => Math.ceil(durationSeconds * centsPerSecond),
    endpointFor: () => `${baseUrl}/prompt`,

    getTemplate(id: string) {
      return BUILTIN_WORKFLOW_RECIPES.find((r) => r.id === id) ?? BUILTIN_WORKFLOW_RECIPES[0];
    },

    async uploadImage(content: Buffer, mimeType: string): Promise<string> {
      if (!baseUrl) throw new VideoProviderError("ComfyUI server is not configured (COMFYUI_BASE_URL missing).", false);
      const formData = new FormData();
      formData.append("image", new Blob([content], { type: mimeType }), "image.png");
      formData.append("overwrite", "true");

      try {
        const res = await send(`${baseUrl}/upload/image`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error(`Upload failed with status ${res.status}`);
        const data = await res.json();
        return data.name || "image.png";
      } catch (err: any) {
        throw new VideoProviderError(`ComfyUI image upload failed: ${err.message}`, false);
      }
    },

    async submit(input: VideoRenderInput): Promise<{ endpoint: string; requestId: string }> {
      if (!baseUrl) throw new VideoProviderError("ComfyUI server is not configured (COMFYUI_BASE_URL missing).", false);

      const template = BUILTIN_WORKFLOW_RECIPES.find((r) => r.id === (input as any).templateId) ?? BUILTIN_WORKFLOW_RECIPES[0];
      const compiled = compileShotWorkflow({
        template,
        prompt: input.prompt,
        durationSeconds: input.durationSeconds,
        aspectRatio: input.aspectRatio,
        referenceKeyframeUrl: input.imageUrl,
        endKeyframeUrl: input.endImageUrl,
        cameraMotion: (input as any).cameraMotion,
        characterFaceIdUrl: (input as any).characterFaceIdUrl,
        seed: (input as any).seed,
      });

      const clientId = `oddjob_media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        const res = await send(`${baseUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: compiled.promptPayload,
            client_id: clientId,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Status ${res.status}: ${errText}`);
        }

        const data = await res.json();
        return {
          endpoint: `${baseUrl}/prompt`,
          requestId: data.prompt_id,
        };
      } catch (err: any) {
        throw new VideoProviderError(`ComfyUI prompt submission failed: ${err.message}`, false);
      }
    },

    async status(endpoint: string, requestId: string): Promise<{ state: ProviderState; error?: string }> {
      if (!baseUrl) return { state: "failed", error: "ComfyUI not configured" };

      try {
        // 1. Check history
        const histRes = await send(`${baseUrl}/history/${requestId}`);
        if (histRes.ok) {
          const hist = await histRes.json();
          if (hist && hist[requestId]) {
            const task = hist[requestId];
            if (task.status?.status_str === "error" || task.status?.completed === false) {
              return { state: "failed", error: task.status?.messages?.[0] || "Execution error in ComfyUI" };
            }
            if (task.status?.completed === true || task.outputs) {
              return { state: "completed" };
            }
          }
        }

        // 2. Check queue
        const queueRes = await send(`${baseUrl}/queue`);
        if (queueRes.ok) {
          const queue = await queueRes.json();
          const running = queue.queue_running || [];
          if (running.some((item: any) => item[1] === requestId)) {
            return { state: "running" };
          }
          const pending = queue.queue_pending || [];
          if (pending.some((item: any) => item[1] === requestId)) {
            return { state: "queued" };
          }
        }

        return { state: "queued" };
      } catch (err: any) {
        return { state: "failed", error: err.message };
      }
    },

    async result(endpoint: string, requestId: string): Promise<{ videoUrl: string; mimeType: string }> {
      if (!baseUrl) throw new VideoProviderError("ComfyUI server is not configured.", false);

      const histRes = await send(`${baseUrl}/history/${requestId}`);
      if (!histRes.ok) throw new VideoProviderError(`Failed to fetch ComfyUI history for ${requestId}`, true);

      const hist = await histRes.json();
      const task = hist?.[requestId];
      if (!task || !task.outputs) {
        throw new VideoProviderError(`No outputs found in ComfyUI task ${requestId}`, true);
      }

      // Look for video or image outputs
      for (const nodeOutput of Object.values<any>(task.outputs)) {
        const vids = nodeOutput.videos || nodeOutput.gifs || nodeOutput.images || [];
        if (vids.length > 0) {
          const file = vids[0];
          const filename = file.filename;
          const subfolder = file.subfolder || "";
          const type = file.type || "output";
          const videoUrl = `${baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
          const isMp4 = filename.endsWith(".mp4");
          return {
            videoUrl,
            mimeType: isMp4 ? "video/mp4" : "image/webp",
          };
        }
      }

      throw new VideoProviderError("ComfyUI finished with no renderable media outputs.", true);
    },

    async download(url: string): Promise<Buffer> {
      const res = await send(url);
      if (!res.ok) throw new VideoProviderError(`Failed to download ComfyUI media from ${url}: ${res.status}`, true);
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    },
  };
}
