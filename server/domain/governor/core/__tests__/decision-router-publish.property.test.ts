/**
 * Property-based tests for DecisionRouter Redis Pub/Sub publish logic.
 *
 * Feature: decision-inbox-surface
 *
 * Tests validate that the DecisionRouter correctly publishes events
 * to Redis Pub/Sub when decisions are persisted, resolved, or auto-approved.
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted mock references ────────────────────────────────────────────────

const mockPublish = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockLpush = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockExpire = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockDel = vi.hoisted(() => vi.fn().mockResolvedValue(1));

const mockDbInsertReturning = vi.hoisted(() => vi.fn().mockResolvedValue([{ id: 1 }]));
const mockDbUpdateSet = vi.hoisted(() => vi.fn());
const mockDbUpdateWhere = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockDbSelectWhere = vi.hoisted(() => vi.fn().mockResolvedValue([{ organizationId: 1 }]));

let uuidCounter = 0;
const mockRandomUUID = vi.hoisted(() => vi.fn(() => `test-uuid-${++uuidCounter}`));

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("crypto", () => {
  const actual = require("crypto");
  return {
    __esModule: true,
    default: actual,
    ...actual,
    randomUUID: (...args: any[]) => mockRandomUUID(),
  };
});

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  nodeRedisClient: {
    lpush: (...args: any[]) => mockLpush(...args),
    expire: (...args: any[]) => mockExpire(...args),
    del: (...args: any[]) => mockDel(...args),
  },
  redisService: {
    publisher: {
      publish: (...args: any[]) => mockPublish(...args),
    },
  },
}));

vi.mock("@server/database_service.js", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: () => mockDbInsertReturning(),
      }),
    }),
    update: () => ({
      set: (...args: any[]) => {
        mockDbUpdateSet(...args);
        return {
          where: (...wArgs: any[]) => mockDbUpdateWhere(...wArgs),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: (...args: any[]) => mockDbSelectWhere(...args),
        limit: () => ({
          where: (...args: any[]) => mockDbSelectWhere(...args),
        }),
      }),
    }),
  },
}));

vi.mock("@shared/schema/index.js", () => ({
  approvalRequests: {
    id: "id",
    organizationId: "organization_id",
    status: "status",
  },
  saasConnectors: { orgId: "org_id", platform: "platform" },
  jobs: { id: "id", organizationId: "organization_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ type: "eq", a, b }),
  and: (...args: any[]) => ({ type: "and", args }),
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../molt-producer.js", () => ({
  MoltProducer: class {
    publish = vi.fn().mockResolvedValue("proposal-id-123");
    disconnect = vi.fn();
  },
}));

vi.mock("../../../../domain/core/auth/jwt.service.js", () => ({
  generateExternalToken: vi.fn().mockReturnValue("mock-token"),
}));

vi.mock("../form-publishing-service.js", () => ({
  formPublishingService: {
    publish: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { DecisionRouter, type DecisionRequest } from "../decision-router.js";

// ─── Utility: flush fire-and-forget promises ────────────────────────────────

/** Flush pending microtasks to allow fire-and-forget publish calls to complete */
function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10));
}

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Generates a tool name that does NOT match any auto-approval bypass rule */
const nonAutoApprovedToolArb = fc.constantFrom(
  "shell_exec",
  "deploy_service",
  "modify_schema",
  "execute_migration",
  "create_file",
  "write_file",
  "delete_file",
  "run_command",
  "install_package",
  "custom_tool",
  "api_call",
  "database_write"
);

/** Generates a tool name that matches read-only file tool bypass */
const readOnlyFileToolArb = fc.constantFrom(
  "file_read",
  "view_file",
  "read_file",
  "file_list",
  "get_blackboard"
);

/** Generates a tool name that matches low-risk routine tool bypass */
const lowRiskRoutineToolArb = fc.constantFrom(
  "browse_web",
  "google_search",
  "update_blackboard",
  "swarm_bid_approval"
);

/** Generates a risk level */
const riskLevelArb = fc.constantFrom("low", "medium", "high") as fc.Arbitrary<"low" | "medium" | "high">;

/** Generates a non-null organizationId (positive integer) */
const orgIdArb = fc.integer({ min: 1, max: 10000 });

/** Generates a positive integer missionId or undefined */
const missionIdArb = fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined });

/** Generates an approver type */
const approverTypeArb = fc.constantFrom("internal", "external") as fc.Arbitrary<"internal" | "external">;

