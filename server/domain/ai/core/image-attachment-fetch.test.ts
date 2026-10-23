import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchImageAsBase64, MAX_IMAGE_ATTACHMENT_BYTES } from "./ai-client.service.js";

/**
 * Image attachments reach the Gemini, Anthropic and Bedrock clients from
 * document and message URLs, so the fetch must not reach internal addresses.
 */
describe("fetchImageAsBase64", () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it("refuses internal and metadata addresses without fetching", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        for (const url of ["http://169.254.169.254/latest/meta-data/", "http://localhost:5000/x.png", "http://10.0.0.5/a.png", "file:///etc/passwd"]) {
            await expect(fetchImageAsBase64(url)).rejects.toThrow("Image URL refused");
        }
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns a public image as base64 with its bare media type", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]),
            { status: 200, headers: { "content-type": "image/PNG; charset=binary" } })));
        await expect(fetchImageAsBase64("https://93.184.215.14/a.png")).resolves.toEqual({ data: "AQID", mimeType: "image/png" });
    });

    it("refuses an image larger than any provider accepts", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x",
            { status: 200, headers: { "content-type": "image/png", "content-length": String(MAX_IMAGE_ATTACHMENT_BYTES + 1) } })));
        await expect(fetchImageAsBase64("https://93.184.215.14/big.png")).rejects.toThrow("too large");
    });

    it("decodes data URLs, including ones with parameters", async () => {
        await expect(fetchImageAsBase64("data:image/jpeg;name=a.jpg;base64,AQID")).resolves.toEqual({ data: "AQID", mimeType: "image/jpeg" });
    });
});
