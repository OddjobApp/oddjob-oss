/**
 * LLM Cognitive Evaluator Service (GRIE Stage 2 Evaluator)
 *
 * Implements LLM-as-a-Judge cognitive evaluation for fuzzy AI criteria:
 * - sentiment_polarity (μ ∈ [-1.0 ... +1.0])
 * - sentiment_panic_distress (μ ∈ [0.0 ... 1.0])
 * - tone_assertiveness (μ ∈ [0.0 ... 1.0])
 * - strategic_relevance (μ ∈ [0.0 ... 1.0])
 * - perceived_urgency (μ ∈ [0.0 ... 1.0])
 */

import type { EventPrimitive } from "@shared/schema/signal-intelligence.js";
import { ORG_GEMINI_KEY_MISSING, resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";

export interface FuzzyEvaluationResult {
  metric: string;
  score: number; // Normalized fuzzy membership value
  reasoning: string;
  evaluatedAt: string;
}

export class LLMCognitiveEvaluatorService {
  /**
   * Evaluates a fuzzy prompt directive against an event primitive
   */
  async evaluateFuzzyCondition(
    event: EventPrimitive,
    metric: string,
    promptDirective: string,
    modelName: string = "gemini-1.5-flash"
  ): Promise<FuzzyEvaluationResult> {
    const fallbackScore = this.computeRuleBasedFallback(event, metric);
    // Judged on the event's organization's key, resolved per call: a key read
    // once at construction was the platform's, which production never sets.
    const apiKey = await resolveOrgGeminiKey(event.organizationId);

    if (!apiKey) {
      return {
        metric,
        score: fallbackScore,
        reasoning: `Rule-based heuristic fallback (${ORG_GEMINI_KEY_MISSING})`,
        evaluatedAt: new Date().toISOString(),
      };
    }

    try {
      const prompt = `
You are an expert Decision Intelligence Evaluator.
Analyze the following event primitive text and evaluate it against the requested qualitative directive.

EVENT DETAILS:
- Event Type: ${event.eventType}
- Target Sector: ${event.targetSector}
- Jurisdiction: ${event.jurisdiction}
- Severity: ${event.severity}
- Confidence: ${event.confidenceScore}
- Text Content: "${event.rawText?.slice(0, 1000) || event.eventType}"

QUALITATIVE DIRECTIVE TO EVALUATE:
"${promptDirective}"

METRIC TARGET: "${metric}"

INSTRUCTIONS:
Return a JSON object with:
1. "score": A single float number.
   - For "sentiment_polarity", output a float between -1.0 (extremely hostile/crisis) and +1.0 (extremely favorable).
   - For all other metrics ("strategic_relevance", "perceived_urgency", "panic_distress"), output a float between 0.0 (low) and 1.0 (high).
2. "reasoning": A 1-2 sentence justification for the score.

Respond ONLY with valid JSON in format: {"score": -0.85, "reasoning": "..."}
`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini API returned status ${response.status}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      const parsed = JSON.parse(rawText);
      const score = typeof parsed.score === "number" ? Math.max(-1.0, Math.min(1.0, parsed.score)) : fallbackScore;

      return {
        metric,
        score,
        reasoning: parsed.reasoning || "Evaluated by Gemini Cognitive Engine",
        evaluatedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      console.warn(`[GRIE Cognitive Evaluator] Gemini call failed for ${metric}, using fallback:`, err.message);
      return {
        metric,
        score: fallbackScore,
        reasoning: `Rule-based fallback due to API error: ${err.message}`,
        evaluatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * High-speed heuristic fallback when LLM API is offline or unconfigured
   */
  private computeRuleBasedFallback(event: EventPrimitive, metric: string): number {
    const text = (event.rawText || "").toLowerCase();
    const isCritical = event.severity === "Critical" || event.severity === "High";

    switch (metric) {
      case "sentiment_polarity":
        if (text.includes("strike") || text.includes("collapse") || text.includes("hostile") || text.includes("lawsuit")) return -0.85;
        if (text.includes("partnership") || text.includes("growth") || text.includes("record profit")) return 0.80;
        return isCritical ? -0.50 : 0.0;

      case "sentiment_panic_distress":
      case "perceived_urgency":
        if (isCritical) return 0.85;
        if (event.confidenceScore > 0.8) return 0.70;
        return 0.40;

      case "strategic_relevance":
      case "actionability_index":
        return event.confidenceScore >= 0.7 ? 0.80 : 0.50;

      default:
        return 0.50;
    }
  }
}

export const llmCognitiveEvaluator = new LLMCognitiveEvaluatorService();
