import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Film, Link2, Loader2, Maximize2, Minimize2, Pencil, Plus, Redo2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { MEDIA_ASPECT_RATIOS, formatCents, type MediaAspectRatio, type MediaStudioSelection, type ProductionView } from "@shared/media-studio";
import type { MediaDiscuss } from "./DiscussButton";
import { productionKey, productionsKey, readJson, useProduction, useProductionAct, useProductions, type ProductionAct } from "./api";
import { MediaStudioPod } from "./MediaStudioPod";
import { CreateVideoPanel } from "./CreateVideoPanel";
import { SceneReel } from "./SceneReel";
import { ShotsPanel } from "./ShotsPanel";
import { StoryboardSequencer } from "./StoryboardSequencer";
import { StoryPanel } from "./StoryPanel";
import { toFilmShots } from "./film";
import { useStudioHistory, type StudioHistory } from "./history";
import { openInMediaStudio, publishStudioSelection, type StudioLocation, useStudioNavigation, useStudioSelectionRequests } from "./navigation";
import { SceneBatchReview } from "./SceneBatchReview";
import { shortcutKeys, useStudioShortcuts } from "./shortcuts";
import { StudioErrorAlert } from "./StudioErrorAlert";
import { approvalAction, newestTakeOf, reshootAction, type StudioSend } from "./take-actions";
import type { DefectClass } from "@shared/media-studio";
import { useStudioToast } from "./feedback";
import { readStudioLink, studioLinkFor } from "./links";
import { readStudioPreferences, writeStudioPreferences, type StudioViewMode } from "./preferences";
import { matchesShotFilter, nextMatchingShot, shotProgress, type ShotFilter } from "./status";
import { FOCUS_RING, StatusIcon } from "./StatusIcon";
import { productionWorkflow } from "./workflow";
import { NextStepCard, WorkflowStepper } from "./WorkflowStepper";
import { CharacterStudio } from "./CharacterStudio";

type FilmFocus = { sceneId?: number; shotId?: number; at: number };

/**
 * Media Studio beside a CREW room: the room's production, its story, storyboard, shots
 * and film. With no production yet, it offers to start one; nothing is shown that has
 * not been saved.
 */

type Tab = "create" | "story" | "storyboard" | "characters" | "shots" | "film";
const TABS: Array<{ id: Tab; label: string; tooltip: string }> = [
  { id: "create", label: "Create", tooltip: "Generate clips from a prompt and assemble your finished video" },
  { id: "story", label: "Story", tooltip: "Narrative outline, screenplay beats, and prompt architecture" },
  { id: "storyboard", label: "Storyboard", tooltip: "Visual keyframe sequence, camera angles, and PowerPoint deck export" },
  { id: "characters", label: "Characters", tooltip: "Character Engine: Invariant phenotypes, turnaround crop bounds, wardrobe states, and face QA" },
  { id: "shots", label: "Shots", tooltip: "Camera coverage, multi-take video generation, and prompt deltas" },
  { id: "film", label: "Film", tooltip: "Multi-track timeline sequencer, audio stem mixing, and conformed reel playback" },
];

export interface MediaStudioProps {
  /** The room the studio is open in; its productions are listed and new ones belong to it. */
  crewSessionId?: number;
  /** The scene the mount named, e.g. SCENE-02: the Film tab opens on it when it exists. */
  sceneId?: string;
  /** The mount's scene title, offered as a new production's title. */
  sceneTitle?: string;
  aspectRatio?: MediaAspectRatio;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
  /** Sends a scene, plot point, shot, take or reel to the chat. Without it, nothing offers to. */
  onFocusInChat?: (selection: MediaStudioSelection) => void;
  /** The production on screen, so a selection from another one can be dropped. */
  onProductionChange?: (productionId: number | null) => void;
  /** The production the mount names, e.g. after the room applied a change to it. */
  productionId?: number;
  /** Changes when the room changed the production, so the studio reads it again. */
  refreshKey?: number | string;
}

