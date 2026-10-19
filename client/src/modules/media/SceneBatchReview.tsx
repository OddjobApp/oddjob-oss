import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCheck, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEFECT_CLASSES, formatCents, type DefectClass, type ProductionView, type SceneView, type ShotView, type TakeView } from "@shared/media-studio";
import { productionKey, readJson } from "./api";
import { describeStudioError } from "./errors";
import { useStudioToast } from "./feedback";
import { shortcutKeys } from "./shortcuts";
import { FOCUS_RING } from "./StatusIcon";
import type { StudioHistory } from "./history";
import { StudioErrorAlert } from "./StudioErrorAlert";
import { approvalAction, reshootAction, type BatchTakeResult, type StudioSend } from "./take-actions";

/**
 * Approving several takes, or re-shooting several shots, of a scene at once. The server
 * handles each take in turn and says how each went; what went through can be undone
 * in one step.
 */

const DEFECT_NAMES: Record<DefectClass, string> = {
  character_drift: "Character drift",
  unnatural_motion: "Unnatural motion",
  wrong_framing: "Wrong framing or lens",
  lighting_mismatch: "Lighting or color shift",
  artifact_glitch: "Render glitch",
};

type Entry = { shot: ShotView; shotNumber: number; take: TakeView };
type BatchAnswer = { production: ProductionView; results: BatchTakeResult[] };

