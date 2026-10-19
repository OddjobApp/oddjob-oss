import React, { useState } from "react";
import { ChevronDown, Clapperboard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sceneAssemblyProblem, type SceneView } from "@shared/media-studio";
import type { ProductionAct } from "./api";
import { DiscussButton, type MediaDiscuss } from "./DiscussButton";

/**
 * A scene's reel: cutting it from the approved takes, and why it cannot be cut yet.
 * The cut itself — under way, failed, ready, out of date — is watched and reported in
 * the viewer's Reel mode, so this holds the action rather than a second player.
 */
export function SceneReel({ scene, act, onDiscuss }: { scene: SceneView; act: ProductionAct; onDiscuss?: MediaDiscuss }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const problem = sceneAssemblyProblem(scene);
  const assembly = scene.assembly;
  const assembling = assembly?.status === "assembling";

  const assemble = async () => {
    setBusy(true);
    setError(null);
    try {
      await act("POST", `/api/media-studio/scenes/${scene.id}/assemble`);
    } catch (err) {
      setError((err as Error).message || "The scene could not be assembled.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`reel-${scene.id}`} className="grid gap-2 rounded-lg border border-border bg-card p-2.5" data-testid={`scene-reel-${scene.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsCollapsed((c) => !c)}
          className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors cursor-pointer text-left"
          data-testid={`reel-toggle-${scene.id}`}
          aria-expanded={!isCollapsed}
        >
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isCollapsed && "-rotate-90")} />
          <span id={`reel-${scene.id}`} className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Clapperboard className="h-3.5 w-3.5 text-primary" />Reel
          </span>
          {assembly?.status === "ready" && assembly.durationSeconds != null && (
            <span className="font-mono text-[10px] text-muted-foreground font-normal">
              ({Number(assembly.durationSeconds.toFixed(1))}s)
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          {assembly && (
            <DiscussButton onDiscuss={onDiscuss} target={{ sceneId: scene.id, sceneKey: scene.sceneKey, kind: "reel", id: assembly.id, label: `${scene.sceneKey} reel` }} />
          )}
          <Button type="button" size="sm" variant="outline" className="h-7" disabled={Boolean(problem) || assembling || busy} onClick={() => void assemble()}>
            {assembling ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />Assembling…</> : assembly?.status === "ready" ? "Assemble again" : "Assemble reel"}
          </Button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {problem && <p className="text-[11px] text-muted-foreground" data-testid={`reel-problem-${scene.id}`}>{problem}</p>}
          {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
          {/* How the cut itself is doing — under way, failed, out of date — is said in
              the viewer's Reel mode, where the cut is watched. This section is the action
              that makes one, and the reasons it cannot be made yet. */}
          {assembly?.status === "ready" && !assembly.current && (
            <p className="text-[11px] text-muted-foreground" data-testid={`reel-state-${scene.id}`}>
              The approved takes or transitions have changed since this reel was cut.
            </p>
          )}
        </>
      )}
    </section>
  );
}
