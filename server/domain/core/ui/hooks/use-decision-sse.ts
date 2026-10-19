/**
 * useDecisionSSE
 *
 * Bootstrap hook that initializes the DecisionSSEClient, wires it to the
 * DecisionStore, and manages the BrowserNotificationService lifecycle.
 *
 * This hook should be called ONCE at the app root level (Layout component).
 * It:
 * 1. Initializes the DecisionStore (fetches initial data)
 * 2. Creates a DecisionSSEClient instance
 * 3. Wires SSE events → store actions (decision:new → handleNewDecision, decision:resolved → handleResolvedDecision)
 * 4. Wires connection state changes → setConnectionState
 * 5. Creates a BrowserNotificationService and subscribes to new decisions for browser notifications
 * 6. Connects the SSE client
 * 7. Cleans up on unmount (disconnect client, dispose notification service)
 *
 * Requirements: 1.6, 2.1, 5.4
 */

import { useEffect, useRef } from 'react';
import { DecisionSSEClient } from '../services/decision-sse-client';
import type { DecisionEvent } from '../services/decision-sse-client';
import { BrowserNotificationService } from '../services/browser-notification.service';
import { useDecisionStore } from '../stores/decision.store';
import { getDesktopBridge } from '@/lib/desktop-bridge';
import type { DecisionNewEvent } from '../services/decision-sse-client';

/**
 * Hook that bootstraps the real-time decision infrastructure on app startup.
 * Must be called once at the Layout level.
 */
export function useDecisionSSE(): void {
  const initializedRef = useRef(false);
  const clientRef = useRef<DecisionSSEClient | null>(null);
  const notificationServiceRef = useRef<BrowserNotificationService | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Guard against double-initialization (React StrictMode double-mount)
    if (initializedRef.current) return;
    initializedRef.current = true;

    // 1. Initialize the store with data from REST endpoints
    useDecisionStore.getState().initialize();

    // 2. Create the DecisionSSEClient
    const client = new DecisionSSEClient({
      onEvent: (event: DecisionEvent) => {
        const store = useDecisionStore.getState();

        // 3. Wire SSE events to store actions
        switch (event.type) {
          case 'decision:new':
            store.handleNewDecision(event);
            break;
          case 'decision:resolved':
            store.handleResolvedDecision(event);
            break;
        }
      },
      onConnectionChange: (state) => {
        // 4. Wire connection state changes to store
        useDecisionStore.getState().setConnectionState(state);
      },
    });

    clientRef.current = client;

    // 5. Create BrowserNotificationService
    const notificationService = new BrowserNotificationService();
    notificationServiceRef.current = notificationService;

    // 6. Subscribe to store changes to trigger browser notifications for new decisions.
    //    We track the previous pendingRequests to detect new arrivals.
    let previousRequestIds = new Set<number>(
      useDecisionStore.getState().pendingRequests.map((r) => r.id)
    );

    const desktop = getDesktopBridge();
    let previousCount = -1;

    const unsubscribe = useDecisionStore.subscribe((state) => {
      // Desktop shell: mirror the pending count onto the taskbar/dock.
      if (desktop && state.pendingCount !== previousCount) {
        previousCount = state.pendingCount;
        desktop.setBadge(state.pendingCount);
      }

      const currentIds = new Set(state.pendingRequests.map((r) => r.id));

      // Find newly added requests (present in current but not in previous)
      for (const request of state.pendingRequests) {
        if (!previousRequestIds.has(request.id)) {
          const lower = (request.toolName || '').toLowerCase().replace(/[\s_\-]/g, '');
          // Exact names, matching the server gate: a substring match silenced the
          // notification for any tool whose name merely contained one of these.
          const isAutoApproved = lower === 'neurallogextractor' ||
                                 lower === 'gmscoresynthesizer' ||
                                 lower === 'behavioralresonancedetector';
          if (!isAutoApproved) {
            // Dispatch browser notification for new decision
            notificationService.dispatch({
              type: 'decision:new',
              requestId: request.id,
              toolName: request.toolName,
              riskLevel: request.riskLevel,
              description: request.description,
              missionId: request.missionId,
              createdAt: request.createdAt,
            } as DecisionNewEvent);
          }
        }
      }

      previousRequestIds = currentIds;
    });

    unsubscribeRef.current = unsubscribe;

    // 7. Connect the SSE client to start receiving events
    client.connect();

    // Cleanup on unmount
    return () => {
      initializedRef.current = false;

      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }

      if (notificationServiceRef.current) {
        notificationServiceRef.current.dispose();
        notificationServiceRef.current = null;
      }

      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);
}
