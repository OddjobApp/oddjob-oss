import React, { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { getLazyPackagedComponent } from "@domain-ui/core/ui/components/packaged/registry";

/**
 * Instant App renderer (Phase 1).
 *
 * Renders a single pre-built, self-wiring packaged block LIVE inside the copilot
 * chat — no build, no deploy. The copilot picks a component from the component
 * index and calls `render_instant_app`; the deterministic payload flows through
 * the rich-response pipeline and lands here, where we resolve the block from the
 * shared packaged registry (same source the gallery previews use) and mount it.
 */

class InstantAppErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    /* swallowed — the fallback communicates the failure */
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

const notice = (text: string, tone: "muted" | "warn" = "muted") => (
  <div
    className={
      "p-6 text-center text-xs font-mono " + (tone === "warn" ? "text-amber-400/80" : "text-muted-foreground")
    }
  >
    {text}
  </div>
);

export interface InstantAppRendererProps {
  module: string;
  componentName?: string;
  title?: string;
  note?: string;
  props?: Record<string, any>;
}

export function InstantAppRenderer({ module, componentName, title, note, props }: InstantAppRendererProps) {
  // Scribe mounts as a full-height rail next to the transcript rather than as
  // an inline transcript card, so the transcript gets a pointer to it instead of
  // a second copy of the 4-pane studio. The packaged ScribeStudioPod entry in
  // registry.ts is what the rail resolves; this branch does not replace it.
  if (module === 'ScribeStudioPod' || componentName === 'ScribeStudioPod') {
    return (
      <div data-testid="instant-app" className="w-full max-w-full rounded-2xl border border-emerald-500/30 bg-card/90 p-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-400">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">Scribe Studio</p>
              <h3 className="truncate text-sm font-bold text-foreground">{title || "Authoring Studio Active"}</h3>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            Active in Workspace
          </span>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          The 4-pane Scribe Studio authoring workspace (Subway Spine, Living Canvas, Multi-Lens Critic Hub, and Telemetry Dock) is mounted and active in the right rail.
        </p>
      </div>
    );
  }

  if (module === 'MediaStudioPod' || componentName === 'MediaStudioPod') {
    return (
      <div data-testid="instant-app" className="w-full max-w-full rounded-2xl border border-sky-500/30 bg-card/90 p-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-1.5 text-sky-700 dark:text-sky-300">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">Media Studio</p>
              <h3 className="truncate text-sm font-bold text-foreground">{title || "Film & Video Studio Active"}</h3>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">
            Active in Workspace
          </span>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          The Media Studio workspace (Director Deck, Latent Canvas, ComfyUI DAG Graph Viewer, and Timeline) is mounted in the right rail.
        </p>
      </div>
    );
  }

  if (module === 'ProjectStudioPod' || componentName === 'ProjectStudioPod') {
    return (
      <div data-testid="instant-app" className="w-full max-w-full rounded-2xl border border-primary/30 bg-card/90 p-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-1.5 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Project Studio</p>
              <h3 className="truncate text-sm font-bold text-foreground">{title || "Operational Cycle Studio Active"}</h3>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-primary/15 text-primary border border-primary/30">
            Active in Workspace
          </span>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          The Project Studio planning workspace (Sequence Spine, Gantt Timeline, Topological DAG, and Companion Dock) is mounted in the right rail.
        </p>
      </div>
    );
  }

  const Lazy = getLazyPackagedComponent(module);

  return (
    <div data-testid="instant-app" className="w-full max-w-full rounded-2xl border border-fuchsia-400/20 bg-card p-4 shadow-xl">
      <div className="mb-3 flex items-center gap-2 border-b border-border pb-2.5">
        <div className="rounded-lg border border-fuchsia-400/20 bg-fuchsia-500/10 p-1.5 text-fuchsia-700 dark:text-fuchsia-300">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-700 dark:text-fuchsia-300">Instant App</p>
          <h3 className="truncate text-sm font-bold text-foreground">{title || componentName || module}</h3>
        </div>
      </div>
      {note && <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{note}</p>}
      {!Lazy ? (
        notice(`Component "${module}" isn't available to render.`)
      ) : (
        <InstantAppErrorBoundary fallback={notice("This component needs live data or props it didn't receive.", "warn")}>
          <Suspense fallback={notice("Assembling…")}>
            <div className="min-w-0 max-w-full max-h-[28rem] overflow-auto rounded-xl border border-border bg-background/40 p-2">
              <Lazy {...(props || {})} />
            </div>
          </Suspense>
        </InstantAppErrorBoundary>
      )}
    </div>
  );
}

export default InstantAppRenderer;
