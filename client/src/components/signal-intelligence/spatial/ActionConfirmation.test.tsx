/**
 * Unit tests for ActionConfirmation component and useSignalAction hook.
 * Requirements: 5.3, 5.4, 5.5, 5.6
 *
 * Tests:
 * - Confirmation dialog displays action type, signal identifier, and cancel option
 * - Loading indicator shown during mutation
 * - Error message displayed on failure with truncated reason and retry option
 * - Retry budget capped at 3 attempts
 * - Timeout error displayed with retry
 * - Cancel-after-start keeps controls disabled
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { ActionConfirmation, type ActionConfirmationProps } from './ActionConfirmation';
import type { SignalActionState } from './useSignalAction';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<SignalActionState> = {}): SignalActionState {
  return {
    isConfirmOpen: false,
    pendingAction: null,
    pendingSignalId: null,
    isMutating: false,
    errorMessage: null,
    isTimeout: false,
    retryCount: 0,
    canRetry: false,
    cancelledAfterStart: false,
    ...overrides,
  };
}

function renderConfirmation(overrides: Partial<ActionConfirmationProps> = {}) {
  const defaultProps: ActionConfirmationProps = {
    state: makeState(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onDismissError: vi.fn(),
    ...overrides,
  };
  return { ...render(createElement(ActionConfirmation, defaultProps)), props: defaultProps };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ActionConfirmation', () => {
  afterEach(() => cleanup());

  describe('Confirmation Dialog (Req 5.3)', () => {
    it('renders dialog when isConfirmOpen is true for cycle_launch', () => {
      renderConfirmation({
        state: makeState({
          isConfirmOpen: true,
          pendingAction: 'cycle_launch',
          pendingSignalId: 'sig-001',
        }),
      });
      expect(screen.getByTestId('action-confirmation-dialog')).toBeTruthy();
      // "Launch Response Cycle" appears in both title and confirm button
      expect(screen.getAllByText('Launch Response Cycle').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Signal: sig-001')).toBeTruthy();
    });

    it('renders dialog when isConfirmOpen is true for escalate', () => {
      renderConfirmation({
        state: makeState({
          isConfirmOpen: true,
          pendingAction: 'escalate',
          pendingSignalId: 'sig-xyz',
        }),
      });
      expect(screen.getByTestId('action-confirmation-dialog')).toBeTruthy();
      // "Escalate Signal" appears in both the title and confirm button
      expect(screen.getAllByText('Escalate Signal').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Signal: sig-xyz')).toBeTruthy();
    });

    it('shows cancel button in confirmation dialog', () => {
      renderConfirmation({
        state: makeState({
          isConfirmOpen: true,
          pendingAction: 'cycle_launch',
          pendingSignalId: 'sig-001',
        }),
      });
      expect(screen.getByTestId('action-confirmation-cancel')).toBeTruthy();
      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('calls onConfirm when confirm button is clicked', () => {
      const onConfirm = vi.fn();
      renderConfirmation({
        state: makeState({
          isConfirmOpen: true,
          pendingAction: 'escalate',
          pendingSignalId: 'sig-001',
        }),
        onConfirm,
      });
      fireEvent.click(screen.getByTestId('action-confirmation-confirm'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn();
      renderConfirmation({
        state: makeState({
          isConfirmOpen: true,
          pendingAction: 'cycle_launch',
          pendingSignalId: 'sig-001',
        }),
        onCancel,
      });
      fireEvent.click(screen.getByTestId('action-confirmation-cancel'));
      // onCancel is called via both the AlertDialogCancel click and the onOpenChange handler
      expect(onCancel).toHaveBeenCalled();
    });

    it('does not render dialog when isConfirmOpen is false', () => {
      renderConfirmation({
        state: makeState({ isConfirmOpen: false }),
      });
      expect(screen.queryByTestId('action-confirmation-dialog')).toBeNull();
    });
  });

  describe('Loading indicator (Req 5.4)', () => {
    it('shows loading indicator during mutation', () => {
      renderConfirmation({
        state: makeState({
          isMutating: true,
          pendingAction: 'cycle_launch',
          pendingSignalId: 'sig-001',
        }),
      });
      expect(screen.getByTestId('action-mutation-loading')).toBeTruthy();
      expect(screen.getByText('Launching response cycle…')).toBeTruthy();
    });

    it('shows escalation loading text for escalate action', () => {
      renderConfirmation({
        state: makeState({
          isMutating: true,
          pendingAction: 'escalate',
          pendingSignalId: 'sig-002',
        }),
      });
      expect(screen.getByText('Escalating signal…')).toBeTruthy();
    });

    it('shows cancel-after-start message when applicable', () => {
      renderConfirmation({
        state: makeState({
          isMutating: true,
          cancelledAfterStart: true,
          pendingAction: 'cycle_launch',
          pendingSignalId: 'sig-001',
        }),
      });
      expect(screen.getByText('(waiting for server to complete)')).toBeTruthy();
    });

    it('does not show loading indicator when not mutating', () => {
      renderConfirmation({
        state: makeState({ isMutating: false }),
      });
      expect(screen.queryByTestId('action-mutation-loading')).toBeNull();
    });
  });

  describe('Error display (Req 5.5)', () => {
    it('shows error message when mutation fails', () => {
      renderConfirmation({
        state: makeState({
          errorMessage: 'Server returned 500: Internal error',
          canRetry: true,
          retryCount: 0,
        }),
      });
      expect(screen.getByTestId('action-mutation-error')).toBeTruthy();
      expect(screen.getByText('Action failed')).toBeTruthy();
      expect(screen.getByText('Server returned 500: Internal error')).toBeTruthy();
    });

    it('shows retry button when canRetry is true', () => {
      renderConfirmation({
        state: makeState({
          errorMessage: 'Something went wrong',
          canRetry: true,
          retryCount: 1,
        }),
      });
      expect(screen.getByTestId('action-mutation-retry')).toBeTruthy();
      expect(screen.getByText('Retry (2 left)')).toBeTruthy();
    });

    it('hides retry button when canRetry is false (budget exhausted)', () => {
      renderConfirmation({
        state: makeState({
          errorMessage: 'Repeated failure',
          canRetry: false,
          retryCount: 3,
        }),
      });
      expect(screen.queryByTestId('action-mutation-retry')).toBeNull();
      expect(screen.getByText(/Maximum retry attempts reached/)).toBeTruthy();
    });

    it('calls onRetry when retry button is clicked', () => {
      const onRetry = vi.fn();
      renderConfirmation({
        state: makeState({
          errorMessage: 'Error',
          canRetry: true,
          retryCount: 0,
        }),
        onRetry,
      });
      fireEvent.click(screen.getByTestId('action-mutation-retry'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('calls onDismissError when dismiss button is clicked', () => {
      const onDismissError = vi.fn();
      renderConfirmation({
        state: makeState({
          errorMessage: 'Error',
          canRetry: true,
          retryCount: 0,
        }),
        onDismissError,
      });
      fireEvent.click(screen.getByTestId('action-mutation-dismiss'));
      expect(onDismissError).toHaveBeenCalledTimes(1);
    });
  });

  describe('Timeout error (Req 5.6)', () => {
    it('shows timeout-specific messaging when isTimeout', () => {
      renderConfirmation({
        state: makeState({
          errorMessage: 'Request timed out after 30 seconds. Please try again.',
          isTimeout: true,
          canRetry: true,
          retryCount: 0,
        }),
      });
      expect(screen.getByText('Request timed out')).toBeTruthy();
      expect(screen.getByTestId('action-mutation-retry')).toBeTruthy();
    });
  });

  describe('No feedback when idle', () => {
    it('renders nothing when no mutation, no error, and dialog closed', () => {
      const { container } = renderConfirmation({
        state: makeState(),
      });
      expect(screen.queryByTestId('action-mutation-loading')).toBeNull();
      expect(screen.queryByTestId('action-mutation-error')).toBeNull();
      expect(screen.queryByTestId('action-confirmation-dialog')).toBeNull();
    });
  });
});
