import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpskillingOrchestratorService } from "../../server/domain/agents/core/upskilling-orchestrator.service.js";
import { eventStream } from "../../server/domain/core/infrastructure/event-stream.service.js";
import { db } from "../../server/database_service.js";

vi.mock("../../server/database_service.js", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    },
  };
});

vi.mock("../../server/domain/core/infrastructure/event-stream.service.js", () => {
  return {
    eventStream: {
      publish: vi.fn(),
    },
  };
});

describe("Sprint 4: Upskilling & Competency Lifecycle Loop", () => {
  let service: UpskillingOrchestratorService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UpskillingOrchestratorService();
  });

  it("promotes agent competency for Tier 1 (prompt_optimization) to Level 2", async () => {
    // Mock competency lookup: not found, so inserts
    const mockCompetency = { id: 101, name: "Prompt Directives & Schema Adherence", category: "engineering" };
    const mockActorComp = { id: 201, actorId: "agent-test-1", competencyId: 101, proficiencyLevel: 2 };

    // db.select().from().where().limit()
    const mockLimitComp = vi.fn().mockResolvedValue([]);
    const mockWhereComp = vi.fn().mockReturnValue({ limit: mockLimitComp });
    const mockFromComp = vi.fn().mockReturnValue({ where: mockWhereComp });

    // db.insert().values().returning()
    const mockReturningComp = vi.fn().mockResolvedValue([mockCompetency]);
    const mockValuesComp = vi.fn().mockReturnValue({ returning: mockReturningComp });

    // actor competency check: not found
    const mockLimitActor = vi.fn().mockResolvedValue([]);
    const mockWhereActor = vi.fn().mockReturnValue({ limit: mockLimitActor });
    const mockFromActor = vi.fn().mockReturnValue({ where: mockWhereActor });

    // actor competency insert: values()
    const mockValuesActor = vi.fn().mockResolvedValue([mockActorComp]);

    (db.select as any)
      .mockReturnValueOnce({ from: mockFromComp })
      .mockReturnValueOnce({ from: mockFromActor });

    (db.insert as any)
      .mockReturnValueOnce({ values: mockValuesComp })
      .mockReturnValueOnce({ values: mockValuesActor });

    const job: any = {
      id: "job-001",
      agentId: "agent-test-1",
      pipId: "pip-001",
      type: "prompt_optimization",
    };

    const result = await service.promoteAgentCompetency(job, 1, 0.98, ["Verified 5 test cases"]);

    expect(result.competencyId).toBe(101);
    expect(result.proficiencyLevel).toBe(2);

    expect(eventStream.publish).toHaveBeenCalledWith(
      "agent.competency_promoted",
      expect.objectContaining({
        agentId: "agent-test-1",
        competencyId: 101,
        competencyName: "Prompt Directives & Schema Adherence",
        proficiencyLevel: 2,
        canaryScore: 0.98,
      }),
      { organizationId: 1 },
      "upskilling_orchestrator"
    );
  });

  it("promotes agent competency for Tier 2 (golden_samples) to Level 3", async () => {
    const mockCompetency = { id: 102, name: "Few-Shot Contextual Reasoning", category: "engineering" };
    const existingActorComp = { id: 202, actorId: "agent-test-2", competencyId: 102, proficiencyLevel: 2 };

    const mockLimitComp = vi.fn().mockResolvedValue([mockCompetency]);
    const mockWhereComp = vi.fn().mockReturnValue({ limit: mockLimitComp });
    const mockFromComp = vi.fn().mockReturnValue({ where: mockWhereComp });

    const mockLimitActor = vi.fn().mockResolvedValue([existingActorComp]);
    const mockWhereActor = vi.fn().mockReturnValue({ limit: mockLimitActor });
    const mockFromActor = vi.fn().mockReturnValue({ where: mockWhereActor });

    const mockWhereUpdate = vi.fn().mockResolvedValue([{ ...existingActorComp, proficiencyLevel: 3 }]);
    const mockSetUpdate = vi.fn().mockReturnValue({ where: mockWhereUpdate });

    (db.select as any)
      .mockReturnValueOnce({ from: mockFromComp })
      .mockReturnValueOnce({ from: mockFromActor });

    (db.update as any).mockReturnValueOnce({ set: mockSetUpdate });

    const job: any = {
      id: "job-002",
      agentId: "agent-test-2",
      pipId: "pip-002",
      type: "golden_samples",
    };

    const result = await service.promoteAgentCompetency(job, 1, 0.95, ["Zero schema violations"]);

    expect(result.competencyId).toBe(102);
    expect(result.proficiencyLevel).toBe(3);

    expect(eventStream.publish).toHaveBeenCalledWith(
      "agent.competency_promoted",
      expect.objectContaining({
        agentId: "agent-test-2",
        competencyId: 102,
        competencyName: "Few-Shot Contextual Reasoning",
        proficiencyLevel: 3,
        canaryScore: 0.95,
      }),
      { organizationId: 1 },
      "upskilling_orchestrator"
    );
  });

  it("promotes agent competency for Tier 3 (fine_tuning) to Level 4", async () => {
    const mockCompetency = { id: 103, name: "Fine-Tuned Domain Mastery", category: "engineering" };
    const existingActorComp = { id: 203, actorId: "agent-test-3", competencyId: 103, proficiencyLevel: 3 };

    const mockLimitComp = vi.fn().mockResolvedValue([mockCompetency]);
    const mockWhereComp = vi.fn().mockReturnValue({ limit: mockLimitComp });
    const mockFromComp = vi.fn().mockReturnValue({ where: mockWhereComp });

    const mockLimitActor = vi.fn().mockResolvedValue([existingActorComp]);
    const mockWhereActor = vi.fn().mockReturnValue({ limit: mockLimitActor });
    const mockFromActor = vi.fn().mockReturnValue({ where: mockWhereActor });

    const mockWhereUpdate = vi.fn().mockResolvedValue([{ ...existingActorComp, proficiencyLevel: 4 }]);
    const mockSetUpdate = vi.fn().mockReturnValue({ where: mockWhereUpdate });

    (db.select as any)
      .mockReturnValueOnce({ from: mockFromComp })
      .mockReturnValueOnce({ from: mockFromActor });

    (db.update as any).mockReturnValueOnce({ set: mockSetUpdate });

    const job: any = {
      id: "job-003",
      agentId: "agent-test-3",
      pipId: "pip-003",
      type: "fine_tuning",
    };

    const result = await service.promoteAgentCompetency(job, 1, 0.99, ["LoRA checkpoint verified"]);

    expect(result.competencyId).toBe(103);
    expect(result.proficiencyLevel).toBe(4);

    expect(eventStream.publish).toHaveBeenCalledWith(
      "agent.competency_promoted",
      expect.objectContaining({
        agentId: "agent-test-3",
        competencyId: 103,
        competencyName: "Fine-Tuned Domain Mastery",
        proficiencyLevel: 4,
        canaryScore: 0.99,
      }),
      { organizationId: 1 },
      "upskilling_orchestrator"
    );
  });

  // Regression: promoteAgentCompetency used to catch every failure, log a warn
  // and return { competencyId: 0, proficiencyLevel: targetLevel }. The caller
  // discards that return value, so a failed ledger write still published
  // "Upskilling successful!" and told the operator a competency had been granted
  // that did not exist -- the exact shape of the actor_competencies outage that
  // migration 0106 was written for. A DB failure must surface, not be smoothed
  // into a success-shaped result.
  it("propagates a ledger write failure instead of reporting a successful promotion", async () => {
    const dbError = new Error('relation "actor_competencies" does not exist');

    const mockLimitComp = vi.fn().mockRejectedValue(dbError);
    const mockWhereComp = vi.fn().mockReturnValue({ limit: mockLimitComp });
    const mockFromComp = vi.fn().mockReturnValue({ where: mockWhereComp });
    (db.select as any).mockReturnValueOnce({ from: mockFromComp });

    const job: any = {
      id: "job-004",
      agentId: "agent-test-4",
      pipId: "pip-004",
      type: "prompt_optimization",
    };

    await expect(
      service.promoteAgentCompetency(job, 1, 0.97, ["Canary passed"]),
    ).rejects.toThrow(/Competency promotion failed for agent agent-test-4/);

    // And nothing may announce a promotion that never landed.
    expect(eventStream.publish).not.toHaveBeenCalled();
  });
});
