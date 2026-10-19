import React, { useState } from "react";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Cpu, Film, Image as ImageIcon, Loader2, Plus, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCents, type ProductionView, type SceneView, type TakeStatus } from "@shared/media-studio";
import { DEFAULT_WAN_WORKFLOW_GRAPH } from "@shared/comfy-workflow";
import { useProduction, useProductions, useProductionAct, withAssetOrg } from "./api";
import { costBreakdown, type SceneCost } from "./cost";
import { useStudioToast } from "./feedback";
import { openInMediaStudio, useStudioSelection, type StudioLocation, type StudioSelection } from "./navigation";
import { shotStatus } from "./status";
import { FOCUS_RING, StatusIcon } from "./StatusIcon";
import { StudioErrorAlert } from "./StudioErrorAlert";
import { ClipInspector } from "./ClipInspector";
import { RenderQueuePanel } from "./RenderQueuePanel";

/**
 * The production open in the room, beside the chat: what it holds, what it has spent,
 * what needs a decision, and each scene and shot. Every part opens the place in the
 * studio where it is changed.
 */

const STATUS_PILL: Record<TakeStatus | "none", { label: string; className: string }> = {
  approved: { label: "Approved", className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  ready_for_review: { label: "Ready for review", className: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  rendering: { label: "Rendering", className: "border-primary/30 bg-primary/15 text-primary" },
  queued: { label: "Queued", className: "border-border bg-muted text-muted-foreground" },
  pending_approval: { label: "Waiting for approval", className: "border-border bg-muted text-muted-foreground" },
  failed: { label: "Failed", className: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  rejected: { label: "Rejected", className: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  simulated: { label: "Simulated", className: "border-border bg-muted text-muted-foreground" },
  none: { label: "No takes", className: "border-dashed border-border text-muted-foreground" },
};

// Which take speaks for a shot is decided in one place, shared with the studio's panels.
export { shotStatus };

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function MediaConfigurationRail({
  crewSessionId,
  productionId,
  isCollapsed,
  onToggleCollapse,
  className,
}: {
  crewSessionId?: number;
  productionId?: number | null;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}) {
  const productions = useProductions(crewSessionId);
  // The clip the studio has on screen. The rail is not in the studio's tree, so it
  // listens rather than being told — see navigation.ts.
  const [selection, setSelection] = useState<StudioSelection | null>(null);
  // No explicit choice yet: follow what the studio is doing. A clip on screen means the
  // clip is what you are working on; nothing selected means the production overview is
  // more use than an empty inspector. Once a tab is picked, it stays picked.
  const [chosenTab, setTab] = useState<"clip" | "queue" | "production" | null>(null);
  useStudioSelection(setSelection);
  const tab = chosenTab ?? (selection?.shotId != null ? "clip" : "production");
  const id = productionId ?? productions.data?.[0]?.id ?? null;
  const production = useProduction(id);
  const view = production.data;
  const loadError = productions.error ?? production.error;
  const loading = productions.isLoading || (id != null && production.isLoading);

  if (isCollapsed) {
    return (
      <aside
        aria-label="Media Studio configuration (collapsed)"
        data-testid="media-configuration-rail-collapsed"
        className={cn(
          "flex h-full w-9 shrink-0 flex-col items-center justify-between rounded-xl border border-border/80 bg-card py-2.5 shadow-sm transition-all duration-300",
          className
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          title="Expand Media Configuration Rail"
          aria-label="Expand Media Configuration Rail"
          data-testid="expand-media-rail-btn"
        >
          <Film className="h-4 w-4" />
        </button>
        <div className="flex flex-col items-center gap-1 my-auto">
          <span className="text-[10px] font-semibold text-muted-foreground [writing-mode:vertical-lr] rotate-180 tracking-wider uppercase">
            {view?.title || "Media Rail"}
          </span>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Expand Media Rail"
            aria-label="Expand Media Rail"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </aside>
    );
  }

  return (
    <aside
      aria-label="Media Studio configuration"
      data-testid="media-configuration-rail"
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-card",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Film className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{view?.title ?? "Media Studio"}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Configuration</p>
        </div>
        {view && <Badge variant="outline" className="shrink-0 px-1 py-0 font-mono text-[10px] text-muted-foreground">{view.aspectRatio}</Badge>}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Collapse Media Rail"
            aria-label="Collapse Media Rail"
            data-testid="collapse-media-rail-btn"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tabs, so the rail can hold more than one set of tools without any of them
          losing the room they need. Clip leads: it is what changes most often. */}
      {view && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border/70 px-2 py-1.5" role="tablist" aria-label="Media rail">
          {([["clip", "Clip"], ["queue", "Queue"], ["production", "Production"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              data-testid={`media-rail-tab-${value}`}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                FOCUS_RING,
                tab === value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {loadError ? (
          <StudioErrorAlert error={loadError} onRetry={() => { void productions.refetch(); if (id != null) void production.refetch(); }} />
        ) : loading ? (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading the production…</p>
        ) : !view ? (
          <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border p-4 text-center" data-testid="media-configuration-empty">
            <Clapperboard className="h-6 w-6 text-muted-foreground/60" aria-hidden />
            <p className="text-sm font-medium text-foreground">No production in this room yet</p>
            <p className="text-xs text-muted-foreground">Start one in Media Studio: give it a title and an aspect ratio, then write its story. Or pick Make a Film in the room's playbooks.</p>
            <Button type="button" size="sm" onClick={() => openInMediaStudio({ tab: "story" })}>Start a production</Button>
          </div>
        ) : tab === "clip" ? (
          <ClipInspector view={view} selection={selection} />
        ) : tab === "queue" ? (
          <RenderQueuePanel view={view} />
        ) : (
          <ProductionConfiguration view={view} onOpenQueue={() => setTab("queue")} />
        )}
      </div>
    </aside>
  );
}

function ProductionConfiguration({ view, onOpenQueue }: { view: ProductionView; onOpenQueue: () => void }) {
  const act = useProductionAct(view.id);
  const notify = useStudioToast();
  const [engineBusy, setEngineBusy] = useState(false);
  const [addingScene, setAddingScene] = useState(false);
  const [sceneTitle, setSceneTitle] = useState("");
  const [creatingScene, setCreatingScene] = useState(false);
  const go = (location: Omit<StudioLocation, "productionId">) => openInMediaStudio({ productionId: view.id, ...location });
  const shots = view.scenes.flatMap((scene) => scene.shots);
  const takes = shots.flatMap((shot) => shot.takes);
  const plotPoints = view.scenes.flatMap((scene) => scene.plotPoints);
  const keyframes = plotPoints.flatMap((point) => point.keyframes);
  const spentShare = view.budgetLimitCents > 0 ? Math.min(1, view.spendCents / view.budgetLimitCents) : 1;
  const cost = costBreakdown(view);
  const costOf = (sceneId: number) => cost.scenes.find((entry) => entry.sceneId === sceneId);

  // Takes waiting, in flight or failed are LISTED in the Queue tab, so here they are a
  // count that opens it. Repeating the list in both tabs is how one of them goes stale.
  const needs = [
    { n: takes.filter((t) => t.status === "ready_for_review").length, text: (n: number) => `${count(n, "take")} to review`, queue: true as const },
    { n: takes.filter((t) => t.status === "pending_approval").length, text: (n: number) => `${count(n, "take")} waiting for approval in the Decision Inbox`, queue: true as const },
    { n: keyframes.filter((k) => k.status === "ready").length, text: (n: number) => `${count(n, "keyframe")} to approve`, location: { tab: "storyboard" as const } },
    { n: takes.filter((t) => t.status === "failed").length + keyframes.filter((k) => k.status === "failed").length, text: (n: number) => `${count(n, "failed render")} to look at`, queue: true as const },
  ].filter((item) => item.n > 0);

  const progress = [
    { label: "Storyboard", done: plotPoints.filter((p) => p.keyframes.some((k) => k.status === "approved")).length, total: plotPoints.length, unit: "plot points have an approved keyframe", location: { tab: "storyboard" as const }, Icon: ImageIcon },
    { label: "Shots", done: shots.filter((s) => s.takes.some((t) => t.status === "approved")).length, total: shots.length, unit: "shots have an approved take", location: { tab: "film" as const }, Icon: Clapperboard },
    { label: "Reels", done: view.scenes.filter((s) => s.assembly?.status === "ready").length, total: view.scenes.length, unit: "scenes have a reel", location: { tab: "film" as const }, Icon: Film },
  ];

  return (
    <>
      <section aria-label="Budget" className="grid gap-1.5 rounded-lg border border-border bg-muted/20 p-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Wallet className="h-3.5 w-3.5 text-primary" aria-hidden />Budget
          <button type="button" onClick={() => go({ tab: "story" })} className={cn("ml-auto rounded text-[11px] font-medium text-primary hover:underline", FOCUS_RING)}>Change</button>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={cn("h-full rounded-full", spentShare >= 1 ? "bg-destructive" : spentShare >= 0.8 ? "bg-amber-500" : "bg-primary")}
            style={{ width: `${Math.round(spentShare * 100)}%` }}
          />
        </div>
        <p className="text-[11px] tabular-nums text-muted-foreground" data-testid="media-configuration-budget">
          {formatCents(view.spendCents)} of {formatCents(view.budgetLimitCents)} spent
          {view.video.configured
            ? ` · Seedance at ${view.video.resolution}, about ${formatCents(Math.ceil(view.video.centsPerSecond))} a second`
            : " · Takes simulate: fal.ai isn't set up, so no video and no charge"}
        </p>
      </section>

      <section aria-label="Video Engine" className="grid gap-1.5 rounded-lg border border-border bg-muted/20 p-2.5" data-testid="media-rail-video-engine">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Cpu className="h-3.5 w-3.5 text-primary" aria-hidden />Video Engine
          <button type="button" onClick={() => go({ tab: "story" })} className={cn("ml-auto rounded text-[11px] font-medium text-primary hover:underline", FOCUS_RING)}>Configure</button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
          <Button
            type="button"
            size="sm"
            variant={view.video.engine === "comfyui" ? "default" : "outline"}
            className="h-7 text-[11px]"
            disabled={engineBusy}
            onClick={async () => {
              if (view.video.engine === "comfyui") return;
              setEngineBusy(true);
              try {
                await act("PUT", `/api/media-studio/productions/${view.id}/video-engine`, {
                  engine: "comfyui",
                  workflow: view.video.workflow ? undefined : { name: "Wan 2.1 Image-to-Video", graph: DEFAULT_WAN_WORKFLOW_GRAPH },
                });
                notify("Video engine: ComfyUI", "Takes and keyframes render locally on your GPU.");
              } finally {
                setEngineBusy(false);
              }
            }}
          >
            {engineBusy && view.video.engine !== "comfyui" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            ComfyUI (Local)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view.video.engine === "fal" ? "default" : "outline"}
            className="h-7 text-[11px]"
            disabled={engineBusy}
            onClick={async () => {
              if (view.video.engine === "fal") return;
              setEngineBusy(true);
              try {
                await act("PUT", `/api/media-studio/productions/${view.id}/video-engine`, { engine: "fal" });
                notify("Video engine: fal.ai", "Takes now render with Seedance on fal.ai.");
              } finally {
                setEngineBusy(false);
              }
            }}
          >
            {engineBusy && view.video.engine !== "fal" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Seedance (Cloud)
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {view.video.engine === "comfyui"
            /* No GPU named here: the platform is told a base URL, never what is behind it,
               so any model of card in the copy is a guess about someone else's machine. */
            ? (view.video.workflow ? `Using "${view.video.workflow.name}" · renders locally` : "Renders locally · no per-take cost")
            : (view.video.configured ? "Cloud renders via fal.ai" : "Simulated (no FAL_KEY)")}
        </p>
      </section>

      {cost.spentCents + cost.waitingCents > 0 && (
        <section aria-label="Spend by scene" className="grid gap-1" data-testid="media-configuration-spend">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Spend by scene</h3>
          {cost.scenes.filter((entry) => entry.spentCents + entry.waitingCents > 0).map((entry) => (
            <button
              key={entry.sceneId}
              type="button"
              onClick={() => go({ tab: "shots", sceneId: entry.sceneId })}
              className={cn("grid gap-1 rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-muted", FOCUS_RING)}
              aria-label={`${entry.sceneKey} ${entry.title}: ${formatCents(entry.spentCents)} spent${entry.waitingCents ? `, ${formatCents(entry.waitingCents)} waiting for approval` : ""}`}
            >
              <span className="flex items-baseline gap-1.5">
                <span className="font-mono text-[10px] text-muted-foreground">{entry.sceneKey}</span>
                <span className="truncate font-medium text-foreground">{entry.title}</span>
                <span className="ml-auto shrink-0 tabular-nums text-foreground">{formatCents(entry.spentCents)}</span>
              </span>
              <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full bg-primary" style={{ width: `${cost.spentCents ? Math.round((entry.spentCents / cost.spentCents) * 100) : 0}%` }} />
              </span>
              {(entry.waitingCents > 0 || entry.keyframeCents > 0) && (
                <span className="tabular-nums text-muted-foreground">
                  {[
                    entry.keyframeCents > 0 ? `${formatCents(entry.keyframeCents)} of it on keyframes` : "",
                    entry.waitingCents > 0 ? `${formatCents(entry.waitingCents)} more waiting for approval` : "",
                  ].filter(Boolean).join(" · ")}
                </span>
              )}
            </button>
          ))}
        </section>
      )}

      {needs.length > 0 && (
        <section aria-label="Needs a decision" className="flex flex-wrap gap-1.5">
          {needs.map((item) => (
            <button key={item.text(item.n)} type="button" onClick={() => ("queue" in item ? onOpenQueue() : go(item.location))} className={cn("rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-500/20 dark:text-amber-200", FOCUS_RING)}>
              {item.text(item.n)}
            </button>
          ))}
        </section>
      )}

      <section aria-label="Progress" className="grid gap-1">
        <button type="button" onClick={() => go({ tab: "story" })} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted", FOCUS_RING)}>
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium text-foreground">Story</span>
          <span className="ml-auto truncate text-[11px] text-muted-foreground">
            {view.scribeDocumentTitle ? `${view.scribeDocumentTitle} · ${count(view.characters.length, "character or location", "characters and locations")}` : "No manuscript linked"}
          </span>
        </button>
        {progress.map(({ label, done, total, unit, location, Icon }) => (
          <button key={label} type="button" onClick={() => go(location)} className={cn("grid gap-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted", FOCUS_RING)} aria-label={`${label}: ${done} of ${total} ${unit}`}>
            <span className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="font-medium text-foreground">{label}</span>
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{done} of {total}</span>
            </span>
            <span className="ml-5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full bg-emerald-500" style={{ width: total ? `${Math.round((done / total) * 100)}%` : "0%" }} />
            </span>
          </button>
        ))}
      </section>

      <section aria-label="Scenes" className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Scenes</h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            title="Add a scene"
            onClick={() => setAddingScene(true)}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {addingScene && (
          <form
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const val = sceneTitle.trim();
              if (!val) return;
              setCreatingScene(true);
              try {
                await act("POST", `/api/media-studio/productions/${view.id}/scenes`, { title: val });
                setSceneTitle("");
                setAddingScene(false);
                notify("Scene created", `"${val}" added.`);
              } finally {
                setCreatingScene(false);
              }
            }}
          >
            <Input
              autoFocus
              placeholder="Scene title..."
              value={sceneTitle}
              onChange={(e) => setSceneTitle(e.target.value)}
              className="h-7 text-xs"
              disabled={creatingScene}
            />
            <div className="flex gap-1">
              <Button type="submit" size="sm" className="h-6 text-[11px]" disabled={!sceneTitle.trim() || creatingScene}>
                {creatingScene ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Save
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setAddingScene(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {view.scenes.length === 0 ? (
          !addingScene && (
            <div className="grid gap-1.5 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              <p>No scenes yet. Add a scene to start storyboarding and shooting.</p>
              <div>
                <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setAddingScene(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Add a scene
                </Button>
              </div>
            </div>
          )
        ) : (
          view.scenes.map((scene) => <SceneRow key={scene.id} scene={scene} cost={costOf(scene.id)} go={go} />)
        )}
      </section>
    </>
  );
}

function SceneRow({ scene, cost, go }: { scene: SceneView; cost?: SceneCost; go: (location: Omit<StudioLocation, "productionId">) => void }) {
  const [open, setOpen] = useState(true);
  const direction = [scene.location, scene.timeOfDay, scene.mood].filter(Boolean).join(" · ");

  return (
    <div className="rounded-lg border border-border bg-card" data-testid={`media-configuration-scene-${scene.id}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={cn("flex w-full items-start gap-1.5 rounded-lg px-2.5 py-2 text-left", FOCUS_RING)}>
        {open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground">{scene.sceneKey}</span>
            <span className="truncate text-xs font-semibold text-foreground">{scene.title}</span>
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">{direction || "Location, time of day and mood not set"}</span>
        </span>
        {scene.assembly?.status === "ready" && <Badge variant="outline" className="shrink-0 border-emerald-500/30 px-1 py-0 text-[10px] text-emerald-700 dark:text-emerald-300">Reel</Badge>}
      </button>

      {open && (
        <div className="grid gap-1 border-t border-border/60 px-2.5 py-2">
          {scene.shots.length === 0 ? (
            <div className="grid gap-1.5 text-[11px] text-muted-foreground">
              <p>No shots yet. Make them from the storyboard's approved keyframes, or add one.</p>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => go({ tab: "storyboard", sceneId: scene.id })}>Open Storyboard</Button>
                <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => go({ tab: "shots", sceneId: scene.id })}>Add a shot</Button>
              </div>
            </div>
          ) : (
            scene.shots.map((shot, index) => {
              const state = shotStatus(shot);
              const status = STATUS_PILL[state];
              const spent = cost?.shots.find((entry) => entry.shotId === shot.id)?.spentCents ?? 0;
              const frame = scene.plotPoints.flatMap((point) => point.keyframes).find((k) => k.id === shot.referenceKeyframeId);
              const thumb = frame?.imageUrl;
              return (
                <button
                  key={shot.id}
                  type="button"
                  onClick={() => go({ tab: "film", sceneId: scene.id, shotId: shot.id })}
                  className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] hover:bg-muted", FOCUS_RING)}
                  title={shot.action || shot.prompt || undefined}
                  data-testid={`media-configuration-shot-${shot.id}`}
                >
                  {thumb ? (
                    <img src={withAssetOrg(thumb)} alt="" className="h-7 w-11 shrink-0 rounded object-cover border border-border/60" />
                  ) : (
                    <div className="flex h-7 w-11 shrink-0 items-center justify-center rounded bg-muted/60 text-muted-foreground border border-border/50">
                      <Clapperboard className="h-3.5 w-3.5" />
                    </div>
                  )}
                  <span className="font-medium text-foreground">Shot {index + 1}</span>
                  <span className="truncate text-muted-foreground">
                    {shot.durationSeconds}s · {shot.framing || "framing not set"}{shot.dialogue.length ? ` · ${count(shot.dialogue.length, "line")}` : ""}{spent > 0 ? ` · ${formatCents(spent)}` : ""}
                  </span>
                  <span className={cn("ml-auto flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]", status.className)}>
                    <StatusIcon status={state} />{status.label}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
