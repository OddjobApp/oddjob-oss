export interface ModelPricing {
    model: string;
    provider: string;
    inputPricePerMillion: number;  // USD per 1M tokens
    outputPricePerMillion: number;
}

/**
 * AI Model Pricing Configuration
 * Prices are in USD per 1 million tokens as of Feb 2026.
 */
export const AI_MODEL_PRICING: ModelPricing[] = [
    // OpenAI
    { model: "gpt-4o", provider: "openai", inputPricePerMillion: 2.50, outputPricePerMillion: 10 },
    { model: "gpt-4o-mini", provider: "openai", inputPricePerMillion: 0.15, outputPricePerMillion: 0.60 },
    { model: "o1-preview", provider: "openai", inputPricePerMillion: 15, outputPricePerMillion: 60 },
    { model: "gpt-4-turbo", provider: "openai", inputPricePerMillion: 10, outputPricePerMillion: 30 },
    { model: "gpt-3.5-turbo", provider: "openai", inputPricePerMillion: 0.5, outputPricePerMillion: 1.5 },

    // Anthropic
    { model: "claude-3-5-sonnet", provider: "anthropic", inputPricePerMillion: 3, outputPricePerMillion: 15 },
    { model: "claude-3-opus", provider: "anthropic", inputPricePerMillion: 15, outputPricePerMillion: 75 },
    { model: "claude-3-haiku", provider: "anthropic", inputPricePerMillion: 0.25, outputPricePerMillion: 1.25 },

    // Google
    { model: "gemini-2.0-flash", provider: "google", inputPricePerMillion: 0.10, outputPricePerMillion: 0.40 },
    { model: "gemini-1.5-pro", provider: "google", inputPricePerMillion: 3.5, outputPricePerMillion: 10.5 },
    { model: "gemini-1.5-flash", provider: "google", inputPricePerMillion: 0.075, outputPricePerMillion: 0.30 },

    // DeepSeek (via OpenRouter or direct)
    { model: "deepseek-v3", provider: "deepseek", inputPricePerMillion: 0.14, outputPricePerMillion: 0.28 },
    { model: "deepseek-r1", provider: "deepseek", inputPricePerMillion: 0.55, outputPricePerMillion: 2.19 },

    // Local (Ollama) - Free
    { model: "llama3", provider: "ollama", inputPricePerMillion: 0, outputPricePerMillion: 0 },
    { model: "llama3.1", provider: "ollama", inputPricePerMillion: 0, outputPricePerMillion: 0 },
    { model: "mistral", provider: "ollama", inputPricePerMillion: 0, outputPricePerMillion: 0 },
];

/**
 * Get pricing for a specific model
 */
export function getModelPricing(modelName: string): ModelPricing | undefined {
    // Try exact match first
    let pricing = AI_MODEL_PRICING.find(p => p.model === modelName);

    if (!pricing) {
        // Try partial match (e.g., "gpt-4" targets "gpt-4-turbo")
        pricing = AI_MODEL_PRICING.find(p => modelName.startsWith(p.model) || p.model.startsWith(modelName));
    }

    return pricing;
}

