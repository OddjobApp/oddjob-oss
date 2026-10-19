/**
 * Integration Tests: Decision Inbox End-to-End Event Flow
 *
 * Validates the full pipeline by testing store reactions to decision events:
 *   1. Given: store has some initial state
 *   2. When: a decision:new or decision:resolved event arrives (simulated via store actions)
 *   3. Then: verify the store state updates correctly within timing constraints
 *
 * Since we cannot easily test the full SSE → browser → React pipeline in unit tests,
 * these tests focus on:
 *   - Store action timing: handleNewDecision updates pendingCount immediately
 *   - Store action timing: handleResolvedDecision removes items immediately
 *   - Banner auto-dismiss: when highRiskAgingRequests becomes empty after resolution,
 *     computeBannerDisplay returns null
 *   - Widget backfill: when one item is resolved, computeWidgetDisplay still returns
 *     min(remaining, 5) items
 *
 * Validates: Requirements 1.6, 4.5, 5.4
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useDecisionStore, type PendingRequest } from '../stores/decision.store';
import { computeBannerDisplay, isAgingHighRisk } from '../components/decisions/DecisionBanner';
import { computeWidgetDisplay } from '../modules/components/DecisionDashboardWidget';
import type {
  DecisionNewEvent,
  DecisionResolvedEvent,
} from '../services/decision-sse-client';

// ─── Helpers ────────────────────────────────────────────────────────────────

function resetStore() {
  useDecisionStore.setState({
    pendingCount: 0,
    pendingRequests: [],
    highRiskAgingRequests: [],
    connectionState: 'connected',
    bannerDismissedIds: new Set<number>(),
  });
}

function makeNewEvent(overrides: Partial<DecisionNewEvent> = {}): DecisionNewEvent {
  return {
    type: 'decision:new',
    requestId: 1,
    toolName: 'shell',
    riskLevel: 'medium',
    description: 'Execute deployment script',
    missionId: 10,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeResolvedEvent(overrides: Partial<DecisionResolvedEvent> = {}): DecisionResolvedEvent {
  return {
    type: 'decision:resolved',
    requestId: 1,
    newStatus: 'approved',
    resolvedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a PendingRequest that was created `minutesAgo` minutes in the past.
 */
function makePendingRequest(
  id: number,
  riskLevel: 'low' | 'medium' | 'high' = 'high',
  minutesAgo: number = 10,
  missionName: string = 'Deploy Service'
): PendingRequest {
  const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  return {
    id,
    toolName: 'shell',
    riskLevel,
    description: `Request ${id}`,
    missionId: id * 10,
    createdAt,
    missionName,
  };
}

// ─── Test Suites ────────────────────────────────────────────────────────────

