/**
 * Property-based tests for Causal Graph Service
 *
 * Feature: hat-menu-intent-router
 *
 * Properties tested:
 * - Property 28: Impact horizon ranges match severity — values within severity-defined bounds
 * - Property 29: Mapping by sector and jurisdiction — matches create links, no matches → unlinked
 * - Property 30: Blast radius counts transitive dependencies up to depth 3
 * - Property 31: Re-evaluation of unlinked events on new asset registration
 *
 * **Validates: Requirements 15.1, 15.3, 15.4, 15.5, 15.6, 15.7**
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

vi.mock("@server/database_service.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
    gte: vi.fn((a: unknown, b: unknown) => ({ op: "gte", a, b })),
    sql: vi.fn(),
    inArray: vi.fn((a: unknown, b: unknown) => ({ op: "inArray", a, b })),
    and: vi.fn((...args: unknown[]) => args),
  };
});

// Import AFTER mocks are established
import { CausalGraphService, type AssetMetadata } from "./causal-graph.service.js";
import { db } from "@server/database_service.js";
import type { EventPrimitive } from "@shared/schema/index.js";

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
  "cycle" as const, "mission" as const, "workstream" as const,
  "supplier" as const, "geo_region" as const
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
  extractionTimestamp: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") })
    .map((d) => d),
  confidenceScore: fc.double({ min: 0.3, max: 1.0, noNaN: true }),
  rawText: fc.constant("Sample raw text for event primitive."),
  flags: fc.constant([] as unknown[]),
  contentHash: fc.hexaString({ minLength: 32, maxLength: 32 }),
  createdAt: fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") })
    .map((d) => d),
}) as unknown as fc.Arbitrary<EventPrimitive>;

/** Generate AssetMetadata */
const assetMetadataArb: fc.Arbitrary<AssetMetadata> = fc.record({
  entityId: fc.uuid(),
  entityType: entityTypeArb,
  organizationId: fc.integer({ min: 1, max: 1000 }),
  sectorTags: fc.uniqueArray(sectorArb, { minLength: 1, maxLength: 4 }),
  operatingRegions: fc.uniqueArray(jurisdictionArb, { minLength: 1, maxLength: 4 }),
});

/** Generate a directed graph (adjacency list) for BFS testing */
interface GraphSpec {
  nodeIds: string[];
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>;
}

