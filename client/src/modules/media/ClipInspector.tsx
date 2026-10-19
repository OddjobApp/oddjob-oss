import React, { useState } from "react";
import { AlertCircle, Check, Clapperboard, Cpu, Film, Loader2, Scissors, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCents, type ProductionView, type SceneView, type ShotView, shownKeyframe } from "@shared/media-studio";
import { useProductionAct } from "./api";
import { useStudioToast } from "./feedback";
import { openInMediaStudio } from "./navigation";
import { shotStatus } from "./status";
import { StatusIcon } from "./StatusIcon";
import type { StudioSelection } from "./navigation";

/**
 * The clip under the playhead, inspected beside the chat.
 *
 * Generative editing turns on one question the timeline cannot answer by itself — "make
 * this shot again, with one thing changed" — and until now that meant leaving the film
 * screen for the Shots tab. The action that costs money says what it costs on the
 * button, because in this tool a click can be a bill and a half-hour wait.
 */

const seconds = (n: number) => `${Number(n.toFixed(2))}s`;

export function ClipInspector({ view, selection }: { view: ProductionView; selection: StudioSelection | null }) {
  const act = useProductionAct(view.id);
  const notify = useStudioToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scene: SceneView | undefined = selection
    ? view.scenes.find((s) => s.id === selection.sceneId)
    : undefined;
  const shot: ShotView | undefined = scene && selection?.shotId != null
    ? scene.shots.find((s) => s.id === selection.shotId)
    : undefined;

  if (!scene || !shot) {
    return (
      <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border p-4 text-center" data-testid="clip-inspector-empty">
        <Clapperboard className="h-6 w-6 text-muted-foreground/60" aria-hidden />
        <p className="text-sm font-medium text-foreground">No clip selected</p>
        <p className="text-xs text-muted-foreground">
          Pick a clip on the timeline, or move the playhead over one, and it is inspected here.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => openInMediaStudio({ productionId: view.id, tab: "film" })}>
          Open the film
        </Button>
      </div>
    );
  }

  const shotNumber = scene.shots.findIndex((s) => s.id === shot.id) + 1;
  const status = shotStatus(shot);
  const approved = shot.takes.find((take) => take.status === "approved");
  const latest = shot.takes[shot.takes.length - 1];
  const estimateCents = Math.ceil(shot.durationSeconds * view.video.centsPerSecond);
  const price = view.video.configured ? `~${formatCents(estimateCents)}` : "Simulation";
  const trimmed = shot.trimInSeconds != null || shot.trimOutSeconds != null;
  const held = (shot.holdDurationSeconds ?? 0) > 0;

  // ComfyUI Image-to-Video verification
  const comfy = view.video.engine === "comfyui";
  const workflow = view.video.workflow;
  const requiresKeyframe = comfy && Boolean(workflow?.mapping.startImage);

  const plotPoint = shot.plotPointId != null
    ? scene.plotPoints.find((p) => p.id === shot.plotPointId)
    : undefined;
  const allSceneKeyframes = scene.plotPoints.flatMap((p) => p.keyframes);
  const refKeyframe = shot.referenceKeyframeId != null
    ? allSceneKeyframes.find((k) => k.id === shot.referenceKeyframeId)
    : (plotPoint ? shownKeyframe(plotPoint) : allSceneKeyframes.find((k) => k.imageUrl));

  const isKeyframeApproved = refKeyframe?.status === "approved" || refKeyframe?.status === "ready";
  const isKeyframeBlocked = requiresKeyframe && (!refKeyframe || !isKeyframeApproved);
  const isKeyframeError = Boolean(error && error.toLowerCase().includes("keyframe first"));

  const run = async (key: string, work: () => Promise<void>, done: [string, string]) => {
    setBusy(key);
    setError(null);
    try {
      await work();
      notify(done[0], done[1]);
    } catch (err) {
      setError((err as Error)?.message ?? "That could not be done.");
    } finally {
      setBusy(null);
    }
  };

  const handleApproveAndLinkKeyframe = async (keyframeId: number) => {
    await run("approve-keyframe", async () => {
      await act("POST", `/api/media-studio/keyframes/${keyframeId}/approve`);
      if (shot.referenceKeyframeId !== keyframeId) {
        await act("PATCH", `/api/media-studio/shots/${shot.id}`, { referenceKeyframeId: keyframeId });
      }
    }, [`Approved keyframe for ${scene.sceneKey} shot ${shotNumber}`, "Keyframe is now approved and set as starting frame."]);
  };

  const handleSwitchToSeedance = async () => {
    await run("switch-engine", async () => {
      await act("PUT", `/api/media-studio/productions/${view.id}/video-engine`, { engine: "fal" });
    }, ["Video engine switched to Seedance", "Seedance renders text-to-video directly without requiring an image keyframe."]);
  };

  const handleOpenStoryboard = () => {
    openInMediaStudio({ productionId: view.id, tab: "storyboard", sceneId: scene.id, shotId: shot.id });
  };

  return (
    <div className="grid gap-2.5" data-testid="clip-inspector">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">Shot {shotNumber}</p>
          <p className="truncate text-[11px] text-muted-foreground">{scene.sceneKey} · {scene.title}</p>
        </div>
        <Badge variant="outline" className="shrink-0 gap-1 px-1.5 py-0 text-[10px]">
          <StatusIcon status={status} className="h-3 w-3" />
          {shot.takes.length ? `${shot.takes.length} take${shot.takes.length === 1 ? "" : "s"}` : "No takes"}
        </Badge>
      </div>

      {shot.prompt && (
        <p className="line-clamp-3 rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground" data-testid="clip-inspector-prompt">
          {shot.prompt}
        </p>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="text-muted-foreground">Length</dt>
        <dd className="text-foreground">
          {seconds(shot.durationSeconds)}
          {trimmed && <span className="text-muted-foreground"> · trimmed {seconds(shot.trimInSeconds ?? 0)}–{seconds(shot.trimOutSeconds ?? shot.durationSeconds)}</span>}
          {held && <span className="text-muted-foreground"> · held {seconds(shot.holdDurationSeconds ?? 0)}</span>}
        </dd>
        <dt className="text-muted-foreground">Transition</dt>
        <dd className="text-foreground">
          {shot.transition.replace(/_/g, " ")}
          {shot.transitionDurationSeconds != null && <span className="text-muted-foreground"> · {seconds(shot.transitionDurationSeconds)}</span>}
        </dd>
        <dt className="text-muted-foreground">Track</dt>
        <dd className="text-foreground">{(shot.track ?? 1) === 2 ? "V2 overlay" : "V1 primary"}</dd>
        {shot.framing && <><dt className="text-muted-foreground">Framing</dt><dd className="truncate text-foreground">{shot.framing}</dd></>}
        {approved && <><dt className="text-muted-foreground">Approved</dt><dd className="text-foreground">Take {approved.takeNumber}</dd></>}
      </dl>

      {/* Interactive Keyframe Guidance & Resolution Box */}
      {(isKeyframeError || isKeyframeBlocked) && (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-foreground space-y-2 animate-in fade-in"
          data-testid="keyframe-resolution-card"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-amber-800 dark:text-amber-300">
                Keyframe Required for Video Render
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Workflow <span className="font-medium text-foreground">"{workflow?.name ?? 'Wan 2.1 Image-to-Video'}"</span> is an Image-to-Video engine that animates from an approved still image.
              </p>
            </div>
          </div>

          <div className="grid gap-1.5 pt-1 border-t border-amber-500/20">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">How to resolve:</p>

            {refKeyframe && refKeyframe.imageUrl ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 justify-start gap-1.5 text-[11px] border-emerald-500/30 bg-background/80 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium"
                disabled={busy !== null}
                onClick={() => void handleApproveAndLinkKeyframe(refKeyframe.id)}
                data-testid="resolve-approve-keyframe-btn"
              >
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                Approve Keyframe ({refKeyframe.status}) & Link to Shot
              </Button>
            ) : null}

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 justify-start gap-1.5 text-[11px] bg-background/80 hover:bg-background"
              onClick={handleOpenStoryboard}
              data-testid="resolve-open-storyboard-btn"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Go to Storyboard to Review & Approve Keyframe →
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 justify-start gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              disabled={busy !== null}
              onClick={() => void handleSwitchToSeedance()}
              data-testid="resolve-switch-engine-btn"
            >
              <Cpu className="h-3.5 w-3.5 text-indigo-400" />
              Switch to Seedance (Text-to-Video, prompt only)
            </Button>
          </div>
        </div>
      )}

      {error && !isKeyframeError && (
        <p role="alert" className="text-[11px] text-destructive">{error}</p>
      )}

      <div className="grid gap-1.5">
        {/* The billable action, with its price on the button. Asking for another take
            never touches the ones already there: rejecting a take is a judgement about
            what it shows, and that belongs in dailies with a defect class. */}
        <Button
          type="button"
          size="sm"
          className="h-8 justify-start gap-1.5"
          disabled={busy !== null}
          data-testid="clip-inspector-take-btn"
          data-tutorial-title="Ask for a Take"
          data-tutorial-description="Dispatches video generation for this shot to the configured video model. For Image-to-Video workflows like Wan 2.1, an approved keyframe from the Storyboard is required as the starting frame."
          data-tutorial-action="Queues a video take for Director review and approval in the Decision Inbox."
          data-tutorial-hint={requiresKeyframe && !isKeyframeApproved ? "Keyframe required: Approve keyframe in Storyboard or switch engine to Seedance." : "Takes wait for approval in the Decision Inbox before anything renders."}
          onClick={() => void run("take", async () => {
            await act("POST", `/api/media-studio/shots/${shot.id}/takes`, {});
          }, [`Asked for a take of ${scene.sceneKey} shot ${shotNumber}`, view.video.configured
            ? "It waits for approval in the Decision Inbox before anything renders."
            : "Recorded as a simulation: no video and no charge."])}
        >
          {busy === "take" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
          {latest ? "Ask for another take" : "Ask for a take"} · {seconds(shot.durationSeconds)} · {price}
        </Button>

        {/* Free, so it reads differently from the billable one above. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn("h-8 justify-start gap-1.5 text-muted-foreground")}
          onClick={() => openInMediaStudio({ productionId: view.id, tab: "shots", sceneId: scene.id, shotId: shot.id })}
          data-testid="clip-inspector-edit-btn"
        >
          <Scissors className="h-3.5 w-3.5" />
          Edit the direction in Shots
        </Button>
      </div>
    </div>
  );
}

export default ClipInspector;
