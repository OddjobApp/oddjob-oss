import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import type { BulkAction, SnoozeDuration } from './utils';

/**
 * useBulkActions — Hook providing optimistic mutations for signal triage bulk actions.
 * On success: signals are removed/updated in the query cache.
 * On failure: signals are reverted to prior visual state via queryClient.setQueryData.
 *
 * Requirements: 4.5, 4.6, 4.7, 4.10, 4.11
 */

interface BulkActionRequest {
  action: BulkAction;
  signalIds: string[];
  metadata?: { snoozeDuration?: SnoozeDuration };
}

interface BulkActionResponse {
  success: boolean;
  affected: number;
  action: string;
  signalIds: string[];
}

const SIGNALS_QUERY_KEY = '/api/event-primitives?limit=100';

export function useBulkActions(options?: {
  onSuccess?: (action: BulkAction, signalIds: string[]) => void;
  onError?: (action: BulkAction, signalIds: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation<BulkActionResponse, Error, BulkActionRequest, { previousSignals: unknown }>({
    mutationFn: async (request: BulkActionRequest) => {
      const response = await apiRequest('POST', '/api/signals/bulk-action', request);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Bulk action failed' }));
        throw new Error(errorData.error || `Bulk action '${request.action}' failed`);
      }
      return response.json();
    },

    // Optimistic update: immediately update signal list before server responds
    onMutate: async (request) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: [SIGNALS_QUERY_KEY] });

      // Snapshot the previous value for rollback
      const previousSignals = queryClient.getQueryData([SIGNALS_QUERY_KEY]);

      // Optimistic update: remove/modify signals in the cache
      queryClient.setQueryData([SIGNALS_QUERY_KEY], (old: any[] | undefined) => {
        if (!old) return old;

        const affectedIds = new Set(request.signalIds);

        switch (request.action) {
          case 'dismiss':
            // Remove dismissed signals from the list
            return old.filter((signal: any) => !affectedIds.has(signal.id));

          case 'escalate':
            // Mark signals as escalated (keep in list with updated state)
            return old.map((signal: any) =>
              affectedIds.has(signal.id)
                ? { ...signal, _escalated: true }
                : signal,
            );

          case 'snooze':
            // Remove snoozed signals from the visible list
            return old.filter((signal: any) => !affectedIds.has(signal.id));

          default:
            return old;
        }
      });

      return { previousSignals };
    },

    // On failure: revert to prior state (Req 4.7)
    onError: (error, request, context) => {
      // Rollback to previous signals snapshot
      if (context?.previousSignals) {
        queryClient.setQueryData([SIGNALS_QUERY_KEY], context.previousSignals);
      }

      toast({
        title: 'Action failed',
        description: error.message || `Could not ${request.action} the selected signals. Please try again.`,
        variant: 'destructive',
      });

      options?.onError?.(request.action, request.signalIds);
    },

    // On success: invalidate to re-sync with server
    onSuccess: (data, request) => {
      // Invalidate signals to ensure we have the latest server state
      queryClient.invalidateQueries({ queryKey: [SIGNALS_QUERY_KEY] });

      const actionLabels: Record<BulkAction, string> = {
        dismiss: 'dismissed',
        escalate: 'escalated',
        snooze: 'snoozed',
      };

      toast({
        title: `Signals ${actionLabels[request.action]}`,
        description: `${data.affected} signal${data.affected !== 1 ? 's' : ''} ${actionLabels[request.action]} successfully.`,
      });

      options?.onSuccess?.(request.action, request.signalIds);
    },

    // Always refetch after error or success to ensure cache consistency
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [SIGNALS_QUERY_KEY] });
    },
  });

  /** Dismiss the selected signals */
  function dismiss(signalIds: string[]) {
    mutation.mutate({ action: 'dismiss', signalIds });
  }

  /** Escalate the selected signals */
  function escalate(signalIds: string[]) {
    mutation.mutate({ action: 'escalate', signalIds });
  }

  /** Snooze the selected signals for the given duration */
  function snooze(signalIds: string[], duration: SnoozeDuration) {
    mutation.mutate({
      action: 'snooze',
      signalIds,
      metadata: { snoozeDuration: duration },
    });
  }

  return {
    dismiss,
    escalate,
    snooze,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}