export function MediaStudio({
  crewSessionId, sceneId, sceneTitle, aspectRatio = "16:9", isFocusMode = false, onToggleFocusMode, onClose, onFocusInChat, onProductionChange,
  productionId: namedProductionId, refreshKey,
}: MediaStudioProps) {
  const queryClient = useQueryClient();
  const productions = useProductions(crewSessionId);
  const [chosenId, setChosenId] = useState<number | null>(null);
  const named = namedProductionId != null && productions.data?.some((p) => p.id === namedProductionId) ? namedProductionId : null;
  const productionId = chosenId ?? named ?? productions.data?.[0]?.id ?? null;

  // A change the room applied reaches the studio as a new mount; read the productions again.
  const lastRefresh = useRef(refreshKey);
  useEffect(() => {
    if (lastRefresh.current === refreshKey) return;
    lastRefresh.current = refreshKey;
    void queryClient.invalidateQueries({ queryKey: ["/api/media-studio/productions"] });
  }, [refreshKey, queryClient]);
  const production = useProduction(productionId);
  const act = useProductionAct(productionId);
  const [tab, setTabState] = useState<Tab>("storyboard");
  const history = useStudioHistory();
  const notify = useStudioToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const [filmFocus, setFilmFocus] = useState<FilmFocus | null>(null);
  const [shotFocus, setShotFocus] = useState<FilmFocus | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);

  // The tab a viewer picks is remembered for the production; opening it again returns there.
  const setTab = (next: Tab) => {
    setTabState(next);
    writeStudioPreferences(productionId, { tab: next });
  };
  const restoredFor = useRef<number | null>(null);
  const namedTab = useRef<Tab | null>(null);
  useEffect(() => {
    if (productionId == null || restoredFor.current === productionId) return;
    restoredFor.current = productionId;
    const next = namedTab.current ?? readStudioPreferences(productionId).tab;
    namedTab.current = null;
    if (next) {
      setTabState(next);
      writeStudioPreferences(productionId, { tab: next });
    }
  }, [productionId]);

  // The configuration rail, an error's quick action, or a shared link asked the studio to go somewhere.
  useStudioNavigation((location: StudioLocation) => {
    if (location.productionId != null && location.productionId !== productionId) {
      if (!productions.data?.some((p) => p.id === location.productionId)) return;
      namedTab.current = location.tab;
      setChosenId(location.productionId);
      setTabState(location.tab);
    } else {
      setTab(location.tab);
    }
    if (location.tab === "film" && (location.sceneId != null || location.shotId != null)) {
      setFilmFocus({ sceneId: location.sceneId, shotId: location.shotId, at: Date.now() });
    }
    if (location.tab === "shots") {
      setShotFocus({ sceneId: location.sceneId, shotId: location.shotId, at: Date.now() });
    }
  });

  // A shared link is followed once, when the room's productions are known.
  const linkFollowed = useRef(false);
  useEffect(() => {
    if (linkFollowed.current || !productions.data) return;
    linkFollowed.current = true;
    const link = readStudioLink(window.location.search);
    if (link) openInMediaStudio(link);
  }, [productions.data]);

  // Undo history belongs to the production on screen.
  const clearHistory = history.clear;
  useEffect(() => {
    clearHistory();
    setHistoryError(null);
  }, [productionId, clearHistory]);

  const stepHistory = (kind: "undo" | "redo") => {
    setHistoryError(null);
    void (kind === "undo" ? history.undo() : history.redo())
      .then((action) => {
        if (action) notify(`${kind === "undo" ? "Undone" : "Redone"}: ${action.label}`);
      })
      .catch((error) => setHistoryError(error));
  };
  useStudioShortcuts(rootRef, {
    undo: history.canUndo ? () => stepHistory("undo") : undefined,
    redo: history.canRedo ? () => stepHistory("redo") : undefined,
  });

  const view = production.data;
  const jobs = view?.scenes.flatMap((scene) => [
    ...scene.plotPoints.flatMap((point) => point.keyframes.map((frame) => ({ status: frame.status, tab: "storyboard" as Tab }))),
    ...scene.shots.flatMap((shot) => shot.takes.map((take) => ({ status: take.status, tab: "shots" as Tab }))),
  ]) ?? [];
  const progress = view ? shotProgress(view.scenes) : { approved: 0, total: 0 };
  const workflow = view ? productionWorkflow(view) : null;
  // Hidden per production for this visit; a new recommendation shows again.
  const [dismissedNext, setDismissedNext] = useState<string | null>(null);
  const viewId = view?.id;
  const nextKey = workflow?.next ? `${viewId ?? ""}:${workflow.next.stage}:${workflow.next.title}` : null;
  const discuss: MediaDiscuss | undefined = onFocusInChat && viewId != null
    ? (target) => onFocusInChat({ productionId: viewId, ...target })
    : undefined;

  useEffect(() => {
    onProductionChange?.(productionId);
  }, [productionId, onProductionChange]);

  const exportDeck = async () => {
    if (!view) return;
    const response = await apiRequest("GET", `/api/media-studio/productions/${view.id}/storyboard.pptx`);
    const blob = await response.blob();
    const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "storyboard.pptx";
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  };

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  const startEditingTitle = () => {
    if (!view) return;
    setTitleDraft(view.title);
    setIsEditingTitle(true);
  };

  const saveTitle = async () => {
    if (!view || !titleDraft.trim() || titleDraft.trim() === view.title) {
      setIsEditingTitle(false);
      return;
    }
    setIsSavingTitle(true);
    try {
      const newTitle = titleDraft.trim();
      await act("PATCH", `/api/media-studio/productions/${view.id}`, { title: newTitle });
      void queryClient.invalidateQueries({ queryKey: productionsKey(crewSessionId) });
      notify("Production renamed", `Updated title to "${newTitle}".`);
      setIsEditingTitle(false);
    } catch (e) {
      notify("Rename failed", (e as Error).message);
    } finally {
      setIsSavingTitle(false);
    }
  };

  return (
    <div ref={rootRef} className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border/80 bg-card" data-testid="media-studio">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Film className="h-4 w-4" /></div>
          {isEditingTitle ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveTitle();
              }}
              className="flex items-center gap-1"
            >
              <Input
                autoFocus
                value={titleDraft}
                disabled={isSavingTitle}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setIsEditingTitle(false);
                }}
                className="h-7 w-48 text-xs font-semibold"
                placeholder="Production title…"
                data-testid="edit-production-title-input"
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-emerald-500 hover:text-emerald-600"
                disabled={isSavingTitle || !titleDraft.trim()}
                title="Save title (Enter)"
                data-testid="save-production-title-btn"
              >
                {isSavingTitle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setIsEditingTitle(false)}
                title="Cancel (Esc)"
                data-testid="cancel-production-title-btn"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-1 min-w-0">
              {productions.data && productions.data.length > 1 ? (
                <label className="flex min-w-0 items-center gap-1.5 text-sm font-semibold" htmlFor="media-studio-production">
                  <span className="sr-only">Production</span>
                  <select
                    id="media-studio-production"
                    value={productionId ?? ""}
                    onChange={(event) => setChosenId(Number(event.target.value))}
                    className="h-7 min-w-0 max-w-[16rem] truncate rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {productions.data.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </label>
              ) : (
                <span className="truncate text-sm font-semibold text-foreground">{view?.title ?? "Media Studio"}</span>
              )}
              {view && (
                <button
                  type="button"
                  onClick={startEditingTitle}
                  className="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                  title="Rename production"
                  aria-label="Rename production"
                  data-testid="edit-production-title-btn"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {view && (
            <div className="mr-1 flex items-center gap-0.5" role="group" aria-label="Undo and redo">
              <Button
                type="button" variant="ghost" size="icon" className="h-7 w-7"
                disabled={!history.canUndo}
                onClick={() => stepHistory("undo")}
                aria-label={history.undoLabel ? `Undo: ${history.undoLabel}` : "Nothing to undo"}
                title={history.undoLabel ? `Undo: ${history.undoLabel} (${shortcutKeys("undo")})` : "Nothing to undo"}
                data-testid="media-studio-undo"
              >
                {history.busy === "undo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              </Button>
              <Button
                type="button" variant="ghost" size="icon" className="h-7 w-7"
                disabled={!history.canRedo}
                onClick={() => stepHistory("redo")}
                aria-label={history.redoLabel ? `Redo: ${history.redoLabel}` : "Nothing to redo"}
                title={history.redoLabel ? `Redo: ${history.redoLabel} (${shortcutKeys("redo")})` : "Nothing to redo"}
                data-testid="media-studio-redo"
              >
                {history.busy === "redo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Redo2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          )}
          {view && (
            <span className="mr-1 text-[11px] tabular-nums text-muted-foreground" data-testid="media-studio-spend">
              {formatCents(view.spendCents)} of {formatCents(view.budgetLimitCents)} spent
            </span>
          )}
          {view && !view.video.configured && (
            <span
              className="mr-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title="fal.ai is not set up here, so takes are recorded as simulations with no video and no charge."
              data-testid="media-studio-simulation"
            >
              Takes simulate
            </span>
          )}
          {onToggleFocusMode && (
            <button
              type="button"
              onClick={onToggleFocusMode}
              className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-border hover:bg-muted"
              title={isFocusMode ? "Restore the chat column" : "Focus the studio across the workspace"}
              aria-label={isFocusMode ? "Show the chat" : "Hide the chat"}
              data-testid="toggle-focus-mode-btn"
            >
              {isFocusMode ? <Minimize2 className="h-3.5 w-3.5 text-emerald-500" /> : <Maximize2 className="h-3.5 w-3.5 text-emerald-500" />}
              <span className="hidden sm:inline font-semibold">{isFocusMode ? "Show Chat" : "Focus Studio"}</span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-border hover:bg-muted"
              title="Close Media Studio and return to the scaffold rail"
              aria-label="Close Media Studio"
              data-testid="close-media-studio-btn"
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Exit</span>
            </button>
          )}
        </div>
      </div>

      {view && workflow && (
        <>
          <WorkflowStepper tab={tab} onSelect={setTab} workflow={workflow} createTooltip={TABS[0].tooltip} />
          {nextKey !== dismissedNext && (
            <NextStepCard next={workflow.next} tab={tab} onGo={setTab} onDismiss={() => setDismissedNext(nextKey)} />
          )}
        </>
      )}

      {view && (jobs.length > 0 || progress.total > 0) && (
        <div aria-label="Production activity" className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 text-xs">
          {progress.total > 0 && (
            <div className="flex min-w-[10rem] flex-1 items-center gap-2" data-testid="media-studio-progress">
              <div
                role="progressbar"
                aria-label="Shots with an approved take"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.approved}
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 motion-reduce:transition-none"
                  style={{ width: `${Math.round((progress.approved / progress.total) * 100)}%` }}
                />
              </div>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {progress.approved} of {progress.total} {progress.total === 1 ? "shot" : "shots"} approved
              </span>
            </div>
          )}
          {([
            { label: "awaiting approval", statuses: ["pending_approval"], icon: "pending_approval" },
            { label: "generating", statuses: ["queued", "rendering"], icon: "rendering" },
            { label: "ready for review", statuses: ["ready", "ready_for_review"], icon: "ready_for_review" },
            { label: "failed", statuses: ["failed"], icon: "failed" },
          ] as const).flatMap(({ label, statuses, icon }) => (["storyboard", "shots"] as Tab[]).map((target) => {
            const count = jobs.filter((job) => job.tab === target && (statuses as readonly string[]).includes(job.status)).length;
            return count > 0 ? (
              <button key={`${label}-${target}`} type="button" onClick={() => setTab(target)} className={cn("flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-muted", FOCUS_RING)}>
                <StatusIcon status={icon} />{count} {target === "shots" ? "takes" : "keyframes"} {label}
              </button>
            ) : null;
          }))}
        </div>
      )}

      {historyError ? <StudioErrorAlert error={historyError} onDismiss={() => setHistoryError(null)} className="mx-3 mt-2" /> : null}
      <p aria-live="polite" className="sr-only" data-testid="media-studio-last-action">{history.undoLabel ?? ""}</p>

      {productions.isLoading || (productionId != null && production.isLoading) ? (
        <p role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Loading the production…
        </p>
      ) : productions.error || production.error ? (
        <StudioErrorAlert
          className="m-3"
          retryLabel="Retry loading"
          error={productions.error ?? production.error}
          onRetry={() => {
            void productions.refetch();
            if (productionId != null) void production.refetch();
          }}
        />
      ) : !view ? (
        <StartProduction
          crewSessionId={crewSessionId}
          defaultTitle={sceneTitle ?? ""}
          defaultAspectRatio={aspectRatio}
          onCreated={(created) => {
            queryClient.setQueryData(productionKey(created.id), created);
            void queryClient.invalidateQueries({ queryKey: productionsKey(crewSessionId) });
            setChosenId(created.id);
            namedTab.current = "create";
            setTabState("create");
          }}
        />
      ) : (
        <div role="tabpanel" id={`media-panel-${tab}`} aria-labelledby={`media-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
          {tab === "create" && <CreateVideoPanel key={view.id} production={view} act={act} />}
          {tab === "story" && <StoryPanel production={view} act={act} onDiscuss={discuss} />}
          {tab === "storyboard" && <StoryboardSequencer production={view} act={act} onExport={exportDeck} onDiscuss={discuss} />}
          {tab === "characters" && <CharacterStudio production={view} onFocusInChat={discuss} />}
          {tab === "shots" && <ShotsPanel production={view} act={act} onDiscuss={discuss} focus={shotFocus} />}
          {tab === "film" && <FilmTab production={view} preferredSceneKey={sceneId} act={act} onDiscuss={discuss} history={history} focus={filmFocus} onOpenTab={setTab} />}
        </div>
      )}
    </div>
  );
}

function StartProduction({ crewSessionId, defaultTitle, defaultAspectRatio, onCreated }: {
  crewSessionId?: number;
  defaultTitle: string;
  defaultAspectRatio: MediaAspectRatio;
  onCreated: (production: ProductionView) => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [aspect, setAspect] = useState<MediaAspectRatio>(defaultAspectRatio);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <form
      className="m-auto grid w-full max-w-sm gap-3 p-6"
      data-testid="media-studio-start"
      onSubmit={async (event) => {
        event.preventDefault();
        setCreating(true);
        setError(null);
        try {
          onCreated(await readJson<ProductionView>("POST", "/api/media-studio/productions", {
            title: title.trim(), aspectRatio: aspect, ...(crewSessionId ? { crewSessionId } : {}),
          }));
        } catch (err) {
          setError(err);
        } finally {
          setCreating(false);
        }
      }}
    >
      <div>
        <p className="text-sm font-semibold text-foreground">Start a production</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {crewSessionId ? "This room has no production yet." : "There is no production yet."} Its story, storyboard and shots are saved as you work.
        </p>
      </div>
      <label className="grid gap-0.5 text-xs font-medium" htmlFor="media-start-title">
        Title
        <Input id="media-start-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
      </label>
      <label className="grid gap-0.5 text-xs font-medium" htmlFor="media-start-aspect">
        Aspect ratio
        <select id="media-start-aspect" value={aspect} onChange={(event) => setAspect(event.target.value as MediaAspectRatio)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          {MEDIA_ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
        </select>
      </label>
      {error ? <StudioErrorAlert error={error} onDismiss={() => setError(null)} /> : null}
      <Button type="submit" disabled={creating || !title.trim()}>
        {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Start production
      </Button>
    </form>
  );
}

// A scene's shots that need looking at; pressing one goes to the next such shot.
const SUMMARY_FILTERS: Array<{ filter: ShotFilter; icon: "ready_for_review" | "pending_approval" | "failed" | "none"; text: (n: number) => string }> = [
  { filter: "ready_for_review", icon: "ready_for_review", text: (n) => `${n} ready for review` },
  { filter: "pending_approval", icon: "pending_approval", text: (n) => `${n} waiting for approval` },
  { filter: "failed", icon: "failed", text: (n) => `${n} failed` },
  { filter: "unapproved", icon: "none", text: (n) => `${n} without an approved take` },
];

function FilmTab({ production, preferredSceneKey, act, onDiscuss, history, focus, onOpenTab }: {
  production: ProductionView;
  preferredSceneKey?: string;
  act: ProductionAct;
  onDiscuss?: MediaDiscuss;
  history: StudioHistory;
  focus: FilmFocus | null;
  onOpenTab: (tab: Tab) => void;
}) {
  const notify = useStudioToast();
  // The scene the mount named wins over the one last viewed here.
  const [sceneId, setSceneIdState] = useState<number | null>(() =>
    preferredSceneKey && production.scenes.some((s) => s.sceneKey === preferredSceneKey) ? null : readStudioPreferences(production.id).sceneId ?? null);
  const [viewMode, setViewModeState] = useState<StudioViewMode>(() => readStudioPreferences(production.id).viewMode ?? "director");
  const [activeShotNumber, setActiveShotNumber] = useState<number | null>(null);

  /*
   * What is selected, said out loud for the rail beside the chat. The rail inspects the
   * clip on screen, and it is not in this tree — see navigation.ts for why this is an
   * event rather than a prop.
   */
  const selectionOf = () => {
    const shot = activeShotNumber != null ? scene?.shots[activeShotNumber - 1] : undefined;
    if (!scene) return null;
    return {
      productionId: production.id,
      sceneId: scene.id,
      sceneKey: scene.sceneKey,
      shotId: shot?.id ?? null,
      shotNumber: shot ? activeShotNumber : null,
    };
  };
  // A status chip asked for a shot. Whichever of it and the rail's focus is newer wins.
  const [jump, setJump] = useState<{ shotNumber: number; at: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [newSceneTitle, setNewSceneTitle] = useState("");
  const setSceneId = (id: number) => {
    setSceneIdState(id);
    setJump(null);
    writeStudioPreferences(production.id, { sceneId: id });
  };
  const setViewMode = (mode: StudioViewMode) => {
    setViewModeState(mode);
    writeStudioPreferences(production.id, { viewMode: mode });
  };
  useEffect(() => {
    if (focus?.sceneId != null) {
      setSceneIdState(focus.sceneId);
      setJump(null);
    }
  }, [focus]);
  const send: StudioSend = (method, url, body) => act(method, url, body);
  const attempt = (work: () => Promise<unknown>) => {
    setError(null);
    work().catch((err) => setError(err));
  };
  const scene = production.scenes.find((s) => s.id === sceneId)
    ?? production.scenes.find((s) => s.sceneKey === preferredSceneKey)
    ?? production.scenes[0];

  // Hooks run before the no-scenes return below, so they are declared here: a production
  // with no scenes still has to tell the rail there is nothing selected.
  useEffect(() => {
    publishStudioSelection(selectionOf());
    // selectionOf reads exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id, scene?.id, activeShotNumber]);
  useStudioSelectionRequests(() => publishStudioSelection(selectionOf()));

  if (!scene) {
    return (
      <div className="m-auto grid max-w-sm justify-items-center gap-3 p-6 text-center" data-testid="film-no-scenes">
        <Film className="h-7 w-7 text-muted-foreground/60" aria-hidden />
        <div>
          <p className="text-sm font-medium text-foreground">No scenes to film yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">Shots and takes are organized by scene. Add your first scene to start reviewing film:</p>
        </div>
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const val = newSceneTitle.trim();
            if (!val) return;
            attempt(async () => {
              await act("POST", `/api/media-studio/productions/${production.id}/scenes`, { title: val });
              setNewSceneTitle("");
            });
          }}
        >
          <Input
            placeholder="Scene 1 title..."
            value={newSceneTitle}
            onChange={(e) => setNewSceneTitle(e.target.value)}
            className="h-8 text-xs flex-1"
          />
          <Button type="submit" size="sm" disabled={!newSceneTitle.trim()}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Create Scene 1
          </Button>
        </form>
        <Button type="button" variant="ghost" size="sm" onClick={() => onOpenTab("story")}>Open Story</Button>
      </div>
    );
  }

  const railShotNumber = focus?.shotId != null ? (scene.shots.findIndex((s) => s.id === focus.shotId) + 1 || undefined) : undefined;
  const latestJump = jump && (!focus || jump.at >= focus.at) ? jump : null;
  const focusShotNumber = latestJump ? latestJump.shotNumber : railShotNumber;
  const focusKey = latestJump ? latestJump.at : focus?.at;
  const approvedShots = scene.shots.filter((shot) => shot.takes.some((take) => take.status === "approved")).length;
  const afterAsking = production.video.configured
    ? "It waits for approval in the Decision Inbox before anything renders."
    : "Recorded as a simulation: no video and no charge.";

  // Built from the scene as it is before the change, so undo restores exactly that.
  const approve = (takeId: number) => attempt(async () => {
    const action = approvalAction(scene, [takeId], send);
    await act("POST", `/api/media-studio/takes/${takeId}/approve`);
    history.record(action);
    notify(action.label, `Undo with ${shortcutKeys("undo")}.`);
  });
  const reshoot = (takeId: number, defectClass: DefectClass, notes?: string) => attempt(async () => {
    const before = scene;
    const after = await act("POST", `/api/media-studio/takes/${takeId}/reshoot`, { defectClass, ...(notes ? { notes } : {}) });
    const action = reshootAction(before, [{ takeId, defectClass, notes, newTakeId: newestTakeOf(after, takeId) }], send);
    history.record(action);
    notify(action.label, afterAsking);
  });
  const goToNext = (filter: ShotFilter) => {
    const next = nextMatchingShot(scene.shots, (activeShotNumber ?? 0) - 1, filter);
    if (next != null) setJump({ shotNumber: next + 1, at: Date.now() });
  };
  const copyLink = async () => {
    const shot = activeShotNumber != null ? scene.shots[activeShotNumber - 1] : undefined;
    const link = studioLinkFor({ tab: "film", productionId: production.id, sceneId: scene.id, ...(shot ? { shotId: shot.id } : {}) }, window.location.href);
    const where = `${scene.sceneKey}${shot ? ` shot ${activeShotNumber}` : ""}`;
    try {
      await navigator.clipboard.writeText(link);
      notify("Link copied", `It opens ${where} in Media Studio for anyone who can see this production.`);
    } catch {
      notify("The link could not be copied", `Copy it from here: ${link}`);
    }
  };

  const [timelineScope, setTimelineScope] = useState<"scene" | "film">("scene");
  const allShotsList = production.scenes.flatMap((s) => s.shots);
  const allFilmShots = production.scenes.flatMap((s) => toFilmShots(s));
  const displayedShots = timelineScope === "film" ? allFilmShots : toFilmShots(scene);
  const displayedSceneId = timelineScope === "film" ? "ALL-SCENES" : scene.sceneKey;
  const displayedSceneTitle = timelineScope === "film" ? `${production.title} (Master Film)` : scene.title;

  const audioStems = [
    {
      id: `dialogue-${scene.id}`,
      type: "dialogue" as const,
      title: `${scene.sceneKey} Dialogue`,
      audioUrl: "",
      volumeDb: -12,
      durationSeconds: scene.shots.reduce((acc, s) => acc + s.durationSeconds, 0),
      startTimeSeconds: 0,
    },
    {
      id: `ambience-${scene.id}`,
      type: "ambience" as const,
      title: scene.location ? `${scene.location} Room` : "Room tone",
      audioUrl: "",
      volumeDb: -22,
      durationSeconds: scene.shots.reduce((acc, s) => acc + s.durationSeconds, 0),
      startTimeSeconds: 0,
    },
    {
      id: `score-${scene.id}`,
      type: "score" as const,
      title: scene.mood ? `${scene.mood} Theme` : "Score cue",
      audioUrl: "",
      volumeDb: -18,
      durationSeconds: scene.shots.reduce((acc, s) => acc + s.durationSeconds, 0),
      startTimeSeconds: 0,
    },
    {
      id: `sfx-${scene.id}`,
      type: "sfx" as const,
      title: "Spot FX",
      audioUrl: "",
      volumeDb: -10,
      durationSeconds: scene.shots.reduce((acc, s) => acc + s.durationSeconds, 0),
      startTimeSeconds: 0,
    },
  ];

  return (
    /*
     * The film screen does not scroll; its regions do. Editing is a loop between the
     * viewer and the timeline — move the playhead, watch the frame, mark the point —
     * and while the whole screen scrolled, that loop spanned a scroll: the timeline
     * sat below the fold under the reel and the review queue. See
     * docs/platform/04-ui-ux-and-usability-standards/film-editor-screen-layout.md.
     */
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
      <nav aria-label="Breadcrumb" className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 text-xs" data-testid="film-breadcrumb">
        <button
          type="button"
          onClick={() => onOpenTab("story")}
          className={cn("max-w-[12rem] truncate rounded px-1 font-medium text-muted-foreground hover:text-foreground", FOCUS_RING)}
          title="Open the production's story"
        >
          {production.title}
        </button>
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        {production.scenes.length > 1 ? (
          <select id="media-film-scene" aria-label="Scene" value={scene.id} onChange={(event) => setSceneId(Number(event.target.value))} className="h-7 max-w-[16rem] rounded-md border border-input bg-background px-2 text-xs">
            {production.scenes.map((s) => <option key={s.id} value={s.id}>{s.sceneKey} · {s.title}</option>)}
          </select>
        ) : (
          <span className="truncate font-medium text-foreground">{scene.sceneKey} · {scene.title}</span>
        )}
        {activeShotNumber != null && (
          <>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span aria-current="page" className="font-medium text-foreground">Shot {activeShotNumber} of {scene.shots.length}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-border/80 bg-muted/40 p-0.5" role="group" aria-label="Timeline Scope">
            <button
              type="button"
              onClick={() => setTimelineScope("scene")}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                timelineScope === "scene" ? "bg-primary/15 text-primary font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="film-scope-scene-btn"
            >
              Scene Focus
            </button>
            <button
              type="button"
              onClick={() => setTimelineScope("film")}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                timelineScope === "film" ? "bg-primary/15 text-primary font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="film-scope-master-btn"
            >
              Master Film
            </button>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => void copyLink()} data-testid="film-copy-link-btn">
            <Link2 className="h-3 w-3" aria-hidden />Copy link{activeShotNumber != null ? " to this shot" : ""}
          </Button>
        </div>
      </nav>

      {error ? <StudioErrorAlert error={error} onDismiss={() => setError(null)} /> : null}

      <MediaStudioPod
        program={{ label: displayedSceneTitle || scene.sceneKey, assembly: scene.assembly ?? null }}
        className="min-h-0 flex-1 overflow-hidden"
        sceneId={displayedSceneId}
        sceneTitle={displayedSceneTitle}
        aspectRatio={production.aspectRatio}
        shots={displayedShots}
        audioStems={audioStems}
        timelineScope={timelineScope}
        onTimelineScopeChange={setTimelineScope}
        focusShotNumber={focusShotNumber}
        focusKey={focusKey}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onActiveShotChange={setActiveShotNumber}
        onAddShot={() => attempt(async () => {
          await act("POST", `/api/media-studio/scenes/${scene.id}/shots`, {});
          notify("Added a shot", "Describe what it shows in Shots.");
          onOpenTab("shots");
        })}
        onOpenStoryboard={() => onOpenTab("storyboard")}
        onRequestTake={(_scene, shotNumber) => {
          const targetList = timelineScope === "film" ? allShotsList : scene.shots;
          const shot = targetList[shotNumber - 1];
          if (shot) attempt(async () => {
            await act("POST", `/api/media-studio/shots/${shot.id}/takes`, {});
            notify(`Asked for a take of ${scene.sceneKey} shot ${shotNumber}`, afterAsking);
          });
        }}
        onApproveTake={(_scene, _shot, takeId) => approve(Number(takeId))}
        onRerollTake={(_scene, _shot, takeId, defectClass, notes) => reshoot(Number(takeId), defectClass, notes)}
        onPersistShotTimeline={(shotNumber, patch) => {
          const targetList = timelineScope === "film" ? allShotsList : scene.shots;
          const shot = targetList[shotNumber - 1];
          // durationSeconds is a whole number on the shot; a trim to a frame boundary is
          // not, and the server refuses a fraction. The sub-second part lives in the
          // trim itself, which is what the cut reads.
          const body = patch.durationSeconds === undefined
            ? patch
            : { ...patch, durationSeconds: Math.max(1, Math.round(patch.durationSeconds)) };
          if (shot) attempt(() => act("PATCH", `/api/media-studio/shots/${shot.id}`, body));
        }}
        onChangeTransition={(shotNumber, transition, durationSeconds) => {
          const targetList = timelineScope === "film" ? allShotsList : scene.shots;
          const shot = targetList[shotNumber - 1];
          if (shot) attempt(() => act("PATCH", `/api/media-studio/shots/${shot.id}`, {
            transition,
            ...(durationSeconds !== undefined ? { transitionDurationSeconds: durationSeconds } : {}),
          }));
        }}
        onDiscussTake={onDiscuss && ((_scene, shotNumber, takeId) => {
          const targetList = timelineScope === "film" ? allShotsList : scene.shots;
          const shot = targetList[shotNumber - 1];
          const take = shot?.takes.find((t) => String(t.id) === takeId);
          if (take) onDiscuss({ sceneId: scene.id, sceneKey: scene.sceneKey, kind: "take", id: take.id, label: `${scene.sceneKey} shot ${shotNumber}, take ${take.takeNumber}` });
        })}
      />

      {/* Approved Shots, Reel and Reviewed Several Takes positioned below Director Deck and Timeline */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-border/70 pt-2" data-testid="film-secondary-controls">
        {scene.shots.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]" role="group" aria-label={`Where ${scene.sceneKey}'s shots stand`} data-testid="film-status-summary">
            <span className="mr-1 tabular-nums text-muted-foreground">{approvedShots} of {scene.shots.length} approved</span>
            {SUMMARY_FILTERS.map(({ filter, icon, text }) => {
              const n = scene.shots.filter((shot) => matchesShotFilter(shot, filter)).length;
              return n > 0 ? (
                <button
                  key={filter}
                  type="button"
                  onClick={() => goToNext(filter)}
                  className={cn("flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-muted", FOCUS_RING)}
                  title="Go to the next of these shots"
                  data-testid={`film-filter-${filter}`}
                >
                  <StatusIcon status={icon} />{text(n)}
                </button>
              ) : null;
            })}
          </div>
        )}

        <div className="flex max-h-48 shrink-0 flex-col gap-2 overflow-y-auto" data-testid="film-reading-region">
          <SceneReel scene={scene} act={act} onDiscuss={onDiscuss} />
          <SceneBatchReview production={production} scene={scene} history={history} send={send} />
        </div>
      </div>
    </div>
  );
}

export default MediaStudio;
