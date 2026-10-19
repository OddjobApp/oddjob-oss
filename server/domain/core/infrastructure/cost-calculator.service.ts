/**
 * AI Cost Calculator
 * 
 * Calculates costs for AI API calls based on provider, model, and token usage.
 * Pricing tables are in USD per 1M tokens.
 */

// Pricing tables (in USD per 1M tokens)
// These should be updated regularly as providers adjust pricing
const PRICING_TABLES = {
  openai: {
    "gpt-4o": { prompt: 2.50, completion: 10.00 },
    "gpt-4o-2024-05-13": { prompt: 2.50, completion: 10.00 },
    "gpt-4-turbo": { prompt: 10.00, completion: 30.00 },
    "gpt-4-turbo-2024-04-09": { prompt: 10.00, completion: 30.00 },
    "gpt-4": { prompt: 30.00, completion: 60.00 },
    "gpt-4-0613": { prompt: 30.00, completion: 60.00 },
    "gpt-3.5-turbo": { prompt: 0.50, completion: 1.50 },
    "gpt-3.5-turbo-0125": { prompt: 0.50, completion: 1.50 },
    "gpt-3.5-turbo-1106": { prompt: 0.50, completion: 1.50 },
  },
  anthropic: {
    "claude-3-opus-20240229": { prompt: 15.00, completion: 75.00 },
    "claude-3-opus": { prompt: 15.00, completion: 75.00 },
    "claude-3-sonnet-20240229": { prompt: 3.00, completion: 15.00 },
    "claude-3-sonnet": { prompt: 3.00, completion: 15.00 },
    "claude-3-haiku-20240307": { prompt: 0.25, completion: 1.25 },
    "claude-3-haiku": { prompt: 0.25, completion: 1.25 },
    "claude-2.1": { prompt: 8.00, completion: 24.00 },
    "claude-2.0": { prompt: 8.00, completion: 24.00 },
    "claude-instant-1.2": { prompt: 0.80, completion: 2.40 },
  },
  google: {
    "gemini-1.5-pro": { prompt: 1.25, completion: 5.00 },
    "gemini-1.5-pro-latest": { prompt: 1.25, completion: 5.00 },
    "gemini-1.5-flash": { prompt: 0.075, completion: 0.30 },
    "gemini-1.5-flash-latest": { prompt: 0.075, completion: 0.30 },
    "gemini-pro": { prompt: 0.50, completion: 1.50 },
    "gemini-pro-vision": { prompt: 0.25, completion: 0.25 },
  },
} as const;

// Default fallback rates (conservative estimates)
const DEFAULT_RATES = {
  openai: { prompt: 5.00, completion: 15.00 },
  anthropic: { prompt: 5.00, completion: 25.00 },
  google: { prompt: 0.50, completion: 2.00 },
} as const;

/**
 * Normalize model name to handle variations (e.g., "gpt-4o" vs "gpt-4o-2024-05-13")
 */
function normalizeModelName(provider: string, model: string): string {
  const modelLower = model.toLowerCase().trim();
  const providerKey = provider.toLowerCase() as keyof typeof PRICING_TABLES;
  const providerPricing = PRICING_TABLES[providerKey];
  
  if (!providerPricing) {
    return modelLower;
  }
  
  // Try exact match first
  if (modelLower in providerPricing) {
    return modelLower;
  }
  
  // Try to match base model name (remove version suffixes)
  // e.g., "gpt-4o-2024-05-13" -> "gpt-4o"
  const baseModelMatch = Object.keys(providerPricing).find((key) => modelLower.startsWith(key));
  
  if (baseModelMatch) {
    return baseModelMatch;
  }
  
  // Return original if no match found
  return modelLower;
}

/**
 * Calculate the cost of an AI API call
 * 
 * @param provider - AI provider ('openai', 'anthropic', 'google')
 * @param model - Model name (e.g., 'gpt-4o', 'claude-3-sonnet')
 * @param promptTokens - Number of prompt/input tokens
 * @param completionTokens - Number of completion/output tokens
 * @returns Cost in USD
 */
