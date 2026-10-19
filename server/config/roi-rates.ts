export interface TokenRate {
    prompt: number;     // USD per 1M tokens
    completion: number; // USD per 1M tokens
}

/**
 * Global Token Pricing Configuration
 * Units: USD per 1,000,000 tokens
 */
export const TOKEN_RATES: Record<string, TokenRate> = {
    "gemini-1.5-pro": { prompt: 3.5, completion: 10.5 },
    "gemini-1.5-flash": { prompt: 0.075, completion: 0.3 },
    "gemini-2.0-flash": { prompt: 0.10, completion: 0.4 },
    "gpt-4o": { prompt: 5.0, completion: 15.0 },
    "gpt-4o-mini": { prompt: 0.15, completion: 0.60 },
    "claude-3-5-sonnet": { prompt: 3.0, completion: 15.0 },
    "default": { prompt: 1.0, completion: 3.0 }
};

/**
 * Helper to get rates for a model with fallback
 */
export function getModelRates(modelId: string): TokenRate {
    if (modelId.includes("gemini-1.5-pro")) return TOKEN_RATES["gemini-1.5-pro"];
    if (modelId.includes("gemini-1.5-flash")) return TOKEN_RATES["gemini-1.5-flash"];
    if (modelId.includes("gemini-2.0-flash")) return TOKEN_RATES["gemini-2.0-flash"];
    if (modelId.includes("gpt-4o-mini")) return TOKEN_RATES["gpt-4o-mini"];
    if (modelId.includes("gpt-4o")) return TOKEN_RATES["gpt-4o"];
    if (modelId.includes("claude-3-5-sonnet")) return TOKEN_RATES["claude-3-5-sonnet"];
    
    return TOKEN_RATES[modelId] || TOKEN_RATES.default;
}
