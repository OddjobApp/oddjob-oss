import React, { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { getLazyPackagedComponent } from "@domain-ui/core/ui/components/packaged/registry";

/**
 * Instant App Surface (Phase 2 — multi-block composition).
 *
 * Composes several pre-built packaged blocks into one live surface in the copilot
 * chat — no build, no deploy. Produced by the `assemble_instant_app` tool. Each
 * block resolves via the shared packaged registry and renders in isolation
 * (Suspense + error boundary), so one data-hungry/broken block can't take down
 * the whole surface.
 */

interface SurfaceBlock {
  module: string;
  componentName?: string;
  props?: Record<string, any>;
  span?: number;
}

export interface InstantAppSurfaceProps {
  title?: string;
  note?: string;
  layout?: "grid" | "stack";
  blocks: SurfaceBlock[];
}

class BlockBoundary extends React.Component<
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

const blockNotice = (text: string, tone: "muted" | "warn" = "muted") => (
  <div className={"p-4 text-center text-[11px] font-mono " + (tone === "warn" ? "text-amber-400/80" : "text-muted-foreground")}>
    {text}
  </div>
);

function SurfaceBlockView({ block }: { block: SurfaceBlock }) {
  const Lazy = getLazyPackagedComponent(block.module);
  const label = block.componentName || block.module;
  return (
    <div className="min-w-0 max-w-full overflow-auto rounded-xl border border-border bg-background/40 p-2 max-h-[24rem]">
      {!Lazy ? (
        blockNotice(`"${block.module}" is not available to render.`)
      ) : (
        <BlockBoundary fallback={blockNotice(`${label}: needs live data or props it didn't receive.`, "warn")}>
          <Suspense fallback={blockNotice("Loading…")}>
            <Lazy {...(block.props || {})} />
          </Suspense>
        </BlockBoundary>
      )}
    </div>
  );
}

// NOTE: `layout` is intentionally ignored — the copilot sheet is narrow, so blocks
// always render as a single vertical column regardless of the requested layout.
export function InstantAppSurface({ title, note, blocks }: InstantAppSurfaceProps) {
  const list = Array.isArray(blocks) ? blocks : [];
  return (
    <div data-testid="instant-app-surface" className="w-full max-w-full rounded-2xl border border-fuchsia-400/20 bg-card p-4 shadow-xl">
      <div className="mb-3 flex items-center gap-2 border-b border-border pb-2.5">
        <div className="rounded-lg border border-fuchsia-400/20 bg-fuchsia-500/10 p-1.5 text-fuchsia-700 dark:text-fuchsia-300">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-700 dark:text-fuchsia-300">
            Instant App · {list.length} block{list.length === 1 ? "" : "s"}
          </p>
          <h3 className="truncate text-sm font-bold text-foreground">{title || "Instant App"}</h3>
        </div>
      </div>
      {note && <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{note}</p>}
      {/* Always a single vertical column: the copilot sheet is narrow (~420px), so
          viewport-based multi-column grids (md/xl) crammed blocks and clipped them.
          Each block scrolls its own overflow, so wide tables never blow out the sheet. */}
      <div className="flex flex-col gap-3">
        {list.map((b, i) => (
          <SurfaceBlockView key={`${b.module}-${i}`} block={b} />
        ))}
      </div>
    </div>
  );
}

export default InstantAppSurface;
