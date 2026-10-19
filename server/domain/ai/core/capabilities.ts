/**
 * Unified AI Model Capabilities
 * Defines what a model can do, enabling capability-based routing.
 */

export enum ModelCapability {
    /** Supports structured JSON output reliably */
    JSON = "json",
    /** Can process image inputs */
    VISION = "vision",
    /** Supports function calling / tool use */
    TOOLS = "tools",
    /** Supports Multi-Token Prediction */
    MTP = "mtp",
    /** Runs locally (no external cost, high privacy) */
    LOCAL = "local",
    /** Low cost per token (e.g., flash models) */
    CHEAP = "cheap",
    /** Low latency response */
    FAST = "fast"
}

export interface ModelMetadata {
    modelId: string;
    providerName: string;
    capabilities: ModelCapability[];
    /** Quality score from 0-100 */
    qualityScore?: number;
    /** Speed score from 0-100 */
    speedScore?: number;
}

/**
 * Static registry of model capabilities.
 * This complements the database-driven models by providing capability flags.
 */
export const MODEL_CAPABILITIES: Record<string, ModelCapability[]> = {
    // Gemini
    "gemini-1.5-flash": [ModelCapability.JSON, ModelCapability.VISION, ModelCapability.TOOLS, ModelCapability.CHEAP, ModelCapability.FAST],
    "gemini-1.5-pro": [ModelCapability.JSON, ModelCapability.VISION, ModelCapability.TOOLS],
    "gemini-2.0-flash": [ModelCapability.JSON, ModelCapability.VISION, ModelCapability.TOOLS, ModelCapability.CHEAP, ModelCapability.FAST],
    "gemini-2.5-pro": [ModelCapability.JSON, ModelCapability.VISION, ModelCapability.TOOLS],

    // OpenAI
    "gpt-4o": [ModelCapability.JSON, ModelCapability.VISION, ModelCapability.TOOLS],
    "gpt-4o-mini": [ModelCapability.JSON, ModelCapability.VISION, ModelCapability.TOOLS, ModelCapability.CHEAP, ModelCapability.FAST],
    "o1": [ModelCapability.JSON, ModelCapability.TOOLS],
    "o3-mini": [ModelCapability.JSON, ModelCapability.TOOLS, ModelCapability.FAST],

    // Local Models (via Ollama or vLLM)
    "llama3.2": [ModelCapability.LOCAL, ModelCapability.CHEAP, ModelCapability.FAST],
    "qwen2.5": [ModelCapability.LOCAL, ModelCapability.JSON, ModelCapability.CHEAP],
    "deepseek-r1": [ModelCapability.LOCAL, ModelCapability.TOOLS]
};

/**
 * Helper to check if a model has a capability
 */
export function hasCapability(modelId: string, capability: ModelCapability): boolean {
    const caps = MODEL_CAPABILITIES[modelId] || [];
    return caps.includes(capability);
}

/**
 * Helper to get capabilities for a model
 */
export function getCapabilities(modelId: string): ModelCapability[] {
    return MODEL_CAPABILITIES[modelId] || [];
}
