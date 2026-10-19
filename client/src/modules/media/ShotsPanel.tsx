import React, { useEffect, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Clapperboard, Copy, Layers, Loader2, Play, Plus, RefreshCw, Search, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { compileShot, SEEDANCE_DURATION } from "@shared/media-prompt";
import { SHOT_TRANSITIONS, formatCents, type DialogueLine, type ProductionView, type SceneView, type ShotView, type TakeView } from "@shared/media-studio";
import { type ProductionAct, withAssetOrg, orchestrateShot } from "./api";
import { openInMediaStudio, useStudioNavigation } from "./navigation";
import { StudioErrorAlert } from "./StudioErrorAlert";
import { DiscussButton, type MediaDiscuss } from "./DiscussButton";
import { moveItem } from "./StoryboardSequencer";
import { isSpent, isWaiting } from "./cost";
import { useStudioToast } from "./feedback";
import { matchesShotFilter, matchesShotSearch, sceneNeedsDecision, SHOT_FILTERS, shotStatus, STATUS_LABEL, type ShotFilter } from "./status";
import { FOCUS_RING, StatusIcon } from "./StatusIcon";

/**
 * Each scene's shots with their direction and dialogue, and exactly what the video
 * model will be sent for each, with what is wrong with it.
 */

type Run = (key: string, work: () => Promise<unknown>) => Promise<void>;

type Draft = Pick<ShotView, "prompt" | "negativePrompt" | "framing" | "lens" | "cameraMotion" | "action" | "durationSeconds" | "transition" | "dialogue" | "referenceKeyframeId">;

const draftOf = (shot: ShotView): Draft => ({
  prompt: shot.prompt, negativePrompt: shot.negativePrompt, framing: shot.framing, lens: shot.lens, cameraMotion: shot.cameraMotion,
  action: shot.action, durationSeconds: shot.durationSeconds, transition: shot.transition, dialogue: shot.dialogue.map((line) => ({ ...line })),
  referenceKeyframeId: shot.referenceKeyframeId,
});

const TRANSITION_LABEL: Record<ShotView["transition"], string> = { cut: "Cut", crossfade: "Crossfade", dip_to_black: "Dip to black" };

export function ShotsPanel({ production, act, onDiscuss, focus }: { production: ProductionView; act: ProductionAct; onDiscuss?: MediaDiscuss; focus?: { sceneId?: number; shotId?: number; at: number } | null }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run: Run = async (key, work) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const speakers = production.characters.filter((c) => c.kind === "character");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ShotFilter>("all");
  const [onlyNeedingDecision, setOnlyNeedingDecision] = useState(false);
  const filtering = Boolean(query.trim()) || filter !== "all" || onlyNeedingDecision;
  const clearFilters = () => {
    setQuery("");
    setFilter("all");
    setOnlyNeedingDecision(false);
  };
  const allShots = production.scenes.reduce((count, scene) => count + scene.shots.length, 0);
  // Shots keep their numbers in the scene when others are filtered out.
  const visible = production.scenes
    .filter((scene) => !onlyNeedingDecision || sceneNeedsDecision(scene))
    .map((scene) => ({
      scene,
      shots: scene.shots.map((shot, index) => ({ shot, index })).filter(({ shot }) => matchesShotFilter(shot, filter) && matchesShotSearch(shot, query)),
    }));
  const shown = visible.reduce((count, entry) => count + entry.shots.length, 0);
  const [selectedShotId, setSelectedShotId] = useState<number | null>(null);
  const [newSceneTitle, setNewSceneTitle] = useState("");

  // Navigation can mount this panel after the event has already been dispatched.
  useEffect(() => {
    if (!focus) return;
    setSelectedShotId(focus.shotId ?? production.scenes.find(s => s.id === focus.sceneId)?.shots[0]?.id ?? null);
  }, [focus]);

  useStudioNavigation((location) => {
    if (location.tab === "shots") {
      if (location.shotId != null) {
        setSelectedShotId(location.shotId);
      } else if (location.sceneId != null) {
        const targetScene = production.scenes.find((s) => s.id === location.sceneId);
        if (targetScene?.shots[0]) {
          setSelectedShotId(targetScene.shots[0].id);
        }
      }
    }
  });

  const selected = visible.flatMap(entry => entry.shots).find(({ shot }) => shot.id === selectedShotId)?.shot.id
    ?? visible.flatMap(entry => entry.shots)[0]?.shot.id;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 pb-16" data-testid="shots-panel">
      {error ? <StudioErrorAlert error={error} onDismiss={() => setError(null)} /> : null}
      <datalist id={`media-speakers-${production.id}`}>
        {speakers.map((character) => <option key={character.id} value={character.name} />)}
      </datalist>

      {production.scenes.length === 0 && (
        <div className="grid justify-items-start gap-3 rounded-lg border border-dashed border-border p-4" data-testid="shots-empty">
          <div>
            <p className="text-sm font-medium text-foreground">No scenes yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Shots belong to a scene. Create your first scene to begin authoring camera angles, actions, and takes:</p>
          </div>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const val = newSceneTitle.trim();
              if (!val) return;
              void run("create-first-scene", async () => {
                await act("POST", `/api/media-studio/productions/${production.id}/scenes`, { title: val });
                setNewSceneTitle("");
              });
            }}
          >
            <Input
              placeholder="Scene 1 title..."
              value={newSceneTitle}
              onChange={(e) => setNewSceneTitle(e.target.value)}
              className="h-8 w-60 text-xs"
              disabled={busy === "create-first-scene"}
            />
            <Button type="submit" size="sm" disabled={!newSceneTitle.trim() || busy === "create-first-scene"}>
              {busy === "create-first-scene" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
              Create Scene 1
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => openInMediaStudio({ tab: "story" })}>Open Story</Button>
          </form>
        </div>
      )}

      {allShots > 0 && (
        <div role="search" aria-label="Find shots" data-testid="shots-filters" className="flex flex-wrap items-end gap-2">
          <label htmlFor={`shots-search-${production.id}`} className="grid min-w-[12rem] flex-1 gap-0.5 text-[11px] font-medium">
            Search shots
            <span className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id={`shots-search-${production.id}`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Direction, dialogue, a speaker, or 5s" className="h-8 pl-7 text-xs" />
            </span>
          </label>
          <div className="grid gap-0.5">
            <label htmlFor={`shots-filter-${production.id}`} className="text-[11px] font-medium">Show</label>
            <select id={`shots-filter-${production.id}`} value={filter} onChange={(e) => setFilter(e.target.value as ShotFilter)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              {SHOT_FILTERS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <Button
            type="button"
            size="sm"
            variant={onlyNeedingDecision ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setOnlyNeedingDecision((v) => !v)}
            aria-label="Only scenes that need a decision"
          >
            <AlertCircle className="mr-1 h-3.5 w-3.5" />Needs a decision
          </Button>
        </div>
      )}

      {filtering && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span data-testid="shots-filter-count">Showing {shown} of {allShots} {allShots === 1 ? "shot." : "shots."}</span>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={clearFilters}><X className="mr-1 h-3 w-3" />Clear filters</Button>
          {query && !shown && (
            <p className="ml-auto">
              No shots match "{query}".{" "}
              <button type="button" onClick={clearFilters} className={cn("rounded text-primary underline", FOCUS_RING)}>Show all</button>
            </p>
          )}
        </div>
      )}

      {allShots > 0 && (
        <aside aria-label="Shot and scene navigator" className="min-w-0">
          <nav aria-label="Shot list" className="flex gap-2 overflow-x-auto pb-1.5">
            {visible.flatMap(({ scene, shots }) => shots.map(({ shot, index }) => {
              const frame = scene.plotPoints.flatMap(point => point.keyframes).find(frame => frame.id === shot.referenceKeyframeId);
              const thumb = frame?.imageUrl;
              return (
                <button
                  key={shot.id}
                  type="button"
                  aria-pressed={selected === shot.id}
                  onClick={() => setSelectedShotId(shot.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-1.5 text-left text-xs shrink-0 transition-colors hover:border-primary/50 min-w-[150px] max-w-[210px]",
                    selected === shot.id ? "border-primary bg-primary/10 shadow-sm" : "border-border bg-card"
                  )}
                >
                  {thumb ? (
                    <img src={withAssetOrg(thumb)} alt="" className="h-9 w-14 shrink-0 rounded object-cover border border-border/60" />
                  ) : (
                    <div className="flex h-9 w-14 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground border border-border/60">
                      <Clapperboard className="h-3.5 w-3.5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{scene.sceneKey} · Shot {index + 1}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{shot.durationSeconds}s · {STATUS_LABEL[shotStatus(shot)]}</span>
                  </div>
                </button>
              );
            }))}
          </nav>
        </aside>
      )}

      <div className="min-w-0 space-y-3">
        {visible.map(({ scene, shots }) => {
          const shotsNeedingTakes = scene.shots.filter((s) => !s.takes.some((t) => t.status === "approved" || t.status === "ready_for_review")).length;
          return filtering && shots.length === 0 ? null : (
            <section key={scene.id} aria-label={`Shots in ${scene.sceneKey}`} className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1.5">
                <h3 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
                  <span className="font-mono text-[11px] font-medium text-muted-foreground">{scene.sceneKey}</span>{scene.title}
                </h3>
                {shotsNeedingTakes > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                    disabled={busy === `batch-takes-${scene.id}`}
                    onClick={() => void run(`batch-takes-${scene.id}`, async () => {
                      await act("POST", `/api/media-studio/scenes/${scene.id}/batch-takes`, {});
                    })}
                    data-testid={`batch-takes-btn-${scene.id}`}
                    title="Queue takes for all shots in this scene without an approved or ready take"
                  >
                    {busy === `batch-takes-${scene.id}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                    Queue Scene Takes ({shotsNeedingTakes})
                  </Button>
                )}
              </div>
              {scene.shots.length === 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>No shots yet. Make them from approved keyframes in the storyboard, or generate standard coverage below.</span>
                  <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => openInMediaStudio({ tab: "storyboard" })}>Open Storyboard</Button>
                </div>
              )}
              {shots.map(({ shot, index }) => (
                <div key={shot.id} hidden={selected !== shot.id}>
                  <ShotEditor key={shot.id} production={production} scene={scene} shot={shot} index={index} act={act} busy={busy} run={run} onDiscuss={onDiscuss} />
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy === `add-shot-${scene.id}`}
                  onClick={() => void run(`add-shot-${scene.id}`, async () => {
                    const after = await act("POST", `/api/media-studio/scenes/${scene.id}/shots`, {});
                    const updatedScene = after?.scenes?.find((s) => s.id === scene.id);
                    const newest = updatedScene?.shots[updatedScene.shots.length - 1];
                    if (newest) setSelectedShotId(newest.id);
                  })}
                  data-testid={`add-single-shot-${scene.id}`}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />Add shot
                </Button>

                <div className="flex items-center gap-1 rounded-md border border-border/70 bg-muted/30 p-0.5" data-testid={`coverage-packages-${scene.id}`}>
                  <span className="px-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Coverage:
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={Boolean(busy)}
                    onClick={() => void run(`coverage-dialogue-${scene.id}`, async () => {
                      const after = await act("POST", `/api/media-studio/scenes/${scene.id}/coverage`, { template: "dialogue" });
                      const updatedScene = after?.scenes?.find((s) => s.id === scene.id);
                      const newest = updatedScene?.shots[updatedScene.shots.length - 1];
                      if (newest) setSelectedShotId(newest.id);
                    })}
                    title="Adds 4 shots: Establishing Wide, Character A MCU, Character B MCU, and Close-Up reaction"
                    data-testid={`coverage-dialogue-${scene.id}`}
                  >
                    <Layers className="mr-1 h-3 w-3 text-primary" />
                    Dialogue (4)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={Boolean(busy)}
                    onClick={() => void run(`coverage-atmospheric-${scene.id}`, async () => {
                      const after = await act("POST", `/api/media-studio/scenes/${scene.id}/coverage`, { template: "atmospheric" });
                      const updatedScene = after?.scenes?.find((s) => s.id === scene.id);
                      const newest = updatedScene?.shots[updatedScene.shots.length - 1];
                      if (newest) setSelectedShotId(newest.id);
                    })}
                    title="Adds 3 shots: Environmental Wide, Medium Crafting, and Macro Detail"
                    data-testid={`coverage-atmospheric-${scene.id}`}
                  >
                    <Layers className="mr-1 h-3 w-3 text-primary" />
                    Atmospheric (3)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={Boolean(busy)}
                    onClick={() => void run(`coverage-action-${scene.id}`, async () => {
                      const after = await act("POST", `/api/media-studio/scenes/${scene.id}/coverage`, { template: "action" });
                      const updatedScene = after?.scenes?.find((s) => s.id === scene.id);
                      const newest = updatedScene?.shots[updatedScene.shots.length - 1];
                      if (newest) setSelectedShotId(newest.id);
                    })}
                    title="Adds 3 shots: Dynamic Tracking Wide, Low-Angle Hero, and Fast Impact Close-Up"
                    data-testid={`coverage-action-${scene.id}`}
                  >
                    <Layers className="mr-1 h-3 w-3 text-primary" />
                    Action (3)
                  </Button>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {filtering && shown === 0 && (
        <div className="grid justify-items-start gap-2 rounded-lg border border-dashed border-border p-4 text-xs" data-testid="shots-no-match">
          <p className="text-sm font-medium text-foreground">No shots match</p>
          <p className="text-muted-foreground">Try fewer or different words, or show every shot.</p>
          <Button type="button" size="sm" variant="outline" onClick={clearFilters}>Show all shots</Button>
        </div>
      )}
    </div>
  );
}

const TAKE_STATUS: Record<TakeView["status"], string> = {
  pending_approval: "Waiting for approval in the Decision Inbox",
  queued: "Queued with Seedance",
  rendering: "Rendering with Seedance",
  ready_for_review: "Ready for review",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
  simulated: "Simulation: no video was rendered",
};

/** A take's status in words, naming where a render in flight is running. */
const statusText = (take: TakeView) => (take.status === "queued" || take.status === "rendering"
  ? `${take.status === "queued" ? "Queued" : "Rendering"} ${take.provider === "comfyui" ? "on ComfyUI" : "with Seedance"}`
  : TAKE_STATUS[take.status]);

/**
 * Asking for a take of a saved shot, and the takes it has. A take renders only after
 * it is approved; without a provider it is recorded as a simulation.
 */
function TakeControls({ production, scene, shot, draft, dirty, act, busy, run }: {
  production: ProductionView; scene: SceneView; shot: ShotView; draft?: Draft; dirty: boolean; act: ProductionAct; busy: string | null; run: Run;
}) {
  const [endOnNext, setEndOnNext] = useState(false);
  const [generateAudio, setGenerateAudio] = useState(true);
  const effectiveRefId = draft?.referenceKeyframeId ?? shot.referenceKeyframeId;
  const reference = scene.plotPoints.flatMap((p) => p.keyframes)
    .find((k) => k.id === effectiveRefId && k.imageUrl && (k.status === "ready" || k.status === "approved"));
  const effectivePlotPoint = scene.plotPoints.find((p) =>
    p.id === shot.plotPointId ||
    (effectiveRefId && p.keyframes.some((k) => k.id === effectiveRefId))
  ) ?? scene.plotPoints[scene.shots.findIndex((s) => s.id === shot.id)];
  const at = effectivePlotPoint ? scene.plotPoints.findIndex((p) => p.id === effectivePlotPoint.id) : -1;
  const next = at >= 0 ? scene.plotPoints[at + 1] : undefined;
  const nextKeyframe = next?.keyframes.find((k) => k.status === "approved" && k.imageUrl);
  const comfy = production.video.engine === "comfyui";
  const workflow = production.video.workflow;
  // A ComfyUI workflow starts from, or ends on, a keyframe only when it has an image input for it.
  const canEndOnNext = Boolean(reference && nextKeyframe && (!comfy || workflow?.mapping.endImage));

  let endOnNextReason: string | null = null;
  if (!reference) {
    endOnNextReason = "Link a starting keyframe (Frame 0) to this shot first";
  } else if (!next) {
    endOnNextReason = "This is the final plot point in the scene";
  } else if (!nextKeyframe) {
    endOnNextReason = `Approve a keyframe for "${next.title}" first`;
  }

  const blocked = dirty
    ? "Save the shot before asking for a take."
    : comfy && !workflow
      ? "Import a ComfyUI workflow in Story first."
      : !comfy && (shot.durationSeconds < SEEDANCE_DURATION.min || shot.durationSeconds > SEEDANCE_DURATION.max)
        ? `Seedance renders ${SEEDANCE_DURATION.min} to ${SEEDANCE_DURATION.max} seconds; this shot is ${shot.durationSeconds}.`
        : !shot.prompt.trim() && !shot.action.trim()
          ? "Describe what the shot shows first."
          : comfy && workflow?.mapping.startImage && !reference
            ? `The workflow "${workflow.name}" starts from an image: approve this shot's keyframe first.`
            : null;
  const estimate = Math.ceil(shot.durationSeconds * production.video.centsPerSecond);
  // Both offers below quote money, so both are worked out from the production's own
  // rate. A figure typed into the label drifts the moment the rate changes, and reads
  // as this shot's number while belonging to no shot at all.
  const RAISE_CAP_BY_CENTS = 1000;
  const SHORTEN_TO_SECONDS = 5;
  const shortenedEstimate = Math.ceil(SHORTEN_TO_SECONDS * production.video.centsPerSecond);
  const estimateText = !production.video.configured
    ? `${comfy ? "ComfyUI" : "fal.ai"} is not set up here, so a take is recorded as a simulation: no video and no charge.`
    : comfy
      ? `Renders on ComfyUI with "${workflow?.name ?? "no workflow yet"}"${estimate > 0 ? `, about ${formatCents(estimate)}` : ", with no provider charge"}${reference && workflow?.mapping.startImage ? ", starting from the shot's keyframe" : ""}. Nothing renders until the take is approved.`
      : `About ${formatCents(estimate)} at ${production.video.resolution}${reference ? ", starting from the shot's keyframe" : ", from text alone"}. Nothing renders until the take is approved.`;
  const key = `take-${shot.id}`;
  const notify = useStudioToast();
  const shotNumber = scene.shots.findIndex((s) => s.id === shot.id) + 1;
  const spentCents = shot.takes.reduce((cents, take) => cents + (isSpent(take) ? take.costCents : 0), 0);
  const waitingCents = shot.takes.reduce((cents, take) => cents + (isWaiting(take) ? take.costCents : 0), 0);
  const committedCents = production.spendCents;
  const remainingCents = Math.max(0, production.budgetLimitCents - committedCents);
  const exceedsBudget = production.video.configured && (committedCents + estimate > production.budgetLimitCents);

  return (
    <div className="grid gap-1.5 border-t border-border/60 pt-2" data-testid={`take-controls-${shot.id}`}>
      <p className="text-[11px] font-medium text-foreground">Takes</p>
      <p className="text-[11px] text-muted-foreground" data-testid={`take-estimate-${shot.id}`}>
        {estimateText}
      </p>
      {(spentCents > 0 || waitingCents > 0) && (
        <p className="text-[11px] tabular-nums text-muted-foreground" data-testid={`shot-spend-${shot.id}`}>
          {formatCents(spentCents)} spent on this shot{waitingCents > 0 ? `; ${formatCents(waitingCents)} more if the take waiting for approval is approved` : ""}.
        </p>
      )}
      {exceedsBudget && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300 space-y-1">
          <p className="font-semibold flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            Exceeds Remaining Budget
          </p>
          <p>
            A {shot.durationSeconds}s take costs ~{formatCents(estimate)}, but only {formatCents(remainingCents)} remains of the {formatCents(production.budgetLimitCents)} cap.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 text-[10px] bg-background/80"
              onClick={() => void run(key, () => act("PATCH", `/api/media-studio/productions/${production.id}`, { budgetLimitCents: production.budgetLimitCents + RAISE_CAP_BY_CENTS }))}
            >
              + Raise Budget Cap by {formatCents(RAISE_CAP_BY_CENTS)}
            </Button>
            {shot.durationSeconds > SHORTEN_TO_SECONDS && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 text-[10px] bg-background/80"
                onClick={() => void act("PATCH", `/api/media-studio/shots/${shot.id}`, { durationSeconds: SHORTEN_TO_SECONDS })}
              >
                Shorten Shot to {SHORTEN_TO_SECONDS}s (~{formatCents(shortenedEstimate)})
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <label
            className={cn("flex items-center gap-1.5 text-[11px]", !canEndOnNext ? "text-muted-foreground/80 cursor-not-allowed" : "text-foreground cursor-pointer")}
            htmlFor={`end-on-next-${shot.id}`}
            title={endOnNextReason ?? undefined}
          >
            <input
              id={`end-on-next-${shot.id}`}
              type="checkbox"
              checked={endOnNext && canEndOnNext}
              disabled={!canEndOnNext}
              onChange={(e) => setEndOnNext(e.target.checked)}
            />
            End on the next plot point's keyframe
          </label>
          {endOnNextReason && (
            <span className="text-[10px] text-muted-foreground italic font-normal">
              ({endOnNextReason})
            </span>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-[11px]" htmlFor={`generate-audio-${shot.id}`}>
          <input id={`generate-audio-${shot.id}`} type="checkbox" checked={generateAudio} onChange={(e) => setGenerateAudio(e.target.checked)} />
          Generate audio (speech & sound)
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button" size="sm" variant="outline" className="h-7"
          disabled={Boolean(blocked) || busy === key}
          data-tutorial-title="Ask for a Take"
          data-tutorial-description="Dispatches video generation for this shot to the configured video model. For Image-to-Video workflows like Wan 2.1, an approved keyframe from the Storyboard is required as the starting frame."
          data-tutorial-action="Queues a video take for Director review and approval in the Decision Inbox."
          data-tutorial-hint={blocked?.includes("keyframe first") ? "Keyframe required: Approve keyframe in Storyboard or switch engine to Seedance." : "Takes wait for approval in the Decision Inbox before anything renders."}
          onClick={() => void run(key, async () => {
            await act("POST", `/api/media-studio/shots/${shot.id}/takes`, {
              endOnNextKeyframe: endOnNext && canEndOnNext,
              ...(generateAudio ? {} : { generateAudio: false }),
            });
            notify(`Asked for a take of ${scene.sceneKey} shot ${shotNumber}`, production.video.configured
              ? "It waits for approval in the Decision Inbox before anything renders."
              : "Recorded as a simulation: no video and no charge.");
          })}
        >
          Ask for a take · {shot.durationSeconds}s · {production.video.configured ? `~${formatCents(estimate)}` : "Simulation"}
        </Button>
        {blocked && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{blocked}</span>
            {blocked.includes("keyframe first") && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-5 px-1.5 text-[10px]"
                  onClick={() => openInMediaStudio({ productionId: production.id, tab: "storyboard", sceneId: scene.id, shotId: shot.id })}
                >
                  Open Storyboard →
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-[10px]"
                  onClick={() => void act("PUT", `/api/media-studio/productions/${production.id}/video-engine`, { engine: "fal" })}
                >
                  Switch to Seedance
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {shot.takes.length > 0 && (
        <ol className="grid gap-1" data-testid={`take-list-${shot.id}`}>
          {shot.takes.map((take) => (
            <li key={take.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              <span className="font-medium text-foreground">Take {take.takeNumber}</span>
              {take.status === "pending_approval" && <a href="/assistant/workbench" target="_blank" rel="noreferrer" className="text-primary underline">Open approval inbox</a>}
              <span className={cn("inline-flex items-center gap-1", take.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                <StatusIcon status={take.status} />{statusText(take)}
              </span>
              {take.mode === "live" && take.costCents > 0 && <span className="tabular-nums text-muted-foreground">{formatCents(take.costCents)}</span>}
              {take.videoUrl && <a href={take.videoUrl} target="_blank" rel="noreferrer" className="text-primary underline">Watch</a>}
              {(take.status === "rejected" || take.status === "failed") && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-5 px-2 text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                  disabled={busy === `reshoot-${take.id}`}
                  onClick={() => void run(`reshoot-${take.id}`, async () => {
                    await act("POST", `/api/media-studio/takes/${take.id}/reshoot`);
                    notify(`Re-shoot requested for Take ${take.takeNumber}`, "A new take has been queued for approval.");
                  })}
                  data-testid={`reshoot-take-${take.id}`}
                >
                  <RefreshCw className="mr-1 h-2.5 w-2.5" />
                  Re-shoot
                </Button>
              )}
              {take.error && (
                <div className="basis-full mt-1.5" data-testid={`take-error-${take.id}`}>
                  <StudioErrorAlert error={take.error} className="p-2 text-[11px]" />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

interface EditorProps {
  onDiscuss?: MediaDiscuss;
  production: ProductionView;
  scene: SceneView;
  shot: ShotView;
  index: number;
  act: ProductionAct;
  busy: string | null;
  run: Run;
}

function ShotEditor({ production, scene, shot, index, act, busy, run, onDiscuss }: EditorProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const playable = shot.takes.filter(take => take.videoUrl);
  const preview = playable.find(take => take.id === previewId) ?? playable[playable.length - 1];
  const compare = playable.find(take => take.id === compareId && take.id !== preview?.id);
  const savedJson = JSON.stringify(draftOf(shot));
  const [draft, setDraft] = useState<Draft>(() => draftOf(shot));
  // Take the server's version when it changes, not on every unrelated update.
  useEffect(() => setDraft(JSON.parse(savedJson)), [savedJson]);

  const dirty = JSON.stringify(draft) !== savedJson;
  const compiled = compileShot({ aspectRatio: production.aspectRatio, scene, shot: draft, characters: production.characters, style: production.style });
  const reference = scene.plotPoints.flatMap((p) => p.keyframes).find((k) => k.id === (draft.referenceKeyframeId ?? shot.referenceKeyframeId));
  const currentPlotPoint = scene.plotPoints.find((p) =>
    p.id === shot.plotPointId ||
    ((draft.referenceKeyframeId ?? shot.referenceKeyframeId) && p.keyframes.some((k) => k.id === (draft.referenceKeyframeId ?? shot.referenceKeyframeId)))
  ) ?? scene.plotPoints[index];
  const field = (name: string) => `shot-${shot.id}-${name}`;
  const set = <K extends keyof Draft>(name: K, value: Draft[K]) => setDraft((current) => ({ ...current, [name]: value }));
  const setLine = (at: number, patch: Partial<DialogueLine>) => set("dialogue", draft.dialogue.map((line, i) => (i === at ? { ...line, ...patch } : line)));
  const key = (what: string) => `${what}-${shot.id}`;
  const notify = useStudioToast();
  const status = shotStatus(shot);

  const availableKeyframes = scene.plotPoints.flatMap((p) =>
    p.keyframes.filter((k) => k.imageUrl && (k.status === "ready" || k.status === "approved")).map((k) => ({
      keyframe: k,
      plotPointTitle: p.title,
    }))
  );
  const latestTake = shot.takes[shot.takes.length - 1];

  const save = () => run(key("save"), () => act("PATCH", `/api/media-studio/shots/${shot.id}`, {
    prompt: draft.prompt,
    negativePrompt: draft.negativePrompt?.trim() || null,
    framing: draft.framing?.trim() || null,
    lens: draft.lens?.trim() || null,
    cameraMotion: draft.cameraMotion?.trim() || null,
    action: draft.action,
    durationSeconds: draft.durationSeconds,
    transition: draft.transition,
    referenceKeyframeId: draft.referenceKeyframeId ?? null,
    dialogue: draft.dialogue
      .filter((line) => line.speaker.trim() && line.line.trim())
      .map((line) => ({ speaker: line.speaker.trim(), line: line.line.trim(), ...(line.delivery?.trim() ? { delivery: line.delivery.trim() } : {}) })),
  }));

  const reorder = (to: number) => {
    if (to < 0 || to >= scene.shots.length) return;
    const ids = moveItem(scene.shots.map((s) => s.id), index, to);
    void run(key("order"), () => act("PUT", `/api/media-studio/scenes/${scene.id}/shots/order`, { ids }));
  };

  return (
    <article className="grid gap-3 rounded-lg border border-border bg-card p-3" data-testid={`shot-editor-${shot.id}`}>
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Shot {index + 1}</p>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground" data-testid={`shot-status-${shot.id}`}>
            <StatusIcon status={status} />{STATUS_LABEL[status]}
          </span>
          {(latestTake?.status === "rejected" || latestTake?.status === "failed") && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 text-[11px] border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
              disabled={busy === `reshoot-${latestTake.id}`}
              onClick={() => void run(`reshoot-${latestTake.id}`, async () => {
                await act("POST", `/api/media-studio/takes/${latestTake.id}/reshoot`);
                notify(`Re-shoot requested for Shot ${index + 1}`, "A new take has been queued for approval.");
              })}
              data-testid={`header-reshoot-${shot.id}`}
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              Re-shoot Shot
            </Button>
          )}
        </div>
        <div className="flex items-center">
          <DiscussButton onDiscuss={onDiscuss} target={{ sceneId: scene.id, sceneKey: scene.sceneKey, kind: "shot", id: shot.id, label: `${scene.sceneKey} shot ${index + 1}` }} />
          <Button
            type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Duplicate shot ${index + 1}`}
            title={dirty ? "Save the shot before duplicating it." : "Duplicate: a copy right after this shot, with its direction and dialogue and no takes"}
            disabled={dirty || busy === key("duplicate")}
            onClick={() => void run(key("duplicate"), async () => {
              await act("POST", `/api/media-studio/shots/${shot.id}/duplicate`);
              notify(`Duplicated shot ${index + 1}`, `The copy is shot ${index + 2}, with the same direction and dialogue and no takes.`);
            })}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move shot ${index + 1} up`} disabled={index === 0} onClick={() => reorder(index - 1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move shot ${index + 1} down`} disabled={index === scene.shots.length - 1} onClick={() => reorder(index + 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
          <Button
            type="button" size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Remove shot ${index + 1}`}
            disabled={busy === key("remove")}
            title={`Delete Shot ${index + 1}${shot.takes.length > 0 ? ` and its ${shot.takes.length} take(s)` : ""}`}
            onClick={() => {
              // A shot with no takes has nothing to lose, so it goes without asking.
              if (shot.takes.length > 0) { setConfirmRemove(true); return; }
              void run(key("remove"), () => act("DELETE", `/api/media-studio/shots/${shot.id}`));
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <h4 className="text-xs font-medium">Preview</h4>
          <div className={cn("grid gap-2", compare && "grid-cols-2")}>
            {preview ? <video key={preview.id} src={withAssetOrg(preview.videoUrl!)} controls preload="metadata" aria-label={`Preview take ${preview.takeNumber}`} className="aspect-video w-full rounded-lg bg-black" /> /* theme-lint-ignore */
              : reference?.imageUrl ? <img src={withAssetOrg(reference.imageUrl)} alt={`Reference keyframe for shot ${index + 1}`} className="aspect-video w-full rounded-lg object-contain bg-muted" />
              : <p className="flex aspect-video items-center justify-center rounded-lg bg-muted p-4 text-xs text-muted-foreground">No rendered take or starting keyframe yet.</p>}
            {compare && <video key={compare.id} src={withAssetOrg(compare.videoUrl!)} controls preload="metadata" aria-label={`Compare take ${compare.takeNumber}`} className="aspect-video w-full rounded-lg bg-black" /> /* theme-lint-ignore */}
          </div>
          {playable.length > 0 && <div className="flex flex-wrap gap-2 text-xs">
            <label>Preview take <select value={preview?.id ?? ""} onChange={event => setPreviewId(Number(event.target.value))} className="rounded border bg-background p-1">{playable.map(take => <option key={take.id} value={take.id}>Take {take.takeNumber}</option>)}</select></label>
            <label>Compare with <select value={compare?.id ?? ""} onChange={event => setCompareId(event.target.value ? Number(event.target.value) : null)} className="rounded border bg-background p-1"><option value="">None</option>{playable.filter(take => take.id !== preview?.id).map(take => <option key={take.id} value={take.id}>Take {take.takeNumber}</option>)}</select></label>
          </div>}
          <TakeControls production={production} scene={scene} shot={shot} draft={draft} dirty={dirty} act={act} busy={busy} run={run} />
          <details className="rounded-lg border p-3 text-xs"><summary className="cursor-pointer font-medium">Inherited look and output</summary><p className="mt-2">{production.style || "No production look set"}</p><p>{production.aspectRatio} · {production.video.resolution}</p><p>Starting reference: {reference ? `Keyframe ${reference.id}` : "None"}</p></details>
        </div>
        <div className="grid content-start gap-2">
          {/* Starting Keyframe Anchor Section */}
          <div className="rounded-lg border border-border/80 bg-muted/20 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Starting Keyframe (Frame 0)
              </span>
              {draft.referenceKeyframeId && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] text-muted-foreground hover:text-destructive px-1.5"
                  onClick={() => set("referenceKeyframeId", null)}
                >
                  Detach keyframe
                </Button>
              )}
            </div>

            {reference?.imageUrl ? (
              <div className="flex items-center gap-2.5">
                <img
                  src={withAssetOrg(reference.imageUrl)}
                  alt="Starting keyframe"
                  className="h-16 w-28 shrink-0 rounded border border-border object-cover bg-muted"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-xs font-medium truncate text-foreground">
                    Keyframe {reference.id} ({reference.status === "approved" ? "Approved" : "Ready"})
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    Shot renders with <strong>Image-to-Video</strong> anchored to this frame.
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p className="text-[11px] font-medium text-foreground">No starting keyframe linked</p>
                <p className="text-[10px]">Shot renders from <strong>text alone</strong> without a visual anchor.</p>
              </div>
            )}

            {availableKeyframes.length > 0 && (
              <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                <span className="text-[10px] text-muted-foreground shrink-0">Link keyframe:</span>
                <select
                  value={draft.referenceKeyframeId ?? ""}
                  onChange={(e) => {
                    const kfId = e.target.value ? Number(e.target.value) : null;
                    if (!kfId) {
                      set("referenceKeyframeId", null);
                      return;
                    }
                    const targetKf = scene.plotPoints.flatMap((p) => p.keyframes).find((k) => k.id === kfId);
                    const targetPt = scene.plotPoints.find((p) => p.keyframes.some((k) => k.id === kfId));
                    setDraft((prev) => ({
                      ...prev,
                      referenceKeyframeId: kfId,
                      prompt: !prev.prompt.trim() && targetKf?.prompt ? targetKf.prompt : prev.prompt,
                      action: !prev.action.trim() && (targetPt?.beat || targetPt?.title) ? (targetPt.beat.trim() || targetPt.title) : prev.action,
                    }));
                    if (!draft.prompt.trim() || !draft.action.trim()) {
                      notify("Storyboard synced", `Autofilled shot details from Keyframe ${kfId}.`);
                    }
                  }}
                  className="h-6 flex-1 rounded border border-input bg-background px-2 text-[11px]"
                  data-testid={`select-keyframe-${shot.id}`}
                >
                  <option value="">None (render from text alone)</option>
                  {availableKeyframes.map(({ keyframe: kf, plotPointTitle }) => (
                    <option key={kf.id} value={kf.id}>
                      {kf.status === "approved" ? "✓ Approved · " : ""}Keyframe {kf.id} ({plotPointTitle})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {currentPlotPoint && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 border border-border/60">
              <span className="text-[11px] text-muted-foreground truncate">
                Storyboard beat: <strong className="text-foreground">{currentPlotPoint.title}</strong>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 text-[11px] shrink-0 border-primary/40 text-primary hover:bg-primary/10"
                onClick={() => {
                  const targetKf = reference ?? currentPlotPoint.keyframes.find((k) => k.status === "approved") ?? currentPlotPoint.keyframes[0];
                  setDraft((prev) => ({
                    ...prev,
                    referenceKeyframeId: prev.referenceKeyframeId ?? (targetKf?.id ?? null),
                    prompt: targetKf?.prompt ?? (currentPlotPoint.beat.trim() || currentPlotPoint.title),
                    action: currentPlotPoint.beat.trim() || currentPlotPoint.title,
                  }));
                  notify("Storyboard beat applied", `Copied visual direction and action from "${currentPlotPoint.title}".`);
                }}
                title="Populate 'What the shot shows' and 'Action' from this scene's Storyboard"
                data-testid={`autofill-storyboard-${shot.id}`}
              >
                <Sparkles className="mr-1 h-3 w-3" />
                Pull from Storyboard
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] font-medium" htmlFor={field("prompt")}>
              What the shot shows
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px] border-primary/40 text-primary hover:bg-primary/10"
              disabled={busy === key("orchestrate")}
              onClick={() => void run(key("orchestrate"), async () => {
                const res = await act("POST", `/api/media-studio/shots/${shot.id}/orchestrate`, {
                  action: draft.action || draft.prompt,
                  framing: draft.framing,
                  lens: draft.lens,
                  cameraMotion: draft.cameraMotion,
                  durationSeconds: draft.durationSeconds,
                });
                const updatedShot = res?.scenes?.flatMap((s: SceneView) => s.shots).find((s: ShotView) => s.id === shot.id);
                if (updatedShot) {
                  setDraft((prev) => ({
                    ...prev,
                    prompt: updatedShot.prompt,
                    negativePrompt: updatedShot.negativePrompt ?? prev.negativePrompt,
                    framing: updatedShot.framing ?? prev.framing,
                    lens: updatedShot.lens ?? prev.lens,
                    cameraMotion: updatedShot.cameraMotion ?? prev.cameraMotion,
                  }));
                  notify("Shot Auto-Orchestrated", "Synthesized prompt, optics, and negative prompt from scene & cast.");
                }
              })}
              title="Automatically synthesize prompt from scene location, lighting rig, and character phenotypes"
              data-testid={`auto-orchestrate-${shot.id}`}
            >
              <Wand2 className="mr-1 h-3 w-3 text-primary" />
              Auto-Orchestrate
            </Button>
          </div>
          <Textarea id={field("prompt")} rows={3} value={draft.prompt} onChange={(e) => set("prompt", e.target.value)} className="text-xs" />

          {/* Quick Prompt Modifier Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1" data-testid={`prompt-chips-${shot.id}`}>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
              Style Chips:
            </span>
            {[
              "Golden hour rim light",
              "Low-angle hero perspective",
              "Slow push-in on subject",
              "35mm prime shallow depth of field",
              "Warm cinematic chiaroscuro",
              "Fine flour dust motes in sunbeams",
              "Handheld subtle natural drift",
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  const cleaned = chip.trim();
                  if (!draft.prompt.includes(cleaned)) {
                    set("prompt", draft.prompt.trim() ? `${draft.prompt.trim()}, ${cleaned}` : cleaned);
                  }
                }}
                className="shrink-0 rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-foreground transition-colors select-none"
              >
                + {chip}
              </button>
            ))}
          </div>
          <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("action")}>
            Action
            <Textarea id={field("action")} rows={2} value={draft.action} onChange={(e) => set("action", e.target.value)} className="text-xs" />
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("framing")}>
              Framing
              <Input id={field("framing")} list="cinematic-framing-options" value={draft.framing ?? ""} placeholder="close-up" onChange={(e) => set("framing", e.target.value)} className="h-7 text-xs" />
            </label>
            <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("lens")}>
              Lens
              <Input id={field("lens")} list="cinematic-lens-options" value={draft.lens ?? ""} placeholder="35mm" onChange={(e) => set("lens", e.target.value)} className="h-7 text-xs" />
            </label>
            <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("camera")}>
              Camera movement
              <Input id={field("camera")} list="cinematic-motion-options" value={draft.cameraMotion ?? ""} placeholder="slow push-in" onChange={(e) => set("cameraMotion", e.target.value)} className="h-7 text-xs" />
            </label>
            <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("duration")}>
              Seconds
              <Input id={field("duration")} type="number" min={1} max={60} value={draft.durationSeconds} onChange={(e) => set("durationSeconds", Math.max(1, Math.min(60, Number(e.target.value) || 1)))} className="h-7 text-xs tabular-nums" />
            </label>
            <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("transition")}>
              Into the next shot
              <select id={field("transition")} value={draft.transition} onChange={(e) => set("transition", e.target.value as Draft["transition"])} className="h-7 rounded-md border border-input bg-background px-2 text-xs">
                {SHOT_TRANSITIONS.map((t) => <option key={t} value={t}>{TRANSITION_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("avoid")}>
              Avoid
              <Input id={field("avoid")} value={draft.negativePrompt ?? ""} placeholder="text overlays" onChange={(e) => set("negativePrompt", e.target.value)} className="h-7 text-xs" />
            </label>
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="text-[11px] font-medium">Dialogue</legend>
            {draft.dialogue.length === 0 && <p className="text-[11px] text-muted-foreground">No lines. The shot is rendered without speech.</p>}
            {draft.dialogue.map((line, at) => (
              <div key={at} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,6rem)_auto] items-end gap-1.5" data-testid={`dialogue-line-${shot.id}-${at}`}>
                <label className="grid gap-0.5 text-[10px] text-muted-foreground" htmlFor={field(`speaker-${at}`)}>
                  Speaker
                  <Input id={field(`speaker-${at}`)} list={`media-speakers-${production.id}`} value={line.speaker} onChange={(e) => setLine(at, { speaker: e.target.value })} className="h-7 text-xs" />
                </label>
                <label className="grid gap-0.5 text-[10px] text-muted-foreground" htmlFor={field(`line-${at}`)}>
                  Line
                  <Input id={field(`line-${at}`)} value={line.line} onChange={(e) => setLine(at, { line: e.target.value })} className="h-7 text-xs" />
                </label>
                <label className="grid gap-0.5 text-[10px] text-muted-foreground" htmlFor={field(`delivery-${at}`)}>
                  Delivery
                  <Input id={field(`delivery-${at}`)} value={line.delivery ?? ""} placeholder="whispering" onChange={(e) => setLine(at, { delivery: e.target.value })} className="h-7 text-xs" />
                </label>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove line ${at + 1}`} onClick={() => set("dialogue", draft.dialogue.filter((_, i) => i !== at))}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" size="sm" variant="ghost" className="h-7" disabled={draft.dialogue.length >= 30} onClick={() => set("dialogue", [...draft.dialogue, { speaker: "", line: "" }])}>
                <Plus className="mr-1 h-3.5 w-3.5" />Add line
              </Button>
            </div>
          </fieldset>

          <datalist id="cinematic-framing-options">
            <option value="extreme_close_up">Extreme Close-Up (ECU)</option>
            <option value="close_up">Close-Up (CU)</option>
            <option value="medium_close_up">Medium Close-Up (MCU)</option>
            <option value="medium_shot">Medium Shot (MS)</option>
            <option value="medium_long_shot">Medium Long Shot (Cowboy)</option>
            <option value="full_shot">Full Shot (FS)</option>
            <option value="establishing_wide">Establishing Wide (EWS)</option>
            <option value="macro_detail">Macro Detail</option>
            <option value="intimate_dirty_ots">Over-The-Shoulder (OTS)</option>
            <option value="neo_noir_dutch_choker">Dutch Angle Choker</option>
          </datalist>
          <datalist id="cinematic-lens-options">
            <option value="18mm">18mm Ultra-Wide Architectural</option>
            <option value="24mm">24mm Wide Environmental</option>
            <option value="35mm">35mm Moderate Wide Street</option>
            <option value="50mm">50mm Standard Human Eye</option>
            <option value="85mm">85mm Telephoto Portrait</option>
            <option value="135mm">135mm Tight Compression</option>
          </datalist>
          <datalist id="cinematic-motion-options">
            <option value="static_lockoff">Static Lock-Off</option>
            <option value="slow_push_in">Slow Push-In</option>
            <option value="slow_pull_out">Slow Pull-Out</option>
            <option value="slow_lateral_truck">Slow Lateral Truck</option>
            <option value="handheld_subtle_drift">Handheld Subtle Drift</option>
            <option value="orbital_arc_clockwise">Orbital Arc (Clockwise)</option>
            <option value="low_angle_pedestal_up">Low Angle Pedestal Up</option>
          </datalist>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" disabled={!dirty || busy === key("save")} onClick={() => void save()}>Save shot</Button>
            {dirty && <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(JSON.parse(savedJson))}>Discard changes</Button>}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-primary/30 text-xs text-primary hover:bg-primary/10"
              disabled={Boolean(busy)}
              onClick={() => void run(key("orchestrate"), async () => {
                await orchestrateShot(shot.id);
              })}
              title="Enrich with unified cinematic abstraction layer (Character, Location, Prop, Lighting, Camera)"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Cinematic Orchestrate
            </Button>
          </div>
        </div>

        <div className="grid content-start gap-1.5 lg:col-span-2">
          <details><summary className="cursor-pointer text-xs font-medium">Review generation request</summary>
          <p className="text-[11px] font-medium text-foreground">What the video model will be sent</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-foreground" data-testid={`compiled-prompt-${shot.id}`}>{compiled.prompt || "(nothing yet)"}</pre>
          <p className="text-[11px] tabular-nums text-muted-foreground">{compiled.durationSeconds} s · {compiled.aspectRatio} · with audio</p>
          </details>
          {compiled.warnings.length > 0 && (
            <ul role="status" className="grid gap-0.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid={`shot-warnings-${shot.id}`}>
              {compiled.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </div>
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shot {index + 1}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {shot.takes.length} rendered take{shot.takes.length === 1 ? "" : "s"} go with it, and what they cost to render is not refunded. Nothing else in the scene changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the shot</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run(key("remove"), () => act("DELETE", `/api/media-studio/shots/${shot.id}`))}>
              Delete shot and takes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
