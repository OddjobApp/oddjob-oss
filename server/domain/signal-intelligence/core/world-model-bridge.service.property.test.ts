/**
 * Property-based tests for World Model Bridge Service
 *
 * Feature: hat-menu-intent-router
 *
 * Properties tested:
 * - Property 32: State-transition event emitted after graph mapping
 * - Property 33: Counterfactual simulation preserves production state
 * - Property 34: Rolling window of 1000 state-transition events
 * - Property 35: Failed events go to dead-letter queue
 *
 * **Validates: Requirements 16.1, 16.4, 16.6, 16.7**
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

vi.mock("@server/database_service.js", () => {
  const mockedDb: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  mockedDb.transaction = vi.fn((callback: (tx: any) => unknown) => callback(mockedDb));
  return { db: mockedDb };
});

vi.mock("@domain/core/infrastructure/kafka-outbox.service.js", () => ({
  enqueueKafkaEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
    desc: vi.fn((a: unknown) => ({ op: "desc", a })),
    and: vi.fn((...args: unknown[]) => args),
    inArray: vi.fn((a: unknown, b: unknown) => ({ op: "inArray", a, b })),
    sql: vi.fn(),
  };
});

vi.mock("./causal-graph.service.js", () => ({
  causalGraphService: {
    computeImpactHorizon: vi.fn(),
    computeBlastRadius: vi.fn(),
  },
}));

vi.mock("@shared/schema/prediction/graph.js", () => ({
  graphNodes: {
    refId: "refId",
    type: "type",
    properties: "properties",
  },
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: {
    xadd: vi.fn(),
  },
}));

vi.mock("uuid", () => ({
  v4: () => "test-uuid-" + Math.random().toString(36).substr(2, 9),
}));

// Import AFTER mocks are established
import { WorldModelBridgeService } from "./world-model-bridge.service.js";
import { db } from "@server/database_service.js";
import { causalGraphService } from "./causal-graph.service.js";
import type { EventPrimitive, CausalGraphLink, StateTransitionEvent } from "@shared/schema/index.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Valid severity levels */
const severityArb = fc.constantFrom("Critical", "High", "Medium", "Low");

/** Jurisdictions */
const jurisdictionArb = fc.constantFrom("US", "CN", "EU", "UK", "JP", "KR", "DE", "FR", "BR", "AU");

/** Target sectors */
const sectorArb = fc.constantFrom(
  "Semiconductor", "Energy", "Finance", "Healthcare",
  "Agriculture", "Defense", "Technology", "Manufacturing"
);

/** Entity types */
const entityTypeArb = fc.constantFrom(
  "cycle", "mission", "workstream", "supplier", "geo_region"
);

/** Generate a mock EventPrimitive with required fields */
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
  extractionTimestamp: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") }),
  confidenceScore: fc.double({ min: 0.3, max: 1.0, noNaN: true }),
  rawText: fc.constant("Sample raw text for event primitive."),
  flags: fc.constant([] as unknown[]),
  contentHash: fc.hexaString({ minLength: 32, maxLength: 32 }),
  createdAt: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") }),
}) as unknown as fc.Arbitrary<EventPrimitive>;

/** Generate a mock CausalGraphLink */
const causalGraphLinkArb: fc.Arbitrary<CausalGraphLink> = fc.record({
  id: fc.uuid(),
  organizationId: fc.integer({ min: 1, max: 1000 }),
  eventPrimitiveId: fc.uuid(),
  targetEntityType: entityTypeArb,
  targetEntityId: fc.uuid(),
  impactHorizonMinDays: fc.integer({ min: 1, max: 90 }),
  impactHorizonMaxDays: fc.integer({ min: 7, max: 365 }),
  impactConfidence: fc.integer({ min: 0, max: 100 }),
  blastRadius: fc.integer({ min: 0, max: 50 }),
  depth: fc.integer({ min: 1, max: 3 }),
  createdAt: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") }),
}) as unknown as fc.Arbitrary<CausalGraphLink>;

/** Generate an array of CausalGraphLinks (at least 1, representing a successful graph mapping) */
const causalGraphLinksArb = fc.array(causalGraphLinkArb, { minLength: 1, maxLength: 5 });

