/**
 * Central registry for AI model pricing.
 * Costs are represented as USD per 1M tokens.
 */
export interface ModelPricing {
    input1M: number;
    output1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
    // Google Gemini
    "gemini-flash-latest": { input1M: 0.075, output1M: 0.30 },
    "gemini-1.5-flash": { input1M: 0.075, output1M: 0.30 },
    "gemini-1.5-flash-8b": { input1M: 0.0375, output1M: 0.15 },
    "gemini-1.5-pro": { input1M: 3.50, output1M: 10.50 },
    "gemini-2.0-flash": { input1M: 0.10, output1M: 0.40 },
    "gemini-2.0-flash-lite": { input1M: 0.075, output1M: 0.30 },
    "gemini-2.0-flash-exp": { input1M: 0, output1M: 0 }, // Experimental free tier
    "gemini-2.5-pro": { input1M: 1.25, output1M: 10.00 }, // <=200k context tier

    // OpenAI
    "gpt-4o": { input1M: 2.50, output1M: 10.00 },
    "gpt-4o-mini": { input1M: 0.15, output1M: 0.60 },
    "o1": { input1M: 15.00, output1M: 60.00 },
    "o1-preview": { input1M: 15.00, output1M: 60.00 },
    "o1-mini": { input1M: 3.00, output1M: 12.00 },
    "o3-mini": { input1M: 1.10, output1M: 4.40 },

    // Meta Model API (Muse Spark) — standard tier; contributor tier trades
    // lower prices for training on your prompts, so it is listed separately.
    "muse-spark-1.3": { input1M: 1.25, output1M: 4.25 },
    "muse-spark-1.2": { input1M: 1.25, output1M: 4.25 },
    "muse-spark-1.1": { input1M: 1.25, output1M: 4.25 },
    "muse-spark-1.3-contributor": { input1M: 0.10, output1M: 0.20 },
    "muse-spark-1.2-contributor": { input1M: 0.10, output1M: 0.20 },

    // Anthropic
    "claude-3-5-sonnet-latest": { input1M: 3.00, output1M: 15.00 },
    "claude-3-5-sonnet-20241022": { input1M: 3.00, output1M: 15.00 },
    "claude-3-7-sonnet-latest": { input1M: 3.00, output1M: 15.00 },
    // Claude 5 generation (Anthropic list prices, Oct 2026). Sonnet 5.5 is the
    // primary crew model since 8 Oct 2026; Opus 5.5 stays bindable.
    "claude-sonnet-5-5": { input1M: 2.00, output1M: 10.00 },
    "claude-opus-5-5": { input1M: 4.00, output1M: 20.00 },
    "claude-sonnet-4-5": { input1M: 3.00, output1M: 15.00 },
    "claude-sonnet-4-6": { input1M: 3.00, output1M: 15.00 },
    "claude-opus-4-7": { input1M: 15.00, output1M: 75.00 },
    "claude-haiku-4-5-20251001": { input1M: 0.80, output1M: 4.00 },
    "claude-3-opus-latest": { input1M: 15.00, output1M: 75.00 },
    "claude-3-haiku-20240307": { input1M: 0.25, output1M: 1.25 },

    // Fallback/Default
    "default": { input1M: 1.00, output1M: 3.00 }
};

/**
 * The Anthropic name inside a Bedrock model ID, so Claude on Bedrock is priced as
 * the same model: us.anthropic.claude-sonnet-4-6 -> claude-sonnet-4-6.
 */
function bedrockClaudeName(model: string): string {
    return model.replace(/^(?:[a-z]+\.)?anthropic\./, "").replace(/-v\d+(?::\d+)?$/, "");
}

/**
 * Calculate the cost of an AI operation in USD.
 */
export function calculateAiCost(model: string, inputTokens: number = 0, outputTokens: number = 0): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING[bedrockClaudeName(model)] || MODEL_PRICING["default"];
    const inputCost = (inputTokens / 1_000_000) * pricing.input1M;
    const outputCost = (outputTokens / 1_000_000) * pricing.output1M;
    return inputCost + outputCost;
}

/**
 * Which vendor bills for a model.
 *
 * Derived from the model name, because that is the only thing every call site
 * reliably has. Returns "unknown" rather than guessing: cost_ledger.provider
 * used to default to "openai", so 132 of 132 recorded rows claimed OpenAI
 * regardless of what actually ran — on a platform whose stated policy is
 * Gemini-first. A wrong attribution is worse than an absent one, because it
 * reads as measurement.
 */
export function providerForModel(model: string | null | undefined): string {
    const m = (model ?? "").toLowerCase();
    if (!m) return "unknown";
    if (/^(?:[a-z]+\.)?anthropic\.claude-/.test(m)) return "bedrock";
    if (m.startsWith("gemini")) return "google";
    if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
    if (m.startsWith("claude")) return "anthropic";
    if (m.startsWith("muse")) return "meta";
    if (m.startsWith("llama") || m.startsWith("mistral") || m.startsWith("qwen")) return "local";
    return "unknown";
}
