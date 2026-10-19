import { Component, type ReactNode } from 'react';
import type { ViewId } from './utils';
import { panelId, tabId } from './ViewSwitcher';

/**
 * ViewContainer — Renders all view panels simultaneously, hiding inactive ones
 * via CSS to preserve scroll position and component state across tab switches.
 *
 * Each panel is wrapped in a ViewErrorBoundary that catches render errors and
 * displays a fallback message while keeping the ViewSwitcher interactive.
 *
 * Requirements: 3.2, 3.3, 3.9
 */

// ─── Error Boundary ───────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  viewId: ViewId;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * ViewErrorBoundary — Catches render errors within a single view panel.
 * On error, shows a fallback message while leaving other panels unaffected
 * and the ViewSwitcher fully interactive.
 */
export class ViewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex items-center justify-center p-8 text-sm text-destructive"
          data-testid={`view-error-${this.props.viewId}`}
        >
          This view could not be loaded
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── View Container ───────────────────────────────────────────────────────────

export interface ViewPanelConfig {
  id: ViewId;
  content: ReactNode;
}

export interface ViewContainerProps {
  activeView: ViewId;
  panels: ViewPanelConfig[];
}

/**
 * ViewContainer renders all panels at once, toggling visibility via the `hidden`
 * attribute on inactive panels. This preserves DOM state (scroll position,
 * component state, fetched data) when switching tabs.
 *
 * Each panel has:
 * - role="tabpanel"
 * - id matching panelId(viewId) for aria-controls linkage from ViewSwitcher
 * - aria-labelledby referencing the corresponding tab element
 */
export function ViewContainer({ activeView, panels }: ViewContainerProps) {
  return (
    <>
      {panels.map(({ id, content }) => {
        const isActive = id === activeView;
        return (
          <div
            key={id}
            id={panelId(id)}
            role="tabpanel"
            aria-labelledby={tabId(id)}
            hidden={!isActive}
            tabIndex={isActive ? 0 : -1}
            data-testid={`view-panel-${id}`}
          >
            <ViewErrorBoundary viewId={id}>
              {content}
            </ViewErrorBoundary>
          </div>
        );
      })}
    </>
  );
}
