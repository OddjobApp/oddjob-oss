import { describe, it, expect } from "vitest";
import { MissionSchedulabilityProver, MissionSchedulePlan } from "../formal/mission-schedulability-prover.js";

describe("MissionSchedulabilityProver (Timed Automata & Concurrency Safety)", () => {
  it("should prove a valid parallel mission plan is schedulable and within rate limits", () => {
    const validPlan: MissionSchedulePlan = {
      missionId: "data_ingestion_and_synthesis",
      globalTokenRateLimitPerSec: 2000,
      tasks: [
        {
          id: "task_fetch",
          agentRole: "crawler",
          estimatedDurationSeconds: 10,
          dependencies: [],
          estimatedTokensPerSecond: 500
        },
        {
          id: "task_enrich",
          agentRole: "enricher",
          estimatedDurationSeconds: 15,
          dependencies: ["task_fetch"],
          estimatedTokensPerSecond: 800
        },
        {
          id: "task_summarize",
          agentRole: "summarizer",
          estimatedDurationSeconds: 10,
          dependencies: ["task_fetch"],
          estimatedTokensPerSecond: 600
        }
      ]
    };

    const proof = MissionSchedulabilityProver.provePlan(validPlan);
    expect(proof.schedulable).toBe(true);
    expect(proof.deadlockFree).toBe(true);
    expect(proof.rateLimitCompliant).toBe(true);
    expect(proof.calculatedMakespanSeconds).toBe(25); // 10 (fetch) + 15 (enrich)
    expect(proof.peakTokensPerSecond).toBe(1400); // enrich (800) + summarize (600) in parallel <= 2000 quota
  });

  it("should detect lock contention deadlock between overlapping tasks with shared mutexes", () => {
    const conflictingPlan: MissionSchedulePlan = {
      missionId: "concurrent_db_mutations",
      tasks: [
        {
          id: "task_a",
          agentRole: "migrator_a",
          estimatedDurationSeconds: 10,
          dependencies: [],
          requiredLocks: ["db_table_users"]
        },
        {
          id: "task_b",
          agentRole: "migrator_b",
          estimatedDurationSeconds: 10,
          dependencies: [], // Both start at t=0
          requiredLocks: ["db_table_users"] // Shared lock conflict!
        }
      ]
    };

    const proof = MissionSchedulabilityProver.provePlan(conflictingPlan);
    expect(proof.schedulable).toBe(false);
    expect(proof.deadlockFree).toBe(false);
    expect(proof.violations.some(v => v.includes("Lock Conflict"))).toBe(true);
  });

  it("should detect rate limit spike violations when parallel tasks exceed quota", () => {
    const burstingPlan: MissionSchedulePlan = {
      missionId: "bulk_enrichment",
      globalTokenRateLimitPerSec: 1000,
      tasks: [
        {
          id: "parallel_1",
          agentRole: "agent_1",
          estimatedDurationSeconds: 10,
          dependencies: [],
          estimatedTokensPerSecond: 700
        },
        {
          id: "parallel_2",
          agentRole: "agent_2",
          estimatedDurationSeconds: 10,
          dependencies: [],
          estimatedTokensPerSecond: 700 // 700 + 700 = 1400 > 1000 limit
        }
      ]
    };

    const proof = MissionSchedulabilityProver.provePlan(burstingPlan);
    expect(proof.schedulable).toBe(false);
    expect(proof.rateLimitCompliant).toBe(false);
    expect(proof.violations.some(v => v.includes("Token Quota Exceeded"))).toBe(true);
  });
});
