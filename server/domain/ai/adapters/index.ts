/**
 * LLM Provider Adapters
 * 
 * This module exports all LLM provider adapters for the router.
 * Adapters translate between the unified LLMRequest/LLMResponse format
 * and each provider's specific API format.
 */

export { openAIAdapter } from "./openai.adapter.js";
export { anthropicAdapter } from "./anthropic.adapter.js";
export { googleAdapter } from "./google.adapter.js";
export { azureAdapter } from "./azure.adapter.js";
export { mockLLMAdapter, mockLLMRegistry } from "./mock-llm.adapter.js";
export { ollamaAdapter, extractReasoningTokens } from "./ollama.adapter.js";

export type {
    LLMRequest,
    LLMResponse,
    LLMAdapter,
    LLMMessage,
} from "./types.js";
