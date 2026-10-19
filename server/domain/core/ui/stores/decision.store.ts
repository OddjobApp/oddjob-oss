/**
 * Decision Store
 *
 * Zustand store managing real-time state for the Decision Inbox Surface.
 * Drives the Decision Indicator badge, toast notifications, aging banner,
 * and dashboard widget by reacting to SSE events from DecisionSSEClient.
 *
 * Requirements: 1.6, 5.4, 5.7
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  ConnectionState,
  DecisionNewEvent,
  DecisionResolvedEvent,
} from '../services/decision-sse-client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PendingRequest {
  id: number;
  toolName: string;
  riskLevel: 'low' | 'medium' | 'high';
  description: string;
  missionId: number | null;
  createdAt: string;
  missionName?: string;
}

export interface DecisionState {
  // State
  pendingCount: number;
  pendingRequests: PendingRequest[];
  highRiskAgingRequests: PendingRequest[];
  connectionState: ConnectionState;
  bannerDismissedIds: Set<number>;

  // Actions
  handleNewDecision: (event: DecisionNewEvent) => void;
  handleResolvedDecision: (event: DecisionResolvedEvent) => void;
  dismissBanner: () => void;
  setConnectionState: (state: ConnectionState) => void;
  initialize: () => Promise<void>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Threshold in milliseconds for a high-risk request to be considered "aging" (5 minutes). */
const AGING_THRESHOLD_MS = 5 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Determines whether a pending request qualifies as an aging high-risk request.
 */
function isHighRiskAging(request: PendingRequest, now: Date = new Date()): boolean {
  if (request.riskLevel !== 'high') return false;
  const elapsed = now.getTime() - new Date(request.createdAt).getTime();
  return elapsed > AGING_THRESHOLD_MS;
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useDecisionStore = create<DecisionState>()(
  devtools(
    (set, get) => ({
      // Initial state
      pendingCount: 0,
      pendingRequests: [],
      highRiskAgingRequests: [],
      connectionState: 'reconnecting' as ConnectionState,
      bannerDismissedIds: new Set<number>(),

      // ── Actions ─────────────────────────────────────────────────────────

      handleNewDecision: (event: DecisionNewEvent) => {
        const state = get();

        // Guard against duplicate additions (e.g., replayed events)
        if (state.pendingRequests.some((r) => r.id === event.requestId)) {
          return;
        }

        const newRequest: PendingRequest = {
          id: event.requestId,
          toolName: event.toolName,
          riskLevel: event.riskLevel,
          description: event.description,
          missionId: event.missionId,
          createdAt: event.createdAt,
        };

        const updatedPending = [...state.pendingRequests, newRequest];
        const updatedHighRisk =
          newRequest.riskLevel === 'high'
            ? [...state.highRiskAgingRequests, newRequest]
            : state.highRiskAgingRequests;

        set({
          pendingCount: state.pendingCount + 1,
          pendingRequests: updatedPending,
          highRiskAgingRequests: updatedHighRisk,
        });
      },

      handleResolvedDecision: (event: DecisionResolvedEvent) => {
        const state = get();

        const updatedPending = state.pendingRequests.filter(
          (r) => r.id !== event.requestId
        );
        const updatedHighRisk = state.highRiskAgingRequests.filter(
          (r) => r.id !== event.requestId
        );

        // Decrement count but never go below 0
        const newCount = Math.max(0, state.pendingCount - 1);

        set({
          pendingCount: newCount,
          pendingRequests: updatedPending,
          highRiskAgingRequests: updatedHighRisk,
        });
      },

      dismissBanner: () => {
        const state = get();
        // Record current aging high-risk request IDs so the banner won't reappear for this set
        const currentAgingIds = new Set<number>(state.bannerDismissedIds);
        for (const req of state.highRiskAgingRequests) {
          currentAgingIds.add(req.id);
        }
        set({ bannerDismissedIds: currentAgingIds });
      },

      setConnectionState: (connectionState: ConnectionState) => {
        set({ connectionState });
      },

      initialize: async () => {
        try {
          // Fetch pending count
          const countResponse = await fetch('/api/approvals/pending/count', {
            credentials: 'include',
          });

          let pendingCount = 0;
          let highRiskAgingRequests: PendingRequest[] = [];

          if (countResponse.ok) {
            const countData = await countResponse.json();
            pendingCount = countData.count ?? 0;
          }

          // Fetch blocked work (grouped by mission)
          const blockedResponse = await fetch('/api/approvals/pending/blocked', {
            credentials: 'include',
          });

          let pendingRequests: PendingRequest[] = [];

          if (blockedResponse.ok) {
            const blockedData = await blockedResponse.json();

            // Flatten blocked work items into PendingRequest list
            if (blockedData.items && Array.isArray(blockedData.items)) {
              for (const group of blockedData.items) {
                for (const req of group.requests ?? []) {
                  pendingRequests.push({
                    id: req.id,
                    toolName: req.toolName,
                    riskLevel: req.riskLevel as PendingRequest['riskLevel'],
                    description: req.description ?? '',
                    missionId: group.missionId ?? null,
                    createdAt: req.pendingSince,
                    missionName: group.missionName,
                  });
                }
              }
            }

            // Compute high-risk aging from the pending requests
            const now = new Date();
            highRiskAgingRequests = pendingRequests.filter((r) =>
              isHighRiskAging(r, now)
            );
          }

          set({
            pendingCount,
            pendingRequests,
            highRiskAgingRequests,
          });
        } catch (error) {
          // Initialization failures are non-fatal — the store starts with defaults
          // and will be updated by subsequent SSE events.
          console.error('[DecisionStore] Failed to initialize:', error);
        }
      },
    }),
    { name: 'DecisionStore' }
  )
);
