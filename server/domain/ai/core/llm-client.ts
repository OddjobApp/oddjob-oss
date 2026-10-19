import { AIClientFactory, AIResponse } from "./ai-client.service.js";
import { AIApiCallConfig } from "@shared/schema/index.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

/**
 * Unified LLM Client that provides a simpler API for agent services.
 * Implements the interface expected by HybridReasoningService and ConstitutionalAIService.
 */
export class LLMClient {
  private apiKey: string;
  private defaultProvider: string = "openai";
  private baseUrl?: string;

  constructor(options: { apiKey?: string; provider?: string }) {
    // Default to Google/Gemini; fall back to OpenAI only when explicitly configured
    this.defaultProvider = options.provider || process.env.AI_PROVIDER || "google";
    this.apiKey = options.apiKey ||
      (this.defaultProvider === "google" ? developmentProviderKey() :
       this.defaultProvider === "ollama" ? "" :
       developmentProviderKey("openai"));
  }

  /**
   * Complete a prompt using the default or specified model.
   */
  async complete(params: {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<CompleteResponse> {
    const provider = this.defaultProvider;
    const client = AIClientFactory.getClient({ provider, baseUrl: this.baseUrl } as any);
    const defaultModel = provider === "google" ? "gemini-2.0-flash" :
                         provider === "ollama" ? "llama3.2:latest" : "gpt-4o";

    const config: AIApiCallConfig = {
      model: params.model || defaultModel,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      baseUrl: this.baseUrl,
      userPrompt: params.messages[params.messages.length - 1].content,
      systemPrompt: params.messages.find(m => m.role === 'system')?.content || ""
    } as any;

    const response: AIResponse = await client.execute(config, config.userPrompt, this.apiKey);

    if (!response.success) {
      throw new Error(`LLM Error: ${response.error}`);
    }

    return {
      content: response.output || "",
      usage: response.metadata
    };
  }

  /**
   * Simple prompt completion (string in, string out).
   * Implements the interface expected by HybridReasoningService.
   */
  async generate(params: {
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    model?: string;
  }): Promise<string> {
    const result = await this.complete({
      model: params.model,
      messages: [{ role: 'user', content: params.prompt }],
      temperature: params.temperature,
      maxTokens: params.maxTokens
    });
    return result.content;
  }

  /**
   * Generate structured output based on a JSON schema.
   */
  async generateStructured<T>(params: {
    prompt: string;
    schema: object;
    temperature?: number;
    maxTokens?: number;
    model?: string;
  }): Promise<T> {
    const provider = this.defaultProvider;
    const client = AIClientFactory.getClient({ provider, baseUrl: this.baseUrl } as any);

    const config: AIApiCallConfig = {
      model: params.model || "gpt-4o",
      userPrompt: params.prompt,
      temperature: params.temperature ?? 0.1,
      maxTokens: params.maxTokens,
      baseUrl: this.baseUrl,
      requestType: "json"
    } as any;

    const response: AIResponse = await client.execute(config, params.prompt, this.apiKey);

    if (!response.success) {
      throw new Error(`LLM Structured Error: ${response.error}`);
    }

    try {
      const output = response.output || "{}";
      // Handle cases where the model might wrap the JSON in code blocks
      const jsonStr = output.replace(/```json\n?([\s\S]*?)\n?```/, '$1').trim();
      return JSON.parse(jsonStr) as T;
    } catch (e) {
      throw new Error(`Failed to parse structured LLM response: ${e}`);
    }
  }
}

export interface CompleteResponse {
  content: string;
  usage?: any;
}

