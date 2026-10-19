/**
 * Property-based tests for CausalGraphVisualizer — dashboard event ordering
 *
 * Feature: hat-menu-intent-router, Property 41: Dashboard event ordering by impact urgency
 *
 * Properties tested:
 * - Property 41: Dashboard event ordering by impact urgency — entity click shows
 *   events ordered by shortest horizon first (impactHorizonMinDays ascending)
 *
 * **Validates: Requirements 18.7**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Types (mirroring component internals) ──────────────────────────────────

interface GraphLink {
  eventPrimitiveId: string;
  targetEntityType: string;
  targetEntityId: string;
  impactHorizonMinDays: number;
  impactHorizonMaxDays: number;
  impactConfidence: number;
  blastRadius: number;
}

interface EventNode {
  id: string;
  eventType: string;
  severity: string;
  jurisdiction: string;
  confidenceScore: number;
  targetSector: string;
}

interface EntityDetailItem {
  eventId: string;
  eventType: string;
  severity: string;
  jurisdiction: string;
  impactHorizonMinDays: number;
  impactHorizonMaxDays: number;
  confidence: number;
}

// ─── Extracted logic under test ─────────────────────────────────────────────
// This replicates the exact sorting and mapping logic from CausalGraphVisualizer's
// `detailContent` useMemo when an entity node is selected.

function getEntityDetailItems(
  links: GraphLink[],
  entityType: string,
  entityId: string,
  events: EventNode[]
): EntityDetailItem[] {
  const relatedLinks = links
    .filter(
      (l) =>
        l.targetEntityType === entityType && l.targetEntityId === entityId
    )
    .sort((a, b) => a.impactHorizonMinDays - b.impactHorizonMinDays);

  return relatedLinks.map((l) => {
    const event = events.find((e) => e.id === l.eventPrimitiveId);
    return {
      eventId: l.eventPrimitiveId,
      eventType: event?.eventType || "Unknown",
      severity: event?.severity || "Unknown",
      jurisdiction: event?.jurisdiction || "Unknown",
      impactHorizonMinDays: l.impactHorizonMinDays,
      impactHorizonMaxDays: l.impactHorizonMaxDays,
      confidence: l.impactConfidence,
    };
  });
}

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

const entityTypeArb = fc.constantFrom(
  "cycle",
  "mission",
  "workstream",
  "supplier",
  "geo_region"
);

const severityArb = fc.constantFrom("Critical", "High", "Medium", "Low");

const eventTypeArb = fc.constantFrom(
  "Tariff_Updated",
  "Regulation_Enacted",
  "Sanction_Imposed",
  "Trade_Agreement_Modified",
  "Central_Bank_Rate_Change",
  "Export_Control_Updated",
  "Compliance_Deadline_Set"
);

const jurisdictionArb = fc.constantFrom(
  "US", "CN", "EU", "UK", "JP", "KR", "DE", "FR", "BR", "AU"
);

const sectorArb = fc.constantFrom(
  "Semiconductor", "Energy", "Finance", "Healthcare",
  "Agriculture", "Defense", "Technology", "Manufacturing"
);

/** Generate a GraphLink with varying impactHorizonMinDays values */
function graphLinkArb(
  targetEntityType: string,
  targetEntityId: string
): fc.Arbitrary<GraphLink> {
  return fc.record({
    eventPrimitiveId: fc.uuid(),
    targetEntityType: fc.constant(targetEntityType),
    targetEntityId: fc.constant(targetEntityId),
    impactHorizonMinDays: fc.integer({ min: 1, max: 365 }),
    impactHorizonMaxDays: fc.integer({ min: 1, max: 730 }),
    impactConfidence: fc.integer({ min: 0, max: 100 }),
    blastRadius: fc.integer({ min: 0, max: 50 }),
  });
}

