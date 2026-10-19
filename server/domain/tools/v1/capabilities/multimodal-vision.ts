import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { ORG_GEMINI_KEY_MISSING, resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";

async function analyzeImageWithGemini(
    imageUrl: string,
    prompt: string,
    orgId?: number | null
): Promise<string> {
    const apiKey = await resolveOrgGeminiKey(orgId);
    if (!apiKey) throw new Error(ORG_GEMINI_KEY_MISSING);

    // Determine if URL or base64
    let imagePart: Record<string, unknown>;
    if (imageUrl.startsWith("data:")) {
        const [header, data] = imageUrl.split(",");
        const mimeType = header.replace("data:", "").replace(";base64", "");
        imagePart = { inlineData: { mimeType, data } };
    } else {
        // Fetch and convert to base64
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get("content-type") || "image/jpeg";
        imagePart = { inlineData: { mimeType: contentType, data: buffer.toString("base64") } };
    }

    const body = {
        contents: [{ parts: [imagePart, { text: prompt }] }],
    };

    const model = "gemini-1.5-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini Vision API error ${response.status}: ${errText}`);
    }
    const json = await response.json() as any;
    return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response from vision model.";
}

export const VISION_TOOLS: Record<string, ToolDefinition> = {
    vision_analyze: {
        name: "vision_analyze",

        idempotency: "read-safe",
        label: "Analyze Image",
        group: "Multimodal / Vision",
        description: "Analyze an image using Google Gemini Vision. Accepts a public URL or base64 data URI. Returns a text description or answer to your prompt.",
        parameters: z.object({
            image: z.string().describe("Image URL (https://...) or base64 data URI (data:image/jpeg;base64,...)"),
            prompt: z.string().describe("What to analyze or ask about the image. E.g. 'Describe this image', 'What text appears here?', 'Are there any people?'"),
        }),
        execute: async (params, context) => {
            try {
                const result = await analyzeImageWithGemini(params.image, params.prompt, context?.organizationId);
                return result;
            } catch (err: any) {
                return `Vision analysis failed: ${err.message}`;
            }
        },
    },

    vision_extract_text: {
        name: "vision_extract_text",

        idempotency: "read-safe",
        label: "Extract Text from Image (OCR)",
        group: "Multimodal / Vision",
        description: "Extract all text from an image using Gemini Vision (OCR). Returns the raw text content found in the image.",
        parameters: z.object({
            image: z.string().describe("Image URL or base64 data URI"),
        }),
        execute: async (params, context) => {
            try {
                return await analyzeImageWithGemini(
                    params.image,
                    "Extract all text visible in this image. Return the text exactly as it appears, preserving layout where possible.",
                    context?.organizationId
                );
            } catch (err: any) {
                return `OCR failed: ${err.message}`;
            }
        },
    },

    vision_describe_screenshot: {
        name: "vision_describe_screenshot",

        idempotency: "read-safe",
        label: "Describe Screenshot",
        group: "Multimodal / Vision",
        description: "Describe the UI state in a screenshot — useful for computer-use workflows. Identifies visible elements, text, and layout.",
        parameters: z.object({
            image: z.string().describe("Screenshot URL or base64 data URI"),
            focus: z.string().optional().describe("Optional aspect to focus on, e.g. 'buttons', 'error messages', 'form fields'"),
        }),
        execute: async (params, context) => {
            const focusClause = params.focus ? ` Pay special attention to: ${params.focus}.` : "";
            const prompt = `You are analyzing a screenshot of a computer screen. Describe the UI state clearly: what application or page is shown, key visible elements (buttons, forms, menus, text), any error messages or important content, and the overall layout.${focusClause}`;
            try {
                return await analyzeImageWithGemini(params.image, prompt, context?.organizationId);
            } catch (err: any) {
                return `Screenshot analysis failed: ${err.message}`;
            }
        },
    },
};