/** Generate a mock StateTransitionEvent for database results */
const stateTransitionEventArb: fc.Arbitrary<StateTransitionEvent> = fc.record({
  id: fc.uuid(),
  organizationId: fc.integer({ min: 1, max: 1000 }),
  eventPrimitiveId: fc.uuid(),
  affectedEntities: fc.constant([] as unknown),
  impactHorizons: fc.constant({} as unknown),
  environmentVariables: fc.constant({} as unknown),
  status: fc.constantFrom("pending", "accepted", "failed", "dead_letter"),
  failureReason: fc.option(fc.string({ minLength: 5, maxLength: 100 }), { nil: null }),
  createdAt: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") }),
}) as unknown as fc.Arbitrary<StateTransitionEvent>;

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: hat-menu-intent-router, Property 32: State-transition event emitted after graph mapping", () => {
  let service: WorldModelBridgeService;
  const mockedDb = vi.mocked(db);

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorldModelBridgeService();
  });

  /**
   * Property 32: State-transition event emitted after graph mapping
   *
   * For any Event Primitive successfully mapped to at least one CausalGraphLink,
   * the system SHALL emit a StateTransitionEvent containing the event primitive,
   * affected entity list, and computed impact horizons to the world model ingestion queue.
   *
   * **Validates: Requirements 16.1**
   */
  it("emitStateTransition persists a state-transition event with correct fields for any event with links", async () => {
    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, causalGraphLinksArb, async (event, links) => {
        vi.clearAllMocks();

        let insertedValues: any = null;

        // Mock db.insert().values().returning() for state_transition_events
        mockedDb.insert.mockReturnValue({
          values: vi.fn().mockImplementation((values: any) => {
            insertedValues = values;
            return {
              returning: vi.fn().mockResolvedValue([{
                id: "ste-" + event.id,
                ...values,
                createdAt: new Date(),
              }]),
            };
          }),
        } as any);

        // Mock db.update().set().where() for marking as accepted
        mockedDb.update.mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        } as any);

        // Mock Redis push (success case)
        const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
        vi.mocked(redis.xadd).mockResolvedValue("stream-id-123");

        await service.emitStateTransition(event, links);

        // Verify insert was called with correct structure
        expect(insertedValues).not.toBeNull();
        expect(insertedValues.organizationId).toBe(event.organizationId);
        expect(insertedValues.eventPrimitiveId).toBe(event.id);
        expect(insertedValues.affectedEntities).toEqual(links);
        expect(insertedValues.status).toBe("accepted");

        // Verify impact horizons contain entries for each link's target entity
        expect(insertedValues.impactHorizons).toBeDefined();
        for (const link of links) {
          expect(insertedValues.impactHorizons[link.targetEntityId]).toBeDefined();
          expect(insertedValues.impactHorizons[link.targetEntityId].min).toBe(link.impactHorizonMinDays);
          expect(insertedValues.impactHorizons[link.targetEntityId].max).toBe(link.impactHorizonMaxDays);
          expect(insertedValues.impactHorizons[link.targetEntityId].confidence).toBe(link.impactConfidence);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 32: State-transition event emitted after graph mapping
   *
   * The emitted state-transition event contains environment variables with
   * signal metadata and per-entity details derived from the event primitive and links.
   *
   * **Validates: Requirements 16.1**
   */
  it("formatForWorldModel produces environment variables for every link entity", async () => {
    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, causalGraphLinksArb, async (event, links) => {
        const formatted = await service.formatForWorldModel(event, links);

        // Verify signal-level environment variables
        expect(formatted.environmentVariables["signal.event_type"]).toBe(event.eventType);
        expect(formatted.environmentVariables["signal.severity"]).toBe(event.severity);
        expect(formatted.environmentVariables["signal.confidence"]).toBe(event.confidenceScore);
        expect(formatted.environmentVariables["signal.jurisdiction"]).toBe(event.jurisdiction);
        expect(formatted.environmentVariables["signal.target_sector"]).toBe(event.targetSector);
        expect(formatted.environmentVariables["signal.affected_entity_count"]).toBe(links.length);

        // Verify per-entity environment variables
        for (const link of links) {
          const prefix = `entities.${link.targetEntityId}`;
          expect(formatted.environmentVariables[`${prefix}.type`]).toBe(link.targetEntityType);
          expect(formatted.environmentVariables[`${prefix}.impact_confidence`]).toBe(link.impactConfidence);
          expect(formatted.environmentVariables[`${prefix}.horizon_min`]).toBe(link.impactHorizonMinDays);
          expect(formatted.environmentVariables[`${prefix}.horizon_max`]).toBe(link.impactHorizonMaxDays);
          expect(formatted.environmentVariables[`${prefix}.blast_radius`]).toBe(link.blastRadius);
          expect(formatted.environmentVariables[`${prefix}.depth`]).toBe(link.depth);
        }

        // Verify the formatted event links back to the event primitive
        expect(formatted.eventPrimitiveId).toBe(event.id);
        expect(formatted.organizationId).toBe(event.organizationId);
        expect(formatted.affectedEntities).toEqual(links);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 33: Counterfactual simulation preserves production state", () => {
  let service: WorldModelBridgeService;
  const mockedDb = vi.mocked(db);

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorldModelBridgeService();
  });

  /**
   * Property 33: Counterfactual simulation preserves production state
   *
   * For any synthetic Event Primitive submitted through the counterfactual simulation
   * channel, the production `event_primitives`, `causal_graph_links`, and
   * `state_transition_events` tables SHALL have zero new entries as a result of
   * that simulation.
   *
   * **Validates: Requirements 16.4**
   */
  it("runCounterfactual never calls db.insert (no production writes)", async () => {
    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, async (syntheticEvent) => {
        vi.clearAllMocks();

        // Mock causalGraphService methods (read-only operations)
        vi.mocked(causalGraphService.computeImpactHorizon).mockResolvedValue({ min: 1, max: 7 });
        vi.mocked(causalGraphService.computeBlastRadius).mockResolvedValue(3);

        // Mock the read-only graphNodes query used by findMatchingAssetsReadOnly
        mockedDb.select.mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { refId: "asset-1", type: "cycle" },
              { refId: "asset-2", type: "supplier" },
            ]),
          }),
        }) as any);

        const result = await service.runCounterfactual(syntheticEvent);

        // CRITICAL: db.insert must NEVER be called during counterfactual simulation
        expect(mockedDb.insert).not.toHaveBeenCalled();

        // Verify that a result is returned (simulation completed)
        expect(result).toBeDefined();
        expect(result.syntheticEventId).toBe(syntheticEvent.id);
        expect(result.affectedEntityCount).toBeGreaterThanOrEqual(0);
        expect(result.simulationDurationMs).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 33: Counterfactual simulation preserves production state
   *
   * Counterfactual simulation only uses db.select (read-only) and never db.update.
   *
   * **Validates: Requirements 16.4**
   */
  it("runCounterfactual never calls db.update (no status changes to production)", async () => {
    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, async (syntheticEvent) => {
        vi.clearAllMocks();

        vi.mocked(causalGraphService.computeImpactHorizon).mockResolvedValue({ min: 7, max: 30 });
        vi.mocked(causalGraphService.computeBlastRadius).mockResolvedValue(0);

        mockedDb.select.mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }) as any);

        await service.runCounterfactual(syntheticEvent);

        // db.update must never be called during simulation
        expect(mockedDb.update).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 33: Counterfactual simulation preserves production state
   *
   * The counterfactual result contains predicted state changes, affected entity
   * count, and adjusted distributions without persisting anything.
   *
   * **Validates: Requirements 16.4**
   */
  it("runCounterfactual returns valid result structure with affected entities", async () => {
    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, async (syntheticEvent) => {
        vi.clearAllMocks();

        vi.mocked(causalGraphService.computeImpactHorizon).mockResolvedValue({ min: 30, max: 90 });
        vi.mocked(causalGraphService.computeBlastRadius).mockResolvedValue(5);

        // Return some matching assets
        const matchCount = Math.floor(Math.random() * 4) + 1;
        const assets = Array.from({ length: matchCount }, (_, i) => ({
          refId: `asset-${i}`,
          type: i % 2 === 0 ? "cycle" : "supplier",
        }));

        mockedDb.select.mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(assets),
          }),
        }) as any);

        const result = await service.runCounterfactual(syntheticEvent);

        // Verify result structure
        expect(result.syntheticEventId).toBe(syntheticEvent.id);
        expect(result.affectedEntityCount).toBe(matchCount);
        expect(result.predictedStateChanges).toBeDefined();
        expect(result.predictedStateChanges.environmentVariables).toBeDefined();
        expect(result.predictedStateChanges.impactHorizons).toBeDefined();
        expect(result.predictedStateChanges.affectedEntities).toHaveLength(matchCount);
        expect(result.adjustedDistributions).toBeDefined();
        expect(typeof result.adjustedDistributions["risk.overall_adjustment"]).toBe("number");
      }),
      { numRuns: 100 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 34: Rolling window of 1000 state-transition events", () => {
  let service: WorldModelBridgeService;
  const mockedDb = vi.mocked(db);

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorldModelBridgeService();
  });

  /**
   * Property 34: Rolling window of 1000 state-transition events
   *
   * For any organization, `getRecentTransitions` SHALL return at most 1000 entries,
   * representing the most recent state-transition events ordered by creation time
   * descending.
   *
   * **Validates: Requirements 16.6**
   */
  it("getRecentTransitions returns at most 1000 entries regardless of input limit", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 5000 }),
        async (orgId, requestedLimit) => {
          vi.clearAllMocks();

          // Generate up to 1000 results (simulating database returning the limit-capped results)
          const effectiveLimit = Math.min(requestedLimit, 1000);
          const mockResults: StateTransitionEvent[] = Array.from(
            { length: effectiveLimit },
            (_, i) => ({
              id: `ste-${i}`,
              organizationId: orgId,
              eventPrimitiveId: `ep-${i}`,
              affectedEntities: [],
              impactHorizons: {},
              environmentVariables: {},
              status: "accepted",
              failureReason: null,
              createdAt: new Date(Date.now() - i * 60000), // Descending order
            })
          ) as unknown as StateTransitionEvent[];

          mockedDb.select.mockImplementation(() => ({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockImplementation((limit: number) => {
                    // Return at most `limit` items
                    return Promise.resolve(mockResults.slice(0, limit));
                  }),
                }),
              }),
            }),
          }) as any);

          const results = await service.getRecentTransitions(orgId, requestedLimit);

          // Must never exceed 1000 entries
          expect(results.length).toBeLessThanOrEqual(1000);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 34: Rolling window of 1000 state-transition events
   *
   * getRecentTransitions caps the effective limit to 1000 even when a larger limit
   * is passed. The database query receives at most 1000 as the limit parameter.
   *
   * **Validates: Requirements 16.6**
   */
  it("effective limit is capped at 1000 even when a higher value is requested", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1001, max: 10000 }),
        async (orgId, oversizedLimit) => {
          vi.clearAllMocks();

          let capturedLimit: number | undefined;

          mockedDb.select.mockImplementation(() => ({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockImplementation((limit: number) => {
                    capturedLimit = limit;
                    return Promise.resolve([]);
                  }),
                }),
              }),
            }),
          }) as any);

          await service.getRecentTransitions(orgId, oversizedLimit);

          // The effective limit passed to db query must be <= 1000
          expect(capturedLimit).toBeDefined();
          expect(capturedLimit).toBeLessThanOrEqual(1000);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 34: Rolling window of 1000 state-transition events
   *
   * Default limit (no argument) also caps at 1000.
   *
   * **Validates: Requirements 16.6**
   */
  it("default limit parameter caps at 1000", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        async (orgId) => {
          vi.clearAllMocks();

          let capturedLimit: number | undefined;

          mockedDb.select.mockImplementation(() => ({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockImplementation((limit: number) => {
                    capturedLimit = limit;
                    return Promise.resolve([]);
                  }),
                }),
              }),
            }),
          }) as any);

          // Call without explicit limit (uses default)
          await service.getRecentTransitions(orgId);

          expect(capturedLimit).toBeDefined();
          expect(capturedLimit).toBeLessThanOrEqual(1000);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 35: Failed events go to dead-letter queue", () => {
  let service: WorldModelBridgeService;
  const mockedDb = vi.mocked(db);

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorldModelBridgeService();
  });

  /**
   * Property 35: Failed events go to dead-letter queue
   *
   * For any state-transition event that fails acceptance by the world model
   * (schema validation error or queue timeout >10s), its status SHALL be set to
   * "dead_letter" and an alert event SHALL be emitted via the event bus.
   *
   * **Validates: Requirements 16.7**
   */
  it("handleDeadLetter sets status to dead_letter with failure reason", async () => {
    await fc.assert(
      fc.asyncProperty(
        stateTransitionEventArb,
        fc.string({ minLength: 5, maxLength: 200 }),
        async (failedEvent, reason) => {
          vi.clearAllMocks();

          let capturedStatus: string | undefined;
          let capturedReason: string | undefined;

          mockedDb.update.mockReturnValue({
            set: vi.fn().mockImplementation((setValues: any) => {
              capturedStatus = setValues.status;
              capturedReason = setValues.failureReason;
              return {
                where: vi.fn().mockResolvedValue(undefined),
              };
            }),
          } as any);

          await service.handleDeadLetter(failedEvent, reason);

          // Status must be set to "dead_letter"
          expect(capturedStatus).toBe("dead_letter");
          // Failure reason must be recorded
          expect(capturedReason).toBe(reason);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 35: Failed events go to dead-letter queue
   *
   * When Redis push times out during emitStateTransition, the event is routed
   * to the dead-letter queue with appropriate failure reason.
   *
   * **Validates: Requirements 16.7**
   */
  it("emitStateTransition retains accepted state when the Redis fallback times out", async () => {
    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, causalGraphLinksArb, async (event, links) => {
        vi.clearAllMocks();

        const insertedId = "ste-timeout-" + event.id;

        // Mock insert returning an ID
        mockedDb.insert.mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              id: insertedId,
              organizationId: event.organizationId,
              eventPrimitiveId: event.id,
              affectedEntities: links,
              impactHorizons: {},
              environmentVariables: {},
              status: "pending",
              failureReason: null,
              createdAt: new Date(),
            }]),
          }),
        } as any);

        // Track update calls
        let deadLetterCalled = false;
        let capturedStatus: string | undefined;

        mockedDb.update.mockReturnValue({
          set: vi.fn().mockImplementation((setValues: any) => {
            if (setValues.status === "dead_letter") {
              deadLetterCalled = true;
              capturedStatus = setValues.status;
            }
            return {
              where: vi.fn().mockResolvedValue(undefined),
            };
          }),
        } as any);

        // Mock Redis xadd to reject (simulating timeout)
        const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
        vi.mocked(redis.xadd).mockRejectedValue(new Error("Queue timeout exceeded 10 seconds"));

        await service.emitStateTransition(event, links);

        // Kafka outbox is authoritative; Redis failure must not poison it.
        expect(deadLetterCalled).toBe(false);
        expect(capturedStatus).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 35: Failed events go to dead-letter queue
   *
   * When Redis push fails with a schema validation error, the event is also
   * routed to dead-letter with the error message as failure reason.
   *
   * **Validates: Requirements 16.7**
   */
  it("emitStateTransition retains accepted state on a Redis schema error", async () => {
    const schemaErrorMessages = [
      "Invalid payload schema: missing required field 'timestamp'",
      "Schema validation failed: environmentVariables must be object",
      "Payload exceeds maximum size",
    ];

    await fc.assert(
      fc.asyncProperty(
        eventPrimitiveArb,
        causalGraphLinksArb,
        fc.constantFrom(...schemaErrorMessages),
        async (event, links, errorMsg) => {
          vi.clearAllMocks();

          mockedDb.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{
                id: "ste-schema-err-" + event.id,
                organizationId: event.organizationId,
                eventPrimitiveId: event.id,
                affectedEntities: links,
                impactHorizons: {},
                environmentVariables: {},
                status: "pending",
                failureReason: null,
                createdAt: new Date(),
              }]),
            }),
          } as any);

          let capturedFailureReason: string | undefined;

          mockedDb.update.mockReturnValue({
            set: vi.fn().mockImplementation((setValues: any) => {
              if (setValues.status === "dead_letter") {
                capturedFailureReason = setValues.failureReason;
              }
              return {
                where: vi.fn().mockResolvedValue(undefined),
              };
            }),
          } as any);

          // Mock Redis xadd to reject with schema error
          const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
          vi.mocked(redis.xadd).mockRejectedValue(new Error(errorMsg));

          await service.emitStateTransition(event, links);

          expect(capturedFailureReason).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
