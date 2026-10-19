import type { WavePlanItem } from "./types";

export interface DagValidationResult {
  hasCycle: boolean;
  /** Waves with no estimate: their hours are unknown, not zero. */
  unestimatedWaveCount: number;
  cycleNodeIds: string[];
  totalCostUsd: number;
  criticalPathHours: number;
  totalDurationHours: number;
  isBudgetExceeded: boolean;
  isSlaExceeded: boolean;
  warnings: string[];
}

/**
 * Detect circular dependencies in waves using DFS cycle detection.
 */
export function detectCycles(waves: WavePlanItem[]): { hasCycle: boolean; cycleNodeIds: string[] } {
  const waveMap = new Map<string, WavePlanItem>();
  waves.forEach((w) => waveMap.set(w.id, w));

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cyclePath: string[] = [];

  function dfs(currentId: string, path: string[]): boolean {
    visited.add(currentId);
    recursionStack.add(currentId);
    path.push(currentId);

    const wave = waveMap.get(currentId);
    const deps = wave?.dependencies || [];

    for (const depId of deps) {
      if (!waveMap.has(depId)) continue; // ignore non-existent dependencies

      if (!visited.has(depId)) {
        if (dfs(depId, path)) return true;
      } else if (recursionStack.has(depId)) {
        // Cycle detected
        const cycleStartIndex = path.indexOf(depId);
        cyclePath.push(...path.slice(cycleStartIndex), depId);
        return true;
      }
    }

    recursionStack.delete(currentId);
    path.pop();
    return false;
  }

  for (const wave of waves) {
    if (!visited.has(wave.id)) {
      if (dfs(wave.id, [])) {
        return { hasCycle: true, cycleNodeIds: cyclePath };
      }
    }
  }

  return { hasCycle: false, cycleNodeIds: [] };
}

/**
 * Validates DAG feasibility, budget ceiling, and SLA overruns.
 */
export function validateWavePlan(
  waves: WavePlanItem[],
  budgetLimitUsd: number,
  targetSlaDays: number
): DagValidationResult {
  const warnings: string[] = [];
  const cycleCheck = detectCycles(waves);

  if (cycleCheck.hasCycle) {
    const cycleNames = cycleCheck.cycleNodeIds
      .map((id) => waves.find((w) => w.id === id)?.name || id)
      .join(" -> ");
    warnings.push(`Circular dependency detected: ${cycleNames}`);
  }

  const totalCostUsd = waves.reduce(
    (acc, w) => acc + (w.assignee.estimatedCostUsd || 0),
    0
  );
  const isBudgetExceeded = totalCostUsd > budgetLimitUsd;
  if (isBudgetExceeded) {
    warnings.push(
      `Budget ceiling exceeded: $${totalCostUsd.toFixed(2)} > $${budgetLimitUsd.toFixed(2)} USD`
    );
  }

  const criticalPathWaves = waves.filter((w) => w.isCriticalPath);
  const criticalPathHours = criticalPathWaves.reduce(
    (acc, w) => acc + w.estimatedDurationHours,
    0
  );
  const slaTargetHours = targetSlaDays * 8;
  const isSlaExceeded = criticalPathHours > slaTargetHours;
  if (isSlaExceeded) {
    warnings.push(
      `Critical path SLA overrun: ${criticalPathHours}h > ${slaTargetHours}h (${targetSlaDays} days)`
    );
  }

  const totalDurationHours = waves.reduce(
    (acc, w) => acc + w.estimatedDurationHours,
    0
  );

  // A wave nobody estimated contributes 0 hours, so an SLA that "passes" may only
  // be passing because part of the plan has no duration. Say which.
  const unestimated = waves.filter(
    (w) => w.estimateSource === "unestimated" || w.estimatedDurationHours <= 0
  );
  if (unestimated.length > 0) {
    warnings.push(
      `${unestimated.length} of ${waves.length} wave(s) have no estimate, so the critical path and SLA verdict cover only the rest: ${unestimated
        .map((w) => w.name)
        .join(", ")}`
    );
  }

  return {
    unestimatedWaveCount: unestimated.length,
    hasCycle: cycleCheck.hasCycle,
    cycleNodeIds: cycleCheck.cycleNodeIds,
    totalCostUsd,
    criticalPathHours,
    totalDurationHours,
    isBudgetExceeded,
    isSlaExceeded,
    warnings,
  };
}

/**
 * Automatically recalculates critical path based on longest dependency chain.
 */
export function autoBalanceCriticalPath(waves: WavePlanItem[]): WavePlanItem[] {
  if (waves.length === 0) return [];

  const waveMap = new Map<string, WavePlanItem>();
  waves.forEach((w) => waveMap.set(w.id, w));

  // Compute longest path from roots
  const memoEarliestFinish = new Map<string, number>();

  function getEarliestFinish(waveId: string, visited = new Set<string>()): number {
    if (memoEarliestFinish.has(waveId)) return memoEarliestFinish.get(waveId)!;
    if (visited.has(waveId)) return 0; // break cycle if present

    visited.add(waveId);
    const wave = waveMap.get(waveId);
    if (!wave) return 0;

    const depFinishes = (wave.dependencies || []).map((depId) =>
      getEarliestFinish(depId, new Set(visited))
    );
    const maxDepFinish = depFinishes.length > 0 ? Math.max(...depFinishes) : 0;
    const ef = maxDepFinish + wave.estimatedDurationHours;

    memoEarliestFinish.set(waveId, ef);
    return ef;
  }

  waves.forEach((w) => getEarliestFinish(w.id));

  // Find max duration
  let maxDuration = 0;
  let criticalLeafId: string | null = null;
  for (const [id, ef] of memoEarliestFinish.entries()) {
    if (ef > maxDuration) {
      maxDuration = ef;
      criticalLeafId = id;
    }
  }

  // Trace back critical path
  const criticalPathIds = new Set<string>();
  let currentId = criticalLeafId;
  const traceVisited = new Set<string>();

  while (currentId && !traceVisited.has(currentId)) {
    traceVisited.add(currentId);
    criticalPathIds.add(currentId);
    const currentWave = waveMap.get(currentId);
    if (!currentWave || !currentWave.dependencies || currentWave.dependencies.length === 0) {
      break;
    }

    // Pick dependency with highest earliest finish
    let bestDepId: string | null = null;
    let bestDepFinish = -1;
    for (const depId of currentWave.dependencies) {
      const depEf = memoEarliestFinish.get(depId) || 0;
      if (depEf > bestDepFinish) {
        bestDepFinish = depEf;
        bestDepId = depId;
      }
    }
    currentId = bestDepId;
  }

  // If no dependencies existed, mark the first wave or wave with highest hours
  if (criticalPathIds.size === 0 && waves.length > 0) {
    criticalPathIds.add(waves[0].id);
  }

  return waves.map((w) => ({
    ...w,
    isCriticalPath: criticalPathIds.has(w.id),
  }));
}
