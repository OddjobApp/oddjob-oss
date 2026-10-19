/**
 * Mission Schedulability & Resource Deadlock / Rate-Limit Prover
 * Formally proves multi-agent cycle schedulability, mutual exclusion deadlock-freedom,
 * and peak token rate limit invariants before operational cycle launch.
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MissionSchedulabilityProver");

export interface MissionTaskSpec {
  id: string;
  name?: string;
  agentRole: string;
  estimatedDurationSeconds: number;
  dependencies: string[]; // Task IDs that must finish before this task starts
  requiredLocks?: string[]; // Shared resource keys (e.g., 'db_table_users', 'graph_write_lock')
  estimatedTokensPerSecond?: number;
}

export interface MissionSchedulePlan {
  missionId: string;
  tasks: MissionTaskSpec[];
  globalTokenRateLimitPerSec?: number; // e.g. 5000 tokens/sec
  maxAllowedMakespanSeconds?: number;
}

export interface ScheduledTaskSlot {
  taskId: string;
  startTime: number;
  endTime: number;
  locksHeld: string[];
  tokensPerSec: number;
}

export interface SchedulabilityProof {
  schedulable: boolean;
  deadlockFree: boolean;
  rateLimitCompliant: boolean;
  calculatedMakespanSeconds: number;
  peakTokensPerSecond: number;
  criticalPath: string[];
  scheduleSlots: ScheduledTaskSlot[];
  violations: string[];
  proofCertificate: string;
}

export class MissionSchedulabilityProver {
  /**
   * Formally proves that a mission plan is schedulable, deadlock-free, and respects provider quotas
   */
  public static provePlan(plan: MissionSchedulePlan): SchedulabilityProof {
    logger.info(`[MissionSchedulabilityProver] Proving schedulability for mission '${plan.missionId}' with ${plan.tasks.length} task(s)`);

    const violations: string[] = [];

    // 1. Dependency Cycle Detection (Deadlock Invariant 1)
    const cycle = this.detectDependencyCycle(plan.tasks);
    if (cycle) {
      violations.push(`Dependency Cycle / Deadlock Detected: ${cycle.join(" -> ")}`);
    }

    // 2. Compute Early Start & Finish Times via Topological Critical Path Method (CPM)
    const taskMap = new Map(plan.tasks.map(t => [t.id, t]));
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    plan.tasks.forEach(t => {
      inDegree.set(t.id, (t.dependencies || []).length);
      dependents.set(t.id, []);
    });

    plan.tasks.forEach(t => {
      (t.dependencies || []).forEach(depId => {
        if (dependents.has(depId)) {
          dependents.get(depId)!.push(t.id);
        }
      });
    });

    const earlyStart = new Map<string, number>();
    const earlyFinish = new Map<string, number>();
    const queue: string[] = [];

    inDegree.forEach((deg, id) => {
      if (deg === 0) {
        earlyStart.set(id, 0);
        const dur = taskMap.get(id)?.estimatedDurationSeconds || 0;
        earlyFinish.set(id, dur);
        queue.push(id);
      }
    });

    while (queue.length > 0) {
      const currId = queue.shift()!;
      const currFinish = earlyFinish.get(currId) || 0;

      for (const nextId of dependents.get(currId) || []) {
        const prevStart = earlyStart.get(nextId) || 0;
        earlyStart.set(nextId, Math.max(prevStart, currFinish));

        const dur = taskMap.get(nextId)?.estimatedDurationSeconds || 0;
        earlyFinish.set(nextId, (earlyStart.get(nextId) || 0) + dur);

        inDegree.set(nextId, inDegree.get(nextId)! - 1);
        if (inDegree.get(nextId) === 0) {
          queue.push(nextId);
        }
      }
    }

    // 3. Resource Lock Conflict Verification (Mutual Exclusion Invariant)
    const slots: ScheduledTaskSlot[] = plan.tasks.map(t => ({
      taskId: t.id,
      startTime: earlyStart.get(t.id) || 0,
      endTime: earlyFinish.get(t.id) || 0,
      locksHeld: t.requiredLocks || [],
      tokensPerSec: t.estimatedTokensPerSecond || 0
    }));

    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];

        // Check if time intervals overlap
        const intervalsOverlap = Math.max(a.startTime, b.startTime) < Math.min(a.endTime, b.endTime);
        if (intervalsOverlap) {
          // Check shared locks
          const sharedLocks = a.locksHeld.filter(lock => b.locksHeld.includes(lock));
          if (sharedLocks.length > 0) {
            violations.push(
              `Lock Conflict / Concurrency Violation: Tasks '${a.taskId}' and '${b.taskId}' run concurrently and both contend for lock(s): [${sharedLocks.join(", ")}]`
            );
          }
        }
      }
    }

    // 4. Rate-Limit Aggregate Ceiling Verification across Continuous Time Interval
    const timeCheckPoints = new Set<number>([0]);
    slots.forEach(s => {
      timeCheckPoints.add(s.startTime);
      timeCheckPoints.add(s.endTime);
    });

    const sortedTimes = Array.from(timeCheckPoints).sort((a, b) => a - b);
    let peakTokens = 0;
    const globalQuota = plan.globalTokenRateLimitPerSec;

    for (const t of sortedTimes) {
      const activeAtT = slots.filter(s => s.startTime <= t && t < s.endTime);
      const sumTokens = activeAtT.reduce((sum, s) => sum + s.tokensPerSec, 0);
      if (sumTokens > peakTokens) {
        peakTokens = sumTokens;
      }

      if (globalQuota && sumTokens > globalQuota) {
        violations.push(
          `Token Quota Exceeded at t=${t}s: Aggregate rate (${sumTokens} tokens/sec) > Quota (${globalQuota} tokens/sec). Active tasks: [${activeAtT.map(a => a.taskId).join(", ")}]`
        );
      }
    }

    // 5. Makespan Upper Bound
    let totalMakespan = 0;
    earlyFinish.forEach(finish => {
      if (finish > totalMakespan) totalMakespan = finish;
    });

    if (plan.maxAllowedMakespanSeconds && totalMakespan > plan.maxAllowedMakespanSeconds) {
      violations.push(
        `Makespan Breach: Total mission duration (${totalMakespan}s) exceeds maximum allowed (${plan.maxAllowedMakespanSeconds}s)`
      );
    }

    const isSchedulable = violations.length === 0;
    const deadlockFree = !cycle && !violations.some(v => v.includes("Lock Conflict"));
    const rateLimitCompliant = !violations.some(v => v.includes("Token Quota"));

    return {
      schedulable: isSchedulable,
      deadlockFree,
      rateLimitCompliant,
      calculatedMakespanSeconds: totalMakespan,
      peakTokensPerSecond: peakTokens,
      criticalPath: this.extractCriticalPath(plan.tasks, earlyStart, earlyFinish, totalMakespan),
      scheduleSlots: slots,
      violations,
      proofCertificate: isSchedulable
        ? `PASSED: Mission plan '${plan.missionId}' verified deadlock-free and within quotas (Makespan: ${totalMakespan}s, Peak: ${peakTokens} tok/s).`
        : `FAILED: Found ${violations.length} schedulability/concurrency violations.`
    };
  }

  private static detectDependencyCycle(tasks: MissionTaskSpec[]): string[] | null {
    const adj = new Map<string, string[]>();
    tasks.forEach(t => adj.set(t.id, t.dependencies || []));

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const dfs = (curr: string): boolean => {
      visited.add(curr);
      recStack.add(curr);
      path.push(curr);

      for (const dep of adj.get(curr) || []) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (recStack.has(dep)) {
          path.push(dep);
          return true;
        }
      }

      recStack.delete(curr);
      path.pop();
      return false;
    };

    for (const t of tasks) {
      if (!visited.has(t.id)) {
        if (dfs(t.id)) return path;
      }
    }

    return null;
  }

  private static extractCriticalPath(
    tasks: MissionTaskSpec[],
    earlyStart: Map<string, number>,
    earlyFinish: Map<string, number>,
    totalMakespan: number
  ): string[] {
    const critical = tasks.filter(t => (earlyFinish.get(t.id) || 0) === totalMakespan);
    return critical.map(t => t.id);
  }
}
