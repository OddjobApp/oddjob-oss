import { Suspense, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { lazyWithRetry } from '@/lib/lazy-retry';
import {
  useOperationalMode,
  MODE_LABELS,
  type OperationalMode,
} from '@/contexts/OperationalModeContext';

// Lazy-load content panels for code-splitting with auto-retry
const AgentChatPanel = lazyWithRetry(
  () => import('@/components/agent-chat/AgentChatPanel')
);
const FeedsCyclesPanel = lazyWithRetry(
  () => import('@/components/feeds-cycles/FeedsCyclesPanel')
);
const SignalStudio = lazyWithRetry(
  () => import('@/modules/signal-studio/SignalStudio')
);

/**
 * Loading fallback displayed while a panel chunk is being loaded.
 */
function PanelLoadingFallback({ mode }: { mode: string }) {
  return (
    <div
      className="flex h-full items-center justify-center"
      role="status"
      aria-label={`Loading ${mode} panel`}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    </div>
  );
}

/**
 * Panel configuration mapping mode identifiers to their lazy-loaded components.
 */
const PANELS: { mode: OperationalMode; Component: React.LazyExoticComponent<React.ComponentType> }[] = [
  { mode: 'agent-chat', Component: AgentChatPanel },
  { mode: 'feeds-cycles', Component: FeedsCyclesPanel },
  { mode: 'h3-spatial-watch', Component: SignalStudio },
];

export interface ModeRouterProps {
  className?: string;
}

/**
 * ModeRouter renders all operational mode panels simultaneously but shows
 * only the active one. Inactive panels are hidden via `display: none` so that
 * their React component state (scroll position, loaded data, user input) is
 * preserved across mode switches per Requirement 2.8.
 *
 * Each panel is wrapped in its own `<Suspense>` boundary so that lazy-load
 * failures or slow loads in one panel don't block the others.
 */
export function ModeRouter({ className }: ModeRouterProps) {
  // The context is the source of truth. This used to re-read localStorage on a
  // 200ms setInterval — with its own duplicate copies of the storage key and
  // the valid-mode list — so a mode switch took up to 200ms to show, a timer
  // ran for the life of the page, and the component could disagree with the
  // context outright. The `storage` event it also listened for never fires in
  // the tab that made the change, which is presumably why the poll existed.
  const { activeMode } = useOperationalMode();
  const renderTimestampRef = useRef<number>(performance.now());

  // Track render timing for performance monitoring (300ms budget)
  useEffect(() => {
    renderTimestampRef.current = performance.now();
  }, [activeMode]);

  return (
    <div
      className={cn('relative flex-1 min-h-0', className)}
      data-testid="mode-router"
    >
      {PANELS.map(({ mode, Component }) => {
        const isActive = mode === activeMode;

        return (
          <div
            key={mode}
            className="h-full w-full"
            // Inline rather than a `hidden` utility class: hiding is load-bearing
            // here (it is what preserves each panel's state across switches), so
            // it must not depend on a stylesheet being present.
            style={{ display: isActive ? 'block' : 'none' }}
            aria-hidden={!isActive}
            data-mode={mode}
            data-active={isActive || undefined}
          >
            <Suspense fallback={<PanelLoadingFallback mode={MODE_LABELS[mode]} />}>
              <Component />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}

export default ModeRouter;
