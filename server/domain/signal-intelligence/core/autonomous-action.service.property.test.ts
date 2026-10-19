/**
 * Property-based tests for Autonomous Action Service
 *
 * Feature: hat-menu-intent-router
 *
 * Properties tested:
 * - Property 36: Policy matching threshold — only Critical/High + confidence ≥ 0.8 trigger evaluation
 * - Property 37: Human approval creates pending request
 * - Property 38: Spawn_cycle creates linked Cycle
 * - Property 39: Execution logging — every execution (success/failure) logged
 * - Property 40: Regional volatility auto-tightens approval gates
 *
 * **Validates: Requirements 17.1, 17.4, 17.6, 17.7, 17.8**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Mock setup ─────────────────────────────────────────────────────────────

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockInsertValues = vi.fn().mockResolvedValue([{ id: 1 }]);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
const mockSelectFrom = vi.fn();
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });
const mockUpdateSet = vi.fn().mockReturnValue({
  where: vi.fn().mockResolvedValue(undefined),
});
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

vi.mock("@server/database_service.js", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    transaction: (callback: (tx: any) => unknown) => callback({
      select: (...args: unknown[]) => mockSelect(...args),
      insert: (...args: unknown[]) => mockInsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    }),
  },
}));

vi.mock("./spatial-kafka.service.js", () => ({
  enqueueSpatialAction: vi.fn().mockResolvedValue("00000000-0000-4000-8000-000000000001"),
  enqueueSpatialOutcome: vi.fn().mockResolvedValue("00000000-0000-4000-8000-000000000002"),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
    gte: vi.fn((a: unknown, b: unknown) => ({ op: "gte", a, b })),
    and: vi.fn((...args: unknown[]) => args),
    sql: vi.fn(),
    inArray: vi.fn((a: unknown, b: unknown) => ({ op: "inArray", a, b })),
  };
});

// Mock the cross-app event bus (used via dynamic import in the service).
// publish(), not emit(): raw emit skips registerHandler() handlers and the event
// log, so the service must not use it. The mock exposes only publish so a
// regression back to emit fails loudly rather than silently going nowhere.
// The service dispatches via `publishWithResults` and destructures `outcomes`
// from the result, so the spy must resolve that shape — a bare id makes the
// destructure throw. One outcome marked succeeded keeps `acted` non-empty,
// which is what the execution-logging assertions depend on.
const mockEventBusPublish = vi.fn().mockResolvedValue({
  eventId: "evt-test-id",
  outcomes: [{ status: "succeeded", handler: "test-handler" }],
});
vi.mock(
  "@domain/org/core/event-bus.service.js",
  () => ({
    crossAppEventBus: {
      publish: mockEventBusPublish,
      // `publish` delegates to this in the real bus, and the service calls it
      // directly. Omitting it left it undefined, so every dispatch threw
      // "publishWithResults is not a function" and the assertions below were
      // checking a spy that was never reached.
      publishWithResults: mockEventBusPublish,
    },
    CrossAppEventType: {
      AUTONOMOUS_ACTION_SPAWN_CYCLE: "autonomous-action:spawn-cycle",
      AUTONOMOUS_ACTION_CREATE_RFC: "autonomous-action:create-rfc",
      AUTONOMOUS_ACTION_UPDATE_COMPLIANCE_CHECK: "autonomous-action:update-compliance-check",
      AUTONOMOUS_ACTION_MODIFY_SPATIAL_ROUTING: "autonomous-action:modify-spatial-routing",
    },
  })
);

// Import AFTER mocks are established
import { AutonomousActionService } from "./autonomous-action.service.js";
import type { EventPrimitive, AutonomousActionPolicy } from "@shared/schema/index.js";
import type { CausalGraphLink } from "@shared/schema/index.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

const severityArb = fc.constantFrom("Critical", "High", "Medium", "Low");
const qualifyingSeverityArb = fc.constantFrom("Critical", "High");
const nonQualifyingSeverityArb = fc.constantFrom("Medium", "Low");

const jurisdictionArb = fc.constantFrom(
  "US", "CN", "EU", "UK", "JP", "KR", "DE", "FR", "BR", "AU"
);

const sectorArb = fc.constantFrom(
  "Semiconductor", "Energy", "Finance", "Healthcare",
  "Agriculture", "Defense", "Technology", "Manufacturing"
);

const actionTypeArb = fc.constantFrom(
  "spawn_cycle", "create_rfc", "update_compliance_check", "modify_spatial_routing"
);

const approvalGateArb = fc.constantFrom("auto_approve", "require_human_approval");

/** Generate a confidence score that qualifies (>= 0.8) */
const qualifyingConfidenceArb = fc.double({ min: 0.8, max: 1.0, noNaN: true });

