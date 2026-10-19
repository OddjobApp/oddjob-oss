import React, { useState } from "react";
import { CheckCircle2, Clock, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCents, type ProductionView, type SceneView, type ShotView, type TakeView } from "@shared/media-studio";
import { useProductionAct } from "./api";
import { useStudioToast } from "./feedback";
import { openInMediaStudio } from "./navigation";

/**
 * What the production is waiting on: renders in flight, and takes waiting on a person.
 *
 * A generated film is mostly waiting. A render runs for minutes — over half an hour on a
 * local ComfyUI — and a scene puts several in flight at once, so "what is happening right
 * now" is a question the timeline cannot answer while showing one clip at a time. This is
 * the one place that answers it for the whole production, without leaving the edit.
 */

interface QueueEntry {
  scene: SceneView;
  shot: ShotView;
  shotNumber: number;
  take: TakeView;
}

const RENDERING: ReadonlyArray<TakeView["status"]> = ["queued", "rendering"];

function entriesOf(view: ProductionView, keep: (take: TakeView) => boolean): QueueEntry[] {
  const found: QueueEntry[] = [];
  for (const scene of view.scenes) {
    scene.shots.forEach((shot, index) => {
      for (const take of shot.takes) {
        if (keep(take)) found.push({ scene, shot, shotNumber: index + 1, take });
      }
    });
  }
  return found;
}

/** How far along, and how long is left, said only when the render actually reported it. */
function progressOf(take: TakeView): { percent: number | null; eta: string | null; where: string | null } {
  const streaming = take.streaming;
  if (!streaming) return { percent: null, eta: null, where: null };
  const step = streaming.currentStep ?? streaming.step;
  const percent = streaming.percent ?? (streaming.totalSteps > 0 && step != null
    ? Math.round((step / streaming.totalSteps) * 100)
    : null);
  const eta = streaming.etaSeconds != null
    ? streaming.etaSeconds >= 60
      ? `${Math.round(streaming.etaSeconds / 60)} min left`
      : `${streaming.etaSeconds}s left`
    : streaming.etc
      ? `about ${streaming.etc}`
      : null;
  return { percent, eta, where: streaming.activeNodeTitle ?? streaming.activeNodeLabel ?? null };
}

export function RenderQueuePanel({ view }: { view: ProductionView }) {
  const act = useProductionAct(view.id);
  const notify = useStudioToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rendering = entriesOf(view, (take) => RENDERING.includes(take.status));
  const waitingOnApproval = entriesOf(view, (take) => take.status === "pending_approval");
  const toReview = entriesOf(view, (take) => take.status === "ready_for_review");
  const failed = entriesOf(view, (take) => take.status === "failed");

  const go = (entry: QueueEntry) =>
    openInMediaStudio({ productionId: view.id, tab: "film", sceneId: entry.scene.id, shotId: entry.shot.id });

  const approve = async (entry: QueueEntry) => {
    setBusy(entry.take.id);
    setError(null);
    try {
      await act("POST", `/api/media-studio/takes/${entry.take.id}/approve`);
      notify(`Approved take ${entry.take.takeNumber}`, `${entry.scene.sceneKey} shot ${entry.shotNumber} is cut from it now.`);
    } catch (err) {
      setError((err as Error)?.message ?? "That take could not be approved.");
    } finally {
      setBusy(null);
    }
  };

  const nothing = !rendering.length && !waitingOnApproval.length && !toReview.length && !failed.length;
  if (nothing) {
    return (
      <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border p-4 text-center" data-testid="render-queue-empty">
        <CheckCircle2 className="h-6 w-6 text-muted-foreground/60" aria-hidden />
        <p className="text-sm font-medium text-foreground">Nothing in flight</p>
        <p className="text-xs text-muted-foreground">No render is running and nothing is waiting on a decision.</p>
      </div>
    );
  }

  const Row = ({ entry, children }: { entry: QueueEntry; children?: React.ReactNode }) => (
    <li className="grid gap-1 rounded-md border border-border/70 p-2">
      <button
        type="button"
        onClick={() => go(entry)}
        className="truncate text-left text-[11px] font-medium text-foreground hover:text-primary"
        title="Show this shot on the timeline"
      >
        {entry.scene.sceneKey} · shot {entry.shotNumber} · take {entry.take.takeNumber}
      </button>
      {children}
    </li>
  );

  return (
    <div className="grid gap-3" data-testid="render-queue">
      {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}

      {rendering.length > 0 && (
        <section className="grid gap-1.5">
          <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <Loader2 className="h-3 w-3 animate-spin text-primary" aria-hidden />
            Rendering ({rendering.length})
          </h4>
          <ul className="grid gap-1.5" data-testid="render-queue-rendering">
            {rendering.map((entry) => {
              const { percent, eta, where } = progressOf(entry.take);
              return (
                <Row key={entry.take.id} entry={entry}>
                  {/* Progress is shown only where the render reported it; a bar invented
                      from nothing reads as knowledge the platform does not have. */}
                  {percent != null && (
                    <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
                    </div>
                  )}
                  <p className="truncate text-[10px] text-muted-foreground">
                    {entry.take.status === "queued" ? "Queued" : percent != null ? `${percent}%` : "Rendering"}
                    {where ? ` · ${where}` : ""}
                    {eta ? ` · ${eta}` : ""}
                  </p>
                </Row>
              );
            })}
          </ul>
        </section>
      )}

      {toReview.length > 0 && (
        <section className="grid gap-1.5">
          <h4 className="text-[11px] font-semibold text-foreground">Ready to review ({toReview.length})</h4>
          <ul className="grid gap-1.5" data-testid="render-queue-review">
            {toReview.map((entry) => (
              <Row key={entry.take.id} entry={entry}>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button" size="sm" className="h-6 px-2 text-[10px]"
                    disabled={busy !== null}
                    onClick={() => void approve(entry)}
                    data-testid={`render-queue-approve-${entry.take.id}`}
                  >
                    {busy === entry.take.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Approve"}
                  </Button>
                  {/* Rejecting asks what is wrong with it, which is a judgement made
                      while watching — so it happens in dailies, not from a list. */}
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground" onClick={() => go(entry)}>
                    Watch it
                  </Button>
                </div>
              </Row>
            ))}
          </ul>
        </section>
      )}

      {waitingOnApproval.length > 0 && (
        <section className="grid gap-1.5">
          <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <Clock className="h-3 w-3 text-muted-foreground" aria-hidden />
            Waiting on approval ({waitingOnApproval.length})
          </h4>
          <ul className="grid gap-1.5" data-testid="render-queue-waiting">
            {waitingOnApproval.map((entry) => (
              <Row key={entry.take.id} entry={entry}>
                <p className="text-[10px] text-muted-foreground">
                  Nothing renders until this is approved in the Decision Inbox
                  {entry.take.costCents > 0 ? ` · ~${formatCents(entry.take.costCents)}` : ""}
                </p>
              </Row>
            ))}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section className="grid gap-1.5">
          <h4 className={cn("flex items-center gap-1.5 text-[11px] font-semibold text-destructive")}>
            <TriangleAlert className="h-3 w-3" aria-hidden />
            Failed ({failed.length})
          </h4>
          <ul className="grid gap-1.5" data-testid="render-queue-failed">
            {failed.map((entry) => (
              <Row key={entry.take.id} entry={entry}>
                <p className="line-clamp-2 text-[10px] text-destructive">{entry.take.error ?? "No reason was given."}</p>
              </Row>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default RenderQueuePanel;
