/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * commit_project_plan_to_cycle used to insert an ACTIVE cycle and its
 * blueprints itself — non-transactionally, without dependencies, and with a
 * model-supplied projectId nobody checked. It now delegates to the same
 * service as the Project Studio UI.
 */

const { commitProjectPlan, resolvePlanActorRoles } = vi.hoisted(() => ({
  commitProjectPlan: vi.fn(),
  resolvePlanActorRoles: vi.fn(),
}));
vi.mock("@domain/mission/core/project-plan-commit.service.js", () => ({ commitProjectPlan, resolvePlanActorRoles }));

import { ASSEMBLY_TOOLS } from "./assembly-tools.js";

const tool = ASSEMBLY_TOOLS.commit_project_plan_to_cycle;

const params = tool.parameters.parse({
  projectTitle: "Plan",
  objective: "Ship",
  budgetLimitUsd: 100,
  tokenLimit: 1000,
  maxParallelMissions: 2,
  targetSlaDays: 3,
  waves: [{ id: "w1", name: "One", waveNumber: 1, objective: "Do it", assignee: { type: "agent", name: "A", role: "R" } }],
});

const context = { organizationId: 7, userId: "user-1", sessionKey: "room-a", projectId: 12, agentName: "planner" };

beforeEach(() => {
  commitProjectPlan.mockReset();
  resolvePlanActorRoles.mockReset();
  resolvePlanActorRoles.mockResolvedValue({ isOrgAdmin: false, isSuperAdmin: false });
  commitProjectPlan.mockResolvedValue({
    cycleId: 5, name: "Plan", status: "pending_approval", projectId: 12, blueprintCount: 1, replayed: false,
    cycleUrl: "/operations/cycles/5",
  });
});

describe("commit_project_plan_to_cycle", () => {
  it("delegates to the commit service with the room, project context and agent principal", async () => {
    const out = JSON.parse(await tool.execute(params, context as any));

    const [input, actor] = commitProjectPlan.mock.calls[0];
    expect(input).toMatchObject({ sessionKey: "room-a", contextProjectId: 12, plan: { projectTitle: "Plan" } });
    expect(actor).toMatchObject({ organizationId: 7, userId: "user-1", agentId: "planner", isOrgAdmin: false });
    expect(out).toMatchObject({ success: true, cycleId: 5, status: "pending_approval" });
    expect(out.message).toMatch(/nothing runs until the cycle is approved/);
  });

  it("takes roles from the database, never from what the context claims", async () => {
    resolvePlanActorRoles.mockResolvedValue({ isOrgAdmin: true, isSuperAdmin: false });
    await tool.execute(params, { ...context, isSuperAdmin: true } as any);
    expect(resolvePlanActorRoles).toHaveBeenCalledWith("user-1", 7);
    expect(commitProjectPlan.mock.calls[0][1]).toMatchObject({ isOrgAdmin: true, isSuperAdmin: false });
  });

  it("derives the same idempotency key for the same plan in the same room", async () => {
    await tool.execute(params, context as any);
    await tool.execute(params, context as any);
    await tool.execute({ ...params, objective: "Different" }, context as any);
    const keys = commitProjectPlan.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("reports the service's refusal instead of a success", async () => {
    commitProjectPlan.mockRejectedValueOnce(new Error("This action requires the 'editor' role"));
    const out = JSON.parse(await tool.execute(params, context as any));
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/editor/);
  });

  it("refuses to run without a user", async () => {
    const out = JSON.parse(await tool.execute(params, { organizationId: 7 } as any));
    expect(out.success).toBe(false);
    expect(commitProjectPlan).not.toHaveBeenCalled();
  });
});
