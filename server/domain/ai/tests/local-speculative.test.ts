import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalSpeculativeService } from "../core/local-speculative.service.js";
import { OllamaClient } from "../core/providers/ollama-client.js";

// Mock fetchWithRetry to capture what is sent in the body
vi.mock("../core/ai-client.service.js", () => ({
  AIClientFactory: {},
  fetchWithRetry: vi.fn().mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({
      message: { role: "assistant", content: "Speculative response" }
    })
  })
}));

describe("Local Speculative Decoding Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Profile and Model Resolution", () => {
    it("should only enable speculation on high-end profiles", () => {
      expect(LocalSpeculativeService.shouldEnableSpeculation("laptop")).toBe(false);
      expect(LocalSpeculativeService.shouldEnableSpeculation("workstation")).toBe(true);
      expect(LocalSpeculativeService.shouldEnableSpeculation("server")).toBe(true);
    });

    it("should map target models to appropriate draft models", () => {
      expect(LocalSpeculativeService.getDraftModelForTarget("llama3:8b")).toBe("llama3.2:1b");
      expect(LocalSpeculativeService.getDraftModelForTarget("llama3.1:latest")).toBe("llama3.2:1b");
      expect(LocalSpeculativeService.getDraftModelForTarget("llama3:70b")).toBe("llama3:8b");
      expect(LocalSpeculativeService.getDraftModelForTarget("unknown_model")).toBeUndefined();
    });
  });

  describe("Request Body Modification", () => {
    it("should append speculative parameters if enabled", () => {
      const requestBody: Record<string, any> = { model: "llama3:8b" };
      LocalSpeculativeService.applySpeculation(requestBody, "llama3:8b", "workstation");

      expect(requestBody.speculative_model).toBe("llama3.2:1b");
      expect(requestBody.num_speculative_tokens).toBe(5);
    });

    it("should not append speculative parameters if disabled on profile", () => {
      const requestBody: Record<string, any> = { model: "llama3:8b" };
      LocalSpeculativeService.applySpeculation(requestBody, "llama3:8b", "laptop");

      expect(requestBody.speculative_model).toBeUndefined();
    });
  });

  describe("Integration with OllamaClient", () => {
    it("should automatically apply speculation parameters to the request body when executing", async () => {
      const client = new OllamaClient({ baseUrl: "http://localhost:11434" });
      
      const config = {
        model: "llama3.1:latest",
        userPrompt: "Hello, model!",
        temperature: 0.7
      };

      const { fetchWithRetry: mockFetch } = await import("../core/ai-client.service.js");

      await client.execute(config as any, undefined, "key");

      // Verify fetch was called with speculative parameters in the body
      expect(mockFetch).toHaveBeenCalled();
      const callArgs = vi.mocked(mockFetch).mock.calls[0];
      const url = callArgs[0];
      const init = callArgs[1] as RequestInit;
      const body = JSON.parse(init.body as string);

      expect(body.speculative_model).toBe("llama3.2:1b");
      expect(body.num_speculative_tokens).toBe(5);
    });
  });
});
