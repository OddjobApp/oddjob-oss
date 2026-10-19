/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const tableNameSymbol = Symbol.for("drizzle:Name");

const mockDbState = vi.hoisted(() => ({
  missionRun: {
    id: 7303,
    missionId: null,
    cycleId: 4407,
    organizationId: 99,
    name: "Implementation",
    parentId: null,
    createdBy: "july3-dev",
    missionContext: {
      prd: { title: "July 3 Pipeline Stack" },
    },
    failureReason: null,
  },
  session: {
    id: "gen-july3-stack",
    cycleId: 4407,
    organizationId: 99,
    status: "active",
    currentPhase: "Implementation",
    phaseSequence: ["Implementation", "Release"],
  },
  cycle: {
    metadata: {
      pipeline_mode: "code_generation",
      pipeline_session_id: "gen-july3-stack",
      template_id: "july-3-pipeline-stack",
    },
  },
  contract: {
    artifactContracts: {
      output_contract: {
        schemaVersion: "2026-07-03",
        requiredFields: ["prd", "test_scenarios"],
        jsonSchema: {
          type: "object",
          required: ["prd", "test_scenarios"],
          properties: {
            prd: { type: "object" },
            test_scenarios: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  },
}));

const dbCalls = vi.hoisted(() => ({
  insertValues: vi.fn(),
  updateSet: vi.fn(),
}));

const publishEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const redisPublish = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const moltPublish = vi.hoisted(() => vi.fn().mockResolvedValue("proposal-july3-gate"));

function getTableName(table: unknown): string {
  return String((table as Record<symbol, unknown>)?.[tableNameSymbol] ?? "");
}

function rowsForTable(table: unknown) {
  switch (getTableName(table)) {
    case "mission_runs":
      return [mockDbState.missionRun];
    case "operational_cycles":
      return [mockDbState.cycle];
    case "generation_sessions":
      return [mockDbState.session];
    case "cycle_blueprints":
      return [mockDbState.contract];
    case "mission_members":
    case "jobs":
    case "app_deployments":
    case "saas_connectors":
      return [];
    default:
      return [];
  }
}

vi.mock("@server/database_service.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(rowsForTable(table))),
        })),
        whereRaw: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(rowsForTable(table))),
        })),
        limit: vi.fn(() => Promise.resolve(rowsForTable(table))),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        dbCalls.insertValues(values);
        return {
          returning: vi.fn(() => Promise.resolve([{ id: 314 }]))
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        dbCalls.updateSet(values);
        return {
          where: vi.fn(() => Promise.resolve([])),
        };
      }),
    })),
  },
}));

vi.mock("@server/domain/core/infrastructure/event-stream.service.js", () => ({
  eventStream: {
    publish: publishEvent,
  },
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  nodeRedisClient: {
    lpush: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
  },
  redisService: {
    publisher: {
      publish: redisPublish,
    },
  },
}));

vi.mock("@domain/core/auth/jwt.service.js", () => ({
  generateExternalToken: vi.fn(() => "gate-token"),
}));

vi.mock("@domain/governor/core/molt-producer.js", () => ({
  MoltProducer: class {
    publish = moltPublish;
    disconnect = vi.fn();
  },
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("@domain/integrations/trustgraph/export.service.js", () => ({
  TrustGraphExportService: {
    snapMission: vi.fn().mockResolvedValue({ success: false }),
  },
}));

vi.mock("@domain/agents/core/compaction.service.js", () => ({
  compactionService: {
    compactSession: vi.fn(),
  },
}));

vi.mock("@domain/agents/core/agent-memory-across-missions.service.js", () => ({
  agentMemoryAcrossMissionsService: {
    compactSession: vi.fn(),
    resolveRepositoryId: vi.fn(() => "repo"),
  },
}));

vi.mock("@domain/agents/core/soul.service.js", () => ({
  SoulService: {
    updateAgentSoul: vi.fn(),
  },
}));

async function waitForAssertion(assertion: () => void) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 1000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

describe("governed SDLC mission gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes a July 3 pipeline artifact-contract failure through governance and emits telemetry", async () => {
    const { MissionLifecycleHooks } = await import("@domain/mission/core/mission-lifecycle-hooks.js");

    await MissionLifecycleHooks.onMissionTerminalState(7303, "completed");

    await waitForAssertion(() => {
      expect(dbCalls.insertValues).toHaveBeenCalledWith(expect.objectContaining({
        executionId: "sdlc_gate_gen-july3-stack_Implementation_7303",
        approverType: "internal",
        approverEmail: "admin@example.com",
        organizationId: 99,
        missionId: 7303,
        status: "pending",
      }));
      expect(publishEvent).toHaveBeenCalledWith(
        "pipeline.phase_failed",
        expect.objectContaining({
          phase: "Implementation",
          error: "artifact_validation_failed",
          validationErrors: expect.arrayContaining([
            expect.objectContaining({
              keyword: "required",
              message: expect.stringContaining("test_scenarios"),
            }),
          ]),
          governanceDecision: expect.objectContaining({
            approved: false,
            source: "db",
            requestId: 314,
          }),
        }),
        expect.objectContaining({
          organizationId: 99,
          subject: "session:gen-july3-stack",
        }),
        "pipeline-orchestrator"
      );
    });

    const decisionPayload = dbCalls.insertValues.mock.calls.find(([values]) =>
      (values as { executionId?: string }).executionId === "sdlc_gate_gen-july3-stack_Implementation_7303"
    )?.[0] as { modifiedOutput?: Record<string, unknown> };

    expect(decisionPayload.modifiedOutput).toEqual(expect.objectContaining({
      tool: "SDLC_ARTIFACT_CONTRACT_GATE",
      risk: "high",
      description: expect.stringContaining("required artifacts"),
      params: expect.objectContaining({
        type: "sdlc_artifact_contract_gate",
        sessionId: "gen-july3-stack",
        phase: "Implementation",
        missionRunId: 7303,
      }),
    }));

    expect(redisPublish).toHaveBeenCalledWith(
      "decisions:99",
      expect.stringContaining("\"type\":\"decision:new\"")
    );
    expect(moltPublish).toHaveBeenCalledWith("PROPOSAL", expect.objectContaining({
      requestId: 314,
      tool: "SDLC_ARTIFACT_CONTRACT_GATE",
      risk: "high",
    }));
  });
});
