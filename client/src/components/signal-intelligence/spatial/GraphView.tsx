/**
 * GraphView — Wrapper component that renders the CausalGraphVisualizer inline
 * in the main content area (not in a dialog) wired to live causal link data.
 *
 * This component is rendered inside the ViewContainer's "Graph" tabpanel.
 * The ViewContainer already provides the role="tabpanel", id, and aria-labelledby
 * attributes, so this component focuses solely on data fetching and rendering.
 *
 * Requirements: 3.4
 */

import { CausalGraphVisualizer } from '../CausalGraphVisualizer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GraphViewProps {
  /** Organization ID for scoping causal graph queries */
  organizationId: number;
  /** Currently selected signal ID (filters the graph to that signal's relationships) */
  selectedSignalId?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * GraphView renders the CausalGraphVisualizer inline. The visualizer handles
 * its own data fetching via react-query internally, so this wrapper passes
 * through the necessary props and provides an appropriate container.
 */
export function GraphView({ organizationId, selectedSignalId }: GraphViewProps) {
  return (
    <div
      className="h-[650px] w-full overflow-hidden rounded-lg border border-border/70 bg-card/20 flex flex-col"
      data-testid="graph-view"
    >
      <CausalGraphVisualizer
        organizationId={organizationId}
        selectedEventId={selectedSignalId ?? undefined}
      />
    </div>
  );
}
