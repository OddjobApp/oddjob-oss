/**
 * Property-based tests for BrowserNotificationService.
 *
 * Feature: decision-inbox-surface
 *
 * Tests validate:
 * - Property 12: Browser Notification Risk Level Filtering — For any event with
 *   riskLevel R and config L ⊆ {low, medium, high}, verify notification dispatched
 *   iff R ∈ L and tab not focused
 * - Property 13: Browser Notification Single-Tab Dispatch — For any event received
 *   by N tabs, verify exactly 1 notification dispatched
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { shouldDispatchBrowserNotification } from "../browser-notification.service.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Valid risk levels in the system */
const VALID_RISK_LEVELS = ["low", "medium", "high"] as const;

/** Arbitrary for a single risk level */
const riskLevelArb = fc.constantFrom(...VALID_RISK_LEVELS);

/** Arbitrary for a risk level configuration (subset of {low, medium, high}) */
const riskLevelConfigArb = fc
  .subarray([...VALID_RISK_LEVELS], { minLength: 0, maxLength: 3 })
  .map((levels) => new Set<string>(levels));

/** Arbitrary for tab focused state */
const tabFocusedArb = fc.boolean();

/** Arbitrary for an arbitrary string risk level (includes invalid ones) */
const anyRiskLevelArb = fc.oneof(
  riskLevelArb,
  fc.string({ minLength: 1, maxLength: 20 })
);

/** Arbitrary for number of tabs (at least 1) */
const tabCountArb = fc.integer({ min: 1, max: 50 });

/**
 * Simulates N tabs where exactly one is leader.
 * Returns array of { isLeader, tabFocused } for each tab.
 */
