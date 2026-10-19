// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createComfyVideoProvider } from "./comfy-video-provider";

describe("ComfyVideoProvider", () => {
  it("computes cost estimates based on resolution and duration", () => {
    const provider720 = createComfyVideoProvider({ resolution: "720p" });
    expect(provider720.centsPerSecond).toBe(20.0);
    expect(provider720.estimateCents(5)).toBe(100);

    const provider1080 = createComfyVideoProvider({ resolution: "1080p" });
    expect(provider1080.centsPerSecond).toBe(45.0);
    expect(provider1080.estimateCents(4)).toBe(180);
  });

  it("submits workflow graph to ComfyUI /prompt endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prompt_id: "comfy_req_998877" }),
    });

    const provider = createComfyVideoProvider({
      baseUrl: "http://127.0.0.1:8188",
      fetch: mockFetch as any,
    });

    const submission = await provider.submit({
      prompt: "Maya leaps over the ledge",
      durationSeconds: 4,
      aspectRatio: "16:9",
      imageUrl: null,
      endImageUrl: null,
      generateAudio: false,
    });

    expect(submission.requestId).toBe("comfy_req_998877");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8188/prompt",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("queries status from ComfyUI history and queue", async () => {
    const mockFetchHistory = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        req_123: { status: { completed: true }, outputs: { "9": { videos: [{ filename: "out.mp4" }] } } },
      }),
    });

    const provider = createComfyVideoProvider({
      baseUrl: "http://127.0.0.1:8188",
      fetch: mockFetchHistory as any,
    });

    const status = await provider.status("http://127.0.0.1:8188/prompt", "req_123");
    expect(status.state).toBe("completed");

    const result = await provider.result("http://127.0.0.1:8188/prompt", "req_123");
    expect(result.videoUrl).toContain("filename=out.mp4");
    expect(result.mimeType).toBe("video/mp4");
  });
});