/** Generate a confidence score that does NOT qualify (< 0.8) */
const nonQualifyingConfidenceArb = fc.double({ min: 0.0, max: 0.799, noNaN: true });

/** Generate a mock EventPrimitive */
const eventPrimitiveArb: fc.Arbitrary<EventPrimitive> = fc.record({
  id: fc.uuid(),
  organizationId: fc.integer({ min: 1, max: 1000 }),
  sourceEntryId: fc.uuid(),
  eventType: fc.constantFrom(
    "Tariff_Updated", "Regulation_Enacted", "Sanction_Imposed",
    "Trade_Agreement_Modified", "Central_Bank_Rate_Change",
    "Export_Control_Updated", "Compliance_Deadline_Set"
  ),
  targetSector: sectorArb,
  jurisdiction: jurisdictionArb,
  severity: severityArb,
  sourceUrl: fc.constant("https://example.com/feed/article"),
  extractionTimestamp: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") })
    .map((d) => d),
  confidenceScore: fc.double({ min: 0.0, max: 1.0, noNaN: true }),
  rawText: fc.constant("Sample raw text for event primitive."),
  flags: fc.constant([] as unknown[]),
  contentHash: fc.hexaString({ minLength: 32, maxLength: 32 }),
  createdAt: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") })
    .map((d) => d),
}) as unknown as fc.Arbitrary<EventPrimitive>;

/** Generate a mock AutonomousActionPolicy */
const policyArb = (orgId: number): fc.Arbitrary<AutonomousActionPolicy> =>
  fc.record({
    id: fc.integer({ min: 1, max: 10000 }),
    organizationId: fc.constant(orgId),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    triggerCondition: fc.record({
      minSeverity: severityArb,
      sectorFilter: fc.array(sectorArb, { minLength: 0, maxLength: 3 }),
      jurisdictionFilter: fc.array(jurisdictionArb, { minLength: 0, maxLength: 3 }),
    }),
    actionType: actionTypeArb,
    approvalGate: approvalGateArb,
    effectiveApprovalGate: approvalGateArb,
    volatilityOverride: fc.boolean(),
    enabled: fc.constant(true),
    createdAt: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") }).map((d) => d),
    updatedAt: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") }).map((d) => d),
  }) as unknown as fc.Arbitrary<AutonomousActionPolicy>;

