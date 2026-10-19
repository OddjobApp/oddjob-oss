import React, { useEffect, useMemo, useRef, useState } from "react";
import { Film, Keyboard, Maximize2, Minimize2, Plus, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MediaStageCanvas } from "./components/MediaStageCanvas";
import { MediaProgramViewer } from "./components/MediaProgramViewer";
import { MediaDailiesInspector } from "./components/MediaDailiesInspector";
import { MediaTimelineSequencer } from "./components/MediaTimelineSequencer";
import { MediaGraphViewer } from "./components/MediaGraphViewer";
import { locateMultiTrackTimelineTime, locateTimelineTime, shotOffsets, totalDuration } from "./timeline";
import { STUDIO_SHORTCUTS, useStudioShortcuts } from "./shortcuts";
import { cn } from "@/lib/utils";
import type { MediaShot, MediaShotTake, MediaStudioPodProps } from "./types";

/** How often the clock moves over a shot that has no video to play. */
const HOLD_TICK_SECONDS = 0.1;

/**
 * The take to compare the one on screen with, at the same moment: the shot's approved
 * take, else the nearest earlier take, else any other. Only takes with video count.
 */
export function compareTakeFor(shot: MediaShot | null, takeIndex: number): MediaShotTake | null {
  const current = shot && takeIndex >= 0 ? shot.takes[takeIndex] : null;
  if (!shot || !current?.videoUrl) return null;
  const others = shot.takes.filter((take, i) => i !== takeIndex && take.videoUrl);
  return others.find((take) => take.status === "approved")
    ?? [...others].reverse().find((take) => take.takeNumber < current.takeNumber)
    ?? others[0]
    ?? null;
}

/**
 * Media Studio: a film scene's shots, their takes and the timeline, beside the
 * CREW conversation.
 *
 * It shows only the shots it is given. It used to fill an empty scene with a
 * made-up storyboard, a spinning "render wave" footer, placeholder audio beds and a
 * budget the agent could set, and Approve or Re-roll changed statuses on screen
 * that nothing had recorded. Review actions now go to whatever handles them, and
 * appear only when something does.
 *
 * Playback runs on one clock for the scene: when a take ends the next shot plays, and
 * a shot with no video still takes its length on the clock, so the playhead, the
 * scrubber and the shot on screen always agree.
 */
