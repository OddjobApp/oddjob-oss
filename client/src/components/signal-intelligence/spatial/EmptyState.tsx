import { Settings2, Radar } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * EmptyState — Displayed when no signals exist in the Signal Dashboard.
 * Provides two actionable prompts: configure a source and inject a scenario.
 *
 * Requirements: 1.4
 */

export interface EmptyStateProps {
  onConfigureSource: () => void;
  onInjectScenario: () => void;
}

export function EmptyState({ onConfigureSource, onInjectScenario }: EmptyStateProps) {
  return (
    <div
      data-testid="signal-empty-state"
      className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-border bg-card/20 p-8 text-center"
      role="status"
      aria-label="No signals available"
    >
      <div className="max-w-sm">
        <Radar className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-4 text-sm font-semibold text-foreground">
          No signals detected
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          Connect an intelligence source or inject a scenario to begin
          receiving live business signals.
        </p>

        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            data-testid="empty-state-configure-source"
            onClick={onConfigureSource}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium',
              'hover:bg-accent transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'min-h-[44px] min-w-[44px]',
            )}
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            Configure Source
          </button>

          <button
            type="button"
            data-testid="empty-state-inject-scenario"
            onClick={onInjectScenario}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'min-h-[44px] min-w-[44px]',
            )}
          >
            <Radar className="h-4 w-4" aria-hidden="true" />
            Inject Scenario
          </button>
        </div>
      </div>
    </div>
  );
}