const graphSpecArb: fc.Arbitrary<GraphSpec> = fc
  .integer({ min: 2, max: 15 })
  .chain((numNodes) => {
    const nodeIdsArb = fc
      .uniqueArray(fc.uuid(), { minLength: numNodes, maxLength: numNodes })
      .filter((arr) => arr.length === numNodes);

    return nodeIdsArb.chain((nodeIds) => {
      // Generate random edges between nodes (no self-loops)
      const maxEdges = Math.min(numNodes * 3, 30);
      const edgeArb = fc
        .tuple(
          fc.integer({ min: 0, max: nodeIds.length - 1 }),
          fc.integer({ min: 0, max: nodeIds.length - 1 })
        )
        .filter(([src, tgt]) => src !== tgt)
        .map(([src, tgt]) => ({
          sourceNodeId: nodeIds[src],
          targetNodeId: nodeIds[tgt],
        }));

      return fc.array(edgeArb, { minLength: 1, maxLength: maxEdges }).map((edges) => {
        // Deduplicate
        const seen = new Set<string>();
        const uniqueEdges = edges.filter((e) => {
          const key = `${e.sourceNodeId}->${e.targetNodeId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        return { nodeIds, edges: uniqueEdges };
      });
    });
  });

// ─── Reference Implementations ──────────────────────────────────────────────

/**
 * Reference BFS implementation that counts unique reachable nodes up to depth 3.
 * Returns count excluding the start node.
 */
function referenceBfs(
  startNodeId: string,
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>,
  maxDepth: number
): number {
  const visited = new Set<string>();
  visited.add(startNodeId);

  const queue: Array<{ nodeId: string; depth: number }> = [
    { nodeId: startNodeId, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    // Get outgoing edges from current node
    const outgoing = edges.filter((e) => e.sourceNodeId === current.nodeId);
    for (const edge of outgoing) {
      if (!visited.has(edge.targetNodeId)) {
        visited.add(edge.targetNodeId);
        queue.push({ nodeId: edge.targetNodeId, depth: current.depth + 1 });
      }
    }
  }

  return visited.size - 1; // Exclude start node
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: hat-menu-intent-router, Property 28: Impact horizon ranges match severity", () => {
  const service = new CausalGraphService();

  /**
   * Property 28: Impact horizon ranges match severity
   *
   * For any severity (Critical/High/Medium/Low), computeImpactHorizon returns
   * values within defined bounds:
   * Critical → [1, 7], High → [7, 30], Medium → [30, 90], Low → [90, 365]
   *
   * **Validates: Requirements 15.3, 15.4**
   */
  it("computeImpactHorizon returns values within severity-defined bounds", async () => {
    const expectedBounds: Record<string, { min: number; max: number }> = {
      Critical: { min: 1, max: 7 },
      High: { min: 7, max: 30 },
      Medium: { min: 30, max: 90 },
      Low: { min: 90, max: 365 },
    };

    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, async (event) => {
        const horizon = await service.computeImpactHorizon(event);
        const expected = expectedBounds[event.severity];

        expect(horizon.min).toBe(expected.min);
        expect(horizon.max).toBe(expected.max);
        expect(horizon.min).toBeGreaterThanOrEqual(1);
        expect(horizon.max).toBeLessThanOrEqual(365);
        expect(horizon.min).toBeLessThanOrEqual(horizon.max);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 28: Impact horizon ranges match severity
   *
   * Unrecognized severity defaults to Low range [90, 365].
   *
   * **Validates: Requirements 15.3, 15.4**
   */
  it("unrecognized severity defaults to Low range [90, 365]", async () => {
    const unknownSeverityArb = fc.constantFrom("Unknown", "Extreme", "Minimal", "");

    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, unknownSeverityArb, async (event, unknownSeverity) => {
        const modifiedEvent = { ...event, severity: unknownSeverity };
        const horizon = await service.computeImpactHorizon(modifiedEvent);

        expect(horizon.min).toBe(90);
        expect(horizon.max).toBe(365);
      }),
      { numRuns: 50 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 29: Causal graph mapping by sector and jurisdiction", () => {
  const service = new CausalGraphService();

  /**
   * Property 29: Causal graph mapping by sector and jurisdiction
   *
   * Events whose targetSector/jurisdiction match an asset's sectorTags/operatingRegions
   * produce links via matchEventToAsset; events with no match produce empty links (unlinked).
   *
   * **Validates: Requirements 15.1, 15.6**
   */
  it("events matching asset by sector produce a match", async () => {
    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, assetMetadataArb, async (event, asset) => {
        // Force the event's targetSector to match one of the asset's sectorTags
        const matchingEvent = {
          ...event,
          targetSector: asset.sectorTags[0],
          jurisdiction: "NOMATCH_JURISDICTION_XYZ",
        };

        // Access private method via prototype
        const matches = (service as any).matchEventToAsset(matchingEvent, asset);
        expect(matches).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 29: Causal graph mapping by sector and jurisdiction
   *
   * Events matching by jurisdiction produce a match.
   *
   * **Validates: Requirements 15.1, 15.6**
   */
  it("events matching asset by jurisdiction produce a match", async () => {
    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, assetMetadataArb, async (event, asset) => {
        // Force the event's jurisdiction to match one of the asset's operatingRegions
        const matchingEvent = {
          ...event,
          targetSector: "NOMATCH_SECTOR_XYZ",
          jurisdiction: asset.operatingRegions[0],
        };

        const matches = (service as any).matchEventToAsset(matchingEvent, asset);
        expect(matches).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 29: Causal graph mapping by sector and jurisdiction
   *
   * Events with no sector or jurisdiction match remain unlinked.
   *
   * **Validates: Requirements 15.1, 15.6**
   */
  it("events with no sector or jurisdiction match produce no link", async () => {
    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, assetMetadataArb, async (event, asset) => {
        // Ensure no overlap: use values guaranteed not to be in asset metadata
        const unmatchedEvent = {
          ...event,
          targetSector: "NOMATCH_SECTOR_XYZ",
          jurisdiction: "NOMATCH_JURISDICTION_XYZ",
        };

        const matches = (service as any).matchEventToAsset(unmatchedEvent, asset);
        expect(matches).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 29: Causal graph mapping by sector and jurisdiction
   *
   * Matching is case-insensitive for both sector and jurisdiction.
   *
   * **Validates: Requirements 15.1, 15.6**
   */
  it("matching is case-insensitive", async () => {
    await fc.assert(
      fc.asyncProperty(eventPrimitiveArb, assetMetadataArb, async (event, asset) => {
        // Force a match with different casing
        const matchingEvent = {
          ...event,
          targetSector: asset.sectorTags[0].toUpperCase(),
          jurisdiction: "NOMATCH_JURISDICTION_XYZ",
        };

        const matches = (service as any).matchEventToAsset(matchingEvent, asset);
        expect(matches).toBe(true);
      }),
      { numRuns: 50 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 30: Blast radius counts transitive dependencies up to depth 3", () => {
  const service = new CausalGraphService();
  const mockedDb = vi.mocked(db);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 30: Blast radius counts transitive dependencies up to depth 3
   *
   * For any directed graph, computeBlastRadius returns the count of unique nodes
   * reachable via BFS from the start node up to depth 3 (excluding the start node).
   *
   * **Validates: Requirements 15.5**
   */
  it("blast radius equals reference BFS count up to depth 3", async () => {
    await fc.assert(
      fc.asyncProperty(graphSpecArb, async (graphSpec) => {
        const { nodeIds, edges } = graphSpec;
        const startNodeId = nodeIds[0];
        const entityId = "entity-" + startNodeId;

        // Mock db.select().from(graphNodes).where(...) to return start node
        const mockSelectGraphNodes = {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: startNodeId }]),
          }),
        };

        // For BFS: mock db.select().from(graphEdges).where(...) based on the current node
        const mockSelectGraphEdges = {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation((condition: any) => {
              // Extract the node ID from the eq condition to find its outgoing edges
              const sourceId = condition?.b;
              const outgoing = edges
                .filter((e) => e.sourceNodeId === sourceId)
                .map((e) => ({ targetNodeId: e.targetNodeId }));
              return Promise.resolve(outgoing);
            }),
          }),
        };

        // Alternate between graphNodes query (first call) and graphEdges queries (subsequent calls)
        let callCount = 0;
        mockedDb.select.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return mockSelectGraphNodes as any;
          }
          return mockSelectGraphEdges as any;
        });

        const result = await service.computeBlastRadius(entityId, 3);

        // Compute expected via reference BFS
        const expected = referenceBfs(startNodeId, edges, 3);

        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 30: Blast radius counts transitive dependencies up to depth 3
   *
   * Nodes at depth > 3 are NOT counted.
   *
   * **Validates: Requirements 15.5**
   */
  it("nodes beyond depth 3 are excluded from blast radius", async () => {
    // Create a linear chain: A -> B -> C -> D -> E (depths 1, 2, 3, 4)
    const nodeIds = ["A", "B", "C", "D", "E"];
    const linearEdges = [
      { sourceNodeId: "A", targetNodeId: "B" },
      { sourceNodeId: "B", targetNodeId: "C" },
      { sourceNodeId: "C", targetNodeId: "D" },
      { sourceNodeId: "D", targetNodeId: "E" },
    ];

    let callCount = 0;
    mockedDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: "A" }]),
          }),
        } as any;
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((condition: any) => {
            const sourceId = condition?.b;
            const outgoing = linearEdges
              .filter((e) => e.sourceNodeId === sourceId)
              .map((e) => ({ targetNodeId: e.targetNodeId }));
            return Promise.resolve(outgoing);
          }),
        }),
      } as any;
    });

    const result = await service.computeBlastRadius("entity-A", 3);

    // BFS from A with maxDepth 3: reaches B(d=1), C(d=2), D(d=3) but NOT E(d=4)
    expect(result).toBe(3);
  });

  /**
   * Property 30: Blast radius counts transitive dependencies up to depth 3
   *
   * Entity not found in graph returns blast radius of 0.
   *
   * **Validates: Requirements 15.5**
   */
  it("returns 0 when entity is not found in graph", async () => {
    mockedDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }) as any);

    const result = await service.computeBlastRadius("nonexistent-entity", 3);
    expect(result).toBe(0);
  });
});

describe("Feature: hat-menu-intent-router, Property 31: Re-evaluation of unlinked events on new asset registration", () => {
  const service = new CausalGraphService();
  const mockedDb = vi.mocked(db);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 31: Re-evaluation of unlinked events on new asset registration
   *
   * When relinkEvents is called with new asset metadata, previously unlinked events
   * matching the new asset's sector or jurisdiction get linked.
   *
   * **Validates: Requirements 15.7**
   */
  it("matching unlinked events get linked to new asset", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(eventPrimitiveArb, { minLength: 1, maxLength: 5 }),
        assetMetadataArb,
        async (events, asset) => {
          // Force some events to match the asset (by sector)
          const matchingEvents = events.map((event, idx) => ({
            ...event,
            organizationId: asset.organizationId,
            targetSector: idx % 2 === 0 ? asset.sectorTags[0] : "NOMATCH_SECTOR_XYZ",
            jurisdiction: "NOMATCH_JURISDICTION_XYZ",
          }));

          const expectedMatches = matchingEvents.filter((_, idx) => idx % 2 === 0).length;

          // Mock getUnlinkedEvents: return our test events
          vi.spyOn(service, "getUnlinkedEvents").mockResolvedValue(
            matchingEvents as unknown as EventPrimitive[]
          );

          // Mock computeImpactHorizon (already tested in Property 28)
          vi.spyOn(service, "computeImpactHorizon").mockResolvedValue({ min: 1, max: 7 });

          // Mock computeBlastRadius (already tested in Property 30)
          vi.spyOn(service, "computeBlastRadius").mockResolvedValue(0);

          // Mock db.insert().values()
          mockedDb.insert.mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          } as any);

          const linksCreated = await service.relinkEvents(asset);

          expect(linksCreated).toBe(expectedMatches);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 31: Re-evaluation of unlinked events on new asset registration
   *
   * When no unlinked events match the new asset, zero links are created.
   *
   * **Validates: Requirements 15.7**
   */
  it("non-matching unlinked events remain unlinked", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(eventPrimitiveArb, { minLength: 1, maxLength: 5 }),
        assetMetadataArb,
        async (events, asset) => {
          // Force all events to NOT match the asset
          const nonMatchingEvents = events.map((event) => ({
            ...event,
            organizationId: asset.organizationId,
            targetSector: "NOMATCH_SECTOR_XYZ",
            jurisdiction: "NOMATCH_JURISDICTION_XYZ",
          }));

          vi.spyOn(service, "getUnlinkedEvents").mockResolvedValue(
            nonMatchingEvents as unknown as EventPrimitive[]
          );

          const linksCreated = await service.relinkEvents(asset);

          expect(linksCreated).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 31: Re-evaluation of unlinked events on new asset registration
   *
   * When there are no unlinked events, relinkEvents returns 0.
   *
   * **Validates: Requirements 15.7**
   */
  it("returns 0 when there are no unlinked events", async () => {
    await fc.assert(
      fc.asyncProperty(assetMetadataArb, async (asset) => {
        vi.spyOn(service, "getUnlinkedEvents").mockResolvedValue([]);

        const linksCreated = await service.relinkEvents(asset);
        expect(linksCreated).toBe(0);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 31: Re-evaluation of unlinked events on new asset registration
   *
   * Events matching by jurisdiction (not sector) also get linked.
   *
   * **Validates: Requirements 15.7**
   */
  it("events matching by jurisdiction also get linked", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(eventPrimitiveArb, { minLength: 1, maxLength: 5 }),
        assetMetadataArb,
        async (events, asset) => {
          // Force all events to match by jurisdiction only
          const jurisdictionMatchEvents = events.map((event) => ({
            ...event,
            organizationId: asset.organizationId,
            targetSector: "NOMATCH_SECTOR_XYZ",
            jurisdiction: asset.operatingRegions[0],
          }));

          vi.spyOn(service, "getUnlinkedEvents").mockResolvedValue(
            jurisdictionMatchEvents as unknown as EventPrimitive[]
          );
          vi.spyOn(service, "computeImpactHorizon").mockResolvedValue({ min: 7, max: 30 });
          vi.spyOn(service, "computeBlastRadius").mockResolvedValue(2);
          mockedDb.insert.mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          } as any);

          const linksCreated = await service.relinkEvents(asset);

          // All events should match by jurisdiction
          expect(linksCreated).toBe(jurisdictionMatchEvents.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
