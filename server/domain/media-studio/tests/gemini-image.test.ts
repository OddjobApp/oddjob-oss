/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { createGeminiImageGenerator, ImageGenerationError } from "../core/gemini-image.js";

const reply = (status: number, body: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Gemini keyframe images", () => {
    it("asks generateContent for an image in the production's nearest aspect ratio, and returns its bytes", async () => {
        const fetch = vi.fn(async () => reply(200, {
            candidates: [{ content: { parts: [{ text: "Here you go" }, { inlineData: { mimeType: "image/png", data: Buffer.from("png-bytes").toString("base64") } }] } }],
        }));
        const generator = createGeminiImageGenerator({ apiKey: "key-123", model: "gemini-2.5-flash-image", costCents: 4, fetch: fetch as any });

        expect(generator).toMatchObject({ configured: true, model: "gemini-2.5-flash-image", estimatedCostCents: 4 });
        const image = await generator.generate("A rooftop at dusk", "2.39:1");
        expect(image.mimeType).toBe("image/png");
        expect(image.content.toString()).toBe("png-bytes");

        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
        expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("key-123");
        expect(url).not.toContain("key-123");
        expect(JSON.parse(init.body as string)).toEqual({
            contents: [{ role: "user", parts: [{ text: "A rooftop at dusk" }] }],
            generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "21:9" } },
        });
    });

    it("sends reference images after the prompt, in order", async () => {
        const fetch = vi.fn(async () => reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "cG5n" } }] } }] }));
        const generator = createGeminiImageGenerator({ apiKey: "k", fetch: fetch as any });
        await generator.generate("Elena at dusk", "16:9", [
            { mimeType: "image/png", content: Buffer.from("elena") },
            { mimeType: "image/jpeg", content: Buffer.from("roof") },
        ]);
        const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(init.body as string).contents[0].parts).toEqual([
            { text: "Elena at dusk" },
            { inlineData: { mimeType: "image/png", data: Buffer.from("elena").toString("base64") } },
            { inlineData: { mimeType: "image/jpeg", data: Buffer.from("roof").toString("base64") } },
        ]);
    });

    it("says an error status was not billed, and an answer without an image may have been", async () => {
        const refused = createGeminiImageGenerator({ apiKey: "k", fetch: (async () => reply(429, "Resource has been exhausted (e.g. check quota).")) as any });
        const quota = await refused.generate("x", "16:9").catch((e) => e);
        expect(quota).toBeInstanceOf(ImageGenerationError);
        expect(quota).toMatchObject({ billed: false, message: "Gemini returned 429: Resource has been exhausted (e.g. check quota)." });

        const blocked = createGeminiImageGenerator({ apiKey: "k", fetch: (async () => reply(200, { candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] })) as any });
        await expect(blocked.generate("x", "16:9")).rejects.toMatchObject({ billed: true, message: "Gemini returned no image (IMAGE_SAFETY)." });

        const unreachable = createGeminiImageGenerator({ apiKey: "k", fetch: (async () => { throw new Error("ECONNRESET"); }) as any });
        await expect(unreachable.generate("x", "16:9")).rejects.toMatchObject({ billed: false, message: "Gemini could not be reached: ECONNRESET" });
    });

    it("attempts nothing without a key", async () => {
        const fetch = vi.fn();
        const generator = createGeminiImageGenerator({ apiKey: "", fetch: fetch as any });
        expect(generator.configured).toBe(false);
        await expect(generator.generate("x", "1:1")).rejects.toMatchObject({ billed: false, message: "Gemini is not configured (no GEMINI_API_KEY), so no image was generated." });
        expect(fetch).not.toHaveBeenCalled();
    });
});
