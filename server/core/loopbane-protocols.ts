/**
 * Loopbane Protocols
 * 
 * Safety mechanisms to prevent infinite loops and stagnant workflows:
 * - Protocol A: Cycle Breaker (Max Visit Count)
 * - Protocol B: Stagnation Lock (State Change Verification)
 * - Protocol C: Doomsday Clock (Global Timeout)
 */

import { createHash } from "crypto";
import type { StateTracker } from "../integrations/state-tracker.js";
import type { DecisionNodeConfig } from "./decision-node.js";
import type { VariableContext } from "./variable-resolver.js";
import type { PipelineExecution } from "@shared/schema/index.js";

export interface CycleBreakerResult {
  allowed: boolean;
  action?: "route_to_fallback" | "abort_workflow";
  destination?: number;
  logReason?: string;
}

export interface StagnationLockResult {
  allowed: boolean;
  logReason?: string;
}

export interface DoomsdayClockResult {
  allowed: boolean;
  logReason?: string;
}

/**
 * Protocol A: Cycle Breaker
 * 
 * Tracks the number of times a specific Step ID is visited within a single workflow execution.
 * If visit_count >= max_loops, triggers an Emergency Eject.
 */
export async function checkCycleBreaker(
  executionId: number,
  stepId: number,
  safetyPolicy: DecisionNodeConfig["safetyPolicy"],
  stateTracker: StateTracker
): Promise<CycleBreakerResult> {
  if (!safetyPolicy || !safetyPolicy.maxLoops) {
    // No safety policy configured - allow execution
    return { allowed: true };
  }

  const visitCount = await stateTracker.getVisitCount(executionId, stepId);
  const maxLoops = safetyPolicy.maxLoops;

  if (visitCount >= maxLoops) {
    console.warn(
      `[Loopbane Protocol A] Cycle limit exceeded for execution ${executionId}, step ${stepId}: ${visitCount} >= ${maxLoops}`
    );

    const action = safetyPolicy.onLoopLimitExceeded.action;
    return {
      allowed: false,
      action,
      destination: safetyPolicy.onLoopLimitExceeded.destination,
      logReason: safetyPolicy.onLoopLimitExceeded.logReason || `Cycle limit exceeded: ${visitCount} >= ${maxLoops}`,
    };
  }

  return { allowed: true };
}

/**
 * Protocol B: Stagnation Lock
 * 
 * Prevents futile loops by comparing current Data Payload Hash against the hash from the previous visit.
 * If hashes are identical, the loop is declared futile and the workflow aborts.
 */
export async function checkStagnationLock(
  executionId: number,
  stepId: number,
  context: VariableContext & { data?: Record<string, any> },
  safetyPolicy: DecisionNodeConfig["safetyPolicy"],
  stateTracker: StateTracker
): Promise<StagnationLockResult> {
  if (!safetyPolicy || !safetyPolicy.onStagnationDetected) {
    // No stagnation detection configured - allow execution
    return { allowed: true };
  }

  // Calculate current payload hash
  const payload = JSON.stringify({
    named: context.named,
    positional: context.positional,
    data: context.data,
  });
  const currentHash = createHash("sha256").update(payload).digest("hex");

  // Get previous hash (before storing current hash)
  const previousHash = await stateTracker.getPayloadHash(executionId, stepId);

  // Store current hash for next visit (before comparison so first visit's hash is available for second visit)
  await stateTracker.setPayloadHash(executionId, stepId, currentHash);

  if (previousHash && previousHash === currentHash) {
    console.warn(
      `[Loopbane Protocol B] Stagnation detected for execution ${executionId}, step ${stepId}: payload hash unchanged`
    );

    return {
      allowed: false,
      logReason: safetyPolicy.onStagnationDetected.logReason || "Payload hash unchanged - no progress detected",
    };
  }

  return { allowed: true };
}

/**
 * Protocol C: Doomsday Clock
 * 
 * Global failsafe that kills the process if the total workflow duration exceeds the configured TTL.
 */
export function checkDoomsdayClock(
  execution: PipelineExecution
): DoomsdayClockResult {
  if (!execution.ttl || !execution.startedAt) {
    // No TTL configured - allow execution
    return { allowed: true };
  }

  const startedAt = execution.startedAt instanceof Date 
    ? execution.startedAt 
    : new Date(execution.startedAt);
  const now = new Date();
  const elapsed = (now.getTime() - startedAt.getTime()) / 1000; // seconds
  const ttl = execution.ttl;

  if (elapsed >= ttl) {
    console.error(
      `[Loopbane Protocol C] Timeout exceeded for execution ${execution.id}: ${elapsed}s >= ${ttl}s`
    );

    return {
      allowed: false,
      logReason: `Execution timeout: ${elapsed}s >= ${ttl}s`,
    };
  }

  return { allowed: true };
}

/**
 * Calculate payload hash for a context
 * Used by Stagnation Lock (Protocol B)
 */
export function calculatePayloadHash(
  context: VariableContext & { data?: Record<string, any> }
): string {
  const payload = JSON.stringify({
    named: context.named,
    positional: context.positional,
    data: context.data,
  });
  return createHash("sha256").update(payload).digest("hex");
}




