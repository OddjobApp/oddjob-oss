import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The bar this has to clear is the existing VisionService, whose Gemini branch
 * returns the string "Gemini analysis placeholder" with `confidence: 0.8` and
 * never calls anything — a fake success a caller cannot detect.
 */

const execute = vi.fn();

vi.mock("@domain/ai/core/ai-client.service.js", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, AIClientFactory: { getClient: () => ({ execute }) } };
});

const { imageRecognitionService } = await import("../core/image-recognition.service.js");

const png = Buffer.from("fake-png-bytes");
const ok = (payload: unknown) => ({ success: true, output: JSON.stringify(payload) });

beforeEach(() => {
    execute.mockReset();
    process.env.GOOGLE_API_KEY = "test-key";
});

afterEach(() => vi.unstubAllEnvs());

describe("imageRecognitionService", () => {
    it("allows production calls without a platform key and forwards the attachment organization", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("GOOGLE_API_KEY", "");
        vi.stubEnv("GEMINI_API_KEY", "");
        execute.mockResolvedValue(ok({ description: "An invoice", text: "Total 100", isDiagram: false, processGraph: null }));
        await imageRecognitionService.read(png, "image/png", "invoice.png", 42);
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 42,
            userPrompt: 'The file is named "invoice.png". Read it now.',
        }), expect.any(String), "");
    });
    it("only attempts formats a vision model can actually read", () => {
        expect(imageRecognitionService.isSupported("image/png")).toBe(true);
        expect(imageRecognitionService.isSupported("image/jpeg")).toBe(true);
        expect(imageRecognitionService.isSupported("application/pdf")).toBe(false);
        expect(imageRecognitionService.isSupported("image/svg+xml")).toBe(false);
    });

    it("transcribes text from the image — the OCR half", async () => {
        execute.mockResolvedValue(ok({
            description: "A screenshot of a failed deployment",
            text: "Error: connect ECONNREFUSED 127.0.0.1:5433",
            isDiagram: false,
            processGraph: null,
        }));

        const reading = await imageRecognitionService.read(png, "image/png", "error.png");

        expect(reading.text).toContain("ECONNREFUSED");
        expect(reading.isDiagram).toBe(false);
        expect(reading.processGraph).toBeNull();
    });

    it("reads a diagram into a process graph, always marked inferred", async () => {
        execute.mockResolvedValue(ok({
            description: "An invoice approval flow",
            text: "Review invoice / Over threshold?",
            isDiagram: true,
            processGraph: {
                tasks: [{ id: "t1", name: "Review invoice", kind: "task", lane: "Finance" }],
                flows: [{ id: "f1", from: "t1", to: "g1", name: null, condition: null }],
                gateways: [{ id: "g1", name: "Over threshold?", kind: "exclusiveGateway" }],
                uncertainties: [],
            },
        }));

        const reading = await imageRecognitionService.read(png, "image/png", "flow.png");

        // Provenance is the whole point: a diagram read from pixels must never
        // be indistinguishable from parsed BPMN.
        expect(reading.processGraph?.provenance).toBe("inferred");
        expect(reading.processGraph?.tasks[0].name).toBe("Review invoice");
    });

    it("keeps what the model could not read rather than dropping it", async () => {
        execute.mockResolvedValue(ok({
            description: "A hand-drawn flow", text: "", isDiagram: true,
            processGraph: {
                tasks: [{ id: "t1", name: "Intake", kind: "task", lane: null }],
                flows: [], gateways: [],
                uncertainties: ["The arrow between Intake and the next box is ambiguous"],
            },
        }));

        const reading = await imageRecognitionService.read(png, "image/png", "whiteboard.jpg");

        // A reported gap is worth far more than a confidently invented step.
        expect(reading.processGraph?.uncertainties).toHaveLength(1);
    });

    it("survives a model that fences its JSON in markdown", async () => {
        execute.mockResolvedValue({
            success: true,
            output: '```json\n{"description":"x","text":"y","isDiagram":false,"processGraph":null}\n```',
        });

        const reading = await imageRecognitionService.read(png, "image/png", "a.png");

        expect(reading.description).toBe("x");
    });

    it("throws when the model call fails, rather than returning a plausible blank", async () => {
        execute.mockResolvedValue({ success: false, error: "quota exceeded" });

        await expect(imageRecognitionService.read(png, "image/png", "a.png")).rejects.toThrow(/quota exceeded/);
    });

    it("throws when the model returns nothing", async () => {
        execute.mockResolvedValue({ success: true, output: "   " });

        await expect(imageRecognitionService.read(png, "image/png", "a.png")).rejects.toThrow(/returned nothing/i);
    });

    it("throws on unusable output instead of inventing an empty reading", async () => {
        execute.mockResolvedValue({ success: true, output: "I'm sorry, I can't help with that." });

        await expect(imageRecognitionService.read(png, "image/png", "a.png")).rejects.toThrow(/usable JSON/i);
    });

    it("sends the image to the model rather than describing the filename", async () => {
        execute.mockResolvedValue(ok({ description: "d", text: "t", isDiagram: false, processGraph: null }));

        await imageRecognitionService.read(png, "image/png", "diagram.png");

        const [config] = execute.mock.calls[0];
        expect(config.attachments[0].type).toBe("image_url");
        expect(config.attachments[0].url).toMatch(/^data:image\/png;base64,/);
        // Deterministic transcription; a creative OCR is a wrong OCR.
        expect(config.temperature).toBe(0);
    });
});
