/**
 * Property-based tests for Decision Dashboard Widget logic.
 *
 * Feature: decision-inbox-surface
 *
 * Tests validate:
 * - Property 10: Dashboard Widget Grouping and Sort Order — For any list of
 *   pending requests with mission names, verify grouping by mission and sort
 *   by longest pending duration descending
 * - Property 11: Dashboard Widget Max Display with Backfill — For any N>5
 *   requests, verify exactly 5 displayed; on resolution, next longest-pending
 *   backfills maintaining min(remaining, 5)
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  groupAndSortBlockedWork,
  computeWidgetDisplay,
  formatShortDuration,
} from "../DecisionDashboardWidget.js";

import type { PendingRequest } from "../../../stores/decision.store.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Fixed "now" reference for deterministic testing. */
const FIXED_NOW = new Date("2025-01-15T12:00:00.000Z").getTime();

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Arbitrary for risk levels. */
const riskLevelArb = fc.oneof(
  fc.constant("low" as const),
  fc.constant("medium" as const),
  fc.constant("high" as const)
);

/** Arbitrary for mission names (small set to encourage grouping). */
const missionNameArb = fc.oneof(
  fc.constant("Mission Alpha"),
  fc.constant("Mission Beta"),
  fc.constant("Mission Gamma"),
  fc.constant("Mission Delta"),
  fc.constant("Mission Epsilon"),
  fc.constant(undefined as unknown as string) // null/undefined => "Unassigned"
);

/** Arbitrary for tool names. */
const toolNameArb = fc.oneof(
  fc.constant("shell"),
  fc.constant("file_write"),
  fc.constant("deploy"),
  fc.constant("database_query"),
  fc.constant("api_call")
);

/** Arbitrary for pending duration in ms (1 minute to 24 hours). */
const pendingDurationMsArb = fc.integer({ min: 60_000, max: 24 * 60 * 60 * 1000 });

/** Arbitrary for a single PendingRequest given a duration. */
function pendingRequestArb(idStart: number = 1): fc.Arbitrary<PendingRequest> {
  return fc.record({
    id: fc.integer({ min: idStart, max: idStart + 100_000 }),
    toolName: toolNameArb,
    riskLevel: riskLevelArb,
    description: fc.string({ minLength: 1, maxLength: 100 }),
    missionId: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
    missionName: missionNameArb,
    pendingDurationMs: pendingDurationMsArb,
  }).map(({ id, toolName, riskLevel, description, missionId, missionName, pendingDurationMs }) => ({
    id,
    toolName,
    riskLevel,
    description,
    missionId,
    createdAt: new Date(FIXED_NOW - pendingDurationMs).toISOString(),
    missionName: missionName || undefined,
  }));
}

/** Arbitrary for a list of pending requests with unique IDs. */
function pendingRequestListArb(
  minLength: number,
  maxLength: number
): fc.Arbitrary<PendingRequest[]> {
  return fc
    .array(
      fc.record({
        toolName: toolNameArb,
        riskLevel: riskLevelArb,
        description: fc.string({ minLength: 1, maxLength: 100 }),
        missionId: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
        missionName: missionNameArb,
        pendingDurationMs: pendingDurationMsArb,
      }),
      { minLength, maxLength }
    )
    .map((items) =>
      items.map((item, idx) => ({
        id: idx + 1,
        toolName: item.toolName,
        riskLevel: item.riskLevel,
        description: item.description,
        missionId: item.missionId,
        createdAt: new Date(FIXED_NOW - item.pendingDurationMs).toISOString(),
        missionName: item.missionName || undefined,
      }))
    );
}

// ─── Property 10: Dashboard Widget Grouping and Sort Order ──────────────────

