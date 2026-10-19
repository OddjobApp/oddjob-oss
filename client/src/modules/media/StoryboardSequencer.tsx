import React, { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clapperboard, Download, Loader2, Pencil, Plus, Sparkles, SplitSquareVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCents, shownKeyframe, type PlotPointView, type ProductionView, type SceneView } from "@shared/media-studio";
import { ASPECT_BOX } from "./aspect";
import { type ProductionAct, withAssetOrg } from "./api";
import { openInMediaStudio } from "./navigation";
import { StudioErrorAlert } from "./StudioErrorAlert";
import { DiscussButton, type MediaDiscuss } from "./DiscussButton";
import { VisualContinuityDiffModal } from "./components/VisualContinuityDiffModal";

/**
 * The storyboard: each scene's plot points as slides in order, each with the keyframe
 * it shows. A keyframe renders with Gemini and counts against the budget; the author
 * picks which one a plot point shows, approves it, and makes a shot from the plot point.
 */

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

type Run = (key: string, work: () => Promise<unknown>) => Promise<void>;

export interface StoryboardSequencerProps {
  production: ProductionView;
  act: ProductionAct;
  onExport: () => Promise<void>;
  onDiscuss?: MediaDiscuss;
}

export function StoryboardSequencer({ production, act, onExport, onDiscuss }: StoryboardSequencerProps) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newSceneTitle, setNewSceneTitle] = useState("");
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3" data-testid="storyboard-sequencer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs tabular-nums text-muted-foreground" data-testid="storyboard-spend">
          Spent {formatCents(production.spendCents)} of {formatCents(production.budgetLimitCents)}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!production.scenes.length || busy === "export"}
          onClick={() => void run("export", onExport)}
          data-testid="storyboard-export-powerpoint"
        >
          {busy === "export" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
          Export to PowerPoint
        </Button>
      </div>

      {error ? <StudioErrorAlert error={error} onDismiss={() => setError(null)} /> : null}

      {production.scenes.length === 0 ? (
        <div className="grid justify-items-start gap-3 rounded-lg border border-dashed border-border p-4" data-testid="storyboard-empty">
          <div>
            <p className="text-sm font-medium text-foreground">No scenes to storyboard yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each scene gets a strip of plot points here, and each plot point a keyframe to render and approve. Create your first scene below to get started:
            </p>
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
      ) : (
        production.scenes.map((scene) => <SceneStrip key={scene.id} production={production} scene={scene} act={act} busy={busy} run={run} onDiscuss={onDiscuss} />)
      )}
    </div>
  );
}

function SceneStrip({ production, scene, act, busy, run, onDiscuss }: { production: ProductionView; scene: SceneView; act: ProductionAct; busy: string | null; run: Run; onDiscuss?: MediaDiscuss }) {
  const [title, setTitle] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);

  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= scene.plotPoints.length || from === to) return;
    const ids = moveItem(scene.plotPoints.map((p) => p.id), from, to);
    void run(`order-${scene.id}`, () => act("PUT", `/api/media-studio/scenes/${scene.id}/plot-points/order`, { ids }));
  };

  return (
    <section aria-label={`${scene.sceneKey} ${scene.title}`} className="grid gap-2">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
        <span className="font-mono text-[11px] font-medium text-muted-foreground">{scene.sceneKey}</span>
        {scene.title}
      </h3>

      {scene.plotPoints.length === 0 ? (
        <p className="text-xs text-muted-foreground">No plot points in this scene yet. Add its beats below, one for each moment the camera needs to capture; each gets a keyframe to render and approve.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {scene.plotPoints.map((plotPoint, index) => (
            <li
              key={plotPoint.id}
              draggable
              onDragStart={() => setDragging(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragging !== null) reorder(dragging, index);
                setDragging(null);
              }}
              className={cn(dragging === index && "opacity-60")}
            >
              <PlotPointSlide
                production={production} scene={scene} plotPoint={plotPoint} index={index} count={scene.plotPoints.length}
                act={act} busy={busy} run={run} onMove={(to) => reorder(index, to)} onDiscuss={onDiscuss}
              />
            </li>
          ))}
        </ol>
      )}

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = title.trim();
          if (!value) return;
          void run(`add-${scene.id}`, async () => {
            await act("POST", `/api/media-studio/scenes/${scene.id}/plot-points`, { title: value });
            setTitle("");
          });
        }}
      >
        <label className="sr-only" htmlFor={`new-plot-point-${scene.id}`}>New plot point in {scene.sceneKey}</label>
        <Input id={`new-plot-point-${scene.id}`} placeholder="New plot point" value={title} onChange={(event) => setTitle(event.target.value)} className="h-8 text-xs" />
        <Button type="submit" size="sm" variant="outline" disabled={!title.trim() || busy === `add-${scene.id}`}>
          <Plus className="mr-1 h-3.5 w-3.5" />Add
        </Button>
      </form>
    </section>
  );
}

