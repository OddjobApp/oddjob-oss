import { AlertTriangle, Loader2, RefreshCw, X, Zap } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@domain-ui/core/ui/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { HighImpactAction, SignalActionState } from './useSignalAction';

/**
 * ActionConfirmation — Confirmation dialog and inline mutation feedback for high-impact signal actions.
 *
 * Displays:
 * 1. A confirmation dialog (Req 5.3) for cycle launch/escalation with action type, signal ID, cancel option
 * 2. A loading indicator when mutation is in progress (Req 5.4)
 * 3. Inline error with failure reason (truncated 200 chars) and retry option (max 3) (Req 5.5)
 * 4. Timeout error with retry option (Req 5.6)
 *
 * Requirements: 5.3, 5.4, 5.5, 5.6
 */

export interface ActionConfirmationProps {
  state: SignalActionState;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismissError: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<HighImpactAction, string> = {
  cycle_launch: 'Launch Response Cycle',
  escalate: 'Escalate Signal',
};

const ACTION_DESCRIPTIONS: Record<HighImpactAction, string> = {
  cycle_launch:
    'This will launch a response cycle for the selected signal. The system will initiate automated actions based on the signal context.',
  escalate:
    'This will escalate the selected signal to a higher priority queue for immediate human review.',
};

function ActionIcon({ action }: { action: HighImpactAction }) {
  if (action === 'cycle_launch') {
    return <Zap className="h-5 w-5 text-blue-500" aria-hidden="true" />;
  }
  return <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActionConfirmation({
  state,
  onConfirm,
  onCancel,
  onRetry,
  onDismissError,
}: ActionConfirmationProps) {
  return (
    <>
      {/* ─── Confirmation Dialog (Req 5.3) ───────────────────────────────── */}
      <AlertDialog open={state.isConfirmOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
        <AlertDialogContent data-testid="action-confirmation-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {state.pendingAction && <ActionIcon action={state.pendingAction} />}
              {state.pendingAction ? ACTION_LABELS[state.pendingAction] : 'Confirm Action'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {state.pendingAction && ACTION_DESCRIPTIONS[state.pendingAction]}
              {state.pendingSignalId && (
                <span className="mt-2 block text-xs font-medium text-foreground">
                  Signal: {state.pendingSignalId}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={onCancel}
              data-testid="action-confirmation-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              data-testid="action-confirmation-confirm"
              className={cn(
                state.pendingAction === 'escalate' && 'bg-amber-600 hover:bg-amber-700',
                state.pendingAction === 'cycle_launch' && 'bg-blue-600 hover:bg-blue-700',
              )}
            >
              {state.pendingAction ? ACTION_LABELS[state.pendingAction] : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Inline Mutation Feedback ─────────────────────────────────────── */}
      <MutationFeedback
        state={state}
        onRetry={onRetry}
        onDismissError={onDismissError}
      />
    </>
  );
}

// ─── Inline Mutation Feedback Sub-Component ───────────────────────────────────

interface MutationFeedbackProps {
  state: SignalActionState;
  onRetry: () => void;
  onDismissError: () => void;
}

function MutationFeedback({ state, onRetry, onDismissError }: MutationFeedbackProps) {
  // Show loading indicator during mutation (Req 5.4)
  if (state.isMutating && !state.errorMessage) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
        role="status"
        aria-live="polite"
        data-testid="action-mutation-loading"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span>
          {state.pendingAction === 'cycle_launch'
            ? 'Launching response cycle…'
            : 'Escalating signal…'}
        </span>
        {state.cancelledAfterStart && (
          <span className="ml-auto text-[10px] text-blue-500">
            (waiting for server to complete)
          </span>
        )}
      </div>
    );
  }

  // Show error with retry option (Req 5.5, 5.6)
  if (state.errorMessage) {
    return (
      <div
        className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        role="alert"
        aria-live="assertive"
        data-testid="action-mutation-error"
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />

        <div className="flex-1 space-y-1">
          <p className="font-medium">
            {state.isTimeout ? 'Request timed out' : 'Action failed'}
          </p>
          <p className="text-[11px] leading-relaxed opacity-90">
            {state.errorMessage}
          </p>
          {!state.canRetry && (
            <p className="text-[10px] opacity-70">
              Maximum retry attempts reached. Please refresh the page to try again.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {state.canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:text-red-300 dark:hover:bg-red-900"
              data-testid="action-mutation-retry"
              aria-label={`Retry (${state.retryCount} of 3 attempts used)`}
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Retry ({3 - state.retryCount} left)
            </button>
          )}
          <button
            type="button"
            onClick={onDismissError}
            className="inline-flex items-center rounded p-1 text-red-500 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:hover:bg-red-900"
            aria-label="Dismiss error"
            data-testid="action-mutation-dismiss"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  // No feedback needed when idle
  return null;
}
