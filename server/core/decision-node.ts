/**
 * Decision Node Evaluator
 * 
 * Evaluates Decision Node configurations and determines routing based on CEL conditions.
 * Supports AND/OR evaluation modes and returns routing decisions (onMatch/onMismatch).
 */

import { evaluateCELExpression, CELExpressionError } from "./cel-evaluator.js";
import type { VariableContext } from "./variable-resolver.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { db } from "../database_service.js";
import { credentials, type AIProviderMetadata } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

export interface DecisionNodeConfig {
  evaluationMode: "AND" | "OR";
  conditions: Array<{
    source: string;      // CEL expression path (e.g., "profile.interest_score")
    operator: string;    // GT, LT, EQ, etc.
    target: any;
  }>;
  routes: {
    onMatch: {
      destinationStepId?: number | null;
      action?: "next_step" | "stop_success" | "stop_failure";
      injectContext?: Record<string, any>;
    };
    onMismatch?: {
      destinationStepId?: number | null;
      action?: "next_step" | "stop_success" | "stop_failure";
      injectContext?: Record<string, any>;
    };
  };
  safetyPolicy?: {
    maxLoops: number;
    onLoopLimitExceeded: {
      action: "route_to_fallback" | "abort_workflow";
      destination?: number;
      logReason: string;
    };
    onStagnationDetected: {
      action: "abort_workflow";
      logReason: string;
    };
  };
}

export interface RoutingDecision {
  destinationStepId?: number | null;
  action: "next_step" | "stop_success" | "stop_failure";
  injectContext?: Record<string, any>;
  matched: boolean;
}

/**
 * Evaluate a Decision Node and return routing decision
 * 
 * @param config - Decision Node configuration
 * @param context - Variable context with step outputs and pipeline data
 * @returns Routing decision with destination step ID
 */
export async function evaluateDecisionNode(
  config: DecisionNodeConfig,
  context: VariableContext & { data?: Record<string, any> }
): Promise<RoutingDecision> {
  if (!config.conditions || config.conditions.length === 0) {
    throw new Error("Decision Node must have at least one condition");
  }

  // Evaluate all conditions
  const conditionResults: boolean[] = [];
  for (const condition of config.conditions) {
    try {
      let result = false;
      if (condition.operator === "SEMANTIC_MATCH") {
        result = await evaluateSemanticCondition(condition, context);
      } else {
        result = evaluateCondition(condition, context);
      }
      conditionResults.push(result);
    } catch (error) {
      console.error(`[Decision Node] Error evaluating condition:`, condition, error);
      // On error, treat as false
      conditionResults.push(false);
    }
  }

  // Combine results based on evaluation mode
  let matched: boolean;
  if (config.evaluationMode === "AND") {
    matched = conditionResults.every(result => result === true);
  } else {
    matched = conditionResults.some(result => result === true);
  }

  // Determine routing
  if (matched) {
    return {
      destinationStepId: config.routes.onMatch.destinationStepId,
      action: config.routes.onMatch.action || "next_step",
      injectContext: config.routes.onMatch.injectContext,
      matched: true,
    };
  } else {
    // Use onMismatch route if provided, otherwise use onMatch (fallback)
    if (config.routes.onMismatch) {
      return {
        destinationStepId: config.routes.onMismatch.destinationStepId,
        action: config.routes.onMismatch.action || "next_step",
        injectContext: config.routes.onMismatch.injectContext,
        matched: false,
      };
    } else {
      // No onMismatch route - use onMatch as fallback
      return {
        destinationStepId: config.routes.onMatch.destinationStepId,
        action: config.routes.onMatch.action || "next_step",
        injectContext: config.routes.onMatch.injectContext,
        matched: false,
      };
    }
  }
}

/**
 * Evaluate a single condition
 */
function evaluateCondition(
  condition: DecisionNodeConfig["conditions"][0],
  context: VariableContext & { data?: Record<string, any> }
): boolean {
  // Build CEL expression from condition
  const expression = buildCELExpression(condition);

  // Evaluate using CEL evaluator
  return evaluateCELExpression(expression, context);
}

/**
 * Build CEL expression from condition
 */