interface SlideProps {
  production: ProductionView;
  scene: SceneView;
  plotPoint: PlotPointView;
  index: number;
  count: number;
  act: ProductionAct;
  busy: string | null;
  run: Run;
  onMove: (to: number) => void;
  onDiscuss?: MediaDiscuss;
}

function PlotPointSlide({ production, scene, plotPoint, index, count, act, busy, run, onMove, onDiscuss }: SlideProps) {
  const [prompt, setPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: plotPoint.title, beat: plotPoint.beat });
  const [isDiffOpen, setIsDiffOpen] = useState(false);

  const shown = shownKeyframe(plotPoint);
  const rendering = plotPoint.keyframes.some((k) => k.status === "rendering");
  const latest = plotPoint.keyframes.at(-1);
  const rendered = plotPoint.keyframes.filter((k) => k.imageUrl && (k.status === "ready" || k.status === "approved"));
  const hasShot = scene.shots.some((s) => s.plotPointId === plotPoint.id);
  const key = (what: string) => `${what}-${plotPoint.id}`;
  const previousPlotPoint = index > 0 ? scene.plotPoints[index - 1] : null;
  const previousKeyframe = previousPlotPoint ? shownKeyframe(previousPlotPoint) : null;

  return (
    <article className="flex h-full flex-col gap-2 rounded-lg border border-border bg-card p-2" data-testid={`plot-point-slide-${plotPoint.id}`}>
      <div className={cn("relative flex w-full items-center justify-center overflow-hidden rounded-md bg-muted", ASPECT_BOX[production.aspectRatio])}>
        {shown?.imageUrl ? (
          <img src={withAssetOrg(shown.imageUrl)} alt={`Keyframe for ${plotPoint.title}`} className="h-full w-full object-cover" />
        ) : (
          <p className="px-3 text-center text-xs text-muted-foreground" data-testid={`slide-frame-note-${plotPoint.id}`}>
            {rendering ? "Rendering keyframe…" : latest?.status === "failed" ? "The last render failed." : "No keyframe yet"}
          </p>
        )}
        {shown?.status === "approved" && (
          <Badge variant="outline" className="absolute right-1.5 top-1.5 border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            Approved
          </Badge>
        )}
        {rendering && shown && <Badge variant="secondary" className="absolute left-1.5 top-1.5">Rendering…</Badge>}
        {shown?.imageUrl && (
          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-[11px] bg-background/80 backdrop-blur-sm shadow hover:bg-background border border-border/50 text-foreground"
              title="Diff visual continuity against previous frame or references"
              onClick={() => setIsDiffOpen(true)}
              data-testid={`diff-keyframe-${plotPoint.id}`}
            >
              <SplitSquareVertical className="mr-1 h-3 w-3 text-primary" />
              Diff
            </Button>
          </div>
        )}
      </div>

      {latest?.status === "failed" && (
        <p className="text-[11px] text-destructive" data-testid={`slide-failure-${plotPoint.id}`}>Last render failed: {latest.error ?? "no reason was given."}</p>
      )}
      {shown && (shown.references?.length ?? 0) > 0 && (
        <p className="text-[11px] text-muted-foreground" data-testid={`slide-references-${plotPoint.id}`}>
          Consistent with {shown.references.map((reference) => (reference.kind === "previous_keyframe" ? "the previous frame" : reference.label)).join(", ")}
        </p>
      )}

      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 rounded bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">{index + 1}</span>
        {editing ? (
          <form
            className="grid flex-1 gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(key("edit"), async () => {
                await act("PATCH", `/api/media-studio/plot-points/${plotPoint.id}`, { title: draft.title.trim(), beat: draft.beat });
                setEditing(false);
              });
            }}
          >
            <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={`plot-point-title-${plotPoint.id}`}>
              Title
              <Input id={`plot-point-title-${plotPoint.id}`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-7 text-xs" />
            </label>
            <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={`plot-point-beat-${plotPoint.id}`}>
              Beat
              <Textarea id={`plot-point-beat-${plotPoint.id}`} value={draft.beat} onChange={(e) => setDraft({ ...draft, beat: e.target.value })} rows={3} className="text-xs" />
            </label>
            <div className="flex gap-1.5">
              <Button type="submit" size="sm" className="h-7" disabled={!draft.title.trim() || busy === key("edit")}>Save</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => { setDraft({ title: plotPoint.title, beat: plotPoint.beat }); setEditing(false); }}>Cancel</Button>
            </div>
          </form>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug text-foreground">{plotPoint.title}</p>
            {plotPoint.beat && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{plotPoint.beat}</p>}
          </div>
        )}
        {!editing && (
          <div className="flex shrink-0 items-center">
            <DiscussButton
              onDiscuss={onDiscuss}
              target={{ sceneId: scene.id, sceneKey: scene.sceneKey, kind: "plot_point", id: plotPoint.id, label: `${scene.sceneKey} plot point ${index + 1}: ${plotPoint.title}` }}
            />
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit "${plotPoint.title}"`} onClick={() => { setDraft({ title: plotPoint.title, beat: plotPoint.beat }); setEditing(true); }}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move "${plotPoint.title}" earlier`} disabled={index === 0} onClick={() => onMove(index - 1)}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move "${plotPoint.title}" later`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {rendered.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Keyframes for "${plotPoint.title}"`}>
          {rendered.map((k, i) => (
            <button
              key={k.id}
              type="button"
              aria-label={`Show keyframe ${i + 1}`}
              aria-pressed={k.isSelected || k.status === "approved"}
              onClick={() => void run(key("select"), () => act("POST", `/api/media-studio/keyframes/${k.id}/select`))}
              className={cn("h-10 w-16 overflow-hidden rounded border", k.isSelected || k.status === "approved" ? "border-primary ring-1 ring-primary" : "border-border")}
            >
              <img src={withAssetOrg(k.imageUrl)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="mt-auto grid gap-1.5 border-t border-border/60 pt-2">
        <label className="grid gap-0.5 text-[11px] font-medium text-foreground" htmlFor={`keyframe-prompt-${plotPoint.id}`}>
          Keyframe prompt (optional)
          <Input
            id={`keyframe-prompt-${plotPoint.id}`}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Leave empty to use the plot point"
            className="h-7 text-xs"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button" size="sm" variant="outline" className="h-7"
            disabled={rendering || busy === key("render")}
            onClick={() => void run(key("render"), async () => {
              await act("POST", `/api/media-studio/plot-points/${plotPoint.id}/keyframes`, prompt.trim() ? { prompt: prompt.trim() } : {});
              setPrompt("");
            })}
          >
            {rendering || busy === key("render") ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            Render keyframe
          </Button>
          {shown?.imageUrl && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setIsDiffOpen(true)}
              data-testid={`diff-action-${plotPoint.id}`}
            >
              <SplitSquareVertical className="mr-1 h-3.5 w-3.5 text-primary" />
              Visual Diff
            </Button>
          )}
          {shown?.status === "ready" && (
            <>
              <Button type="button" size="sm" className="h-7" disabled={busy === key("approve")} onClick={() => void run(key("approve"), () => act("POST", `/api/media-studio/keyframes/${shown.id}/approve`))}>
                <Check className="mr-1 h-3.5 w-3.5" />Approve
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7" disabled={busy === key("reject")} onClick={() => void run(key("reject"), () => act("POST", `/api/media-studio/keyframes/${shown.id}/reject`))}>
                <X className="mr-1 h-3.5 w-3.5" />Reject
              </Button>
            </>
          )}
          <Button
            type="button" size="sm" variant="secondary" className="h-7"
            disabled={hasShot || busy === key("shot")}
            onClick={() => void run(key("shot"), () => act("POST", `/api/media-studio/plot-points/${plotPoint.id}/shot`))}
          >
            <Clapperboard className="mr-1 h-3.5 w-3.5" />{hasShot ? "Shot made" : "Make shot"}
          </Button>
        </div>
      </div>

      {isDiffOpen && shown && (
        <VisualContinuityDiffModal
          open={isDiffOpen}
          onOpenChange={setIsDiffOpen}
          currentKeyframe={shown}
          plotPoint={plotPoint}
          previousKeyframe={previousKeyframe}
          previousPlotPointTitle={previousPlotPoint?.title}
          production={production}
          onApprove={() => void run(key("approve"), () => act("POST", `/api/media-studio/keyframes/${shown.id}/approve`))}
          onReject={() => void run(key("reject"), () => act("POST", `/api/media-studio/keyframes/${shown.id}/reject`))}
        />
      )}
    </article>
  );
}