describe('Decision Inbox Integration: End-to-End Event Flow', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Redis Pub/Sub → SSE → Client → Store → UI Update Cycle ────────────

  describe('Event flow: decision:new → store → indicator update', () => {
    /**
     * Validates: Requirement 1.6
     * WHEN a new Approval_Request arrives via the Decision_SSE_Channel,
     * THE Decision_Indicator SHALL update its displayed count within 2 seconds.
     *
     * We simulate the SSE event arriving by calling handleNewDecision directly
     * (the SSE client calls this on the store). The store update is synchronous,
     * so the indicator count updates immediately (well within 2 seconds).
     */
    it('indicator count updates immediately when handleNewDecision is called (within 2s constraint)', () => {
      const startTime = performance.now();

      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 1 }));

      const state = useDecisionStore.getState();
      const elapsed = performance.now() - startTime;

      expect(state.pendingCount).toBe(1);
      expect(elapsed).toBeLessThan(2000); // Well within 2 second requirement
    });

    it('handles rapid sequential events updating count correctly', () => {
      const { handleNewDecision } = useDecisionStore.getState();

      // Simulate burst of SSE events (as if Redis Pub/Sub delivered a quick sequence)
      handleNewDecision(makeNewEvent({ requestId: 1, riskLevel: 'low' }));
      handleNewDecision(makeNewEvent({ requestId: 2, riskLevel: 'medium' }));
      handleNewDecision(makeNewEvent({ requestId: 3, riskLevel: 'high' }));

      const state = useDecisionStore.getState();
      expect(state.pendingCount).toBe(3);
      expect(state.pendingRequests).toHaveLength(3);
    });

    it('resolved event immediately decrements indicator count', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 1 }));
      handleNewDecision(makeNewEvent({ requestId: 2 }));
      expect(useDecisionStore.getState().pendingCount).toBe(2);

      const startTime = performance.now();
      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 1 }));

      const state = useDecisionStore.getState();
      const elapsed = performance.now() - startTime;

      expect(state.pendingCount).toBe(1);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  // ── Widget Updates Within 2 Seconds of SSE Event ───────────────────────

  describe('Event flow: decision events → widget updates within 2 seconds', () => {
    /**
     * Validates: Requirement 5.4
     * THE Decision_Dashboard_Widget SHALL reflect new and resolved Approval_Requests
     * within 2 seconds of receiving a decision:new or decision:resolved event from
     * the Decision_SSE_Channel without requiring a page refresh.
     */
    it('widget display reflects new decision immediately (within 2s)', () => {
      const { handleNewDecision } = useDecisionStore.getState();

      // Add 3 requests
      handleNewDecision(makeNewEvent({ requestId: 1, missionId: 10 }));
      handleNewDecision(makeNewEvent({ requestId: 2, missionId: 20 }));
      handleNewDecision(makeNewEvent({ requestId: 3, missionId: 30 }));

      const startTime = performance.now();
      const state = useDecisionStore.getState();
      const widgetDisplay = computeWidgetDisplay(state.pendingRequests, 5);
      const elapsed = performance.now() - startTime;

      expect(widgetDisplay.totalCount).toBe(3);
      expect(widgetDisplay.items).toHaveLength(3);
      expect(elapsed).toBeLessThan(2000);
    });

    it('widget backfills when one item is resolved and remaining > displayed', () => {
      // Seed the store with 7 requests (exceeds max display of 5)
      const requests: PendingRequest[] = [];
      for (let i = 1; i <= 7; i++) {
        requests.push(makePendingRequest(i, 'medium', i * 2, `Mission ${i}`));
      }
      useDecisionStore.setState({
        pendingCount: 7,
        pendingRequests: requests,
        highRiskAgingRequests: [],
        connectionState: 'connected',
        bannerDismissedIds: new Set<number>(),
      });

      // Widget should display max 5
      const now = Date.now();
      let display = computeWidgetDisplay(useDecisionStore.getState().pendingRequests, 5, now);
      expect(display.items).toHaveLength(5);
      expect(display.hasMore).toBe(true);
      expect(display.totalCount).toBe(7);

      // Simulate resolving one of the displayed items (longest pending = id 7, 14min ago)
      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 7 }));

      // After resolution: 6 remaining, widget should still show 5
      const updatedState = useDecisionStore.getState();
      display = computeWidgetDisplay(updatedState.pendingRequests, 5, now);
      expect(display.items).toHaveLength(5);
      expect(display.hasMore).toBe(true);
      expect(display.totalCount).toBe(6);

      // The resolved item (id: 7) should not be in the display
      expect(display.items.find((item) => item.id === 7)).toBeUndefined();
    });

    it('widget shows min(remaining, 5) items after resolution when remaining <= 5', () => {
      // Seed with 5 requests (exactly fills max display)
      const requests: PendingRequest[] = [];
      for (let i = 1; i <= 5; i++) {
        requests.push(makePendingRequest(i, 'medium', i * 3, `Mission ${i}`));
      }
      useDecisionStore.setState({
        pendingCount: 5,
        pendingRequests: requests,
        highRiskAgingRequests: [],
        connectionState: 'connected',
        bannerDismissedIds: new Set<number>(),
      });

      // Resolve one item
      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 3 }));

      const now = Date.now();
      const display = computeWidgetDisplay(useDecisionStore.getState().pendingRequests, 5, now);
      expect(display.items).toHaveLength(4); // min(4, 5) = 4
      expect(display.hasMore).toBe(false);
      expect(display.totalCount).toBe(4);
    });
  });

  // ── Banner Auto-Dismiss Within 2 Seconds When All Resolved ─────────────

  describe('Event flow: all high-risk resolved → banner auto-dismiss within 2 seconds', () => {
    /**
     * Validates: Requirement 4.5
     * WHEN all high-risk Approval_Requests are resolved,
     * THE Decision_Banner SHALL dismiss automatically within 2 seconds.
     *
     * We verify that once all high-risk aging requests are resolved from the store,
     * computeBannerDisplay returns null (banner should not be visible).
     */
    it('banner display returns null when all high-risk requests are resolved', () => {
      // Seed with aging high-risk requests (created 10 minutes ago)
      const agingRequest1 = makePendingRequest(1, 'high', 10, 'Mission Alpha');
      const agingRequest2 = makePendingRequest(2, 'high', 8, 'Mission Beta');

      useDecisionStore.setState({
        pendingCount: 2,
        pendingRequests: [agingRequest1, agingRequest2],
        highRiskAgingRequests: [agingRequest1, agingRequest2],
        connectionState: 'connected',
        bannerDismissedIds: new Set<number>(),
      });

      const now = new Date();

      // Banner should be visible initially (both are aging high-risk)
      let bannerDisplay = computeBannerDisplay(
        useDecisionStore.getState().highRiskAgingRequests,
        now,
        useDecisionStore.getState().bannerDismissedIds
      );
      expect(bannerDisplay).not.toBeNull();
      expect(bannerDisplay!.visible).toBe(true);
      expect(bannerDisplay!.count).toBe(2);

      // Simulate resolution of all high-risk requests via SSE events
      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 1 }));
      handleResolvedDecision(makeResolvedEvent({ requestId: 2 }));

      // After all resolved, computeBannerDisplay should return null
      bannerDisplay = computeBannerDisplay(
        useDecisionStore.getState().highRiskAgingRequests,
        now,
        useDecisionStore.getState().bannerDismissedIds
      );
      expect(bannerDisplay).toBeNull();
    });

    it('banner display returns null immediately after final high-risk resolution (within 2s budget)', () => {
      const agingRequest = makePendingRequest(42, 'high', 15, 'Critical Deploy');

      useDecisionStore.setState({
        pendingCount: 1,
        pendingRequests: [agingRequest],
        highRiskAgingRequests: [agingRequest],
        connectionState: 'connected',
        bannerDismissedIds: new Set<number>(),
      });

      const now = new Date();

      // Verify banner is visible
      let bannerDisplay = computeBannerDisplay(
        useDecisionStore.getState().highRiskAgingRequests,
        now,
        useDecisionStore.getState().bannerDismissedIds
      );
      expect(bannerDisplay).not.toBeNull();

      // Resolve the request - measure the time for the store update + banner computation
      const startTime = performance.now();
      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 42 }));

      bannerDisplay = computeBannerDisplay(
        useDecisionStore.getState().highRiskAgingRequests,
        now,
        useDecisionStore.getState().bannerDismissedIds
      );
      const elapsed = performance.now() - startTime;

      expect(bannerDisplay).toBeNull();
      expect(elapsed).toBeLessThan(2000); // Well within 2 second requirement
    });

    it('banner remains visible when only some high-risk requests are resolved', () => {
      const request1 = makePendingRequest(1, 'high', 10, 'Mission A');
      const request2 = makePendingRequest(2, 'high', 12, 'Mission B');

      useDecisionStore.setState({
        pendingCount: 2,
        pendingRequests: [request1, request2],
        highRiskAgingRequests: [request1, request2],
        connectionState: 'connected',
        bannerDismissedIds: new Set<number>(),
      });

      const now = new Date();

      // Resolve only one
      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 1 }));

      const bannerDisplay = computeBannerDisplay(
        useDecisionStore.getState().highRiskAgingRequests,
        now,
        useDecisionStore.getState().bannerDismissedIds
      );
      expect(bannerDisplay).not.toBeNull();
      expect(bannerDisplay!.count).toBe(1);
    });

    it('banner auto-dismiss respects dismissed IDs — does not re-show dismissed requests', () => {
      const request1 = makePendingRequest(1, 'high', 10, 'Mission A');
      const request2 = makePendingRequest(2, 'high', 8, 'Mission B');

      useDecisionStore.setState({
        pendingCount: 2,
        pendingRequests: [request1, request2],
        highRiskAgingRequests: [request1, request2],
        connectionState: 'connected',
        bannerDismissedIds: new Set<number>(),
      });

      const now = new Date();

      // Dismiss the banner (records IDs 1 and 2)
      useDecisionStore.getState().dismissBanner();

      // After dismissal, banner should not show these requests
      const bannerDisplay = computeBannerDisplay(
        useDecisionStore.getState().highRiskAgingRequests,
        now,
        useDecisionStore.getState().bannerDismissedIds
      );
      expect(bannerDisplay).toBeNull();
    });
  });

  // ── Full Pipeline Simulation ───────────────────────────────────────────

  describe('Full pipeline: SSE event sequence simulation', () => {
    /**
     * Simulates a realistic sequence of events as they would flow through
     * the pipeline: Redis Pub/Sub → SSE endpoint → client → store → UI
     *
     * Validates: Requirements 1.6, 4.5, 5.4
     */
    it('complete lifecycle: new decisions arrive, some resolved, state consistent', () => {
      const { handleNewDecision, handleResolvedDecision } = useDecisionStore.getState();

      // Phase 1: Three new decisions arrive via SSE
      handleNewDecision(makeNewEvent({
        requestId: 100,
        toolName: 'shell',
        riskLevel: 'high',
        missionId: 1,
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
      }));
      handleNewDecision(makeNewEvent({
        requestId: 101,
        toolName: 'file_write',
        riskLevel: 'medium',
        missionId: 2,
        createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
      }));
      handleNewDecision(makeNewEvent({
        requestId: 102,
        toolName: 'db_query',
        riskLevel: 'high',
        missionId: 1,
        createdAt: new Date(Date.now() - 7 * 60 * 1000).toISOString(), // 7 min ago
      }));

      // Verify indicator state
      let state = useDecisionStore.getState();
      expect(state.pendingCount).toBe(3);

      // Verify widget state
      const now = Date.now();
      let widgetDisplay = computeWidgetDisplay(state.pendingRequests, 5, now);
      expect(widgetDisplay.totalCount).toBe(3);
      expect(widgetDisplay.items).toHaveLength(3);

      // Verify banner state (high-risk aging requests exist)
      let bannerDisplay = computeBannerDisplay(
        state.highRiskAgingRequests,
        new Date(),
        state.bannerDismissedIds
      );
      expect(bannerDisplay).not.toBeNull();
      expect(bannerDisplay!.count).toBe(2); // Two high-risk requests

      // Phase 2: One decision resolved via SSE
      handleResolvedDecision(makeResolvedEvent({ requestId: 101, newStatus: 'approved' }));

      state = useDecisionStore.getState();
      expect(state.pendingCount).toBe(2);

      widgetDisplay = computeWidgetDisplay(state.pendingRequests, 5, now);
      expect(widgetDisplay.totalCount).toBe(2);
      expect(widgetDisplay.items.find((i) => i.id === 101)).toBeUndefined();

      // Phase 3: All high-risk resolved
      handleResolvedDecision(makeResolvedEvent({ requestId: 100, newStatus: 'approved' }));
      handleResolvedDecision(makeResolvedEvent({ requestId: 102, newStatus: 'rejected' }));

      state = useDecisionStore.getState();
      expect(state.pendingCount).toBe(0);
      expect(state.highRiskAgingRequests).toHaveLength(0);

      // Banner should auto-dismiss (null)
      bannerDisplay = computeBannerDisplay(
        state.highRiskAgingRequests,
        new Date(),
        state.bannerDismissedIds
      );
      expect(bannerDisplay).toBeNull();

      // Widget should show empty state
      widgetDisplay = computeWidgetDisplay(state.pendingRequests, 5, now);
      expect(widgetDisplay.totalCount).toBe(0);
      expect(widgetDisplay.items).toHaveLength(0);
    });

    it('interleaved new/resolved events maintain consistent state', () => {
      const { handleNewDecision, handleResolvedDecision } = useDecisionStore.getState();

      // Interleave: new, new, resolved, new, resolved, resolved
      handleNewDecision(makeNewEvent({ requestId: 1 }));
      handleNewDecision(makeNewEvent({ requestId: 2 }));
      expect(useDecisionStore.getState().pendingCount).toBe(2);

      handleResolvedDecision(makeResolvedEvent({ requestId: 1 }));
      expect(useDecisionStore.getState().pendingCount).toBe(1);

      handleNewDecision(makeNewEvent({ requestId: 3 }));
      expect(useDecisionStore.getState().pendingCount).toBe(2);

      handleResolvedDecision(makeResolvedEvent({ requestId: 2 }));
      handleResolvedDecision(makeResolvedEvent({ requestId: 3 }));
      expect(useDecisionStore.getState().pendingCount).toBe(0);
      expect(useDecisionStore.getState().pendingRequests).toHaveLength(0);
    });

    it('widget backfill works correctly through sequential resolved events', () => {
      // Seed 8 requests with staggered creation times
      const requests: PendingRequest[] = [];
      for (let i = 1; i <= 8; i++) {
        requests.push(makePendingRequest(i, 'medium', i * 2, `Mission ${i}`));
      }
      useDecisionStore.setState({
        pendingCount: 8,
        pendingRequests: requests,
        highRiskAgingRequests: [],
        connectionState: 'connected',
        bannerDismissedIds: new Set<number>(),
      });

      const now = Date.now();

      // Initial: 5 displayed out of 8
      let display = computeWidgetDisplay(useDecisionStore.getState().pendingRequests, 5, now);
      expect(display.items).toHaveLength(5);
      expect(display.hasMore).toBe(true);

      // Resolve the longest pending (id 8, 16 min ago)
      useDecisionStore.getState().handleResolvedDecision(makeResolvedEvent({ requestId: 8 }));

      display = computeWidgetDisplay(useDecisionStore.getState().pendingRequests, 5, now);
      expect(display.items).toHaveLength(5); // Backfilled from queue
      expect(display.totalCount).toBe(7);
      expect(display.items.find((item) => item.id === 8)).toBeUndefined();

      // Resolve two more
      useDecisionStore.getState().handleResolvedDecision(makeResolvedEvent({ requestId: 7 }));
      useDecisionStore.getState().handleResolvedDecision(makeResolvedEvent({ requestId: 6 }));

      display = computeWidgetDisplay(useDecisionStore.getState().pendingRequests, 5, now);
      expect(display.items).toHaveLength(5); // Still 5 since 5 remain
      expect(display.totalCount).toBe(5);
      expect(display.hasMore).toBe(false);

      // Resolve one more → only 4 remain
      useDecisionStore.getState().handleResolvedDecision(makeResolvedEvent({ requestId: 5 }));

      display = computeWidgetDisplay(useDecisionStore.getState().pendingRequests, 5, now);
      expect(display.items).toHaveLength(4); // min(4, 5) = 4
      expect(display.totalCount).toBe(4);
      expect(display.hasMore).toBe(false);
    });
  });

  // ── isAgingHighRisk utility integration ────────────────────────────────

  describe('isAgingHighRisk integration with store state', () => {
    it('correctly identifies aging high-risk requests from store state', () => {
      const agingRequest = makePendingRequest(1, 'high', 10); // 10 min ago
      const recentRequest = makePendingRequest(2, 'high', 2); // 2 min ago (not aging)
      const lowRiskAging = makePendingRequest(3, 'low', 10); // low risk, won't show

      useDecisionStore.setState({
        pendingCount: 3,
        pendingRequests: [agingRequest, recentRequest, lowRiskAging],
        highRiskAgingRequests: [agingRequest, recentRequest],
        connectionState: 'connected',
        bannerDismissedIds: new Set<number>(),
      });

      const now = new Date();
      const dismissedIds = useDecisionStore.getState().bannerDismissedIds;

      expect(isAgingHighRisk(agingRequest, now, 5 * 60 * 1000, dismissedIds)).toBe(true);
      expect(isAgingHighRisk(recentRequest, now, 5 * 60 * 1000, dismissedIds)).toBe(false);
      expect(isAgingHighRisk(lowRiskAging, now, 5 * 60 * 1000, dismissedIds)).toBe(false);
    });
  });
});