/** Generate a CausalGraphLink */
const causalGraphLinkArb: fc.Arbitrary<CausalGraphLink> = fc.record({
  id: fc.uuid(),
  organizationId: fc.integer({ min: 1, max: 1000 }),
  eventPrimitiveId: fc.uuid(),
  targetEntityType: fc.constantFrom("cycle", "mission", "workstream", "supplier", "geo_region"),
  targetEntityId: fc.uuid(),
  impactHorizonMinDays: fc.integer({ min: 1, max: 90 }),
  impactHorizonMaxDays: fc.integer({ min: 7, max: 365 }),
  impactConfidence: fc.integer({ min: 0, max: 100 }),
  blastRadius: fc.integer({ min: 0, max: 50 }),
  depth: fc.integer({ min: 1, max: 3 }),
  createdAt: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") }).map((d) => d),
}) as unknown as fc.Arbitrary<CausalGraphLink>;

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: hat-menu-intent-router, Property 36: Policy matching threshold", () => {
  const service = new AutonomousActionService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 36: Policy matching threshold
   *
   * For any Event Primitive with severity "Critical" or "High" AND confidence_score ≥ 0.8,
   * the system SHALL evaluate it against all enabled autonomous action policies.
   *
   * **Validates: Requirements 17.1**
   */
  it("events with Critical/High severity AND confidence >= 0.8 qualify for evaluation", () => {
    fc.assert(
      fc.property(
        eventPrimitiveArb,
        qualifyingSeverityArb,
        qualifyingConfidenceArb,
        (event, severity, confidence) => {
          const qualifyingEvent = {
            ...event,
            severity,
            confidenceScore: confidence,
          };
          expect(service.qualifiesForEvaluation(qualifyingEvent as EventPrimitive)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 36: Policy matching threshold
   *
   * Events not meeting severity threshold (Medium/Low) SHALL NOT trigger policy evaluation.
   *
   * **Validates: Requirements 17.1**
   */
  it("events with Medium/Low severity do NOT qualify regardless of confidence", () => {
    fc.assert(
      fc.property(
        eventPrimitiveArb,
        nonQualifyingSeverityArb,
        qualifyingConfidenceArb,
        (event, severity, confidence) => {
          const nonQualifyingEvent = {
            ...event,
            severity,
            confidenceScore: confidence,
          };
          expect(service.qualifiesForEvaluation(nonQualifyingEvent as EventPrimitive)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 36: Policy matching threshold
   *
   * Events not meeting confidence threshold (< 0.8) SHALL NOT trigger policy evaluation
   * even with qualifying severity.
   *
   * **Validates: Requirements 17.1**
   */
  it("events with confidence < 0.8 do NOT qualify regardless of severity", () => {
    fc.assert(
      fc.property(
        eventPrimitiveArb,
        qualifyingSeverityArb,
        nonQualifyingConfidenceArb,
        (event, severity, confidence) => {
          const nonQualifyingEvent = {
            ...event,
            severity,
            confidenceScore: confidence,
          };
          expect(service.qualifiesForEvaluation(nonQualifyingEvent as EventPrimitive)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 36: Policy matching threshold
   *
   * Events with both non-qualifying severity AND confidence do NOT qualify.
   *
   * **Validates: Requirements 17.1**
   */
  it("events with both non-qualifying severity AND confidence do not qualify", () => {
    fc.assert(
      fc.property(
        eventPrimitiveArb,
        nonQualifyingSeverityArb,
        nonQualifyingConfidenceArb,
        (event, severity, confidence) => {
          const nonQualifyingEvent = {
            ...event,
            severity,
            confidenceScore: confidence,
          };
          expect(service.qualifiesForEvaluation(nonQualifyingEvent as EventPrimitive)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 37: Human approval creates pending request", () => {
  let service: AutonomousActionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AutonomousActionService();
    // Mock db.insert().values() for approval log
    mockInsert.mockReturnValue({ values: mockInsertValues });
  });

  /**
   * Property 37: Human approval creates pending request
   *
   * For any event matching a policy with effective_approval_gate = "require_human_approval",
   * the system SHALL create a pending approval request containing the Event Primitive details,
   * proposed action type, and affected entities list.
   *
   * **Validates: Requirements 17.4**
   */
  it("creates approval request with event details, action type, and affected entities", async () => {
    await fc.assert(
      fc.asyncProperty(
        eventPrimitiveArb,
        actionTypeArb,
        fc.array(causalGraphLinkArb, { minLength: 0, maxLength: 5 }),
        async (event, actionType, links) => {
          const policy: AutonomousActionPolicy = {
            id: 42,
            organizationId: event.organizationId,
            name: "Test Policy",
            triggerCondition: { minSeverity: "High" },
            actionType,
            approvalGate: "require_human_approval",
            effectiveApprovalGate: "require_human_approval",
            volatilityOverride: false,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as unknown as AutonomousActionPolicy;

          const result = await service.createApprovalRequest(policy, event as EventPrimitive, links as CausalGraphLink[]);

          // Verify the approval request contains the required data
          expect(result.eventPrimitiveId).toBe(event.id);
          expect(result.policyId).toBe(policy.id);
          expect(result.actionType).toBe(actionType);
          expect(result.affectedEntities).toEqual(links);
          expect(result.eventDetails).toEqual(event);
          expect(result.createdAt).toBeInstanceOf(Date);
          expect(result.expiresAt).toBeInstanceOf(Date);
          // 24h timeout
          const timeoutMs = result.expiresAt.getTime() - result.createdAt.getTime();
          expect(timeoutMs).toBe(24 * 60 * 60 * 1000);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 37: Human approval creates pending request
   *
   * The approval request logs a "pending" entry in autonomous_action_logs.
   *
   * **Validates: Requirements 17.4**
   */
  it("logs a pending entry in autonomous_action_logs", async () => {
    await fc.assert(
      fc.asyncProperty(
        eventPrimitiveArb,
        actionTypeArb,
        async (event, actionType) => {
          vi.clearAllMocks();
          mockInsert.mockReturnValue({ values: mockInsertValues });

          const policy: AutonomousActionPolicy = {
            id: 99,
            organizationId: event.organizationId,
            name: "Log Test Policy",
            triggerCondition: { minSeverity: "High" },
            actionType,
            approvalGate: "require_human_approval",
            effectiveApprovalGate: "require_human_approval",
            volatilityOverride: false,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as unknown as AutonomousActionPolicy;

          await service.createApprovalRequest(policy, event as EventPrimitive, []);

          // Verify db.insert was called (for the log entry)
          expect(mockInsert).toHaveBeenCalled();
          expect(mockInsertValues).toHaveBeenCalledWith(
            expect.objectContaining({
              organizationId: event.organizationId,
              eventPrimitiveId: event.id,
              policyId: policy.id,
              actionType,
              approvalStatus: "pending",
            })
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 38: Spawn_cycle creates linked Cycle", () => {
  let service: AutonomousActionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AutonomousActionService();
    mockInsert.mockReturnValue({ values: mockInsertValues });
  });

  /**
   * Property 38: Spawn_cycle creates linked Cycle
   *
   * For any executed autonomous action of type "spawn_cycle", a new Cycle SHALL be
   * created with the triggering Event Primitive as context, linked to all affected
   * entities from the Causal Graph, with priority derived from Event Primitive severity.
   *
   * **Validates: Requirements 17.6**
   */
  it("spawn_cycle emits event with event context, linked entities, and severity-based priority", async () => {
    await fc.assert(
      fc.asyncProperty(
        eventPrimitiveArb,
        fc.array(causalGraphLinkArb, { minLength: 1, maxLength: 5 }),
        qualifyingSeverityArb,
        qualifyingConfidenceArb,
        async (event, links, severity, confidence) => {
          vi.clearAllMocks();
          mockInsert.mockReturnValue({ values: mockInsertValues });

          const qualifiedEvent = {
            ...event,
            severity,
            confidenceScore: confidence,
          } as unknown as EventPrimitive;

          const policy: AutonomousActionPolicy = {
            id: 10,
            organizationId: event.organizationId,
            name: "Spawn Cycle Policy",
            triggerCondition: { minSeverity: "High" },
            actionType: "spawn_cycle",
            approvalGate: "auto_approve",
            effectiveApprovalGate: "auto_approve",
            volatilityOverride: false,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as unknown as AutonomousActionPolicy;

          await service.executeAction(policy, qualifiedEvent, links as CausalGraphLink[]);

          // Verify the event was published with the correct envelope and payload.
          // organizationId is asserted on the envelope too — that is what scopes
          // the event log and lets handlers filter by org.
          expect(mockEventBusPublish).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "autonomous-action:spawn-cycle",
              organizationId: qualifiedEvent.organizationId,
              sourceApp: "signal-intelligence",
              payload: expect.objectContaining({
                eventPrimitiveId: qualifiedEvent.id,
                organizationId: qualifiedEvent.organizationId,
                severity: qualifiedEvent.severity,
                affectedEntityIds: links.map((l) => l.targetEntityId),
                triggerContext: expect.objectContaining({
                  eventType: qualifiedEvent.eventType,
                  confidenceScore: qualifiedEvent.confidenceScore,
                }),
              }),
            })
          );

          // Verify priority is derived from severity. publish() takes a single
          // envelope argument, so the data lives at calls[0][0].payload.
          const publishCall = mockEventBusPublish.mock.calls[0];
          const payload = publishCall[0].payload as { priority: number };
          const expectedPriority = severity === "Critical" ? 1 : 2;
          expect(payload.priority).toBe(expectedPriority);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 38: Spawn_cycle creates linked Cycle
   *
   * The cycle includes ALL affected entities from the causal graph links.
   *
   * **Validates: Requirements 17.6**
   */
  it("all affected entity IDs from causal graph are included in spawn payload", async () => {
    await fc.assert(
      fc.asyncProperty(
        eventPrimitiveArb,
        fc.array(causalGraphLinkArb, { minLength: 0, maxLength: 10 }),
        async (event, links) => {
          vi.clearAllMocks();
          mockInsert.mockReturnValue({ values: mockInsertValues });

          const qualifiedEvent = {
            ...event,
            severity: "Critical",
            confidenceScore: 0.95,
          } as unknown as EventPrimitive;

          const policy: AutonomousActionPolicy = {
            id: 11,
            organizationId: event.organizationId,
            name: "Spawn Cycle All Entities",
            triggerCondition: { minSeverity: "High" },
            actionType: "spawn_cycle",
            approvalGate: "auto_approve",
            effectiveApprovalGate: "auto_approve",
            volatilityOverride: false,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as unknown as AutonomousActionPolicy;

          await service.executeAction(policy, qualifiedEvent, links as CausalGraphLink[]);

          const publishCall = mockEventBusPublish.mock.calls[0];
          const payload = publishCall[0].payload as { affectedEntityIds: string[] };

          // Every entity ID from the links should be in the payload
          const expectedIds = links.map((l) => l.targetEntityId);
          expect(payload.affectedEntityIds).toEqual(expectedIds);
          expect(payload.affectedEntityIds.length).toBe(links.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 39: Execution logging", () => {
  let service: AutonomousActionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AutonomousActionService();
    mockInsert.mockReturnValue({ values: mockInsertValues });
  });

  /**
   * Property 39: Execution logging
   *
   * For any autonomous action execution (whether successful or failed),
   * a log entry SHALL exist in autonomous_action_logs containing:
   * event_primitive_id, policy_id, action_type, execution timestamp, and outcome.
   *
   * **Validates: Requirements 17.7**
   */
  it("successful executions are logged with all required fields", async () => {
    await fc.assert(
      fc.asyncProperty(
        eventPrimitiveArb,
        actionTypeArb,
        async (event, actionType) => {
          vi.clearAllMocks();
          mockInsert.mockReturnValue({ values: mockInsertValues });

          const qualifiedEvent = {
            ...event,
            severity: "Critical",
            confidenceScore: 0.9,
          } as unknown as EventPrimitive;

          const policy: AutonomousActionPolicy = {
            id: 55,
            organizationId: event.organizationId,
            name: "Logging Policy",
            triggerCondition: { minSeverity: "High" },
            actionType,
            approvalGate: "auto_approve",
            effectiveApprovalGate: "auto_approve",
            volatilityOverride: false,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as unknown as AutonomousActionPolicy;

          await service.executeAction(policy, qualifiedEvent, []);

          // The second insert call is the log entry (first is from event bus mock side effects)
          // Actually: executeAction calls logExecution which calls db.insert
          expect(mockInsert).toHaveBeenCalled();
          expect(mockInsertValues).toHaveBeenCalledWith(
            expect.objectContaining({
              organizationId: event.organizationId,
              eventPrimitiveId: qualifiedEvent.id,
              policyId: policy.id,
              actionType,
              outcome: "success",
              executedAt: expect.any(Date),
            })
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 39: Execution logging
   *
   * Failed executions are also logged with outcome = "failure" and a failure reason.
   *
   * **Validates: Requirements 17.7**
   */
  it("failed executions are logged with failure reason", async () => {
    await fc.assert(
      fc.asyncProperty(
        eventPrimitiveArb,
        actionTypeArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        async (event, actionType, errorMsg) => {
          vi.clearAllMocks();
          mockInsert.mockReturnValue({ values: mockInsertValues });

          // Make the event bus throw to simulate failure
          mockEventBusPublish.mockRejectedValueOnce(new Error(errorMsg));

          const qualifiedEvent = {
            ...event,
            severity: "Critical",
            confidenceScore: 0.9,
          } as unknown as EventPrimitive;

          const policy: AutonomousActionPolicy = {
            id: 77,
            organizationId: event.organizationId,
            name: "Failure Logging Policy",
            triggerCondition: { minSeverity: "High" },
            actionType,
            approvalGate: "auto_approve",
            effectiveApprovalGate: "auto_approve",
            volatilityOverride: false,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as unknown as AutonomousActionPolicy;

          const result = await service.executeAction(policy, qualifiedEvent, []);

          expect(result.success).toBe(false);
          expect(result.failureReason).toBe(errorMsg);

          // Verify log entry with failure
          expect(mockInsertValues).toHaveBeenCalledWith(
            expect.objectContaining({
              eventPrimitiveId: qualifiedEvent.id,
              policyId: policy.id,
              actionType,
              outcome: "failure",
              failureReason: errorMsg,
            })
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 40: Regional volatility auto-tightens approval gates", () => {
  let service: AutonomousActionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AutonomousActionService();
  });

  /**
   * Property 40: Regional volatility auto-tightens approval gates
   *
   * For any jurisdiction where the 7-day rolling window of Event Primitive frequency
   * multiplied by average severity exceeds the organization's configured threshold,
   * all "auto_approve" policies affecting that jurisdiction SHALL have their
   * effective_approval_gate set to "require_human_approval".
   *
   * **Validates: Requirements 17.8**
   */
  it("volatility exceeding threshold tightens auto_approve policies to require_human_approval", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        jurisdictionArb,
        fc.integer({ min: 5, max: 50 }),
        async (orgId, jurisdiction, threshold) => {
          vi.clearAllMocks();

          // Generate enough high-severity events to exceed the threshold
          // We need: eventCount × avgSeverity > threshold
          // With all "Critical" events: avgSeverity=4, so need eventCount > threshold/4
          const requiredEvents = Math.ceil(threshold / 4) + 1;
          const highSeverityEvents = Array.from({ length: requiredEvents }, () => ({
            severity: "Critical",
          }));

          // Mock db.select for computeRegionalVolatility (events query)
          const mockWhere = vi.fn().mockResolvedValue(highSeverityEvents);
          mockSelectFrom.mockReturnValue({ where: mockWhere });

          const metrics = await service.computeRegionalVolatility(orgId, jurisdiction, threshold);

          // Verify volatility exceeds threshold
          const expectedVolatility = requiredEvents * 4; // all Critical = weight 4
          expect(metrics.exceeds).toBe(true);
          expect(metrics.eventCount7d).toBe(requiredEvents);
          expect(metrics.avgSeverity7d).toBe(4);
          expect(metrics.eventCount7d * metrics.avgSeverity7d).toBeGreaterThan(threshold);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 40: Regional volatility auto-tightens approval gates
   *
   * When volatility drops below the threshold, gates are NOT tightened.
   *
   * **Validates: Requirements 17.8**
   */
  it("volatility below threshold does not tighten gates", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        jurisdictionArb,
        fc.integer({ min: 50, max: 200 }),
        async (orgId, jurisdiction, threshold) => {
          vi.clearAllMocks();

          // Few low-severity events: eventCount=2, avgSeverity=1 → volatility=2
          const lowSeverityEvents = [{ severity: "Low" }, { severity: "Low" }];

          const mockWhere = vi.fn().mockResolvedValue(lowSeverityEvents);
          mockSelectFrom.mockReturnValue({ where: mockWhere });

          const metrics = await service.computeRegionalVolatility(orgId, jurisdiction, threshold);

          expect(metrics.exceeds).toBe(false);
          expect(metrics.eventCount7d * metrics.avgSeverity7d).toBeLessThanOrEqual(threshold);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 40: Regional volatility auto-tightens approval gates
   *
   * tightenApprovalGates updates effectiveApprovalGate to "require_human_approval"
   * and sets volatilityOverride = true for affected policies.
   *
   * **Validates: Requirements 17.8**
   */
  it("tightenApprovalGates sets effective gate and volatility override on affected policies", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        jurisdictionArb,
        fc.array(
          fc.record({
            id: fc.integer({ min: 1, max: 10000 }),
            organizationId: fc.constant(1),
            name: fc.constant("Test"),
            triggerCondition: fc.record({
              jurisdictionFilter: fc.constant([] as string[]),
            }),
            actionType: actionTypeArb,
            approvalGate: fc.constant("auto_approve"),
            effectiveApprovalGate: fc.constant("auto_approve"),
            volatilityOverride: fc.constant(false),
            enabled: fc.constant(true),
            createdAt: fc.constant(new Date()),
            updatedAt: fc.constant(new Date()),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (orgId, jurisdiction, policies) => {
          vi.clearAllMocks();

          // Mock db.select for tightenApprovalGates (policies query)
          const mockPoliciesWhere = vi.fn().mockResolvedValue(policies);
          mockSelectFrom.mockReturnValue({ where: mockPoliciesWhere });

          // Mock db.update().set().where()
          const mockWhereUpdate = vi.fn().mockResolvedValue(undefined);
          mockUpdateSet.mockReturnValue({ where: mockWhereUpdate });

          await service.tightenApprovalGates(orgId, jurisdiction);

          // Verify update was called for each affected policy
          expect(mockUpdate).toHaveBeenCalled();
          expect(mockUpdateSet).toHaveBeenCalledWith(
            expect.objectContaining({
              effectiveApprovalGate: "require_human_approval",
              volatilityOverride: true,
            })
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 40: Regional volatility auto-tightens approval gates
   *
   * relaxApprovalGates restores the original approval gate and clears
   * the volatility override flag.
   *
   * **Validates: Requirements 17.8**
   */
  it("relaxApprovalGates restores original gate and clears volatility override", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        jurisdictionArb,
        async (orgId, jurisdiction) => {
          vi.clearAllMocks();

          // Mock policies that were previously tightened
          const tightenedPolicies = [
            {
              id: 1,
              organizationId: orgId,
              name: "Policy A",
              triggerCondition: { jurisdictionFilter: [] },
              actionType: "spawn_cycle",
              approvalGate: "auto_approve",
              effectiveApprovalGate: "require_human_approval",
              volatilityOverride: true,
              enabled: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];

          const mockPoliciesWhere = vi.fn().mockResolvedValue(tightenedPolicies);
          mockSelectFrom.mockReturnValue({ where: mockPoliciesWhere });

          const mockWhereUpdate = vi.fn().mockResolvedValue(undefined);
          mockUpdateSet.mockReturnValue({ where: mockWhereUpdate });

          await service.relaxApprovalGates(orgId, jurisdiction);

          // Verify update restores original gate
          expect(mockUpdateSet).toHaveBeenCalledWith(
            expect.objectContaining({
              effectiveApprovalGate: "auto_approve", // restored from policy.approvalGate
              volatilityOverride: false,
            })
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