/** Generates a notification channel array (always includes copilot for testing) */
const channelsArb = fc.constantFrom(
  ["copilot"] as const,
  ["inbox"] as const,
  ["copilot", "inbox"] as const,
  ["copilot", "email"] as const
);

/** Generates a session ID */
const sessionIdArb = fc.stringMatching(/^[a-z0-9]{5,20}$/);

/** Generates a description string */
const descriptionArb = fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/);

/** Generates params that are NOT error_review */
const nonErrorReviewParamsArb = fc.record({
  action: fc.stringMatching(/^[a-z]{1,10}$/),
  target: fc.stringMatching(/^[a-z]{1,20}$/),
});

/** Generates a DecisionRequest that should NOT be auto-approved */
function nonAutoApprovedRequestArb(): fc.Arbitrary<DecisionRequest> {
  return fc.record({
    sessionId: sessionIdArb,
    tool: nonAutoApprovedToolArb,
    params: nonErrorReviewParamsArb,
    goal: fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
    riskLevel: riskLevelArb,
    description: descriptionArb,
    approverType: approverTypeArb,
    channels: channelsArb as fc.Arbitrary<any>,
    organizationId: orgIdArb,
    missionId: missionIdArb as fc.Arbitrary<number | undefined>,
    noWait: fc.constant(true),
  }).map(r => ({
    ...r,
    missionId: r.missionId ?? undefined,
  }) as DecisionRequest);
}

/** Generates a DecisionRequest that SHOULD be auto-approved (read-only tools) */
function autoApprovedReadOnlyRequestArb(): fc.Arbitrary<DecisionRequest> {
  return fc.record({
    sessionId: sessionIdArb,
    tool: readOnlyFileToolArb,
    params: nonErrorReviewParamsArb,
    goal: fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
    riskLevel: riskLevelArb,
    description: descriptionArb,
    approverType: approverTypeArb,
    channels: channelsArb as fc.Arbitrary<any>,
    organizationId: orgIdArb,
    missionId: missionIdArb as fc.Arbitrary<number | undefined>,
    noWait: fc.constant(true),
  }).map(r => ({
    ...r,
    missionId: r.missionId ?? undefined,
  }) as DecisionRequest);
}

/** Generates a DecisionRequest that SHOULD be auto-approved (low-risk routine) */
function autoApprovedRoutineRequestArb(): fc.Arbitrary<DecisionRequest> {
  return fc.record({
    sessionId: sessionIdArb,
    tool: lowRiskRoutineToolArb,
    params: nonErrorReviewParamsArb,
    goal: fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
    riskLevel: riskLevelArb,
    description: descriptionArb,
    approverType: approverTypeArb,
    channels: channelsArb as fc.Arbitrary<any>,
    organizationId: orgIdArb,
    missionId: missionIdArb as fc.Arbitrary<number | undefined>,
    noWait: fc.constant(true),
  }).map(r => ({
    ...r,
    missionId: r.missionId ?? undefined,
  }) as DecisionRequest);
}

/** Generates a DecisionRequest for trusted system shell (auto-approved) */
function autoApprovedTrustedShellRequestArb(): fc.Arbitrary<DecisionRequest> {
  return fc.record({
    sessionId: sessionIdArb,
    tool: fc.constant("shell"),
    params: nonErrorReviewParamsArb,
    goal: fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
    riskLevel: riskLevelArb,
    description: descriptionArb,
    approverType: approverTypeArb,
    approverId: fc.constant("system"),
    channels: channelsArb as fc.Arbitrary<any>,
    organizationId: orgIdArb,
    missionId: missionIdArb as fc.Arbitrary<number | undefined>,
    noWait: fc.constant(true),
  }).map(r => ({
    ...r,
    missionId: r.missionId ?? undefined,
  }) as DecisionRequest);
}

/** Generates a DecisionRequest for error_escalation (auto-approved) */
function autoApprovedErrorReviewRequestArb(): fc.Arbitrary<DecisionRequest> {
  return fc.record({
    sessionId: sessionIdArb,
    tool: fc.constant("error_escalation"),
    params: nonErrorReviewParamsArb,
    goal: fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
    riskLevel: riskLevelArb,
    description: descriptionArb,
    approverType: approverTypeArb,
    channels: channelsArb as fc.Arbitrary<any>,
    organizationId: orgIdArb,
    missionId: missionIdArb as fc.Arbitrary<number | undefined>,
    noWait: fc.constant(true),
  }).map(r => ({
    ...r,
    missionId: r.missionId ?? undefined,
  }) as DecisionRequest);
}