export function calculateCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  if (promptTokens < 0 || completionTokens < 0) {
    console.warn(`[Cost Calculator] Negative token counts: prompt=${promptTokens}, completion=${completionTokens}`);
    return 0;
  }

  if (promptTokens === 0 && completionTokens === 0) {
    return 0;
  }

  const providerKey = provider.toLowerCase() as keyof typeof PRICING_TABLES;
  const normalizedModel = normalizeModelName(provider, model);
  
  // Get pricing for this provider/model combination
  const providerPricing = PRICING_TABLES[providerKey];
  if (!providerPricing) {
    console.warn(`[Cost Calculator] Unknown provider: ${provider}. Using default rates.`);
    const defaultRate = DEFAULT_RATES[providerKey] || DEFAULT_RATES.openai;
    const promptCost = (promptTokens / 1_000_000) * defaultRate.prompt;
    const completionCost = (completionTokens / 1_000_000) * defaultRate.completion;
    return promptCost + completionCost;
  }

  const modelPricing = (providerPricing as Record<string, { prompt: number; completion: number }>)[normalizedModel];
  if (!modelPricing) {
    console.warn(
      `[Cost Calculator] Unknown model: ${model} (normalized: ${normalizedModel}) for provider ${provider}. Using default rates.`
    );
    const defaultRate = DEFAULT_RATES[providerKey] || DEFAULT_RATES.openai;
    const promptCost = (promptTokens / 1_000_000) * defaultRate.prompt;
    const completionCost = (completionTokens / 1_000_000) * defaultRate.completion;
    return promptCost + completionCost;
  }

  // Calculate cost: (tokens / 1M) * price_per_1M_tokens
  const promptCost = (promptTokens / 1_000_000) * modelPricing.prompt;
  const completionCost = (completionTokens / 1_000_000) * modelPricing.completion;
  
  const totalCost = promptCost + completionCost;
  
  // Round to 6 decimal places for precision
  return Math.round(totalCost * 1_000_000) / 1_000_000;
}

/**
 * Get pricing information for a specific model
 */
export function getModelPricing(provider: string, model: string): {
  prompt: number;
  completion: number;
  provider: string;
  model: string;
} | null {
  const providerKey = provider.toLowerCase() as keyof typeof PRICING_TABLES;
  const normalizedModel = normalizeModelName(provider, model);
  
  const providerPricing = PRICING_TABLES[providerKey];
  if (!providerPricing) {
    return null;
  }

  const modelPricing = (providerPricing as Record<string, { prompt: number; completion: number }>)[normalizedModel];
  if (!modelPricing) {
    return null;
  }

  return {
    prompt: modelPricing.prompt,
    completion: modelPricing.completion,
    provider: providerKey,
    model: normalizedModel,
  };
}

/**
 * Extract token counts from AI API response metadata
 * Different providers return token counts in different formats
 */
export function extractTokenCounts(
  provider: string,
  metadata: any
): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const providerLower = provider.toLowerCase();
  
  if (providerLower === "openai") {
    // OpenAI format: { usage: { prompt_tokens: X, completion_tokens: Y, total_tokens: Z } }
    const promptTokens = metadata?.usage?.prompt_tokens || 0;
    const completionTokens = metadata?.usage?.completion_tokens || 0;
    const totalTokens = metadata?.usage?.total_tokens || promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
  }
  
  if (providerLower === "anthropic") {
    // Anthropic format: { usage: { input_tokens: X, output_tokens: Y } }
    const promptTokens = metadata?.usage?.input_tokens || 0;
    const completionTokens = metadata?.usage?.output_tokens || 0;
    const totalTokens = promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
  }
  
  if (providerLower === "google") {
    // Google format: { usageMetadata: { promptTokenCount: X, candidatesTokenCount: Y, totalTokenCount: Z } }
    const promptTokens = metadata?.usageMetadata?.promptTokenCount || 0;
    const completionTokens = metadata?.usageMetadata?.candidatesTokenCount || 0;
    const totalTokens = metadata?.usageMetadata?.totalTokenCount || promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
  }
  
  // Fallback: try to extract from common fields
  const promptTokens = metadata?.promptTokens || metadata?.inputTokens || metadata?.prompt_tokens || 0;
  const completionTokens = metadata?.completionTokens || metadata?.outputTokens || metadata?.completion_tokens || 0;
  const totalTokens = metadata?.totalTokens || metadata?.tokensUsed || promptTokens + completionTokens;
  
  return { promptTokens, completionTokens, totalTokens };
}





