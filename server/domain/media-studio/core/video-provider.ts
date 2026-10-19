import { createFalClient, type FalClient } from "@fal-ai/client";
import { SEEDANCE_CENTS_PER_SECOND, VIDEO_RESOLUTIONS, estimateTakeCents, type VideoResolution } from "@shared/media-studio.js";
import type { ComfyWorkflow } from "@shared/comfy-workflow.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

/**
 * Seedance takes through fal.ai's queue.
 *
 * This replaces a live call to api.seedance.ai, an endpoint that appears in no
 * documentation, and a $0.04 a second estimate that was seven to twelve times too
 * low. The contract follows fal's documented Seedance 2.0 schema: a take starts from a
 * keyframe (image-to-video) or from text alone (text-to-video), may end on a second
 * keyframe, and speaks its dialogue when audio is on. Keyframes are uploaded to fal's
 * storage first, because the platform's own files are behind sign-in.
 */

export type ProviderState = "queued" | "running" | "completed" | "failed";

export interface VideoRenderInput {
    prompt: string;
    imageUrl: string | null;
    endImageUrl: string | null;
    durationSeconds: number;
    aspectRatio: string;
    generateAudio: boolean;
    /** ComfyUI only: the workflow the take was asked with, its seed, and what to avoid. */
    workflow?: ComfyWorkflow | null;
    seed?: number | null;
    negativePrompt?: string | null;
}

export interface VideoRenderProgress {
    step?: number;
    currentStep?: number;
    totalSteps: number;
    percent: number;
    etaSeconds?: number;
    etc?: string;
    previewUrl?: string;
    activeNodeId?: string;
    activeNodeLabel?: string;
    activeNodeTitle?: string;
}

export interface VideoProvider {
    name: string;
    /** Who renders, in words, e.g. "fal.ai" or "ComfyUI". */
    label?: string;
    /** Why nothing renders when it is not configured. */
    notConfigured?: string;
    /** False without a key: nothing can be rendered, and nothing is attempted. */
    configured: boolean;
    resolution: VideoResolution;
    centsPerSecond: number;
    estimateCents(durationSeconds: number): number;
    endpointFor(input: { imageUrl: string | null }): string;
    uploadImage(content: Buffer, mimeType: string): Promise<string>;
    submit(input: VideoRenderInput): Promise<{ endpoint: string; requestId: string }>;
    status(endpoint: string, requestId: string): Promise<{ state: ProviderState; error?: string; progress?: VideoRenderProgress }>;
    result(endpoint: string, requestId: string): Promise<{ videoUrl: string; mimeType: string }>;
    download(url: string): Promise<Buffer>;
}

/**
 * A render that produced no video. `billed` says whether it may still have cost
 * something: a request fal refused or never ran is not billed; one it ran is.
 */
export class VideoProviderError extends Error {
    constructor(message: string, readonly billed: boolean) {
        super(message);
        this.name = "VideoProviderError";
    }
}

type FalLike = Pick<FalClient, "queue" | "storage">;

function describe(error: unknown): string {
    const e = error as { message?: string; status?: number; body?: { detail?: unknown } } | null;
    const detail = e?.body?.detail;
    const text = typeof detail === "string" ? detail : detail ? JSON.stringify(detail).slice(0, 300) : e?.message;
    return [e?.status ? `fal.ai returned ${e.status}` : null, text].filter(Boolean).join(": ") || "no reason was given";
}

