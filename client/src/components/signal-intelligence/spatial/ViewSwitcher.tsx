import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { ViewId } from './utils';

/**
 * ViewSwitcher — Horizontal tab bar for navigating spatial UX views.
 * Requirements: 3.1, 3.7, 3.8
 *
 * Implements WAI-ARIA Tabs pattern:
 * - role="tablist" on the container
 * - role="tab" on each button with aria-selected and aria-controls
 * - Left/Right arrow key navigation between tabs
 */

export interface ViewSwitcherProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  isBusinessMode?: boolean;
}

const TAB_CONFIG: { id: ViewId; businessLabel: string; technicalLabel: string }[] = [
  { id: 'signals', businessLabel: '1. 📡 Detect Alerts', technicalLabel: 'Signals' },
  { id: 'subscriptions', businessLabel: '2. ⚡ Act & Auto-Rules', technicalLabel: 'Cycle Subscriptions' },
  { id: 'sources', businessLabel: '🔌 Data Connectors', technicalLabel: 'Signal Sources' },
  { id: 'backbone', businessLabel: '📊 Outbox Status', technicalLabel: 'Event Backbone' },
];

/** Returns the panel element ID that a tab controls. */
function panelId(viewId: ViewId): string {
  return `tabpanel-${viewId}`;
}

/** Returns the tab element ID for a given view. */
function tabId(viewId: ViewId): string {
  return `tab-${viewId}`;
}

export function ViewSwitcher({ activeView, onViewChange, isBusinessMode = true }: ViewSwitcherProps) {
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const currentIndex = TAB_CONFIG.findIndex((t) => t.id === activeView);
      let nextIndex: number | null = null;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % TAB_CONFIG.length;
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + TAB_CONFIG.length) % TAB_CONFIG.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIndex = TAB_CONFIG.length - 1;
      }

      if (nextIndex !== null) {
        onViewChange(TAB_CONFIG[nextIndex].id);
        tabsRef.current[nextIndex]?.focus();
      }
    },
    [activeView, onViewChange],
  );

  return (
    <nav aria-label="View navigation">
      <div
        role="tablist"
        aria-label="Spatial views"
        className="flex gap-1 border-b border-border"
      >
        {TAB_CONFIG.map((tab, index) => {
          const isActive = tab.id === activeView;
          const label = isBusinessMode ? tab.businessLabel : tab.technicalLabel;
          return (
            <button
              key={tab.id}
              ref={(el) => { tabsRef.current[index] = el; }}
              id={tabId(tab.id)}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={panelId(tab.id)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onViewChange(tab.id)}
              onKeyDown={handleKeyDown}
              className={cn(
                'relative px-4 py-2.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'hover:text-foreground',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {label}
              {/* Active indicator — underline accent */}
              {isActive && (
                <span
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export { TAB_CONFIG, panelId, tabId };
