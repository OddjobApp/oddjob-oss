/**
 * Reranking Service — Boot / Initialization Module
 *
 * Loads configuration, instantiates backend adapters with their dependencies,
 * and initializes the singleton RerankingService instance.
 *
 * Call `bootRerankingService()` once during application startup.
 *
 * Requirements: 2.1, 2.5
 */

import type { RerankBackendConfig, RerankBackendType } from "./types.js";
import type { RerankBackend } from "./backends/rerank-backend.interface.js";
import type { LLMRouterClient } from "./backends/llm.backend.js";
import { CohereBackend } from "./backends/cohere.backend.js";
import { LocalBackend } from "./backends/local.backend.js";
import { LLMBackend } from "./backends/llm.backend.js";
import { initRerankingService, type RerankingService } from "./reranking.service.js";
import { loadRerankingConfig } from "./config.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { developmentProviderKey, resolveOrgTextAiKey } from "@domain/ai/core/org-gemini-key.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("RerankingBoot");

/**
 * LLM Router client adapter that wraps the existing AIClientFactory
 * infrastructure to provide LLM completions for the reranking backend.
 *
 * Uses Google/Gemini as the provider with cost-efficient defaults.
 */
const llmRouterAdapter: LLMRouterClient = {
  async complete(prompt, options) {
    const client = AIClientFactory.getClient({ provider: "google" });
    const result = await client.execute(
      {
        systemPrompt: "You are a relevance scoring system.",
        userPrompt: prompt,
        temperature: options?.temperature ?? 0,
        model: options?.model || "gemini-2.0-flash",
        useCache: false,
        saveOutputToFile: false,
        enableQueryExpansion: false,
      },
      undefined,
      developmentProviderKey()
    );
    return result.output || "";
  },
  async isAvailable() {
    // Available when the organization in scope has a key. The platform key this
    // used to check is never set in production, so LLM reranking was always off.
    return !!(await resolveOrgTextAiKey(null));
  },
};

/**
 * Boot the reranking service: load config, instantiate backends, and
 * initialize the singleton service instance.
 *
 * @param configOverride Optional config to use instead of loading from store.
 *   When provided, bypasses the system_config lookup. Useful for testing.
 * @returns The initialized RerankingService singleton.
 */
export async function bootRerankingService(
  configOverride?: RerankBackendConfig
): Promise<RerankingService> {
  logger.info("Booting reranking service...");

  // 1. Load config from system_config table (or use override for testing)
  const config = configOverride ?? await loadRerankingConfig();

  // 2. Instantiate backend adapters
  const backends = new Map<RerankBackendType, RerankBackend>();

  // Cohere backend — always instantiate (availability checked at runtime via API key)
  if (config.cohere) {
    backends.set("cohere", new CohereBackend(config.cohere));
    logger.info("Registered Cohere reranking backend", {
      model: config.cohere.model ?? "rerank-v3.5",
    });
  }

  // Local backend — only instantiate if an endpoint is configured
  if (config.local?.endpoint) {
    backends.set("local", new LocalBackend(config.local));
    logger.info("Registered Local reranking backend", {
      endpoint: config.local.endpoint,
      model: config.local.model ?? "cross-encoder/ms-marco-MiniLM-L-6-v2",
    });
  }

  // LLM backend — uses the router adapter wrapping AIClientFactory
  backends.set("llm", new LLMBackend(config.llm, llmRouterAdapter));
  logger.info("Registered LLM reranking backend", {
    maxDocsPerPrompt: config.llm?.maxDocsPerPrompt ?? 20,
  });

  // 3. Initialize the singleton service
  const service = initRerankingService(config, backends);

  logger.info("Reranking service booted successfully", {
    defaultBackend: config.defaultBackend,
    priorityOrder: config.priorityOrder,
    registeredBackends: Array.from(backends.keys()),
  });

  return service;
}
