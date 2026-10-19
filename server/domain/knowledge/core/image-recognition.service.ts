import { createLogger } from "@server/utils/logger.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("ImageRecognition");

/**
 * Reading an attached image.
 *
 * `FileParser` stores an image as base64 with the summary "Image file: name.png"
 * — literally the filename — so an attached diagram was inert. The existing
 * VisionService is worse than absent for this: its Gemini branch returns the
 * string "Gemini analysis placeholder" with `confidence: 0.8` and never calls
 * anything, so a caller cannot tell it did nothing.
 *
 * Everything here is an INFERENCE, and says so. A workflow read off a picture is
 * not a parse: a misread arrow becomes a wrong branch in a deployed application,
 * so the provenance has to survive into the room rather than being flattened
 * into the same shape as parsed BPMN.
 */

export interface ImageReading {
    /** Prose description of what the image shows. */
    description: string;
    /** Text transcribed from the image, empty when there is none. */
    text: string;
    /** True when the image appears to depict a process, flow or architecture. */
    isDiagram: boolean;
    /**
     * A process graph, when one could be read. Shaped like the BPMN extractor's
     * output so synthesis has ONE input contract — but always marked inferred.
     */
    processGraph: {
        provenance: "inferred";
        tasks: Array<{ id: string; name: string; kind: string; lane: string | null }>;
        flows: Array<{ id: string; from: string; to: string; name: string | null; condition: string | null }>;
        gateways: Array<{ id: string; name: string | null; kind: string }>;
        /** What the model could not read — never silently completed. */
        uncertainties: string[];
    } | null;
    model: string;
}

const EXTRACTION_PROMPT = `You are reading an image that was attached to a working discussion.

Return ONLY a JSON object with this exact shape:
{
  "description": "one paragraph describing what this image shows",
  "text": "every piece of text visible in the image, verbatim; empty string if none",
  "isDiagram": true or false,
  "processGraph": null OR {
    "tasks":    [{ "id": "t1", "name": "Review invoice", "kind": "task", "lane": "Finance or null" }],
    "flows":    [{ "id": "f1", "from": "t1", "to": "t2", "name": "label or null", "condition": "condition text or null" }],
    "gateways": [{ "id": "g1", "name": "Over threshold?", "kind": "exclusiveGateway" }],
    "uncertainties": ["anything you could not read clearly"]
  }
}

Rules that matter more than completeness:
- Set processGraph ONLY if the image actually depicts a process, workflow, flowchart or pipeline. A screenshot, photo or chart is not a process — use null.
- Transcribe labels exactly as written. Do not tidy them.
- If an arrow's direction or a label is unclear, say so in "uncertainties" rather than guessing. An invented step is far worse than a reported gap.
- Never invent tasks to make the diagram look complete.`;

export const imageRecognitionService = {
    /** Whether a reading can even be attempted. */
    isSupported(mimeType: string): boolean {
        return /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(mimeType);
    },

    /**
     * Reads an image with a multimodal model.
     *
     * Throws rather than returning a plausible-looking empty result: a caller
     * must be able to distinguish "the model said there is no process here"
     * from "nothing ran".
     */
    async read(buffer: Buffer, mimeType: string, originalName: string, organizationId?: number): Promise<ImageReading> {
        if (!this.isSupported(mimeType)) {
            throw new Error(`Cannot read ${mimeType} as an image.`);
        }

        const { systemConfigService } = await import("@domain/system/system-config.service.js");
        const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");

        let config: any = null;
        try {
            config = await systemConfigService.resolveAiConfig("imageRecognition");
        } catch {
            // Falls through to the Gemini default below — house policy is
            // Gemini-first, and vision is one of its native capabilities.
        }

        const provider = config?.provider || "google";
        const model = config?.model || "gemini-flash-latest";
        // The org-aware client resolves and meters the organization's own key.
        // An empty development key is valid in production; it is not a feature gate.
        const apiKey = developmentProviderKey();

        const client = AIClientFactory.getClient({ ...(config ?? {}), provider, model } as any);

        // Inline bytes rather than a separate temporary provider file. The
        // org-aware client sends the image to the organization's AI provider.
        const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

        const response = await client.execute(
            {
                provider,
                model,
                organizationId,
                userPrompt: `The file is named "${originalName}". Read it now.`,
                temperature: 0,
                systemPrompt: EXTRACTION_PROMPT,
                requestType: "json",
                attachments: [{ type: "image_url", url: dataUrl }],
                // A thinking model emits reasoning parts instead of the JSON
                // answer unless the budget is switched off.
                thinkingBudget: 0,
            } as any,
            `The file is named "${originalName}". Read it now.`,
            apiKey,
        );

        if (!response.success) {
            throw new Error(response.error || "The vision model call failed.");
        }
        const raw = String(response.output ?? "").trim();
        if (!raw) throw new Error("The vision model returned nothing.");

        const parsed = parseJsonObject(raw);
        if (!parsed) {
            throw new Error(`The vision model did not return usable JSON: ${raw.slice(0, 200)}`);
        }

        const graph = parsed.processGraph;
        return {
            description: String(parsed.description ?? "").trim(),
            text: String(parsed.text ?? "").trim(),
            isDiagram: parsed.isDiagram === true,
            processGraph: graph
                ? {
                      provenance: "inferred",
                      tasks: asArray(graph.tasks),
                      flows: asArray(graph.flows),
                      gateways: asArray(graph.gateways),
                      uncertainties: asArray(graph.uncertainties).map(String),
                  }
                : null,
            model,
        };
    },
};

function asArray(value: any): any[] {
    return Array.isArray(value) ? value : [];
}

/**
 * Models fence JSON in markdown even when told not to. Extracts the outermost
 * object rather than regexing for fields — a lazy pattern truncates at the
 * first nested brace.
 */
function parseJsonObject(raw: string): any | null {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start === -1 || end <= start) return null;
        try {
            return JSON.parse(cleaned.slice(start, end + 1));
        } catch (err: any) {
            logger.warn(`Unparseable vision response: ${err?.message}`);
            return null;
        }
    }
}