export function MediaStudioPod({
  sceneId,
  sceneTitle,
  aspectRatio = "16:9",
  shots = [],
  audioStems = [],
  isFocusMode = false,
  onToggleFocusMode,
  onClose,
  onApproveTake,
  onRerollTake,
  onChangeTransition,
  onDiscussTake,
  onOpenFormStudio,
  onUpdateTakeParams,
  onAddShot,
  onOpenStoryboard,
  onRequestTake,
  focusShotNumber,
  focusKey,
  viewMode: viewModeProp,
  onViewModeChange,
  onActiveShotChange,
  onPersistShotTimeline,
  program,
  timelineScope,
  onTimelineScopeChange,
  onSelectTakeForShot,
  className,
}: MediaStudioPodProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Bumped by the re-shoot shortcut; the inspector opens its re-shoot menu when it changes.
  const [reshootRequest, setReshootRequest] = useState(0);
  // Source shows the take under the playhead, Program the assembled cut. One viewer,
  // two modes, the way an editor's source and program monitors work.
  const [viewerMode, setViewerMode] = useState<"source" | "program">("source");
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Bumped by the full-screen and frame-step shortcuts; the stage acts when they change.
  const [fullscreenRequest, setFullscreenRequest] = useState(0);
  const [frameStepRequest, setFrameStepRequest] = useState<{ direction: 1 | -1; id: number } | null>(null);
  const stepFrame = (direction: 1 | -1) => setFrameStepRequest((last) => ({ direction, id: (last?.id ?? 0) + 1 }));
  const [activeShotIndex, setActiveShotIndex] = useState(() => {
    if (focusShotNumber) {
      const idx = shots.findIndex((s) => s.shotNumber === focusShotNumber);
      if (idx >= 0) return idx;
    }
    return 0;
  });
  // Which take is on screen for each shot, by shot number. Viewing a take does not
  // make it the scene's take.
  const [takeChoice, setTakeChoice] = useState<Record<number, number>>({});
  // Seconds into the shot on screen.
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ownViewMode, setOwnViewMode] = useState<"director" | "graph">(viewModeProp ?? "director");
  const viewMode = viewModeProp ?? ownViewMode;
  const setViewMode = (mode: "director" | "graph") => {
    setOwnViewMode(mode);
    onViewModeChange?.(mode);
  };

  const [localShots, setLocalShots] = useState<MediaShot[]>(shots);
  useEffect(() => {
    setLocalShots(shots);
  }, [shots]);

  const offsets = useMemo(() => shotOffsets(localShots), [localShots]);
  const totalTime = useMemo(() => totalDuration(localShots), [localShots]);

  const takeIndexOf = (shot: MediaShot) => (shot.takes.length > 0
    ? Math.min(Math.max(0, takeChoice[shot.shotNumber] ?? shot.activeTakeIndex), shot.takes.length - 1)
    : -1);

  const shotIndex = Math.min(activeShotIndex, Math.max(0, localShots.length - 1));
  const activeShot = localShots[shotIndex] ?? null;
  const takeIndex = activeShot ? takeIndexOf(activeShot) : -1;
  const activeTake = activeShot && takeIndex >= 0 ? activeShot.takes[takeIndex] : null;
  const compareTake = compareTakeFor(activeShot, takeIndex);
  const shotLength = activeShot?.durationSeconds ?? 0;
  const canPlay = localShots.some((shot) => {
    const index = takeIndexOf(shot);
    return index >= 0 && Boolean(shot.takes[index].videoUrl);
  });

  const selectShot = (index: number) => {
    setActiveShotIndex(index);
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const seekTimeline = (seconds: number) => {
    const at = locateTimelineTime(localShots, seconds);
    if (!at) return;
    if (at.shotIndex !== shotIndex) setIsPlaying(false);
    setActiveShotIndex(at.shotIndex);
    setCurrentTime(at.offsetSeconds);
  };

  const advance = () => {
    if (shotIndex < localShots.length - 1) {
      setActiveShotIndex(shotIndex + 1);
      setCurrentTime(0);
    } else {
      setIsPlaying(false);
    }
  };

  const currentTimelineTime = (offsets[shotIndex] ?? 0) + Math.min(currentTime, shotLength);
  const multiTrackLocation = useMemo(() => {
    return locateMultiTrackTimelineTime(localShots, currentTimelineTime);
  }, [localShots, currentTimelineTime]);

  const activeOverlayShot = multiTrackLocation?.v2ShotIndex !== undefined ? localShots[multiTrackLocation.v2ShotIndex] : null;
  const activeOverlayTake = activeOverlayShot && activeOverlayShot.takes.length > 0 ? activeOverlayShot.takes[activeOverlayShot.activeTakeIndex] : null;

  // Each edit lands on screen at once and is saved behind it. Local state alone is what
  // made every trim and move disappear on reload.
  const handleTrimShot = (shotNumber: number, trimIn: number, trimOut: number, newDuration: number) => {
    const durationSeconds = Math.max(0.2, newDuration);
    setLocalShots((prev) =>
      prev.map((s) =>
        s.shotNumber === shotNumber
          ? {
              ...s,
              trimInSeconds: trimIn,
              trimOutSeconds: trimOut,
              durationSeconds,
            }
          : s
      )
    );
    onPersistShotTimeline?.(shotNumber, { trimInSeconds: trimIn, trimOutSeconds: trimOut, durationSeconds });
  };

  const handleMoveShot = (shotNumber: number, newStartTime: number, track: number) => {
    // A cutaway hangs off the primary shot it was dropped over, a given distance into it,
    // so trimming an earlier shot moves the cutaway with the moment it belongs to instead
    // of leaving it behind. Which shot that is, is read off the timeline as it stands.
    const primaries = localShots.filter((s) => (s.track ?? 1) === 1);
    const primaryStarts = shotOffsets(primaries);
    let anchorIndex = -1;
    primaries.forEach((shot, index) => {
      if (newStartTime >= (primaryStarts[index] ?? 0)) anchorIndex = index;
    });
    const anchor = anchorIndex >= 0 ? primaries[anchorIndex] : undefined;
    const anchorOffsetSeconds = anchor ? Math.max(0, newStartTime - (primaryStarts[anchorIndex] ?? 0)) : undefined;
    const connected = track === 2 && anchor?.shotId != null;

    setLocalShots((prev) =>
      prev.map((s) =>
        s.shotNumber === shotNumber
          ? {
              ...s,
              track,
              startTimeSeconds: track === 2 ? newStartTime : undefined,
              anchorShotId: connected ? anchor?.shotId : undefined,
              anchorOffsetSeconds: connected ? anchorOffsetSeconds : undefined,
            }
          : s
      )
    );
    // A shot back on the primary track follows the one before it, so it keeps no start
    // time or anchor of its own — the server drops both, and sending null keeps them in step.
    onPersistShotTimeline?.(shotNumber, {
      track,
      startTimeSeconds: track === 2 ? newStartTime : null,
      anchorShotId: connected ? anchor?.shotId ?? null : null,
      anchorOffsetSeconds: connected ? anchorOffsetSeconds ?? null : null,
    });
  };

  const handleSplitShot = (shotNumber: number, atTimelineSeconds: number) => {
    const idx = localShots.findIndex((s) => s.shotNumber === shotNumber);
    if (idx < 0) return;
    const shotToSplit = localShots[idx];
    const shotStart = offsets[idx] ?? 0;
    const offsetInShot = atTimelineSeconds - shotStart;
    if (offsetInShot <= 0.2 || offsetInShot >= shotToSplit.durationSeconds - 0.2) return;

    const originalTrimIn = shotToSplit.trimInSeconds ?? 0;
    const splitPoint = originalTrimIn + offsetInShot;
    const originalTrimOut = shotToSplit.trimOutSeconds ?? (originalTrimIn + shotToSplit.durationSeconds);

    const shotA: MediaShot = {
      ...shotToSplit,
      durationSeconds: offsetInShot,
      trimInSeconds: originalTrimIn,
      trimOutSeconds: splitPoint,
      transition: "cut",
    };

    const maxShotNum = Math.max(...localShots.map((s) => s.shotNumber), 0);
    const shotB: MediaShot = {
      ...shotToSplit,
      shotNumber: maxShotNum + 1,
      durationSeconds: shotToSplit.durationSeconds - offsetInShot,
      trimInSeconds: splitPoint,
      trimOutSeconds: originalTrimOut,
      transition: shotToSplit.transition,
    };

    const nextShots = [...localShots];
    nextShots.splice(idx, 1, shotA, shotB);
    setLocalShots(nextShots);
  };

  const handleExtendShot = (shotNumber: number, mode: "hold" | "loop" | "continue", extraSeconds: number) => {
    const shot = localShots.find((s) => s.shotNumber === shotNumber);
    if (!shot) return;
    const holdDurationSeconds = (shot.holdDurationSeconds ?? 0) + extraSeconds;
    const durationSeconds = shot.durationSeconds + extraSeconds;
    setLocalShots((prev) =>
      prev.map((s) =>
        s.shotNumber === shotNumber
          ? { ...s, holdDurationSeconds, durationSeconds }
          : s
      )
    );
    onPersistShotTimeline?.(shotNumber, { holdDurationSeconds, durationSeconds });
  };

  // While playing over a shot with no video, the clock still moves through its length.
  const holding = isPlaying && Boolean(activeShot) && !activeTake?.videoUrl;
  useEffect(() => {
    if (!holding) return;
    const timer = setInterval(() => setCurrentTime((time) => time + HOLD_TICK_SECONDS), HOLD_TICK_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [holding, shotIndex]);
  useEffect(() => {
    if (holding && currentTime >= shotLength) advance();
    // advance reads the shot on screen, which the other dependencies already track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding, currentTime, shotLength]);

  // A shot named from outside the pod, such as the configuration rail, goes on screen.
  useEffect(() => {
    if (!focusShotNumber) return;
    const index = shots.findIndex((shot) => shot.shotNumber === focusShotNumber);
    if (index >= 0) selectShot(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusShotNumber, focusKey]);

  const activeShotNumber = activeShot?.shotNumber ?? null;
  useEffect(() => {
    onActiveShotChange?.(activeShotNumber);
    // Reported when the shot changes, not when the handler's identity does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShotNumber]);

  useStudioShortcuts(rootRef, {
    togglePlay: canPlay ? () => setIsPlaying((playing) => !playing) : undefined,
    nextShot: shots.length ? () => selectShot(Math.min(shotIndex + 1, shots.length - 1)) : undefined,
    previousShot: shots.length ? () => selectShot(Math.max(shotIndex - 1, 0)) : undefined,
    approveTake: onApproveTake && activeShot && activeTake?.status === "ready_for_review"
      ? () => onApproveTake(activeShot.sceneId, activeShot.shotNumber, activeTake.takeId)
      : undefined,
    reshootTake: onRerollTake && activeTake
      ? () => { setViewMode("director"); setReshootRequest((count) => count + 1); }
      : undefined,
    nextFrame: viewMode === "director" && activeTake?.videoUrl ? () => stepFrame(1) : undefined,
    previousFrame: viewMode === "director" && activeTake?.videoUrl ? () => stepFrame(-1) : undefined,
    fullscreen: viewMode === "director" && activeShot ? () => setFullscreenRequest((count) => count + 1) : undefined,
  });

  return (
    <div ref={rootRef} className={cn("flex min-h-0 w-full flex-col rounded-xl border border-border/80 bg-card", className ?? "h-full overflow-hidden")} data-testid="media-studio-pod">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Film className="h-4 w-4" />
          </div>
          <span className="truncate text-sm font-semibold text-foreground">{sceneTitle}</span>
          <Badge variant="outline" className="shrink-0 px-1 py-0 font-mono text-[10px] text-muted-foreground">{sceneId}</Badge>
          <Badge variant="outline" className="shrink-0 px-1 py-0 font-mono text-[10px] text-muted-foreground" data-testid="media-aspect-ratio">{aspectRatio}</Badge>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {shots.length > 0 && (
            <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-muted/40 p-0.5" role="group" aria-label="Studio View Mode">
              <Button
                type="button"
                variant={viewMode === "director" ? "secondary" : "ghost"}
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={() => setViewMode("director")}
                data-testid="view-mode-director-btn"
              >
                <Film className="h-3 w-3" />
                <span>Director Deck</span>
              </Button>
              <Button
                type="button"
                variant={viewMode === "graph" ? "secondary" : "ghost"}
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={() => setViewMode("graph")}
                data-testid="view-mode-graph-btn"
              >
                <Workflow className="h-3 w-3" />
                <span>Pipeline Graph</span>
              </Button>
            </div>
          )}

          {shots.length > 0 && (
            <Button
              type="button"
              variant={showShortcuts ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              aria-expanded={showShortcuts}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts"
              onClick={() => setShowShortcuts((open) => !open)}
              data-testid="media-shortcuts-btn"
            >
              <Keyboard className="h-3.5 w-3.5" />
            </Button>
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

      {showShortcuts && (
        <div className="border-b border-border/60 bg-muted/30 px-3 py-2" data-testid="media-shortcuts">
          <ul className="grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2">
            {STUDIO_SHORTCUTS.map((hint) => (
              <li key={hint.command} className="flex items-center gap-2">
                <span className="flex gap-0.5">
                  {hint.keys.map((key) => <kbd key={key} className="rounded border border-border bg-background px-1 font-mono text-[10px] text-foreground">{key}</kbd>)}
                </span>
                <span className="text-muted-foreground">{hint.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-muted-foreground">They work while the studio has focus, and never while you type in a field.</p>
        </div>
      )}

      {shots.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center" data-testid="media-studio-empty">
          <Film className="h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">No shots in this scene yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            A shot is one camera setup for {sceneTitle}: what it shows, its framing and dialogue, and how long it runs. Make shots from the storyboard's approved keyframes, add one here, or plan them with the room in the chat.
          </p>
          {(onAddShot || onOpenStoryboard) && (
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {onOpenStoryboard && <Button type="button" size="sm" variant="outline" className="h-8" onClick={onOpenStoryboard}>Make shots from the storyboard</Button>}
              {onAddShot && <Button type="button" size="sm" className="h-8 gap-1" onClick={onAddShot}><Plus className="h-3.5 w-3.5" />Add a shot</Button>}
            </div>
          )}
        </div>
      ) : (
        <>
          {viewMode === "director" ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-2.5 md:grid-cols-12">
              <div className="flex min-h-[170px] flex-col md:col-span-7">
                {program && (
                  <div className="mb-1.5 flex shrink-0 items-center gap-1 rounded-md border border-border/80 bg-muted/40 p-0.5" role="group" aria-label="Viewer">
                    {(["source", "program"] as const).map((mode) => (
                      <Button
                        key={mode}
                        type="button"
                        variant={viewerMode === mode ? "secondary" : "ghost"}
                        size="sm"
                        className="h-6 px-2 text-[11px] capitalize"
                        onClick={() => setViewerMode(mode)}
                        data-testid={`viewer-mode-${mode}-btn`}
                        aria-pressed={viewerMode === mode}
                      >
                        {mode === "source" ? "Take" : "Reel"}
                      </Button>
                    ))}
                  </div>
                )}
                {program && viewerMode === "program" ? (
                  <MediaProgramViewer label={program.label} assembly={program.assembly} className="h-full" />
                ) : (
                <MediaStageCanvas
                  activeShot={activeShot}
                  activeTake={activeTake}
                  compareTake={compareTake}
                  aspectRatio={aspectRatio}
                  isPlaying={isPlaying}
                  canPlay={canPlay}
                  currentTime={currentTime}
                  onTogglePlay={() => setIsPlaying((playing) => !playing)}
                  onSeek={setCurrentTime}
                  onEnded={advance}
                  fullscreenRequest={fullscreenRequest}
                  frameStepRequest={frameStepRequest}
                  activeOverlayShot={activeOverlayShot}
                  activeOverlayTake={activeOverlayTake}
                  overlayOffsetSeconds={multiTrackLocation?.v2OffsetSeconds}
                  className="h-full"
                />
                )}
              </div>
              <div className="flex min-h-[170px] flex-col md:col-span-5">
                <MediaDailiesInspector
                  activeShot={activeShot}
                  activeTake={activeTake}
                  activeTakeIndex={takeIndex}
                  onSelectTake={(index) => {
                    if (!activeShot) return;
                    setTakeChoice((choice) => ({ ...choice, [activeShot.shotNumber]: index }));
                    setCurrentTime(0);
                    setIsPlaying(false);
                  }}
                  onApproveTake={onApproveTake}
                  onRerollTake={onRerollTake}
                  onDiscussTake={onDiscussTake}
                  onRequestTake={onRequestTake}
                  reshootRequest={reshootRequest}
                  className="h-full"
                />
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden p-2.5">
              <MediaGraphViewer
                activeShot={activeShot}
                activeTake={activeTake}
                onOpenFormStudio={onOpenFormStudio}
                onApplyParameters={(params) => {
                  if (activeShot && takeIndex >= 0) {
                    onUpdateTakeParams?.(activeShot.shotNumber, takeIndex, params);
                  }
                }}
                className="h-full"
              />
            </div>
          )}

          {/* A share of the editor's height, not whatever the tracks add up to: the
              timeline scrolls its own stack, so more layers deepen the scroll rather
              than pushing the viewer off screen.

              The share has to leave a picture behind it. In a CREW rail the pod is
              about 460px tall, and at 55% plus a 180px floor the timeline took more
              than the viewer, whose columns then overflowed their own scroll area —
              the reel played with two thirds of the frame below the fold. */}
          <div className="flex min-h-[140px] max-h-[40%] shrink-0 flex-col px-2.5 pb-2.5">
            <MediaTimelineSequencer
              className="min-h-0 flex-1"
              shots={localShots}
              audioStems={audioStems}
              activeShotIndex={shotIndex}
              timelineTime={(offsets[shotIndex] ?? 0) + Math.min(currentTime, shotLength)}
              totalTime={totalTime}
              onSelectShot={selectShot}
              onSeek={seekTimeline}
              onChangeTransition={onChangeTransition}
              onTrimShot={handleTrimShot}
              onMoveShot={handleMoveShot}
              onSplitShot={handleSplitShot}
              onExtendShot={handleExtendShot}
              onSelectTake={(shotNumber, takeIdx) => {
                if (onSelectTakeForShot) {
                  onSelectTakeForShot(shotNumber, takeIdx);
                } else {
                  setTakeChoice((choice) => ({ ...choice, [shotNumber]: takeIdx }));
                  setCurrentTime(0);
                  setIsPlaying(false);
                }
              }}
              timelineScope={timelineScope}
              onScopeChange={onTimelineScopeChange}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default MediaStudioPod;