export function SceneBatchReview({ production, scene, history, send }: {
  production: ProductionView;
  scene: SceneView;
  history?: StudioHistory;
  /** Sends a follow-up request (an undo or redo) and refreshes the production. */
  send: StudioSend;
}) {
  const queryClient = useQueryClient();
  const notify = useStudioToast();
  const [open, setOpen] = useState(false);
  const [approveIds, setApproveIds] = useState<number[]>([]);
  const [reshootIds, setReshootIds] = useState<number[]>([]);
  const [defect, setDefect] = useState<DefectClass | "">("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"approve" | "reshoot" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<{ verb: string; results: BatchTakeResult[] } | null>(null);

  const entries: Entry[] = scene.shots.flatMap((shot, index) => shot.takes.map((take) => ({ shot, shotNumber: index + 1, take })));
  const reviewable = entries.filter((entry) => entry.take.status === "ready_for_review");
  // The take a shot would re-shoot: its approved take, else its latest take ready for review.
  const reshootable: Entry[] = scene.shots.flatMap((shot, index) => {
    const take = shot.takes.find((t) => t.status === "approved") ?? [...shot.takes].reverse().find((t) => t.status === "ready_for_review");
    return take ? [{ shot, shotNumber: index + 1, take }] : [];
  });
  if (!reviewable.length && !reshootable.length) return null;

  const numberOf = (takeId: number) => entries.find((entry) => entry.take.id === takeId);
  const doubled = [...new Set(approveIds.map((id) => numberOf(id)?.shotNumber))]
    .filter((shotNumber) => approveIds.filter((id) => numberOf(id)?.shotNumber === shotNumber).length > 1) as number[];
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const estimate = reshootIds.reduce((cents, id) => cents + Math.ceil((numberOf(id)?.shot.durationSeconds ?? 0) * production.video.centsPerSecond), 0);

  const run = async (kind: "approve" | "reshoot") => {
    setBusy(kind);
    setError(null);
    setOutcome(null);
    try {
      const answer = kind === "approve"
        ? await readJson<BatchAnswer>("POST", `/api/media-studio/scenes/${scene.id}/takes/approve`, { takeIds: approveIds })
        : await readJson<BatchAnswer>("POST", `/api/media-studio/scenes/${scene.id}/takes/reshoot`, {
          items: reshootIds.map((takeId) => ({ takeId, ...(defect ? { defectClass: defect } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) })),
        });
      queryClient.setQueryData(productionKey(answer.production.id), answer.production);
      const done = answer.results.filter((result) => result.ok);
      if (done.length) {
        history?.record(kind === "approve"
          ? approvalAction(scene, done.map((result) => result.takeId), send)
          : reshootAction(scene, done.map((result) => ({ takeId: result.takeId, newTakeId: result.newTakeId ?? null, defectClass: defect || undefined, notes: notes.trim() || undefined })), send));
      }
      setOutcome({ verb: kind === "approve" ? "Approved" : "Asked to re-shoot", results: answer.results });
      notify(
        `${kind === "approve" ? "Approved" : "Asked to re-shoot"} ${done.length} of ${answer.results.length}`,
        done.length ? `Undo takes all of them back (${shortcutKeys("undo")}).` : "None went through; the reasons are listed in the panel.",
      );
      if (kind === "approve") setApproveIds([]);
      else setReshootIds([]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const failures = outcome?.results.filter((result) => !result.ok) ?? [];

  return (
    <section className="rounded-lg border border-border bg-card" data-testid={`scene-batch-${scene.id}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn("flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-foreground", FOCUS_RING)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
        Review several takes
        <span className="ml-auto font-normal text-muted-foreground">
          {reviewable.length} ready for review · {reshootable.length} can be re-shot
        </span>
      </button>

      {open && (
        <div className="grid gap-3 border-t border-border/60 p-2.5">
          {error ? <StudioErrorAlert error={error} onDismiss={() => setError(null)} /> : null}
          {outcome && (
            <div role="status" className="rounded-md border border-border bg-muted/40 p-2 text-[11px]" data-testid={`scene-batch-outcome-${scene.id}`}>
              <p className="font-medium text-foreground">
                {outcome.verb} {outcome.results.length - failures.length} of {outcome.results.length}.
                {outcome.results.length > failures.length ? " Undo takes all of them back." : ""}
              </p>
              {failures.length > 0 && (
                <ul className="mt-1 grid gap-1">
                  {failures.map((result) => {
                    const entry = numberOf(result.takeId);
                    return (
                      <li key={result.takeId} className="text-muted-foreground">
                        <span className="text-destructive">{entry ? `Shot ${entry.shotNumber}, take ${entry.take.takeNumber}: ` : ""}{result.error}</span>{" "}
                        {describeStudioError(result.error).fix}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-[11px] font-semibold text-foreground">Approve</legend>
            {reviewable.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No takes in {scene.sceneKey} are ready for review. Rendered takes appear here when they finish.</p>
            ) : (
              <>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" htmlFor={`batch-approve-all-${scene.id}`}>
                  <input
                    id={`batch-approve-all-${scene.id}`} type="checkbox"
                    checked={approveIds.length === reviewable.length}
                    onChange={(event) => setApproveIds(event.target.checked ? reviewable.map((entry) => entry.take.id) : [])}
                  />
                  Select all ready for review
                </label>
                <ul className="grid gap-1">
                  {reviewable.map(({ shotNumber, take }) => (
                    <li key={take.id} className="flex items-center gap-1.5 text-[11px]">
                      <input id={`batch-approve-${take.id}`} type="checkbox" checked={approveIds.includes(take.id)} onChange={() => setApproveIds((ids) => toggle(ids, take.id))} />
                      <label htmlFor={`batch-approve-${take.id}`} className="text-foreground">Shot {shotNumber}, take {take.takeNumber}</label>
                      {take.videoUrl && <a href={take.videoUrl} target="_blank" rel="noreferrer" className="text-primary underline">Watch</a>}
                    </li>
                  ))}
                </ul>
                {doubled.length > 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    {doubled.length === 1 ? `Shot ${doubled[0]} has` : `Shots ${doubled.join(", ")} have`} more than one take selected. A shot keeps one approved take, so pick one.
                  </p>
                )}
                <div>
                  <Button type="button" size="sm" className="h-7 gap-1" disabled={!approveIds.length || doubled.length > 0 || busy !== null} onClick={() => void run("approve")}>
                    {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCheck className="h-3.5 w-3.5" aria-hidden />}
                    Approve selected ({approveIds.length})
                  </Button>
                </div>
              </>
            )}
          </fieldset>

          <fieldset className="grid gap-1.5 border-t border-border/60 pt-2">
            <legend className="mb-1 text-[11px] font-semibold text-foreground">Re-shoot</legend>
            {reshootable.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No shot has a rendered take to re-shoot yet.</p>
            ) : (
              <>
                <ul className="grid gap-1">
                  {reshootable.map(({ shotNumber, take }) => (
                    <li key={take.id} className="flex items-center gap-1.5 text-[11px]">
                      <input id={`batch-reshoot-${take.id}`} type="checkbox" checked={reshootIds.includes(take.id)} onChange={() => setReshootIds((ids) => toggle(ids, take.id))} />
                      <label htmlFor={`batch-reshoot-${take.id}`} className="text-foreground">
                        Shot {shotNumber}, take {take.takeNumber} <span className="text-muted-foreground">({take.status === "approved" ? "approved" : "ready for review"})</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={`batch-defect-${scene.id}`}>
                    What was wrong (optional)
                    <select id={`batch-defect-${scene.id}`} value={defect} onChange={(event) => setDefect(event.target.value as DefectClass | "")} className="h-7 rounded-md border border-input bg-background px-2 text-xs">
                      <option value="">Not saying</option>
                      {DEFECT_CLASSES.map((d) => <option key={d} value={d}>{DEFECT_NAMES[d]}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={`batch-notes-${scene.id}`}>
                    What to change (optional)
                    <input id={`batch-notes-${scene.id}`} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} className="h-7 rounded-md border border-input bg-background px-2 text-xs" />
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {!production.video.configured
                    ? "Takes are simulations here, so re-shooting records new takes with no video and no charge."
                    : production.video.engine === "comfyui"
                      ? `Each re-shoot is its own request and waits for approval before anything renders on ComfyUI${estimate > 0 ? `: about ${formatCents(estimate)} for ${reshootIds.length === 1 ? "this one" : `these ${reshootIds.length}`}` : ", with no provider charge"}.`
                      : `Each re-shoot is its own request and waits for approval before anything renders: about ${formatCents(estimate)} for ${reshootIds.length === 1 ? "this one" : `these ${reshootIds.length}`} at ${production.video.resolution}.`}
                </p>
                <div>
                  <Button type="button" size="sm" variant="outline" className="h-7 gap-1" disabled={!reshootIds.length || busy !== null} onClick={() => void run("reshoot")}>
                    {busy === "reshoot" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                    Re-shoot selected ({reshootIds.length})
                  </Button>
                </div>
              </>
            )}
          </fieldset>
        </div>
      )}
    </section>
  );
}
