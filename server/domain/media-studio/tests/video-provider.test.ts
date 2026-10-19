/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { createFalVideoProvider, VideoProviderError } from "../core/video-provider.js";

function fakeFal() {
    const client = {
        storage: {
            upload: vi.fn(async (_file: Blob, _options?: unknown) => "https://v3.fal.media/files/frame.png"),
            transformInput: vi.fn(async (input: Record<string, unknown>) => input),
        },
        queue: {
            submit: vi.fn(async () => ({ status: "IN_QUEUE", request_id: "req-1", response_url: "", status_url: "", cancel_url: "", queue_position: 0 })),
            status: vi.fn(async (): Promise<any> => ({ status: "IN_QUEUE", request_id: "req-1" })),
            result: vi.fn(async (): Promise<any> => ({ data: { video: { url: "https://v3.fal.media/files/take.mp4", content_type: "video/mp4" }, seed: 7 }, requestId: "req-1" })),
            streamStatus: vi.fn(), subscribeToStatus: vi.fn(), cancel: vi.fn(),
        },
    };
    return client;
}

describe("Seedance through fal.ai", () => {
    it("prices takes at fal's list price and picks the endpoint by whether a take starts from a keyframe", () => {
        const provider = createFalVideoProvider({ apiKey: "k", client: fakeFal() as any });
        expect(provider).toMatchObject({ name: "fal", configured: true, resolution: "720p", centsPerSecond: 30.34 });
        expect(provider.estimateCents(5)).toBe(152);
        expect(createFalVideoProvider({ apiKey: "k", resolution: "1080p" }).estimateCents(5)).toBe(341);
        expect(createFalVideoProvider({ apiKey: "k", resolution: "4k" }).resolution).toBe("720p");
        expect(provider.endpointFor({ imageUrl: "https://x/frame.png" })).toBe("bytedance/seedance-2.0/image-to-video");
        expect(provider.endpointFor({ imageUrl: null })).toBe("bytedance/seedance-2.0/text-to-video");
    });

    it("sends the documented fields, with start and end frames only for image-to-video", async () => {
        const fal = fakeFal();
        const provider = createFalVideoProvider({ apiKey: "k", client: fal as any });

        expect(await provider.submit({ prompt: "Elena runs", imageUrl: "https://f/a.png", endImageUrl: "https://f/b.png", durationSeconds: 5, aspectRatio: "21:9", generateAudio: true }))
            .toEqual({ endpoint: "bytedance/seedance-2.0/image-to-video", requestId: "req-1" });
        expect(fal.queue.submit).toHaveBeenLastCalledWith("bytedance/seedance-2.0/image-to-video", {
            input: { prompt: "Elena runs", resolution: "720p", duration: "5", aspect_ratio: "21:9", generate_audio: true, image_url: "https://f/a.png", end_image_url: "https://f/b.png" },
        });

        await provider.submit({ prompt: "A wide city", imageUrl: null, endImageUrl: "https://f/b.png", durationSeconds: 8, aspectRatio: "16:9", generateAudio: true });
        expect(fal.queue.submit).toHaveBeenLastCalledWith("bytedance/seedance-2.0/text-to-video", {
            input: { prompt: "A wide city", resolution: "720p", duration: "8", aspect_ratio: "16:9", generate_audio: true },
        });
    });

    it("uploads a keyframe as a typed file that expires after a day", async () => {
        const fal = fakeFal();
        const provider = createFalVideoProvider({ apiKey: "k", client: fal as any });
        expect(await provider.uploadImage(Buffer.from("png"), "image/png")).toBe("https://v3.fal.media/files/frame.png");
        const [file, options] = fal.storage.upload.mock.calls[0];
        expect(file.type).toBe("image/png");
        expect(options).toEqual({ lifecycle: { expiresIn: "1d" } });

        fal.storage.upload.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
        await expect(provider.uploadImage(Buffer.from("png"), "image/png")).rejects.toMatchObject({ billed: false, message: "The keyframe could not be uploaded to fal.ai: fal.ai returned 403: Forbidden" });
    });

    it("maps the queue's states, including a finished request that failed", async () => {
        const fal = fakeFal();
        const provider = createFalVideoProvider({ apiKey: "k", client: fal as any });
        expect(await provider.status("e", "req-1")).toEqual({ state: "queued" });
        fal.queue.status.mockResolvedValueOnce({ status: "IN_PROGRESS", request_id: "req-1", logs: [] });
        expect(await provider.status("e", "req-1")).toEqual({ state: "running" });
        fal.queue.status.mockResolvedValueOnce({ status: "COMPLETED", request_id: "req-1", logs: [] });
        expect(await provider.status("e", "req-1")).toEqual({ state: "completed" });
        fal.queue.status.mockResolvedValueOnce({ status: "COMPLETED", request_id: "req-1", logs: [], error: "Content policy violation" });
        expect(await provider.status("e", "req-1")).toEqual({ state: "failed", error: "Content policy violation" });
        fal.queue.status.mockRejectedValueOnce(new Error("socket hang up"));
        await expect(provider.status("e", "req-1")).rejects.toBeInstanceOf(VideoProviderError);
    });

    it("reads the finished video, and says when there is none", async () => {
        const fal = fakeFal();
        const provider = createFalVideoProvider({ apiKey: "k", client: fal as any });
        expect(await provider.result("e", "req-1")).toEqual({ videoUrl: "https://v3.fal.media/files/take.mp4", mimeType: "video/mp4" });

        fal.queue.result.mockResolvedValueOnce({ data: {}, requestId: "req-1" });
        await expect(provider.result("e", "req-1")).rejects.toMatchObject({ billed: true, message: "fal.ai finished without a video." });
        fal.queue.result.mockRejectedValueOnce(Object.assign(new Error("Unprocessable"), { status: 422, body: { detail: "image_url could not be read" } }));
        await expect(provider.result("e", "req-1")).rejects.toMatchObject({ billed: false, message: "fal.ai did not return the video: fal.ai returned 422: image_url could not be read" });
    });

    it("downloads the video, and attempts nothing without a key", async () => {
        const fetch = vi.fn(async () => new Response("mp4-bytes", { status: 200 }));
        const provider = createFalVideoProvider({ apiKey: "k", client: fakeFal() as any, fetch: fetch as any });
        expect((await provider.download("https://v3.fal.media/files/take.mp4")).toString()).toBe("mp4-bytes");

        const fal = fakeFal();
        const unconfigured = createFalVideoProvider({ apiKey: "", client: fal as any });
        expect(unconfigured.configured).toBe(false);
        await expect(unconfigured.submit({ prompt: "x", imageUrl: null, endImageUrl: null, durationSeconds: 5, aspectRatio: "16:9", generateAudio: true }))
            .rejects.toMatchObject({ billed: false, message: "fal.ai is not connected for this organization, so nothing was rendered. Connect a fal.ai key in Organization Settings." });
        expect(fal.queue.submit).not.toHaveBeenCalled();
    });
});
