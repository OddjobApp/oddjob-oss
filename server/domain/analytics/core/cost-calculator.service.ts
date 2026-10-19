import { getModelPricing } from "@server/config/ai-pricing.js";
import { tokenCounterService } from "@domain/core/infrastructure/token-counter.service.js";
import { toolAnalyticsService } from "@domain/agents/core/tool-analytics.service.js";

export interface CostEstimate {
  inputTokens: number;
  estimatedOutputTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  breakdown: {
    inputCost: number;
    outputCost: number;
    toolCosts: number;
  };
}

/**
 * Cost Calculator Service
 * Estimates costs for AI-driven operations.
 */
export const costCalculatorService = {
  /**
   * Estimate cost for a single AI API call
   */
  estimateCallCost(
    prompt: string,
    model: string,
    taskType: string = "general"
  ): CostEstimate {
    const pricing = getModelPricing(model);

    // Default to a middle-ground pricing if not found (e.g., GPT-4o-mini rates)
    const activePricing = pricing || {
      model: "default",
      provider: "default",
      inputPricePerMillion: 0.15,
      outputPricePerMillion: 0.60
    };

    const inputTokens = tokenCounterService.countTokens(prompt, model);
    const estimatedOutputTokens = tokenCounterService.estimateOutputTokens(taskType, inputTokens);

    const inputCost = (inputTokens / 1_000_000) * activePricing.inputPricePerMillion;
    const outputCost = (estimatedOutputTokens / 1_000_000) * activePricing.outputPricePerMillion;

    return {
      inputTokens,
      estimatedOutputTokens,
      totalTokens: inputTokens + estimatedOutputTokens,
      estimatedCostUSD: inputCost + outputCost,
      breakdown: {
        inputCost,
        outputCost,
        toolCosts: 0 // Placeholder for future tool-specific costs
      }
    };
  },

  /**
   * Estimate cost for an entire agent loop or supervisor plan
   */
  async estimateAgentLoopCost(
    goal: string,
    model: string,
    maxIterations: number = 5
  ): Promise<CostEstimate> {
    const taskType = toolAnalyticsService.inferTaskType(goal);

    // Estimate cost per iteration
    // Typically: Iteration 1 (planning) + Iteration 2 (tool use) + Iteration 3 (verification)
    const baseEstimate = this.estimateCallCost(goal, model, taskType);

    // Heuristic: Agent loops multiply basic call cost based on depth
    // Each iteration typically adds some history context, making it slightly more expensive
    const depthMultiplier = Math.min(maxIterations, 3); // Average loop depth is 2-3
    const loopFactor = 1.2; // 20% compound increase per iteration for history tokens

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalInputCost = 0;
    let totalOutputCost = 0;

    for (let i = 0; i < depthMultiplier; i++) {
      const iterationInput = baseEstimate.inputTokens * Math.pow(loopFactor, i);
      const iterationOutput = baseEstimate.estimatedOutputTokens;

      totalInputTokens += iterationInput;
      totalOutputTokens += iterationOutput;

      totalInputCost += (iterationInput / 1_000_000) * (getModelPricing(model)?.inputPricePerMillion || 0.15);
      totalOutputCost += (iterationOutput / 1_000_000) * (getModelPricing(model)?.outputPricePerMillion || 0.60);
    }

    return {
      inputTokens: Math.ceil(totalInputTokens),
      estimatedOutputTokens: Math.ceil(totalOutputTokens),
      totalTokens: Math.ceil(totalInputTokens + totalOutputTokens),
      estimatedCostUSD: totalInputCost + totalOutputCost,
      breakdown: {
        inputCost: totalInputCost,
        outputCost: totalOutputCost,
        toolCosts: 0
      }
    };
  }
};

/**
 * Extract token counts from provider-specific metadata
 */
export function extractTokenCounts(provider: string, metadata: any): { promptTokens: number; completionTokens: number } {
  if (!metadata) return { promptTokens: 0, completionTokens: 0 };

  // OpenAI / Standard format
  if (metadata.usage) {
    return {
      promptTokens: metadata.usage.prompt_tokens || metadata.usage.input_tokens || 0,
      completionTokens: metadata.usage.completion_tokens || metadata.usage.output_tokens || 0
    };
  }

  // Anthropic format
  if (metadata.input_tokens || metadata.output_tokens) {
    return {
      promptTokens: metadata.input_tokens || 0,
      completionTokens: metadata.output_tokens || 0
    };
  }

  // Fallback for direct properties
  return {
    promptTokens: metadata.prompt_tokens || metadata.promptTokens || 0,
    completionTokens: metadata.completion_tokens || metadata.completionTokens || 0
  };
}

/**
 * Calculate actual cost based on token counts and model pricing
 */
export function calculateCost(
  provider: string,
  modelName: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = getModelPricing(modelName);

  if (!pricing) {
    // Fallback to a cheap default if unknown
    const defaultInputPrice = 0.15;
    const defaultOutputPrice = 0.60;
    return ((promptTokens / 1_000_000) * defaultInputPrice) +
      ((completionTokens / 1_000_000) * defaultOutputPrice);
  }

  const inputCost = (promptTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPricePerMillion;

  return inputCost + outputCost;
}