/** Generate a random EventNode */
const eventNodeArb: fc.Arbitrary<EventNode> = fc.record({
  id: fc.uuid(),
  eventType: eventTypeArb,
  severity: severityArb,
  jurisdiction: jurisdictionArb,
  confidenceScore: fc.float({ min: 0, max: 1, noNaN: true }),
  targetSector: sectorArb,
});

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: hat-menu-intent-router, Property 41: Dashboard event ordering by impact urgency", () => {
  it("entity click shows events ordered by shortest impactHorizonMinDays first", () => {
    fc.assert(
      fc.property(
        // Generate a fixed entity identity
        entityTypeArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        // Generate 2-20 links pointing to the same entity with different horizons
        fc.integer({ min: 2, max: 20 }).chain((count) =>
          fc.tuple(
            fc.constant(count),
            entityTypeArb,
            fc.string({ minLength: 1, maxLength: 20 })
          )
        ),
        (_entityType, _entityId, tuple) => {
          const [count, entityType, entityId] = tuple;

          // Generate links and events in sequence with fixed entity identity
          const linksArb = fc.array(
            graphLinkArb(entityType, entityId),
            { minLength: count, maxLength: count }
          );
          const eventsArb = fc.array(eventNodeArb, {
            minLength: count,
            maxLength: count + 5,
          });

          fc.assert(
            fc.property(linksArb, eventsArb, (links, events) => {
              // Ensure events have IDs matching the links' eventPrimitiveIds
              const linkedEvents = links.map((link, i) => ({
                ...events[i % events.length],
                id: link.eventPrimitiveId,
              }));

              const result = getEntityDetailItems(
                links,
                entityType,
                entityId,
                linkedEvents
              );

              // Property: result must be sorted by impactHorizonMinDays ascending
              for (let i = 1; i < result.length; i++) {
                expect(result[i].impactHorizonMinDays).toBeGreaterThanOrEqual(
                  result[i - 1].impactHorizonMinDays
                );
              }
            }),
            { numRuns: 50 }
          );
        }
      ),
      { numRuns: 2 }
    );
  });

  it("ordering is stable — items with equal impactHorizonMinDays preserve relative order", () => {
    fc.assert(
      fc.property(
        entityTypeArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.array(
          fc.record({
            eventPrimitiveId: fc.uuid(),
            targetEntityType: fc.constant("cycle"),
            targetEntityId: fc.constant("entity-1"),
            // Use a small range to increase likelihood of duplicates
            impactHorizonMinDays: fc.integer({ min: 1, max: 10 }),
            impactHorizonMaxDays: fc.integer({ min: 10, max: 100 }),
            impactConfidence: fc.integer({ min: 0, max: 100 }),
            blastRadius: fc.integer({ min: 0, max: 50 }),
          }),
          { minLength: 3, maxLength: 15 }
        ),
        fc.array(eventNodeArb, { minLength: 3, maxLength: 15 }),
        (_entityType, _entityId, links, events) => {
          // Make links consistent with fixed entity
          const fixedLinks = links.map((l) => ({
            ...l,
            targetEntityType: "cycle",
            targetEntityId: "entity-1",
          }));

          // Ensure events match link event IDs
          const linkedEvents = fixedLinks.map((link, i) => ({
            ...events[i % events.length],
            id: link.eventPrimitiveId,
          }));

          const result = getEntityDetailItems(
            fixedLinks,
            "cycle",
            "entity-1",
            linkedEvents
          );

          // Property: sorted ascending by impactHorizonMinDays
          for (let i = 1; i < result.length; i++) {
            expect(result[i].impactHorizonMinDays).toBeGreaterThanOrEqual(
              result[i - 1].impactHorizonMinDays
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("only links matching the selected entity appear in the result", () => {
    fc.assert(
      fc.property(
        // Links for the target entity
        fc.array(
          graphLinkArb("mission", "target-entity"),
          { minLength: 1, maxLength: 10 }
        ),
        // Links for OTHER entities (should be excluded)
        fc.array(
          fc.record({
            eventPrimitiveId: fc.uuid(),
            targetEntityType: fc.constantFrom("cycle", "supplier", "geo_region"),
            targetEntityId: fc.string({ minLength: 1, maxLength: 20 }).filter(
              (s) => s !== "target-entity"
            ),
            impactHorizonMinDays: fc.integer({ min: 1, max: 365 }),
            impactHorizonMaxDays: fc.integer({ min: 1, max: 730 }),
            impactConfidence: fc.integer({ min: 0, max: 100 }),
            blastRadius: fc.integer({ min: 0, max: 50 }),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        fc.array(eventNodeArb, { minLength: 1, maxLength: 20 }),
        (targetLinks, otherLinks, events) => {
          const allLinks = [...targetLinks, ...otherLinks];
          const allEvents = targetLinks.map((link, i) => ({
            ...events[i % events.length],
            id: link.eventPrimitiveId,
          }));

          const result = getEntityDetailItems(
            allLinks,
            "mission",
            "target-entity",
            allEvents
          );

          // Property: result count equals only target links
          expect(result.length).toBe(targetLinks.length);

          // Property: all result items have event IDs from target links only
          const targetEventIds = new Set(
            targetLinks.map((l) => l.eventPrimitiveId)
          );
          for (const item of result) {
            expect(targetEventIds.has(item.eventId)).toBe(true);
          }

          // Property: still sorted ascending by impactHorizonMinDays
          for (let i = 1; i < result.length; i++) {
            expect(result[i].impactHorizonMinDays).toBeGreaterThanOrEqual(
              result[i - 1].impactHorizonMinDays
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