/** Union arbitrary for any auto-approved request */
function anyAutoApprovedRequestArb(): fc.Arbitrary<DecisionRequest> {
  return fc.oneof(
    autoApprovedReadOnlyRequestArb(),
    autoApprovedRoutineRequestArb(),
    autoApprovedTrustedShellRequestArb(),
    autoApprovedErrorReviewRequestArb()
  );
}

/** Generates a resolved status */
const resolvedStatusArb = fc.constantFrom("approved", "rejected", "snoozed") as fc.Arbitrary<"approved" | "rejected" | "snoozed">;

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("DecisionRouter Publish Logic Property Tests", () => {
  let router: DecisionRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    router = new DecisionRouter();

    // Default mock behavior: DB insert returns a row with incrementing ID
    let idCounter = 100;
    mockDbInsertReturning.mockImplementation(() => Promise.resolve([{ id: ++idCounter }]));
    mockDbUpdateWhere.mockResolvedValue([]);
    mockDbSelectWhere.mockResolvedValue([{ organizationId: 1 }]);
    mockPublish.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Feature: decision-inbox-surface, Property 14: DecisionRouter Redis Publish on Persist
   *
   * For any DecisionRequest with non-null organizationId that is NOT auto-approved,
   * verify redis.publish is called on `decisions:{organizationId}` with correct payload fields.
   *
   * **Validates: Requirements 7.1, 7.4**
   */
  describe("Property 14: DecisionRouter Redis Publish on Persist", () => {
    it("publishes decision:new event to correct channel with required payload fields for any non-auto-approved request", async () => {
      await fc.assert(
        fc.asyncProperty(nonAutoApprovedRequestArb(), async (request) => {
          vi.clearAllMocks();

          const expectedRequestId = Math.floor(Math.random() * 10000) + 1;
          mockDbInsertReturning.mockResolvedValue([{ id: expectedRequestId }]);
          mockDbUpdateWhere.mockResolvedValue([]);
          mockPublish.mockResolvedValue(1);

          await router.requestDecision(request);
          // The publishDecisionEvent call is fire-and-forget; wait for it
          await flushPromises();

          // redis.publish should have been called
          expect(mockPublish).toHaveBeenCalled();

          // Find the publish call for the decision:new event
          const publishCalls = mockPublish.mock.calls;
          const decisionNewCall = publishCalls.find(
            (call) => call[0] === `decisions:${request.organizationId}`
          );

          expect(decisionNewCall).toBeDefined();

          // Verify the channel
          expect(decisionNewCall![0]).toBe(`decisions:${request.organizationId}`);

          // Verify the payload
          const payload = JSON.parse(decisionNewCall![1]);
          expect(payload.type).toBe("decision:new");
          expect(payload.requestId).toBe(expectedRequestId);
          expect(payload.toolName).toBe(request.tool);
          expect(payload.riskLevel).toBe(request.riskLevel);
          expect(typeof payload.description).toBe("string");
          expect(payload.missionId).toBe(request.missionId || null);
          expect(typeof payload.createdAt).toBe("string");
          expect(typeof payload.eventId).toBe("string");

          // Verify createdAt is a valid ISO timestamp
          expect(new Date(payload.createdAt).toISOString()).toBe(payload.createdAt);
        }),
        { numRuns: 100 }
      );
    });

    it("publishes to channel named exactly decisions:{organizationId} for any positive orgId", async () => {
      await fc.assert(
        fc.asyncProperty(nonAutoApprovedRequestArb(), async (request) => {
          vi.clearAllMocks();
          mockDbInsertReturning.mockResolvedValue([{ id: 42 }]);
          mockDbUpdateWhere.mockResolvedValue([]);
          mockPublish.mockResolvedValue(1);

          await router.requestDecision(request);
          await flushPromises();

          const channelCalls = mockPublish.mock.calls.map(c => c[0]);
          expect(channelCalls).toContain(`decisions:${request.organizationId}`);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: decision-inbox-surface, Property 15: DecisionRouter Resolved Event Publish
   *
   * For any status transition from pending to approved/rejected/snoozed,
   * verify `decision:resolved` event is published with requestId, newStatus, resolvedAt.
   *
   * **Validates: Requirements 7.2**
   */
  describe("Property 15: DecisionRouter Resolved Event Publish", () => {
    it("publishes decision:resolved event with correct fields for any status transition", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100000 }),
          orgIdArb,
          resolvedStatusArb,
          async (requestId, organizationId, newStatus) => {
            vi.clearAllMocks();
            mockPublish.mockResolvedValue(1);

            await router.publishResolution(requestId, organizationId, newStatus);

            // Verify publish was called
            expect(mockPublish).toHaveBeenCalledTimes(1);

            const [channel, rawPayload] = mockPublish.mock.calls[0];

            // Verify channel
            expect(channel).toBe(`decisions:${organizationId}`);

            // Verify payload structure
            const payload = JSON.parse(rawPayload);
            expect(payload.type).toBe("decision:resolved");
            expect(payload.requestId).toBe(requestId);
            expect(payload.newStatus).toBe(newStatus);
            expect(typeof payload.resolvedAt).toBe("string");
            expect(typeof payload.eventId).toBe("string");

            // Verify resolvedAt is a valid ISO timestamp
            expect(new Date(payload.resolvedAt).toISOString()).toBe(payload.resolvedAt);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("resolved event newStatus always matches the requested transition status", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100000 }),
          orgIdArb,
          resolvedStatusArb,
          async (requestId, organizationId, newStatus) => {
            vi.clearAllMocks();
            mockPublish.mockResolvedValue(1);

            await router.publishResolution(requestId, organizationId, newStatus);

            const payload = JSON.parse(mockPublish.mock.calls[0][1]);
            expect(payload.newStatus).toBe(newStatus);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("resolved event requestId always matches the input requestId", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100000 }),
          orgIdArb,
          resolvedStatusArb,
          async (requestId, organizationId, newStatus) => {
            vi.clearAllMocks();
            mockPublish.mockResolvedValue(1);

            await router.publishResolution(requestId, organizationId, newStatus);

            const payload = JSON.parse(mockPublish.mock.calls[0][1]);
            expect(payload.requestId).toBe(requestId);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: decision-inbox-surface, Property 16: DecisionRouter No Publish on Auto-Approve
   *
   * For any DecisionRequest matching auto-approval bypass rules (read-only file tools,
   * low-risk routine tools, trusted system shells, error_escalation, safe diagnostic commands),
   * verify no redis.publish call is made.
   *
   * **Validates: Requirements 7.7**
   */
  describe("Property 16: DecisionRouter No Publish on Auto-Approve", () => {
    it("never publishes to Redis for any auto-approved request (read-only file tools)", async () => {
      await fc.assert(
        fc.asyncProperty(autoApprovedReadOnlyRequestArb(), async (request) => {
          vi.clearAllMocks();
          mockPublish.mockResolvedValue(1);

          const result = await router.requestDecision(request);
          await flushPromises();

          // Verify it was auto-approved
          expect(result.approved).toBe(true);
          expect(result.source).toBe("auto");

          // Verify NO publish was called
          expect(mockPublish).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it("never publishes to Redis for any auto-approved request (low-risk routine tools)", async () => {
      await fc.assert(
        fc.asyncProperty(autoApprovedRoutineRequestArb(), async (request) => {
          vi.clearAllMocks();
          mockPublish.mockResolvedValue(1);

          const result = await router.requestDecision(request);
          await flushPromises();

          // Verify it was auto-approved
          expect(result.approved).toBe(true);
          expect(result.source).toBe("auto");

          // Verify NO publish was called
          expect(mockPublish).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it("never publishes to Redis for any auto-approved request (trusted system shells)", async () => {
      await fc.assert(
        fc.asyncProperty(autoApprovedTrustedShellRequestArb(), async (request) => {
          vi.clearAllMocks();
          mockPublish.mockResolvedValue(1);

          const result = await router.requestDecision(request);
          await flushPromises();

          // Verify it was auto-approved
          expect(result.approved).toBe(true);
          expect(result.source).toBe("auto");

          // Verify NO publish was called
          expect(mockPublish).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it("never publishes to Redis for any auto-approved request (error_escalation)", async () => {
      await fc.assert(
        fc.asyncProperty(autoApprovedErrorReviewRequestArb(), async (request) => {
          vi.clearAllMocks();
          mockPublish.mockResolvedValue(1);

          const result = await router.requestDecision(request);
          await flushPromises();

          // Verify it was auto-approved
          expect(result.approved).toBe(true);
          expect(result.source).toBe("auto");

          // Verify NO publish was called
          expect(mockPublish).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it("never publishes to Redis for any auto-approved request (combined arbitrary)", async () => {
      await fc.assert(
        fc.asyncProperty(anyAutoApprovedRequestArb(), async (request) => {
          vi.clearAllMocks();
          mockPublish.mockResolvedValue(1);

          const result = await router.requestDecision(request);
          await flushPromises();

          // Verify it was auto-approved
          expect(result.approved).toBe(true);
          expect(result.source).toBe("auto");

          // Verify NO publish was called
          expect(mockPublish).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });
  });
});
