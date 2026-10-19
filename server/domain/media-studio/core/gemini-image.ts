import type { MediaAspectRatio } from "@shared/media-studio.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

/**
 * Keyframe stills from Gemini's native image generation: generateContent asked for
 * an image response. Gemini first, per platform policy.
 */

/** Gemini's nearest aspect ratio for each one a production can be shot in. */
export const GEMINI_IMAGE_ASPECT_RATIOS: Record<MediaAspectRatio, string> = {
    "16:9": "16:9",
    "9:16": "9:16",
    "2.39:1": "21:9",
    "4:3": "4:3",
    "1:1": "1:1",
};

/** An image sent with a prompt, e.g. a character's approved reference. */
export interface ReferenceImage {
    mimeType: string;
    content: Buffer;
}

export interface GeneratedImage {
    mimeType: string;
    content: Buffer;
    model: string;
}

export interface ImageGenerator {
    /** False when there is no key: nothing can be rendered, and nothing is attempted. */
    configured: boolean;
    model: string;
    /** What one image is expected to cost, counted against the production's budget. */
    estimatedCostCents: number;
    /** Reference images go after the prompt, in the order the prompt names them. */
    generate(prompt: string, aspectRatio: MediaAspectRatio, references?: ReferenceImage[]): Promise<GeneratedImage>;
}

/**
 * A render that produced no image. `billed` says whether the request may still have
 * cost something: a request Gemini refused with an error status is not billed; one it
 * answered without an image may have been.
 */
export class ImageGenerationError extends Error {
    constructor(message: string, readonly billed: boolean) {
        super(message);
        this.name = "ImageGenerationError";
    }
}

export function createGeminiImageGenerator(options: {
    apiKey?: string;
    model?: string;
    costCents?: number;
    fetch?: typeof fetch;
} = {}): ImageGenerator {
    const apiKey = options.apiKey ?? developmentProviderKey();
    const model = options.model ?? process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
    // About $0.04 an image for gemini-2.5-flash-image; set GEMINI_IMAGE_COST_CENTS for another model.
    const estimatedCostCents = options.costCents ?? (Number(process.env.GEMINI_IMAGE_COST_CENTS) || 4);
    const send = options.fetch ?? fetch;

    return {
        configured: Boolean(apiKey),
        model,
        estimatedCostCents,
        async generate(prompt, aspectRatio, references = []) {
            if (!apiKey) throw new ImageGenerationError("Gemini is not configured (no GEMINI_API_KEY), so no image was generated.", false);

            let response: Response;
            try {
                response = await send(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                    body: JSON.stringify({
                        contents: [{
                            role: "user",
                            parts: [
                                { text: prompt },
                                ...references.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.content.toString("base64") } })),
                            ],
                        }],
                        generationConfig: {
                            responseModalities: ["IMAGE"],
                            imageConfig: { aspectRatio: GEMINI_IMAGE_ASPECT_RATIOS[aspectRatio] },
                        },
                    }),
                    signal: AbortSignal.timeout(90_000),
                });
            } catch (error) {
                throw new ImageGenerationError(`Gemini could not be reached: ${(error as Error)?.message ?? error}`, false);
            }

            if (!response.ok) {
                const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
                throw new ImageGenerationError(`Gemini returned ${response.status}${detail ? `: ${detail}` : ""}`, false);
            }

            const body: any = await response.json().catch(() => null);
            const parts: any[] = body?.candidates?.[0]?.content?.parts ?? [];
            const inline = parts.map((part) => part?.inlineData ?? part?.inline_data).find((data) => data?.data);
            if (!inline) {
                const reason = body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason;
                throw new ImageGenerationError(reason ? `Gemini returned no image (${reason}).` : "Gemini returned no image.", true);
            }
            return {
                mimeType: inline.mimeType ?? inline.mime_type ?? "image/png",
                content: Buffer.from(inline.data, "base64"),
                model,
            };
        },
    };
}