describe("Feature: decision-inbox-surface, Property 10: Dashboard Widget Grouping and Sort Order", () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For any list of pending Approval_Requests with associated mission names,
   * the widget SHALL group requests by mission name and sort groups by the
   * longest pending duration within each group, in descending order.
   */

  it("groups requests by mission name — each group contains only requests with the same mission name", () => {
    fc.assert(
      fc.property(pendingRequestListArb(1, 20), (requests) => {
        const groups = groupAndSortBlockedWork(requests, FIXED_NOW);

        for (const group of groups) {
          // All requests in a group should correspond to the same mission name
          const expectedMissionName = group.missionName;
          for (const req of group.requests) {
            const originalReq = requests.find((r) => r.id === req.id);
            const originalMissionName = originalReq?.missionName || "Unassigned";
            expect(originalMissionName).toBe(expectedMissionName);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("every input request appears in exactly one group", () => {
    fc.assert(
      fc.property(pendingRequestListArb(1, 20), (requests) => {
        const groups = groupAndSortBlockedWork(requests, FIXED_NOW);

        // Total requests across all groups should equal input size
        const totalInGroups = groups.reduce((sum, g) => sum + g.requests.length, 0);
        expect(totalInGroups).toBe(requests.length);

        // Every request ID from input should appear in exactly one group
        const allIds = groups.flatMap((g) => g.requests.map((r) => r.id));
        const uniqueIds = new Set(allIds);
        expect(uniqueIds.size).toBe(requests.length);

        for (const req of requests) {
          expect(uniqueIds.has(req.id)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("groups are sorted by longest pending duration descending (first group has longest pending request)", () => {
    fc.assert(
      fc.property(pendingRequestListArb(2, 20), (requests) => {
        const groups = groupAndSortBlockedWork(requests, FIXED_NOW);

        // Each group's max pending duration should be >= the next group's max
        for (let i = 0; i < groups.length - 1; i++) {
          const currentMax = groups[i].requests[0]?.pendingSinceMs ?? 0;
          const nextMax = groups[i + 1].requests[0]?.pendingSinceMs ?? 0;
          expect(currentMax).toBeGreaterThanOrEqual(nextMax);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("within each group, requests are sorted by longest pending first", () => {
    fc.assert(
      fc.property(pendingRequestListArb(1, 20), (requests) => {
        const groups = groupAndSortBlockedWork(requests, FIXED_NOW);

        for (const group of groups) {
          for (let i = 0; i < group.requests.length - 1; i++) {
            expect(group.requests[i].pendingSinceMs).toBeGreaterThanOrEqual(
              group.requests[i + 1].pendingSinceMs
            );
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("mission names in output are unique (no duplicate groups)", () => {
    fc.assert(
      fc.property(pendingRequestListArb(1, 20), (requests) => {
        const groups = groupAndSortBlockedWork(requests, FIXED_NOW);
        const names = groups.map((g) => g.missionName);
        const uniqueNames = new Set(names);
        expect(uniqueNames.size).toBe(names.length);
      }),
      { numRuns: 100 }
    );
  });

  it("requests without a mission name are grouped under 'Unassigned'", () => {
    fc.assert(
      fc.property(pendingRequestListArb(1, 20), (requests) => {
        const groups = groupAndSortBlockedWork(requests, FIXED_NOW);

        const requestsWithoutMission = requests.filter(
          (r) => !r.missionName
        );

        if (requestsWithoutMission.length > 0) {
          const unassignedGroup = groups.find((g) => g.missionName === "Unassigned");
          expect(unassignedGroup).toBeDefined();
          expect(unassignedGroup!.requests.length).toBe(requestsWithoutMission.length);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("pendingSinceMs values are non-negative for all requests", () => {
    fc.assert(
      fc.property(pendingRequestListArb(1, 20), (requests) => {
        const groups = groupAndSortBlockedWork(requests, FIXED_NOW);

        for (const group of groups) {
          for (const req of group.requests) {
            expect(req.pendingSinceMs).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 11: Dashboard Widget Max Display with Backfill ────────────────

describe("Feature: decision-inbox-surface, Property 11: Dashboard Widget Max Display with Backfill", () => {
  /**
   * **Validates: Requirements 5.6, 5.7**
   *
   * For any N pending Approval_Requests where N > 5, the widget SHALL display
   * exactly 5 items. When an item is resolved, the next longest-pending item
   * from the remaining queue SHALL replace it, maintaining the display at
   * min(remaining, 5).
   */

  it("for N > 5 requests, exactly 5 items are displayed", () => {
    fc.assert(
      fc.property(pendingRequestListArb(6, 30), (requests) => {
        const display = computeWidgetDisplay(requests, 5, FIXED_NOW);

        expect(display.items.length).toBe(5);
        expect(display.hasMore).toBe(true);
        expect(display.totalCount).toBe(requests.length);
      }),
      { numRuns: 100 }
    );
  });

  it("for N <= 5 requests, all items are displayed and hasMore is false", () => {
    fc.assert(
      fc.property(pendingRequestListArb(1, 5), (requests) => {
        const display = computeWidgetDisplay(requests, 5, FIXED_NOW);

        expect(display.items.length).toBe(requests.length);
        expect(display.hasMore).toBe(false);
        expect(display.totalCount).toBe(requests.length);
      }),
      { numRuns: 100 }
    );
  });

  it("displayed items are the 5 longest-pending requests (sorted by pending duration descending)", () => {
    fc.assert(
      fc.property(pendingRequestListArb(6, 30), (requests) => {
        const display = computeWidgetDisplay(requests, 5, FIXED_NOW);

        // Displayed items should be sorted by longest pending first
        for (let i = 0; i < display.items.length - 1; i++) {
          expect(display.items[i].pendingSinceMs).toBeGreaterThanOrEqual(
            display.items[i + 1].pendingSinceMs
          );
        }

        // The displayed items should be the top-5 by pending duration
        const allDurations = requests.map((r) =>
          Math.max(0, FIXED_NOW - new Date(r.createdAt).getTime())
        );
        allDurations.sort((a, b) => b - a);
        const top5Duration = allDurations[4]; // 5th longest

        for (const item of display.items) {
          expect(item.pendingSinceMs).toBeGreaterThanOrEqual(top5Duration);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("on resolution of one item, backfill maintains min(remaining, 5) displayed items", () => {
    fc.assert(
      fc.property(pendingRequestListArb(6, 30), (requests) => {
        const display = computeWidgetDisplay(requests, 5, FIXED_NOW);

        // Simulate resolving the first displayed item
        const resolvedId = display.items[0].id;
        const remainingRequests = requests.filter((r) => r.id !== resolvedId);

        const newDisplay = computeWidgetDisplay(remainingRequests, 5, FIXED_NOW);

        // Should show min(remaining, 5) items
        const expectedCount = Math.min(remainingRequests.length, 5);
        expect(newDisplay.items.length).toBe(expectedCount);
        expect(newDisplay.totalCount).toBe(remainingRequests.length);

        // The resolved item should not appear in the new display
        const newIds = newDisplay.items.map((item) => item.id);
        expect(newIds).not.toContain(resolvedId);
      }),
      { numRuns: 100 }
    );
  });

  it("backfill selects the next longest-pending item from remaining queue", () => {
    fc.assert(
      fc.property(pendingRequestListArb(7, 30), (requests) => {
        const display = computeWidgetDisplay(requests, 5, FIXED_NOW);

        // Simulate resolving the first displayed item
        const resolvedId = display.items[0].id;
        const remainingRequests = requests.filter((r) => r.id !== resolvedId);

        const newDisplay = computeWidgetDisplay(remainingRequests, 5, FIXED_NOW);

        // The new 5th item should be the item that was 6th longest-pending overall
        // i.e., the one that just got "backfilled" into the display
        const newDisplayIds = new Set(newDisplay.items.map((item) => item.id));
        const oldDisplayIds = new Set(display.items.map((item) => item.id));

        // The new display should have one item that wasn't in the old display
        // (the backfilled item), except for the resolved one
        const backfilledIds = [...newDisplayIds].filter(
          (id) => !oldDisplayIds.has(id)
        );

        if (requests.length > 6) {
          // There must be a backfilled item
          expect(backfilledIds.length).toBe(1);

          // The backfilled item should have been the next longest-pending
          // that was not in the original top-5
          const backfilledItem = newDisplay.items.find(
            (item) => item.id === backfilledIds[0]
          );
          expect(backfilledItem).toBeDefined();

          // It should be sorted correctly (≤ the item before it)
          const backfilledIdx = newDisplay.items.indexOf(backfilledItem!);
          if (backfilledIdx > 0) {
            expect(
              newDisplay.items[backfilledIdx - 1].pendingSinceMs
            ).toBeGreaterThanOrEqual(backfilledItem!.pendingSinceMs);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("resolving all items results in empty display", () => {
    fc.assert(
      fc.property(pendingRequestListArb(1, 10), (requests) => {
        // Remove all requests (simulate resolving all)
        const emptyDisplay = computeWidgetDisplay([], 5, FIXED_NOW);

        expect(emptyDisplay.items.length).toBe(0);
        expect(emptyDisplay.hasMore).toBe(false);
        expect(emptyDisplay.totalCount).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("hasMore is true iff totalCount > maxItems", () => {
    fc.assert(
      fc.property(
        pendingRequestListArb(1, 30),
        fc.integer({ min: 1, max: 10 }),
        (requests, maxItems) => {
          const display = computeWidgetDisplay(requests, maxItems, FIXED_NOW);

          expect(display.hasMore).toBe(requests.length > maxItems);
          expect(display.items.length).toBe(Math.min(requests.length, maxItems));
        }
      ),
      { numRuns: 100 }
    );
  });

  it("totalCount always equals the input request count", () => {
    fc.assert(
      fc.property(pendingRequestListArb(0, 30), (requests) => {
        const display = computeWidgetDisplay(requests, 5, FIXED_NOW);
        expect(display.totalCount).toBe(requests.length);
      }),
      { numRuns: 100 }
    );
  });

  it("successive resolutions keep display at min(remaining, 5) until queue is exhausted", () => {
    fc.assert(
      fc.property(pendingRequestListArb(6, 15), (requests) => {
        let remaining = [...requests];

        // Resolve items one at a time and verify display size
        for (let i = 0; i < 3 && remaining.length > 0; i++) {
          const display = computeWidgetDisplay(remaining, 5, FIXED_NOW);
          const expectedCount = Math.min(remaining.length, 5);
          expect(display.items.length).toBe(expectedCount);

          // Remove the first displayed item (longest pending)
          remaining = remaining.filter((r) => r.id !== display.items[0].id);
        }
      }),
      { numRuns: 100 }
    );
  });
});
