import { slmAdapterDistillerService } from "./slm-adapter-distiller.service.js";

describe("SLM Adapter Distiller Service", () => {
  it("should fail gracefully if insufficient execution logs are found for prompt hash", async () => {
    await expect(
      slmAdapterDistillerService.distillAdapterForPromptHash("non_existent_hash_12345")
    ).rejects.toThrow("Insufficient execution logs");
  });
});
