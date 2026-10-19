/**
 * Unit Tests for DecisionStore
 *
 * Tests the Zustand store actions: handleNewDecision, handleResolvedDecision,
 * dismissBanner, setConnectionState, and initialize.
 *
 * Requirements: 1.6, 5.4, 5.7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDecisionStore } from '../decision.store';
import type { DecisionState, PendingRequest } from '../decision.store';
import type {
  DecisionNewEvent,
  DecisionResolvedEvent,
  ConnectionState,
} from '../../services/decision-sse-client';

// ─── Helpers ────────────────────────────────────────────────────────────────

function resetStore() {
  useDecisionStore.setState({
    pendingCount: 0,
    pendingRequests: [],
    highRiskAgingRequests: [],
    connectionState: 'reconnecting',
    bannerDismissedIds: new Set<number>(),
  });
}

function makeNewEvent(overrides: Partial<DecisionNewEvent> = {}): DecisionNewEvent {
  return {
    type: 'decision:new',
    requestId: 1,
    toolName: 'shell',
    riskLevel: 'medium',
    description: 'Run deploy script',
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DecisionStore', () => {
  beforeEach(() => {
    resetStore();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── handleNewDecision ───────────────────────────────────────────────────

  describe('handleNewDecision', () => {
    it('increments pendingCount by 1', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 1 }));

      const state = useDecisionStore.getState();
      expect(state.pendingCount).toBe(1);
    });

    it('adds the request to pendingRequests list', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      const event = makeNewEvent({ requestId: 42, toolName: 'file_write' });
      handleNewDecision(event);

      const state = useDecisionStore.getState();
      expect(state.pendingRequests).toHaveLength(1);
      expect(state.pendingRequests[0]).toMatchObject({
        id: 42,
        toolName: 'file_write',
        riskLevel: 'medium',
        description: 'Run deploy script',
        missionId: 10,
      });
    });

    it('handles multiple new decisions correctly', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 1 }));
      handleNewDecision(makeNewEvent({ requestId: 2 }));
      handleNewDecision(makeNewEvent({ requestId: 3 }));

      const state = useDecisionStore.getState();
      expect(state.pendingCount).toBe(3);
      expect(state.pendingRequests).toHaveLength(3);
    });

    it('does not add duplicate requests (duplicate protection)', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 1 }));
      handleNewDecision(makeNewEvent({ requestId: 1 })); // duplicate

      const state = useDecisionStore.getState();
      expect(state.pendingCount).toBe(1);
      expect(state.pendingRequests).toHaveLength(1);
    });

    it('adds high-risk requests to highRiskAgingRequests', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 5, riskLevel: 'high' }));

      const state = useDecisionStore.getState();
      expect(state.highRiskAgingRequests).toHaveLength(1);
      expect(state.highRiskAgingRequests[0].id).toBe(5);
    });

    it('does not add low-risk requests to highRiskAgingRequests', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 6, riskLevel: 'low' }));

      const state = useDecisionStore.getState();
      expect(state.highRiskAgingRequests).toHaveLength(0);
    });

    it('does not add medium-risk requests to highRiskAgingRequests', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 7, riskLevel: 'medium' }));

      const state = useDecisionStore.getState();
      expect(state.highRiskAgingRequests).toHaveLength(0);
    });
  });

  // ── handleResolvedDecision ──────────────────────────────────────────────

  describe('handleResolvedDecision', () => {
    it('decrements pendingCount by 1', () => {
      // Seed the store with a pending request
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 10 }));
      expect(useDecisionStore.getState().pendingCount).toBe(1);

      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 10 }));

      expect(useDecisionStore.getState().pendingCount).toBe(0);
    });

    it('removes the resolved request from pendingRequests', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 20 }));
      handleNewDecision(makeNewEvent({ requestId: 21 }));

      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 20 }));

      const state = useDecisionStore.getState();
      expect(state.pendingRequests).toHaveLength(1);
      expect(state.pendingRequests[0].id).toBe(21);
    });

    it('removes the resolved request from highRiskAgingRequests', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 30, riskLevel: 'high' }));
      expect(useDecisionStore.getState().highRiskAgingRequests).toHaveLength(1);

      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 30 }));

      expect(useDecisionStore.getState().highRiskAgingRequests).toHaveLength(0);
    });

    it('never decrements count below 0', () => {
      // Store starts at count 0
      expect(useDecisionStore.getState().pendingCount).toBe(0);

      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 999 }));

      expect(useDecisionStore.getState().pendingCount).toBe(0);
    });

    it('handles resolving a request that does not exist in pendingRequests gracefully', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 40 }));

      const { handleResolvedDecision } = useDecisionStore.getState();
      // Resolve a different requestId
      handleResolvedDecision(makeResolvedEvent({ requestId: 999 }));

      const state = useDecisionStore.getState();
      // Count still decrements (it tracks count independently) but won't go below 0
      expect(state.pendingCount).toBe(0);
      // The original request remains
      expect(state.pendingRequests).toHaveLength(1);
      expect(state.pendingRequests[0].id).toBe(40);
    });
  });

  // ── dismissBanner ───────────────────────────────────────────────────────

  describe('dismissBanner', () => {
    it('records current highRiskAgingRequests IDs into bannerDismissedIds', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 50, riskLevel: 'high' }));
      handleNewDecision(makeNewEvent({ requestId: 51, riskLevel: 'high' }));

      const { dismissBanner } = useDecisionStore.getState();
      dismissBanner();

      const state = useDecisionStore.getState();
      expect(state.bannerDismissedIds.has(50)).toBe(true);
      expect(state.bannerDismissedIds.has(51)).toBe(true);
    });

    it('preserves previously dismissed IDs when dismissing again', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 60, riskLevel: 'high' }));

      useDecisionStore.getState().dismissBanner();

      // Add a new high-risk request and dismiss again
      handleNewDecision(makeNewEvent({ requestId: 61, riskLevel: 'high' }));
      useDecisionStore.getState().dismissBanner();

      const state = useDecisionStore.getState();
      expect(state.bannerDismissedIds.has(60)).toBe(true);
      expect(state.bannerDismissedIds.has(61)).toBe(true);
    });

    it('does not add non-high-risk request IDs to bannerDismissedIds', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 70, riskLevel: 'low' }));
      handleNewDecision(makeNewEvent({ requestId: 71, riskLevel: 'high' }));

      useDecisionStore.getState().dismissBanner();

      const state = useDecisionStore.getState();
      // Only the high-risk request is in highRiskAgingRequests and thus dismissed
      expect(state.bannerDismissedIds.has(71)).toBe(true);
      expect(state.bannerDismissedIds.has(70)).toBe(false);
    });

    it('is a no-op when no high-risk aging requests exist', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 80, riskLevel: 'low' }));

      useDecisionStore.getState().dismissBanner();

      const state = useDecisionStore.getState();
      expect(state.bannerDismissedIds.size).toBe(0);
    });
  });

  // ── setConnectionState ──────────────────────────────────────────────────

  describe('setConnectionState', () => {
    it('sets connection state to connected', () => {
      useDecisionStore.getState().setConnectionState('connected');
      expect(useDecisionStore.getState().connectionState).toBe('connected');
    });

    it('sets connection state to reconnecting', () => {
      useDecisionStore.getState().setConnectionState('reconnecting');
      expect(useDecisionStore.getState().connectionState).toBe('reconnecting');
    });

    it('sets connection state to polling', () => {
      useDecisionStore.getState().setConnectionState('polling');
      expect(useDecisionStore.getState().connectionState).toBe('polling');
    });
  });

  // ── High-risk detection logic ───────────────────────────────────────────

  describe('high-risk detection logic', () => {
    it('adds high-risk requests to highRiskAgingRequests on arrival', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 100, riskLevel: 'high', toolName: 'shell' }));
      handleNewDecision(makeNewEvent({ requestId: 101, riskLevel: 'high', toolName: 'file_delete' }));

      const state = useDecisionStore.getState();
      expect(state.highRiskAgingRequests).toHaveLength(2);
      expect(state.highRiskAgingRequests.map((r) => r.id)).toEqual([100, 101]);
    });

    it('removes high-risk requests from highRiskAgingRequests when resolved', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 110, riskLevel: 'high' }));
      handleNewDecision(makeNewEvent({ requestId: 111, riskLevel: 'high' }));

      const { handleResolvedDecision } = useDecisionStore.getState();
      handleResolvedDecision(makeResolvedEvent({ requestId: 110 }));

      const state = useDecisionStore.getState();
      expect(state.highRiskAgingRequests).toHaveLength(1);
      expect(state.highRiskAgingRequests[0].id).toBe(111);
    });

    it('correctly separates high-risk from non-high-risk in a mixed batch', () => {
      const { handleNewDecision } = useDecisionStore.getState();
      handleNewDecision(makeNewEvent({ requestId: 200, riskLevel: 'low' }));
      handleNewDecision(makeNewEvent({ requestId: 201, riskLevel: 'high' }));
      handleNewDecision(makeNewEvent({ requestId: 202, riskLevel: 'medium' }));
      handleNewDecision(makeNewEvent({ requestId: 203, riskLevel: 'high' }));

      const state = useDecisionStore.getState();
      expect(state.pendingRequests).toHaveLength(4);
      expect(state.highRiskAgingRequests).toHaveLength(2);
      expect(state.highRiskAgingRequests.map((r) => r.id)).toEqual([201, 203]);
    });
  });

  // ── initialize ──────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('fetches pending count and blocked work on initialization', async () => {
      const mockCountResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ count: 3, highRiskAgingCount: 1, oldestPendingAt: '2024-01-01T00:00:00Z' }),
      };
      const mockBlockedResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          items: [
            {
              missionId: 1,
              missionName: 'Deploy Service',
              requests: [
                { id: 10, toolName: 'shell', riskLevel: 'high', description: 'Deploy prod', pendingSince: '2024-01-01T00:00:00Z' },
                { id: 11, toolName: 'file_write', riskLevel: 'medium', description: 'Write config', pendingSince: '2024-01-01T00:01:00Z' },
              ],
            },
          ],
          totalCount: 2,
        }),
      };

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockCountResponse)
        .mockResolvedValueOnce(mockBlockedResponse)
      );

      await useDecisionStore.getState().initialize();

      const state = useDecisionStore.getState();
      expect(state.pendingCount).toBe(3);
      expect(state.pendingRequests).toHaveLength(2);
      expect(state.pendingRequests[0].id).toBe(10);
      expect(state.pendingRequests[1].id).toBe(11);
    });

    it('computes highRiskAgingRequests from fetched data based on 5-minute threshold', async () => {
      // Request created 10 minutes ago (should be aging)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      // Request created 1 minute ago (not aging yet)
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

      const mockCountResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ count: 2 }),
      };
      const mockBlockedResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          items: [
            {
              missionId: 1,
              missionName: 'Mission A',
              requests: [
                { id: 1, toolName: 'shell', riskLevel: 'high', description: 'Aging request', pendingSince: tenMinutesAgo },
                { id: 2, toolName: 'shell', riskLevel: 'high', description: 'Recent request', pendingSince: oneMinuteAgo },
              ],
            },
          ],
          totalCount: 2,
        }),
      };

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockCountResponse)
        .mockResolvedValueOnce(mockBlockedResponse)
      );

      await useDecisionStore.getState().initialize();

      const state = useDecisionStore.getState();
      // Only the request from 10 minutes ago should be aging
      expect(state.highRiskAgingRequests).toHaveLength(1);
      expect(state.highRiskAgingRequests[0].id).toBe(1);
    });

    it('handles failed count fetch gracefully (defaults to 0)', async () => {
      const mockCountResponse = { ok: false, status: 500 };
      const mockBlockedResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
      };

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockCountResponse)
        .mockResolvedValueOnce(mockBlockedResponse)
      );

      await useDecisionStore.getState().initialize();

      const state = useDecisionStore.getState();
      expect(state.pendingCount).toBe(0);
    });

    it('handles network error gracefully without crashing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      // Should not throw
      await expect(useDecisionStore.getState().initialize()).resolves.toBeUndefined();

      // Store retains default state
      const state = useDecisionStore.getState();
      expect(state.pendingCount).toBe(0);
      expect(state.pendingRequests).toHaveLength(0);
    });
  });
});
