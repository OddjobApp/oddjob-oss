import React from "react";
import { Clapperboard, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssemblyView } from "@shared/media-studio";

export interface MediaProgramViewerProps {
  /** The scene or film being watched, for the player's label. */
  label: string;
  /** The latest cut of it, or null when it has never been assembled. */
  assembly: AssemblyView | null;
  className?: string;
}

/**
 * The program monitor: the assembled reel, watched in the viewer.
 *
 * Its player used to live in SceneReel, a block of its own further up the film screen,
 * which left two video surfaces on one page — the take under the playhead and the cut —
 * far apart and competing. Editors put both in one place and switch between them, so
 * this is the same viewer area in its other mode, and SceneReel keeps what it is
 * actually for: cutting the reel and saying why it cannot be cut yet.
 */
export function MediaProgramViewer({ label, assembly, className }: MediaProgramViewerProps) {
  const ready = assembly?.status === "ready" && assembly.reelUrl;
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)} data-testid="media-program-viewer">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
        {ready ? (
          <video
            controls
            preload="metadata"
            src={assembly.reelUrl ?? undefined}
            aria-label={`${label} reel`}
            className="max-h-full w-full"
            data-testid="program-reel-video"
          />
        ) : (
          <div className="grid justify-items-center gap-2 p-6 text-center text-muted-foreground">
            {assembly?.status === "assembling" ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
                <p role="status" className="text-xs">Cutting {label} from its approved takes. This can take a minute.</p>
              </>
            ) : assembly?.status === "failed" ? (
              <p role="alert" className="text-xs text-destructive">
                The reel could not be cut: {assembly.error ?? "no reason was given"}
              </p>
            ) : (
              <>
                <Clapperboard className="h-5 w-5" aria-hidden />
                <p className="text-xs">No reel yet. Assemble one from the approved takes to watch the cut.</p>
              </>
            )}
          </div>
        )}
      </div>

      {ready && (
        <p className="shrink-0 text-[11px] text-muted-foreground" data-testid="program-reel-state">
          {assembly.durationSeconds != null ? `${Number(assembly.durationSeconds.toFixed(1))} seconds · ` : ""}
          {assembly.current
            ? "Cut from the takes approved now."
            : "The approved takes or transitions have changed since this reel was cut. Assemble it again to include them."}
        </p>
      )}
    </div>
  );
}

export default MediaProgramViewer;