function buildCELExpression(condition: {
  source: string;
  operator: string;
  target: any;
}): string {
  const { source, operator, target } = condition;

  // Format target value
  let targetStr: string;
  if (typeof target === "string") {
    targetStr = `"${target.replace(/"/g, '\\"')}"`;
  } else if (typeof target === "number") {
    targetStr = String(target);
  } else if (Array.isArray(target)) {
    targetStr = `[${target.map(v => typeof v === "string" ? `"${v}"` : String(v)).join(", ")}]`;
  } else {
    targetStr = JSON.stringify(target);
  }

  // Handle special operators that use method call syntax
  if (operator === "CONTAINS") {
    return `${source}.contains(${targetStr})`;
  }

  if (operator === "STARTS_WITH") {
    return `${source}.startsWith(${targetStr})`;
  }

  if (operator === "ENDS_WITH") {
    return `${source}.endsWith(${targetStr})`;
  }

  if (operator === "HAS") {
    return `${source}.has(${targetStr})`;
  }

  if (operator === "NOT_HAS") {
    return `!${source}.has(${targetStr})`;
  }

  if (operator === "MATCHES") {
    return `${source}.matches(${targetStr})`;
  }

  // Handle temporal operators
  if (operator === "WITHIN_WINDOW") {
    // Convert time window to comparison (e.g., "7d" -> timestamp comparison)
    return `${source} > timestamp("${getWindowTimestamp(target)}")`;
  }

  if (operator === "BEFORE") {
    return `${source} < timestamp("${getWindowTimestamp(target)}")`;
  }

  if (operator === "AFTER") {
    return `${source} > timestamp("${getWindowTimestamp(target)}")`;
  }

  // Map infix operators (comparison operators)
  const infixOperatorMap: Record<string, string> = {
    "GT": ">",
    "LT": "<",
    "GTE": ">=",
    "LTE": "<=",
    "EQ": "==",
    "NE": "!=",
  };

  const celOperator = infixOperatorMap[operator] || operator;

  // Build expression: source operator target (for infix operators)
  return `${source} ${celOperator} ${targetStr}`;
}

/**
 * Get timestamp for time window (e.g., "7d" -> timestamp 7 days ago)
 */
function getWindowTimestamp(window: string): string {
  // Parse window string (e.g., "7d", "24h", "30m")
  const match = window.match(/^(\d+)([dhms])$/);
  if (!match) {
    throw new Error(`Invalid time window format: ${window}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const now = new Date();
  let timestamp: Date;

  switch (unit) {
    case "d":
      timestamp = new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
      break;
    case "h":
      timestamp = new Date(now.getTime() - value * 60 * 60 * 1000);
      break;
    case "m":
      timestamp = new Date(now.getTime() - value * 60 * 1000);
      break;
    case "s":
      timestamp = new Date(now.getTime() - value * 1000);
      break;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }

  return timestamp.toISOString();
}

/**
 * Evaluate a semantic condition using an LLM
 */
async function evaluateSemanticCondition(
  condition: DecisionNodeConfig["conditions"][0],
  context: VariableContext & { data?: Record<string, any> }
): Promise<boolean> {
  // 1. Resolve source value (the "Context")
  const getPathValue = (obj: any, path: string) => {
    // Handle array access like step.1
    // Split by dot, but maybe handle brackets if needed. 
    // For now, simple dot notation assumes object keys.
    if (!obj) return undefined;
    return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
  };

  // Try to find the value in named context (steps) or general data
  let contextValue: any = getPathValue(context.named, condition.source);
  if (contextValue === undefined && context.data) {
    contextValue = getPathValue(context.data, condition.source);
  }

  // If undefined, might be a string literal? Unlikely in this mode.
  const contextStr = typeof contextValue === 'object' ? JSON.stringify(contextValue) : String(contextValue || "");

  const prompt = `
Context:
"""
${contextStr}
"""

Condition to evaluate: "${condition.target}"

Instructions:
Evaluate if the Context meets the Condition.
Return ONLY the word "TRUE" or "FALSE".
`;

  // 2. Get AI Credential
  // For now, fetch the "first available" AI provider credential in the system.
  // Ideally, the decision node should configure this.
  const allCreds = await db.select().from(credentials).where(eq(credentials.type, "ai_provider")).limit(1);
  if (allCreds.length === 0) {
    console.error("[Decision Node] No AI Provider credential found for Semantic Match");
    return false;
  }

  const credential = allCreds[0];
  const apiKey = (await resolveCredentialSecret(credential));
  if (!apiKey) {
    console.error("[Decision Node] API Key not found for credential", credential.name);
    return false;
  }

  // 3. Call LLM
  try {
    const metadata = credential.metadata as AIProviderMetadata;
    const client = AIClientFactory.getClient(metadata);

    const result = await client.execute({
      credentialId: credential.id,
      model: "gpt-4o-mini", // Default to a fast model. Adjust for other providers if needed.
      userPrompt: prompt,
      temperature: 0,
      useCache: false,
      enableQueryExpansion: false,
      saveOutputToFile: false
    }, undefined, apiKey);

    if (!result.success) {
      console.error("[Decision Node] LLM Call failed:", result.error);
      return false;
    }

    const output = (result.output || "").trim().toUpperCase();
    return output.includes("TRUE");

  } catch (e) {
    console.error("[Decision Node] Semantic evaluation error:", e);
    return false;
  }
}




