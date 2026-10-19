import { useState } from 'react';
import { Ban, AlertTriangle, Clock, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SnoozeDuration } from './utils';

/**
 * BulkActionToolbar — Shown when multi-select mode is active (2+ signals selected).
 * Provides dismiss, escalate, and snooze actions for batch triage.
 *
 * Requirements: 4.4, 4.5, 4.6, 4.7, 4.10, 4.11
 */

export interface BulkActionToolbarProps {
  selectedCount: number;
  onDismiss: () => void;
  onEscalate: () => void;
  onSnooze: (duration: SnoozeDuration) => void;
  isPending: boolean;
}

const SNOOZE_OPTIONS: { value: SnoozeDuration; label: string }[] = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: '24h', label: '24 hours' },
];

export function BulkActionToolbar({
  selectedCount,
  onDismiss,
  onEscalate,
  onSnooze,
  isPending,
}: BulkActionToolbarProps) {
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);

  return (
    <div
      className="flex items-center gap-2 border-b border-border bg-accent/30 px-3 py-2"
      role="toolbar"
      aria-label="Bulk actions"
      data-testid="bulk-action-toolbar"
    >
      <span className="text-[11px] font-semibold text-foreground">
        {selectedCount} selected
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {/* Dismiss */}
        <button
          type="button"
          onClick={onDismiss}
          disabled={isPending}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            'hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
          aria-label={`Dismiss ${selectedCount} signals`}
          data-testid="bulk-dismiss-btn"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Ban className="h-3.5 w-3.5" />
          )}
          Dismiss
        </button>

        {/* Escalate */}
        <button
          type="button"
          onClick={onEscalate}
          disabled={isPending}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            'hover:bg-amber-500/10 hover:border-amber-500/30 hover:text-amber-600',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
          aria-label={`Escalate ${selectedCount} signals`}
          data-testid="bulk-escalate-btn"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          Escalate
        </button>

        {/* Snooze with duration picker */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSnoozeMenu((prev) => !prev)}
            disabled={isPending}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
              'hover:bg-blue-500/10 hover:border-blue-500/30 hover:text-blue-600',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:opacity-50 disabled:pointer-events-none',
              showSnoozeMenu && 'bg-blue-500/10 border-blue-500/30 text-blue-600',
            )}
            aria-label={`Snooze ${selectedCount} signals`}
            aria-expanded={showSnoozeMenu}
            aria-haspopup="menu"
            data-testid="bulk-snooze-btn"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Clock className="h-3.5 w-3.5" />
            )}
            Snooze
          </button>

          {/* Snooze duration menu */}
          {showSnoozeMenu && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-border bg-popover p-1 shadow-lg"
              role="menu"
              aria-label="Select snooze duration"
              data-testid="snooze-duration-menu"
            >
              <div className="mb-1 flex items-center justify-between px-2 py-1">
                <span className="text-[10px] font-medium text-muted-foreground">
                  Duration
                </span>
                <button
                  type="button"
                  onClick={() => setShowSnoozeMenu(false)}
                  className="rounded p-0.5 hover:bg-accent"
                  aria-label="Close snooze menu"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
              {SNOOZE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSnooze(option.value);
                    setShowSnoozeMenu(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors',
                    'hover:bg-accent text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                  data-testid={`snooze-option-${option.value}`}
                >
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
