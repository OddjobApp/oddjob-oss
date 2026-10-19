import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

/**
 * useSignalAction — Hook providing individual signal action mutations with:
 * - Confirmation dialog state management
 * - 30-second timeout handling (Req 5.4, 5.6)
 * - Retry budget of 3 attempts (Req 5.5)
 * - Inline error display with truncated failure reason (Req 5.5)
 * - Cancel-after-start behavior: keeps controls disabled until server completes (Req 5.4)
 *
 * Requirements: 5.3, 5.4, 5.5, 5.6
 */

export type HighImpactAction = 'cycle_launch' | 'escalate';

export interface SignalActionState {
  /** Whether the confirmation dialog is showing */
  isConfirmOpen: boolean;
  /** The action type pending confirmation */
  pendingAction: HighImpactAction | null;
  /** The signal identifier pending action */
  pendingSignalId: string | null;
  /** Whether a mutation is currently in progress */
  isMutating: boolean;
  /** Error message from a failed mutation (truncated to 200 chars) */
  errorMessage: string | null;
  /** Whether the last failure was a timeout */
  isTimeout: boolean;
  /** Number of retry attempts used (max 3) */
  retryCount: number;
  /** Whether retry is available (retryCount < 3) */
  canRetry: boolean;
  /** Whether the user cancelled after mutation started (controls stay disabled) */
  cancelledAfterStart: boolean;
}

interface SignalActionRequest {
  action: HighImpactAction;
  signalId: string;
}

interface SignalActionResponse {
  success: boolean;
  action: string;
  signalId: string;
}

const MUTATION_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const SIGNALS_QUERY_KEY = '/api/event-primitives?limit=100';

export function useSignalAction() {
  const queryClient = useQueryClient();

  // ─── State ───────────────────────────────────────────────────────────────────
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<HighImpactAction | null>(null);
  const [pendingSignalId, setPendingSignalId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTimeout, setIsTimeout] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [cancelledAfterStart, setCancelledAfterStart] = useState(false);

  // Track whether mutation has started (for cancel-after-start logic)
  const mutationStartedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ─── Mutation ────────────────────────────────────────────────────────────────
  const mutation = useMutation<SignalActionResponse, Error, SignalActionRequest>({
    mutationFn: async (request: SignalActionRequest) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const endpoint = request.action === 'cycle_launch'
        ? `/api/signals/${request.signalId}/launch-cycle`
        : `/api/signals/${request.signalId}/escalate`;

      const response = await apiRequest(
        'POST',
        endpoint,
        { action: request.action, signalId: request.signalId },
        MUTATION_TIMEOUT_MS,
        controller.signal,
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Action failed' }));
        throw new Error(errorData.error || `Action '${request.action}' failed`);
      }
      return response.json();
    },

    onSuccess: () => {
      // Clear all error/retry state on success
      cleanupTimeout();
      setErrorMessage(null);
      setIsTimeout(false);
      setRetryCount(0);
      setCancelledAfterStart(false);
      mutationStartedRef.current = false;

      // Invalidate signals to refresh the feed
      queryClient.invalidateQueries({ queryKey: [SIGNALS_QUERY_KEY] });
    },

    onError: (error) => {
      cleanupTimeout();
      mutationStartedRef.current = false;
      setCancelledAfterStart(false);

      // Truncate error message to 200 chars (Req 5.5)
      const reason = error.message || 'Unknown error occurred';
      setErrorMessage(reason.length > 200 ? reason.slice(0, 200) : reason);
    },
  });

  // ─── Timeout Handling ────────────────────────────────────────────────────────
  function startTimeout() {
    cleanupTimeout();
    timeoutRef.current = setTimeout(() => {
      // Timeout reached (Req 5.6): re-enable control, dismiss loading, show timeout error
      if (abortRef.current) {
        abortRef.current.abort();
      }
      mutationStartedRef.current = false;
      setCancelledAfterStart(false);
      setIsTimeout(true);
      setErrorMessage('Request timed out after 30 seconds. Please try again.');
    }, MUTATION_TIMEOUT_MS);
  }

  function cleanupTimeout() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  // ─── Public Methods ──────────────────────────────────────────────────────────

  /**
   * Request confirmation for a high-impact action.
   * Opens the confirmation dialog. (Req 5.3)
   */
  const requestConfirmation = useCallback(
    (action: HighImpactAction, signalId: string) => {
      // Reset error state when opening a new confirmation
      setErrorMessage(null);
      setIsTimeout(false);
      setRetryCount(0);
      setCancelledAfterStart(false);
      setPendingAction(action);
      setPendingSignalId(signalId);
      setIsConfirmOpen(true);
    },
    [],
  );

  /**
   * Confirm and execute the pending action.
   * Starts the mutation, sets timeout, and tracks retry budget.
   */
  const confirmAction = useCallback(() => {
    if (!pendingAction || !pendingSignalId) return;

    setIsConfirmOpen(false);
    setErrorMessage(null);
    setIsTimeout(false);
    mutationStartedRef.current = true;

    startTimeout();
    mutation.mutate({ action: pendingAction, signalId: pendingSignalId });
  }, [pendingAction, pendingSignalId, mutation]);

  /**
   * Cancel the pending action.
   * If mutation has already started, keep controls disabled (Req 5.4).
   * If mutation hasn't started, just close the dialog.
   */
  const cancelAction = useCallback(() => {
    setIsConfirmOpen(false);

    if (mutationStartedRef.current) {
      // Mutation already started — keep controls disabled until server completes or times out
      setCancelledAfterStart(true);
    } else {
      // Mutation not started — clean reset
      setPendingAction(null);
      setPendingSignalId(null);
    }
  }, []);

  /**
   * Retry the failed action.
   * Only allowed if retryCount < MAX_RETRIES (Req 5.5).
   */
  const retry = useCallback(() => {
    if (retryCount >= MAX_RETRIES || !pendingAction || !pendingSignalId) return;

    setRetryCount((c) => c + 1);
    setErrorMessage(null);
    setIsTimeout(false);
    mutationStartedRef.current = true;

    startTimeout();
    mutation.mutate({ action: pendingAction, signalId: pendingSignalId });
  }, [retryCount, pendingAction, pendingSignalId, mutation]);

  /**
   * Dismiss the error message and reset state.
   */
  const dismissError = useCallback(() => {
    setErrorMessage(null);
    setIsTimeout(false);
    setPendingAction(null);
    setPendingSignalId(null);
  }, []);

  // ─── Computed State ──────────────────────────────────────────────────────────
  // Controls are disabled when mutation is in progress OR when user cancelled after mutation started
  const isMutating = mutation.isPending || cancelledAfterStart;
  const canRetry = retryCount < MAX_RETRIES && errorMessage !== null;

  const state: SignalActionState = {
    isConfirmOpen,
    pendingAction,
    pendingSignalId,
    isMutating,
    errorMessage,
    isTimeout,
    retryCount,
    canRetry,
    cancelledAfterStart,
  };

  return {
    state,
    requestConfirmation,
    confirmAction,
    cancelAction,
    retry,
    dismissError,
  };
}