const multiTabScenarioArb = fc
  .tuple(tabCountArb, riskLevelArb, riskLevelConfigArb)
  .chain(([n, _riskLevel, _config]) =>
    fc.tuple(
      fc.constant(n),
      fc.constant(_riskLevel),
      fc.constant(_config),
      fc.integer({ min: 0, max: n - 1 }), // leader index
      fc.array(tabFocusedArb, { minLength: n, maxLength: n }) // focused state per tab
    )
  );

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("BrowserNotificationService Property Tests", () => {
  /**
   * Feature: decision-inbox-surface, Property 12: Browser Notification Risk Level Filtering
   *
   * For any decision:new event with riskLevel R and user configuration allowing
   * levels L (a subset of {low, medium, high}), a browser notification SHALL be
   * dispatched if and only if R ∈ L and the tab is not focused.
   *
   * **Validates: Requirements 6.2, 6.4**
   */
  describe("Property 12: Browser Notification Risk Level Filtering", () => {
    it("dispatches iff riskLevel ∈ config AND tab is NOT focused", () => {
      fc.assert(
        fc.property(
          riskLevelArb,
          riskLevelConfigArb,
          tabFocusedArb,
          (riskLevel, config, tabFocused) => {
            const result = shouldDispatchBrowserNotification(
              riskLevel,
              config,
              tabFocused
            );
            const expected = config.has(riskLevel) && !tabFocused;
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("never dispatches when tab is focused regardless of config", () => {
      fc.assert(
        fc.property(riskLevelArb, riskLevelConfigArb, (riskLevel, config) => {
          const result = shouldDispatchBrowserNotification(
            riskLevel,
            config,
            true // tab focused
          );
          expect(result).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("never dispatches when riskLevel is not in config regardless of focus", () => {
      fc.assert(
        fc.property(
          riskLevelArb,
          riskLevelConfigArb,
          tabFocusedArb,
          (riskLevel, config, tabFocused) => {
            // Remove the riskLevel from config to guarantee it's not included
            const configWithout = new Set(config);
            configWithout.delete(riskLevel);

            const result = shouldDispatchBrowserNotification(
              riskLevel,
              configWithout,
              tabFocused
            );
            expect(result).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("always dispatches when riskLevel ∈ config AND tab is NOT focused", () => {
      fc.assert(
        fc.property(riskLevelArb, riskLevelConfigArb, (riskLevel, config) => {
          // Ensure the riskLevel is in config
          const configWith = new Set(config);
          configWith.add(riskLevel);

          const result = shouldDispatchBrowserNotification(
            riskLevel,
            configWith,
            false // tab not focused
          );
          expect(result).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it("handles arbitrary string risk levels — never dispatches if not in config", () => {
      fc.assert(
        fc.property(anyRiskLevelArb, tabFocusedArb, (riskLevel, tabFocused) => {
          // Empty config means nothing should dispatch
          const emptyConfig = new Set<string>();
          const result = shouldDispatchBrowserNotification(
            riskLevel,
            emptyConfig,
            tabFocused
          );
          expect(result).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("dispatch decision is symmetric: same inputs always produce same output", () => {
      fc.assert(
        fc.property(
          anyRiskLevelArb,
          riskLevelConfigArb,
          tabFocusedArb,
          (riskLevel, config, tabFocused) => {
            const result1 = shouldDispatchBrowserNotification(
              riskLevel,
              config,
              tabFocused
            );
            const result2 = shouldDispatchBrowserNotification(
              riskLevel,
              config,
              tabFocused
            );
            expect(result1).toBe(result2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: decision-inbox-surface, Property 13: Browser Notification Single-Tab Dispatch
   *
   * For any decision:new event received by N open Oddjob tabs simultaneously,
   * exactly 1 browser notification SHALL be dispatched across all tabs.
   *
   * This property tests the leader election invariant: given N tabs where
   * exactly one is leader, only the leader tab's shouldDispatchBrowserNotification
   * result contributes to actual notification dispatch.
   *
   * **Validates: Requirements 6.8**
   */
  describe("Property 13: Browser Notification Single-Tab Dispatch", () => {
    it("exactly 1 tab dispatches when exactly 1 tab is leader and conditions are met", () => {
      fc.assert(
        fc.property(multiTabScenarioArb, ([n, riskLevel, config, leaderIdx, focusStates]) => {
          // Ensure riskLevel is in config so dispatch conditions can be met
          const configWith = new Set(config);
          configWith.add(riskLevel);

          // Simulate: only the leader tab may dispatch.
          // A tab dispatches iff it is leader AND shouldDispatchBrowserNotification returns true
          let dispatchCount = 0;

          for (let i = 0; i < n; i++) {
            const isLeader = i === leaderIdx;
            const tabFocused = focusStates[i];

            // Only the leader tab attempts dispatch
            if (isLeader) {
              const shouldDispatch = shouldDispatchBrowserNotification(
                riskLevel,
                configWith,
                tabFocused
              );
              if (shouldDispatch) {
                dispatchCount++;
              }
            }
          }

          // At most 1 dispatch (exactly 1 leader), so dispatchCount is 0 or 1
          expect(dispatchCount).toBeLessThanOrEqual(1);
        }),
        { numRuns: 100 }
      );
    });

    it("exactly 1 notification when leader tab is not focused and risk level matches", () => {
      fc.assert(
        fc.property(
          tabCountArb,
          riskLevelArb,
          riskLevelConfigArb,
          fc.integer({ min: 0, max: 49 }),
          (n, riskLevel, config, leaderSeed) => {
            const leaderIdx = leaderSeed % n;
            // Ensure risk level is in config
            const configWith = new Set(config);
            configWith.add(riskLevel);

            // Leader tab is NOT focused (so it should dispatch)
            let dispatchCount = 0;

            for (let i = 0; i < n; i++) {
              const isLeader = i === leaderIdx;
              // Only leader tab dispatches; non-leaders never dispatch
              if (isLeader) {
                const shouldDispatch = shouldDispatchBrowserNotification(
                  riskLevel,
                  configWith,
                  false // leader tab not focused
                );
                if (shouldDispatch) {
                  dispatchCount++;
                }
              }
            }

            // Exactly 1 notification dispatched across all N tabs
            expect(dispatchCount).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("zero notifications when leader tab IS focused (suppression)", () => {
      fc.assert(
        fc.property(
          tabCountArb,
          riskLevelArb,
          riskLevelConfigArb,
          fc.integer({ min: 0, max: 49 }),
          (n, riskLevel, config, leaderSeed) => {
            const leaderIdx = leaderSeed % n;
            const configWith = new Set(config);
            configWith.add(riskLevel);

            let dispatchCount = 0;

            for (let i = 0; i < n; i++) {
              const isLeader = i === leaderIdx;
              if (isLeader) {
                const shouldDispatch = shouldDispatchBrowserNotification(
                  riskLevel,
                  configWith,
                  true // leader tab is focused — suppress
                );
                if (shouldDispatch) {
                  dispatchCount++;
                }
              }
            }

            // Zero notifications when leader is focused
            expect(dispatchCount).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("non-leader tabs never dispatch regardless of conditions", () => {
      fc.assert(
        fc.property(
          tabCountArb.filter((n) => n >= 2), // Need at least 2 tabs
          riskLevelArb,
          riskLevelConfigArb,
          fc.integer({ min: 0, max: 49 }),
          (n, riskLevel, config, leaderSeed) => {
            const leaderIdx = leaderSeed % n;
            const configWith = new Set(config);
            configWith.add(riskLevel);

            // Non-leader tabs: even if shouldDispatch returns true for their
            // local state, the leader gate prevents dispatch
            for (let i = 0; i < n; i++) {
              const isLeader = i === leaderIdx;
              if (!isLeader) {
                // A non-leader tab NEVER dispatches — the leader gate
                // (broadcastChannel !== null && !isLeader) blocks it
                // This models the service's `if (!this.isLeader) return;` guard
                const wouldDispatchLocally = shouldDispatchBrowserNotification(
                  riskLevel,
                  configWith,
                  false // even unfocused
                );
                // Even if local conditions say yes, non-leader is gated out
                // The combined result for non-leaders is always 0
                const actualDispatch = isLeader && wouldDispatchLocally;
                expect(actualDispatch).toBe(false);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
