import { describe, it, expect } from "vitest";
import { findPlanGraphProblems, projectPlanCommitRequestSchema } from "./project-plan-commit";

const wave = (id: string, name: string, dependencies: string[] = []) => ({
  id,
  name,
  waveNumber: 1,
  objective: `Deliver ${name}`,
  dependencies,
  assignee: { type: "agent" as const, name: "Agent", role: "Lead" },
});

const request = (waves: ReturnType<typeof wave>[]) => ({
  idempotencyKey: "plan-test-key-1",
  projectTitle: "Plan",
  objective: "Ship it",
  budgetLimitUsd: 100,
  tokenLimit: 1000,
  maxParallelMissions: 2,
  targetSlaDays: 3,
  waves,
});

describe("findPlanGraphProblems", () => {
  it("accepts a sound DAG", () => {
    expect(findPlanGraphProblems([wave("a", "A"), wave("b", "B", ["a"]), wave("c", "C", ["a", "b"])])).toEqual([]);
  });

  it("rejects duplicate names, because the runtime keys dependencies on blueprint name", () => {
    expect(findPlanGraphProblems([wave("a", "Same"), wave("b", "Same")])).toEqual([
      'Two waves are named "Same"; wave names must be unique.',
    ]);
  });

  it("rejects a dependency on a wave that is not in the plan", () => {
    expect(findPlanGraphProblems([wave("a", "A", ["ghost"])])[0]).toMatch(/depends on "ghost"/);
  });

  it("rejects self-dependency", () => {
    expect(findPlanGraphProblems([wave("a", "A", ["a"])])[0]).toMatch(/depends on itself/);
  });

  it("names every wave caught in a cycle", () => {
    const problems = findPlanGraphProblems([wave("a", "A", ["c"]), wave("b", "B", ["a"]), wave("c", "C", ["b"]), wave("d", "D")]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Circular dependency between: /);
    expect(problems[0]).toContain("A");
    expect(problems[0]).not.toContain("D");
  });
});

describe("projectPlanCommitRequestSchema", () => {
  it("parses a valid request and fills defaults", () => {
    const parsed = projectPlanCommitRequestSchema.parse(request([wave("a", "A")]));
    expect(parsed.waves[0].acceptanceCriteria).toEqual([]);
    expect(parsed.waves[0].isCriticalPath).toBe(false);
  });

  it("surfaces graph problems as validation issues", () => {
    const result = projectPlanCommitRequestSchema.safeParse(request([wave("a", "A", ["b"]), wave("b", "B", ["a"])]));
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toMatch(/Circular/);
  });

  it("rejects an empty plan and a missing idempotency key", () => {
    expect(projectPlanCommitRequestSchema.safeParse(request([])).success).toBe(false);
    const { idempotencyKey: _omit, ...noKey } = request([wave("a", "A")]);
    expect(projectPlanCommitRequestSchema.safeParse(noKey).success).toBe(false);
  });
});