export function createFalVideoProvider(options: {
    apiKey?: string;
    resolution?: string;
    imageToVideo?: string;
    textToVideo?: string;
    client?: FalLike;
    fetch?: typeof fetch;
} = {}): VideoProvider {
    const apiKey = options.apiKey ?? developmentProviderKey("fal");
    const wanted = options.resolution ?? process.env.FAL_SEEDANCE_RESOLUTION ?? "";
    const resolution: VideoResolution = (VIDEO_RESOLUTIONS as readonly string[]).includes(wanted) ? (wanted as VideoResolution) : "720p";
    const imageToVideo = options.imageToVideo ?? process.env.FAL_SEEDANCE_IMAGE_TO_VIDEO ?? "bytedance/seedance-2.0/image-to-video";
    const textToVideo = options.textToVideo ?? process.env.FAL_SEEDANCE_TEXT_TO_VIDEO ?? "bytedance/seedance-2.0/text-to-video";
    const send = options.fetch ?? fetch;
    let client: FalLike | null = options.client ?? null;

    const fal = (): FalLike => {
        if (!apiKey) throw new VideoProviderError("fal.ai is not connected for this organization, so nothing was rendered. Connect a fal.ai key in Organization Settings.", false);
        return (client ??= createFalClient({ credentials: apiKey }));
    };
    const endpointFor = ({ imageUrl }: { imageUrl: string | null }) => (imageUrl ? imageToVideo : textToVideo);

    return {
        name: "fal",
        label: "fal.ai",
        notConfigured: "fal.ai is not connected for this organization, so nothing was rendered. Connect a fal.ai key in Organization Settings.",
        configured: Boolean(apiKey),
        resolution,
        centsPerSecond: SEEDANCE_CENTS_PER_SECOND[resolution],
        estimateCents: (durationSeconds) => estimateTakeCents(durationSeconds, resolution),
        endpointFor,

        async uploadImage(content, mimeType) {
            const storage = fal().storage;
            try {
                // A frame is needed only until the render starts.
                return await storage.upload(new Blob([content], { type: mimeType }), { lifecycle: { expiresIn: "1d" } });
            } catch (error) {
                throw new VideoProviderError(`The keyframe could not be uploaded to fal.ai: ${describe(error)}`, false);
            }
        },

        async submit(input) {
            const queue = fal().queue;
            const endpoint = endpointFor(input);
            const body: Record<string, unknown> = {
                prompt: input.prompt,
                resolution,
                duration: String(input.durationSeconds),
                aspect_ratio: input.aspectRatio,
                generate_audio: input.generateAudio,
            };
            if (input.imageUrl) {
                body.image_url = input.imageUrl;
                if (input.endImageUrl) body.end_image_url = input.endImageUrl;
            }
            try {
                const queued = await queue.submit(endpoint, { input: body });
                return { endpoint, requestId: queued.request_id };
            } catch (error) {
                throw new VideoProviderError(`fal.ai did not accept the render: ${describe(error)}`, false);
            }
        },

        async status(endpoint, requestId) {
            const queue = fal().queue;
            let status: Awaited<ReturnType<FalLike["queue"]["status"]>>;
            try {
                status = await queue.status(endpoint, { requestId });
            } catch (error) {
                throw new VideoProviderError(`fal.ai could not report on the render: ${describe(error)}`, true);
            }
            if (status.status === "IN_QUEUE") return { state: "queued" };
            if (status.status === "IN_PROGRESS") return { state: "running" };
            // A finished request that failed carries an error alongside COMPLETED.
            const error = (status as { error?: unknown }).error;
            return error ? { state: "failed", error: typeof error === "string" ? error : JSON.stringify(error) } : { state: "completed" };
        },

        async result(endpoint, requestId) {
            const queue = fal().queue;
            let data: any;
            try {
                ({ data } = await queue.result(endpoint, { requestId }));
            } catch (error) {
                throw new VideoProviderError(`fal.ai did not return the video: ${describe(error)}`, false);
            }
            const video = data?.video;
            if (!video?.url) throw new VideoProviderError("fal.ai finished without a video.", true);
            return { videoUrl: String(video.url), mimeType: typeof video.content_type === "string" && video.content_type ? video.content_type : "video/mp4" };
        },

        async download(url) {
            let response: Response;
            try {
                response = await send(url, { signal: AbortSignal.timeout(180_000) });
            } catch (error) {
                throw new VideoProviderError(`The finished video could not be downloaded: ${(error as Error)?.message ?? error}`, true);
            }
            if (!response.ok) throw new VideoProviderError(`The finished video could not be downloaded (${response.status}).`, true);
            return Buffer.from(await response.arrayBuffer());
        },
    };
}
