import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalInferenceDispatcherService, type LocalInferenceRequest } from "../core/local-inference-dispatcher.service.js";
import type { OllamaService } from "@domain/ai/core/ollama.service.js";

describe("LocalInferenceDispatcherService", () => {
    let mockOllama: Partial<OllamaService>;
    let dispatcher: LocalInferenceDispatcherService;

    const baseRequest: LocalInferenceRequest = {
        organizationId: 1,
        documentId: 42,
        nodeId: 101,
        sandboxId: "vault_001",
        classification: "adult",
        summary: "Passionate romance reunion",
        existingProse: "They stood on the balcony overlooking the sea.",
        prompt: "Write a passionate, emotional embrace where they confess their love.",
        preferredModel: "mistral-uncensored",
    };

    beforeEach(() => {
        mockOllama = {
            isAvailable: vi.fn(),
            generateCompletion: vi.fn(),
        };
        dispatcher = new LocalInferenceDispatcherService(mockOllama as OllamaService);
    });

    it("generates HIL card and prevents egress when local daemon is offline", async () => {
        (mockOllama.isAvailable as any).mockResolvedValue(false);

        const result = await dispatcher.dispatchLocalGeneration(baseRequest);

        expect(result.success).toBe(false);
        expect(result.offlineFallbackRequired).toBe(true);
        expect(result.hilCard).toBeDefined();
        expect(result.hilCard?.type).toBe("LOCAL_MODEL_OFFLINE");
        expect(result.hilCard?.sandboxId).toBe("vault_001");
        expect(result.hilCard?.message).toContain("Zero-egress policy prevented cloud routing");
        expect(mockOllama.generateCompletion).not.toHaveBeenCalled();
    });

    it("executes local generation and wraps prose in sandbox directive when online", async () => {
        (mockOllama.isAvailable as any).mockResolvedValue(true);
        (mockOllama.generateCompletion as any).mockResolvedValue({
            response: "He took her hands and pulled her close, whispering into the night air.",
        });

        const result = await dispatcher.dispatchLocalGeneration(baseRequest);

        expect(result.success).toBe(true);
        expect(result.generatedText).toBe("He took her hands and pulled her close, whispering into the night air.");
        expect(result.modelUsed).toBe("mistral-uncensored");
        expect(result.sandboxBlock).toContain(':::sandbox id="vault_001" type="adult" mode="static_reinsert" summary="Passionate romance reunion"');
        expect(result.sandboxBlock).toContain("He took her hands and pulled her close");
        expect(result.sandboxBlock).toContain(":::");

        expect(mockOllama.generateCompletion).toHaveBeenCalledWith(
            "mistral-uncensored",
            expect.stringContaining("SCENE CONTEXT"),
            expect.objectContaining({
                system: expect.stringContaining("unrestricted creative writing assistant"),
            })
        );
    });

    it("handles execution failures gracefully and produces HIL card", async () => {
        (mockOllama.isAvailable as any).mockResolvedValue(true);
        (mockOllama.generateCompletion as any).mockRejectedValue(new Error("GPU out of memory"));

        const result = await dispatcher.dispatchLocalGeneration(baseRequest);

        expect(result.success).toBe(false);
        expect(result.offlineFallbackRequired).toBe(true);
        expect(result.hilCard).toBeDefined();
        expect(result.hilCard?.title).toBe("Local Inference Generation Error");
        expect(result.hilCard?.message).toContain("GPU out of memory");
        expect(result.hilCard?.message).toContain("Zero-egress policy preserved");
    });
});
