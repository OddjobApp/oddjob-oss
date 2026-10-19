/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { createComfyUIImageGenerator, COMFY_ASPECT_RATIO_DIMENSIONS } from "../core/comfyui-image.js";
import { ImageGenerationError } from "../core/gemini-image.js";

const jsonReply = (status: number, body: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

const imageReply = (bytes: Uint8Array) =>
    new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "image/png" },
    });

describe("ComfyUI keyframe images", () => {
    it("attempts nothing without a baseUrl", async () => {
        const fetch = vi.fn();
        const generator = createComfyUIImageGenerator({ baseUrl: "", fetch: fetch as any });
        expect(generator.configured).toBe(false);
        await expect(generator.generate("prompt", "16:9")).rejects.toBeInstanceOf(ImageGenerationError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it("compiles text-to-image DAG with correct aspect ratio dimensions and retrieves generated image", async () => {
        const promptId = "test-prompt-id-123";
        const imageBytes = new Uint8Array(Buffer.from("comfy-png-data"));

        const fetch = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith("/prompt")) {
                const body = JSON.parse(init?.body as string);
                expect(body.client_id).toBe("oddjob-media-engine");
                const graph = body.prompt;
                // Verify SDXL dimensions for 16:9
                expect(graph["5"].inputs).toEqual({
                    width: COMFY_ASPECT_RATIO_DIMENSIONS["16:9"].width,
                    height: COMFY_ASPECT_RATIO_DIMENSIONS["16:9"].height,
                    batch_size: 1,
                });
                expect(graph["4"].inputs.ckpt_name).toBe("sdxl_test.safetensors");
                expect(graph["6"].inputs.text).toBe("A cinematic space battle");
                expect(graph["3"].inputs.denoise).toBe(1.0);
                return jsonReply(200, { prompt_id: promptId });
            }
            if (url.includes(`/history/${promptId}`)) {
                return jsonReply(200, {
                    [promptId]: {
                        status: { completed: true, status_str: "success" },
                        outputs: {
                            "9": {
                                images: [{ filename: "Oddjob_0001.png", subfolder: "keyframes", type: "output" }],
                            },
                        },
                    },
                });
            }
            if (url.includes("/view?")) {
                expect(url).toContain("filename=Oddjob_0001.png");
                expect(url).toContain("subfolder=keyframes");
                return imageReply(imageBytes);
            }
            return jsonReply(404, "Not Found");
        });

        const generator = createComfyUIImageGenerator({
            baseUrl: "http://127.0.0.1:8188",
            model: "sdxl_test.safetensors",
            fetch: fetch as any,
        });

        expect(generator.configured).toBe(true);
        expect(generator.estimatedCostCents).toBe(0);

        const result = await generator.generate("A cinematic space battle", "16:9");
        expect(result.mimeType).toBe("image/png");
        expect(Buffer.from(result.content).toString()).toBe("comfy-png-data");
        expect(result.model).toBe("comfyui:sdxl_test.safetensors");
    });

    it("uploads reference image and builds image-to-image DAG when references are provided", async () => {
        const promptId = "ref-prompt-id-456";
        let uploadCalled = false;

        const fetch = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith("/upload/image")) {
                uploadCalled = true;
                expect(init?.method).toBe("POST");
                return jsonReply(200, { name: "ref-uploaded.png", subfolder: "" });
            }
            if (url.endsWith("/prompt")) {
                const body = JSON.parse(init?.body as string);
                const graph = body.prompt;
                // Image-to-image pipeline: LoadImage (10) -> VAEEncode (11) -> KSampler (3)
                expect(graph["10"].inputs.image).toBe("ref-uploaded.png");
                expect(graph["11"].class_type).toBe("VAEEncode");
                expect(graph["3"].inputs.denoise).toBe(0.7);
                return jsonReply(200, { prompt_id: promptId });
            }
            if (url.includes(`/history/${promptId}`)) {
                return jsonReply(200, {
                    [promptId]: {
                        status: { completed: true, status_str: "success" },
                        outputs: {
                            "9": {
                                images: [{ filename: "Oddjob_0002.png", subfolder: "", type: "output" }],
                            },
                        },
                    },
                });
            }
            if (url.includes("/view?")) {
                return imageReply(new Uint8Array(Buffer.from("ref-result-image")));
            }
            return jsonReply(404, "Not Found");
        });

        const generator = createComfyUIImageGenerator({
            baseUrl: "http://127.0.0.1:8188",
            model: "sdxl_test.safetensors",
            fetch: fetch as any,
        });

        const result = await generator.generate("Character in armor", "1:1", [
            { mimeType: "image/png", content: Buffer.from("fake-character-ref") },
        ]);

        expect(uploadCalled).toBe(true);
        expect(Buffer.from(result.content).toString()).toBe("ref-result-image");
    });

    it("auto-detects checkpoint from /object_info if no model is provided", async () => {
        const fetch = vi.fn(async (url: string) => {
            if (url.endsWith("/object_info")) {
                return jsonReply(200, {
                    CheckpointLoaderSimple: {
                        input: {
                            required: {
                                ckpt_name: [["discovered_sdxl.safetensors", "other.safetensors"]],
                            },
                        },
                    },
                });
            }
            if (url.endsWith("/prompt")) {
                return jsonReply(200, { prompt_id: "auto-id" });
            }
            if (url.includes("/history/auto-id")) {
                return jsonReply(200, {
                    "auto-id": {
                        status: { completed: true },
                        outputs: { "9": { images: [{ filename: "out.png" }] } },
                    },
                });
            }
            if (url.includes("/view?")) {
                return imageReply(new Uint8Array(Buffer.from("auto-image")));
            }
            return jsonReply(404, "Not Found");
        });

        const generator = createComfyUIImageGenerator({
            baseUrl: "http://127.0.0.1:8188",
            model: undefined,
            fetch: fetch as any,
        });

        const result = await generator.generate("Sunset", "16:9");
        expect(result.model).toBe("comfyui:discovered_sdxl.safetensors");
    });

    it("reports unreachable server with descriptive ImageGenerationError", async () => {
        const fetch = vi.fn(async () => {
            throw new Error("ECONNREFUSED 127.0.0.1:8188");
        });
        const generator = createComfyUIImageGenerator({
            baseUrl: "http://127.0.0.1:8188",
            fetch: fetch as any,
        });

        await expect(generator.generate("Test", "16:9")).rejects.toMatchObject({
            billed: false,
            message: expect.stringContaining("ComfyUI at http://127.0.0.1:8188 could not be reached"),
        });
    });

    it("fails cleanly when ComfyUI reports error in history status", async () => {
        const fetch = vi.fn(async (url: string) => {
            if (url.endsWith("/prompt")) {
                return jsonReply(200, { prompt_id: "error-id" });
            }
            if (url.includes("/history/error-id")) {
                return jsonReply(200, {
                    "error-id": {
                        status: { status_str: "error", completed: false },
                    },
                });
            }
            return jsonReply(404, "Not Found");
        });

        const generator = createComfyUIImageGenerator({
            baseUrl: "http://127.0.0.1:8188",
            model: "test.safetensors",
            fetch: fetch as any,
        });

        await expect(generator.generate("Test", "16:9")).rejects.toMatchObject({
            billed: false,
            message: "ComfyUI failed during keyframe generation.",
        });
    });

    it("names itself with the comfyui prefix whatever the checkpoint is called", () => {
        // Media Studio reads this to stamp a keyframe's provider. A bare checkpoint
        // filename here recorded every locally rendered still as a Gemini one.
        const bare = createComfyUIImageGenerator({ baseUrl: "http://127.0.0.1:8188", model: "sd_xl_base_1.0.safetensors" });
        expect(bare.model).toBe("comfyui:sd_xl_base_1.0.safetensors");
        expect(bare.model.startsWith("comfyui")).toBe(true);

        const unnamed = createComfyUIImageGenerator({ baseUrl: "http://127.0.0.1:8188" });
        expect(unnamed.model.startsWith("comfyui")).toBe(true);
    });
});
