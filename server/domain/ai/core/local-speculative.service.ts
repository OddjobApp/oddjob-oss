import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LocalSpeculativeService");

export interface SpeculativeDecodingOptions {
  enabled: boolean;
  draftModel?: string;
  numSpeculativeTokens?: number;
}

export class LocalSpeculativeService {
  /**
   * Determine if speculative decoding should be enabled based on hardware profile.
   */
  static shouldEnableSpeculation(profile: string): boolean {
    // Enabled on workstation, server, and cluster profiles where multiple local models can run.
    return ["workstation", "server", "cluster"].includes(profile.toLowerCase());
  }

  /**
   * Resolve draft model mapping for a given target model.
   */
  static getDraftModelForTarget(targetModel: string): string | undefined {
    const targetLower = targetModel.toLowerCase();
    
    // Maps standard models to their light draft variants
    if (targetLower.includes("llama-3-8b") || targetLower.includes("llama3:8b") || targetLower.includes("llama3.1:latest")) {
      return "llama3.2:1b"; // Light draft model
    }
    if (targetLower.includes("llama3:70b")) {
      return "llama3:8b";
    }
    if (targetLower.includes("gemma2:27b")) {
      return "gemma2:2b";
    }
    
    return undefined;
  }

  /**
   * Appends speculative parameters to the API request body.
   */
  static applySpeculation(
    requestBody: Record<string, any>,
    targetModel: string,
    profile: string
  ): void {
    if (!this.shouldEnableSpeculation(profile)) {
      return;
    }

    const draftModel = this.getDraftModelForTarget(targetModel);
    if (!draftModel) {
      return;
    }

    logger.info(`[LocalSpeculative] Applying speculative decoding to target model: ${targetModel} using draft: ${draftModel}`);

    // Standard backend formatting (vLLM, SGLang, and local API wrappers support these params)
    requestBody.speculative_model = draftModel;
    requestBody.num_speculative_tokens = 5;
    
    // For custom sidecars or specific Ollama versions that support custom draft options:
    requestBody.options = requestBody.options || {};
    requestBody.options.draft_model = draftModel;
  }
}
