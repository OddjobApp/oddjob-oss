/**
 * Graph Validator
 * 
 * Validates pipeline graphs for:
 * - Valid destinationStepId references
 * - Orphaned steps (unreachable from start)
 * - Cycles (with Loopbane protection)
 * - Decision Node configuration validity
 */

import type { PipelineStep } from "@shared/schema/index.js";
import type { DecisionNodeConfig } from "../core/decision-node.js";

export interface ValidationError {
  type: "error" | "warning";
  message: string;
  stepId?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validate a pipeline graph
 */
export function validatePipelineGraph(steps: PipelineStep[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (steps.length === 0) {
    errors.push({
      type: "error",
      message: "Pipeline must have at least one step",
    });
    return { valid: false, errors, warnings };
  }

  // Build step lookup map
  const stepMap = new Map<number, PipelineStep>();
  for (const step of steps) {
    stepMap.set(step.id, step);
  }

  // Validate destinationStepId references
  for (const step of steps) {
    if (step.destinationStepId !== null && step.destinationStepId !== undefined) {
      if (!stepMap.has(step.destinationStepId)) {
        errors.push({
          type: "error",
          message: `Step ${step.id} references non-existent destination step ${step.destinationStepId}`,
          stepId: step.id,
        });
      }
    }
  }

  // Validate Decision Node configurations
  for (const step of steps) {
    if (step.moduleType === "logic_gatekeeper") {
      const configErrors = validateDecisionNodeConfig(step, stepMap);
      errors.push(...configErrors.filter(e => e.type === "error"));
      warnings.push(...configErrors.filter(e => e.type === "warning"));
    }
  }

  // Check for orphaned steps (unreachable from start)
  const reachableSteps = findReachableSteps(steps, stepMap);
  for (const step of steps) {
    if (!reachableSteps.has(step.id)) {
      warnings.push({
        type: "warning",
        message: `Step ${step.id} is not reachable from the start of the pipeline`,
        stepId: step.id,
      });
    }
  }

  // Detect cycles (warnings only, as Loopbane Protocols will handle at runtime)
  const cycles = detectCycles(steps, stepMap);
  for (const cycle of cycles) {
    warnings.push({
      type: "warning",
      message: `Potential cycle detected: ${cycle.join(" -> ")}. Loopbane Protocols will prevent infinite loops.`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate Decision Node configuration
 */
function validateDecisionNodeConfig(step: PipelineStep, stepMap: Map<number, PipelineStep>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!step.decisionNodeConfig) {
    errors.push({
      type: "error",
      message: `Decision Node step ${step.id} must have decisionNodeConfig`,
      stepId: step.id,
    });
    return errors;
  }

  const config = step.decisionNodeConfig as DecisionNodeConfig;

  // Validate evaluation mode
  if (config.evaluationMode !== "AND" && config.evaluationMode !== "OR") {
    errors.push({
      type: "error",
      message: `Decision Node step ${step.id} has invalid evaluationMode: ${config.evaluationMode}`,
      stepId: step.id,
    });
  }

  // Validate conditions
  if (!config.conditions || config.conditions.length === 0) {
    errors.push({
      type: "error",
      message: `Decision Node step ${step.id} must have at least one condition`,
      stepId: step.id,
    });
  }

  // Validate routes
  if (!config.routes || !config.routes.onMatch) {
    errors.push({
      type: "error",
      message: `Decision Node step ${step.id} must have onMatch route`,
      stepId: step.id,
    });
  } else if (!config.routes.onMatch.destinationStepId) {
    errors.push({
      type: "error",
      message: `Decision Node step ${step.id} onMatch route must have destinationStepId`,
      stepId: step.id,
    });
  } else {
    // Validate that onMatch destinationStepId exists
    if (!stepMap.has(config.routes.onMatch.destinationStepId)) {
      errors.push({
        type: "error",
        message: `Decision Node step ${step.id} onMatch route references non-existent step ${config.routes.onMatch.destinationStepId}`,
        stepId: step.id,
      });
    }
  }

  // Validate onMismatch route if present
  if (config.routes.onMismatch) {
    if (!config.routes.onMismatch.destinationStepId) {
      errors.push({
        type: "error",
        message: `Decision Node step ${step.id} onMismatch route must have destinationStepId`,
        stepId: step.id,
      });
    } else {
      // Validate that onMismatch destinationStepId exists
      if (!stepMap.has(config.routes.onMismatch.destinationStepId)) {
        errors.push({
          type: "error",
          message: `Decision Node step ${step.id} onMismatch route references non-existent step ${config.routes.onMismatch.destinationStepId}`,
          stepId: step.id,
        });
      }
    }
  }

  // Validate safety policy if present
  if (config.safetyPolicy) {
    if (config.safetyPolicy.maxLoops && config.safetyPolicy.maxLoops <= 0) {
      errors.push({
        type: "error",
        message: `Decision Node step ${step.id} maxLoops must be greater than 0`,
        stepId: step.id,
      });
    }

    if (config.safetyPolicy.onLoopLimitExceeded) {
      const action = config.safetyPolicy.onLoopLimitExceeded.action;
      if (action === "route_to_fallback") {
        if (!config.safetyPolicy.onLoopLimitExceeded.destination) {
          errors.push({
            type: "error",
            message: `Decision Node step ${step.id} onLoopLimitExceeded.route_to_fallback requires destination`,
            stepId: step.id,
          });
        } else {
          // Validate that fallback destination exists
          if (!stepMap.has(config.safetyPolicy.onLoopLimitExceeded.destination)) {
            errors.push({
              type: "error",
              message: `Decision Node step ${step.id} onLoopLimitExceeded fallback destination references non-existent step ${config.safetyPolicy.onLoopLimitExceeded.destination}`,
              stepId: step.id,
            });
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Find all reachable steps from the start
 */
function findReachableSteps(
  steps: PipelineStep[],
  stepMap: Map<number, PipelineStep>
): Set<number> {
  const reachable = new Set<number>();
  
  // Start from the step with lowest order
  const startStep = steps.reduce((min, step) => 
    step.order < min.order ? step : min
  );

  // BFS to find all reachable steps
  const queue: number[] = [startStep.id];
  reachable.add(startStep.id);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = stepMap.get(currentId);
    if (!current) continue;

    // Follow destinationStepId if set
    if (current.destinationStepId !== null && current.destinationStepId !== undefined) {
      if (!reachable.has(current.destinationStepId)) {
        reachable.add(current.destinationStepId);
        queue.push(current.destinationStepId);
      }
    }

    // Also follow order-based next step
    const nextByOrder = steps.find(s => s.order === current.order + 1);
    if (nextByOrder && !reachable.has(nextByOrder.id)) {
      reachable.add(nextByOrder.id);
      queue.push(nextByOrder.id);
    }
  }

  return reachable;
}

/**
 * Detect cycles in the graph
 */
function detectCycles(
  steps: PipelineStep[],
  stepMap: Map<number, PipelineStep>
): number[][] {
  const cycles: number[][] = [];
  const visited = new Set<number>();
  const recursionStack = new Set<number>();

  function dfs(stepId: number, path: number[]): void {
    if (recursionStack.has(stepId)) {
      // Cycle detected
      const cycleStart = path.indexOf(stepId);
      cycles.push(path.slice(cycleStart));
      return;
    }

    if (visited.has(stepId)) {
      return;
    }

    visited.add(stepId);
    recursionStack.add(stepId);

    const step = stepMap.get(stepId);
    if (step) {
      if (step.destinationStepId !== null && step.destinationStepId !== undefined) {
        dfs(step.destinationStepId, [...path, stepId]);
      }
    }

    recursionStack.delete(stepId);
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      dfs(step.id, []);
    }
  }

  return cycles;
}


