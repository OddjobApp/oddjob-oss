import React, { useState, useMemo, useEffect } from "react";
import {
  Film,
  Mic,
  Music,
  Wind,
  Zap,
  Volume2,
  VolumeX,
  Plus,
  Scissors,
  Magnet,
  Layers,
  ZoomIn,
  ZoomOut,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { FOCUS_RING, StatusIcon } from "../StatusIcon";
import {
  TAKE_STATUS_LABEL,
  type AudioStemType,
  type MediaAudioStem,
  type MediaShot,
  type ShotTakeStatus,
  type ShotTransition,
} from "../types";
import { TransitionInspectorPopover } from "./TransitionInspectorPopover";
import { useMediaTimelineGantt } from "./useMediaTimelineGantt";

export interface MediaTimelineSequencerProps {
  shots: MediaShot[];
  audioStems?: MediaAudioStem[];
  activeShotIndex: number;
  /** Seconds from the start of the scene or film. */
  timelineTime: number;
  totalTime: number;
  onSelectShot: (index: number) => void;
  /** A click on the clip track, in seconds from the start of the scene. */
  onSeek: (timelineSeconds: number) => void;
  /** Without it, transitions are shown but cannot be changed. */
  onChangeTransition?: (shotNumber: number, transition: ShotTransition, durationSeconds?: number) => void;
  /** Selects a specific take for a shot directly from the timeline */
  onSelectTake?: (shotNumber: number, takeIndex: number) => void;
  /** Trims in/out boundaries or adjusts duration */
  onTrimShot?: (shotNumber: number, trimIn: number, trimOut: number, newDuration: number) => void;
  /** Moves a clip (e.g. V2 cutaway start time or track change) */
  onMoveShot?: (shotNumber: number, newStartTime: number, track: number) => void;
  /** Splits a clip at playhead into two contiguous clips */
  onSplitShot?: (shotNumber: number, atSeconds: number) => void;
  /** Extends a clip beyond source footage (freeze frame, loop, or AI continuation) */
  onExtendShot?: (shotNumber: number, mode: "hold" | "loop" | "continue", extraSeconds: number) => void;
  /** Whether the sequencer is in single-scene focus or master film mode */
  timelineScope?: "scene" | "film";
  onScopeChange?: (scope: "scene" | "film") => void;
  className?: string;
}

const TRANSITION_LABEL: Record<ShotTransition, string> = {
  cut: "Cut",
  crossfade: "Crossfade",
  dip_to_black: "Dip to black",
};

const TRANSITION_GLYPH: Record<ShotTransition, string> = {
  cut: "∣",
  crossfade: "✕",
  dip_to_black: "◼",
};

const NEXT_TRANSITION: Record<ShotTransition, ShotTransition> = {
  cut: "crossfade",
  crossfade: "dip_to_black",
  dip_to_black: "cut",
};

const STATUS_EDGE: Record<ShotTakeStatus, string> = {
  pending_approval: "border-l-muted-foreground/40",
  approved: "border-l-emerald-500",
  ready_for_review: "border-l-amber-500",
  rendering: "border-l-primary",
  queued: "border-l-muted-foreground/40",
  rejected: "border-l-rose-500",
  simulated: "border-l-muted-foreground/40",
  failed: "border-l-rose-500",
};

export const FULL_4_STEM_TRACKS: Array<{ type: AudioStemType; trackLabel: string; name: string; Icon: typeof Mic }> = [
  { type: "dialogue", trackLabel: "A1", name: "Voice", Icon: Mic },
  { type: "ambience", trackLabel: "A2", name: "Room", Icon: Wind },
  { type: "score", trackLabel: "A3", name: "Score", Icon: Music },
  { type: "sfx", trackLabel: "A4", name: "Effects", Icon: Zap },
];

function formatTimecode(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * 24);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

export function MediaTimelineSequencer({
  shots,
  audioStems = [],
  activeShotIndex,
  timelineTime,
  totalTime,
  onSelectShot,
  onSeek,
  onChangeTransition,
  onSelectTake,
  onTrimShot,
  onMoveShot,
  onSplitShot,
  onExtendShot,
  timelineScope = "scene",
  onScopeChange,
  className,
}: MediaTimelineSequencerProps) {
  const safeTotal = Math.max(1, totalTime);
  const playheadPercent = Math.min(100, Math.max(0, (timelineTime / safeTotal) * 100));

  /**
   * Scrubbing: press anywhere on a lane and drag to move the playhead.
   *
   * Finding a trim point means watching the frame under the playhead while you move it,
   * which a click alone cannot do — and the lanes each need it, because the frame you
   * are looking for is as likely to be under a cutaway as under the A-roll. The seek is
   * one per animation frame, since a mouse reports moves faster than the screen redraws.
   */
  const scrubbing = React.useRef<{ strip: HTMLElement; frame: number | null; at: number | null } | null>(null);
  const seekFromClientX = React.useCallback((strip: HTMLElement, clientX: number) => {
    const rect = strip.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * safeTotal);
  }, [onSeek, safeTotal]);

  const startScrub = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    // Left button only, and never when the press began on a clip: that is a trim or a
    // move, and seeking as well would fight the drag the sequencer just started.
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-timeline-clip]")) return;
    const strip = event.currentTarget;
    seekFromClientX(strip, event.clientX);

    const state = { strip, frame: null as number | null, at: null as number | null };
    scrubbing.current = state;

    const onMove = (me: MouseEvent) => {
      me.preventDefault();
      state.at = me.clientX;
      if (state.frame !== null) return;
      state.frame = requestAnimationFrame(() => {
        state.frame = null;
        if (state.at !== null) seekFromClientX(state.strip, state.at);
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (state.frame !== null) cancelAnimationFrame(state.frame);
      scrubbing.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [seekFromClientX]);

  // A drag left running by an unmount would keep seeking into a gone component.
  useEffect(() => () => {
    const state = scrubbing.current;
    if (state?.frame !== null && state?.frame !== undefined) cancelAnimationFrame(state.frame);
  }, []);

  // Multi-track local states: mute and solo controls per track
  const [mutedTracks, setMutedTracks] = useState<Record<string, boolean>>({});
  const [soloTrack, setSoloTrack] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [showV2Overlay, setShowV2Overlay] = useState(false);
  const [stemsState, setStemsState] = useState<MediaAudioStem[]>(audioStems);

  const {
    startDrag,
    dragState,
    dragTooltip,
    containerRef,
  } = useMediaTimelineGantt({
    shots,
    totalDurationSeconds: safeTotal,
    onTrimShot,
    onMoveShot,
  });

  const v1Shots = shots.filter((s) => (s.track ?? 1) === 1);
  const v2Shots = shots.filter((s) => s.track === 2);
  const v1Offsets = useMemo(() => {
    let at = 0;
    return v1Shots.map((shot) => {
      const start = at;
      at += Math.max(0, shot.durationSeconds);
      return start;
    });
  }, [v1Shots]);

  // Keyboard shortcut: Ctrl+B or Cmd+B to split clip at playhead
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        const active = shots[activeShotIndex];
        if (active && onSplitShot) {
          e.preventDefault();
          onSplitShot(active.shotNumber, timelineTime);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shots, activeShotIndex, onSplitShot, timelineTime]);

  // Sync incoming audioStems if passed
  React.useEffect(() => {
    if (audioStems.length > 0) {
      setStemsState(audioStems);
    }
  }, [audioStems]);

  const toggleMute = (trackId: string) => {
    setMutedTracks((prev) => ({ ...prev, [trackId]: !prev[trackId] }));
  };

  const toggleSolo = (trackId: string) => {
    setSoloTrack((prev) => (prev === trackId ? null : trackId));
  };

  const addStem = (type: AudioStemType) => {
    const newStem: MediaAudioStem = {
      id: `stem-${Date.now()}`,
      type,
      title: `${type === "dialogue" ? "Voiceover" : type === "ambience" ? "Room tone" : type === "score" ? "Theme cue" : "Foley hit"}`,
      audioUrl: "",
      volumeDb: type === "score" ? -18 : -12,
      durationSeconds: Math.min(10, Math.max(2, safeTotal / 2)),
      startTimeSeconds: 0,
    };
    setStemsState((prev) => [...prev, newStem]);
  };

  return (
    <div
      className={cn("flex min-h-0 flex-col gap-2 rounded-xl border border-border/70 bg-card p-2.5", className)}
      data-testid="media-timeline-sequencer"
    >
      {/* Top Toolbar: Timecode, Scope Switcher, Zoom, and Editing Tools */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] font-semibold text-foreground">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5 text-primary" />
            <span>Timeline</span>
          </span>
          {/* The scope is SET in the film toolbar, beside the scene it applies to. Here it
              is only stated, because two controls for one piece of state means whichever
              you did not use looks stale. */}
          <span className="rounded border border-border/70 bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" data-testid="timeline-scope-label">
            {timelineScope === "film" ? "Master film" : "Scene"}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-primary bg-primary/10 px-1.5 py-0.5 rounded">
            {formatTimecode(timelineTime)} / {formatTimecode(safeTotal)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {shots.length} {shots.length === 1 ? "shot" : "shots"} · {totalTime}s
          </span>

          <div className="flex items-center gap-1 border-l border-border/60 pl-2">
            {onSplitShot && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const active = shots[activeShotIndex];
                  if (active) onSplitShot(active.shotNumber, timelineTime);
                }}
                title="Split clip at playhead (Ctrl+B)"
                aria-label="Split clip at playhead"
                data-testid="timeline-split-btn"
              >
                <Scissors className="h-3 w-3" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("h-6 w-6", showV2Overlay ? "bg-primary/10 text-primary" : "text-muted-foreground")}
              onClick={() => setShowV2Overlay((v) => !v)}
              title="Toggle V2 Overlay / B-Roll Track"
              data-testid="toggle-v2-track-btn"
            >
              <Layers className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              onClick={() => setZoomLevel((z) => Math.max(0.75, z - 0.25))}
              disabled={zoomLevel <= 0.75}
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.25))}
              disabled={zoomLevel >= 2.5}
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn className="h-3 w-3" />
            </Button>
            <span className="font-mono text-[9px] text-muted-foreground w-8 text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
          </div>
        </div>
      </div>

      {/* Multi-Track Sequencer Canvas.
          Scrolls both ways: sideways through time, and DOWN through the stack. A
          composite is layers over layers — overlays, titles, effects, four audio
          lanes — and a cut with six of them must not push the viewer off screen or
          clip its own lower tracks. The toolbar above stays put while this moves. */}
      <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto rounded-lg border border-border/40 bg-muted/20 p-2">
        {/* Floating Tooltip during drag */}
        {dragTooltip && (
          <div
            className="pointer-events-none absolute z-50 -translate-x-1/2 rounded border border-border/80 bg-popover px-2 py-1 text-center font-mono text-[10px] text-popover-foreground shadow-lg backdrop-blur-xs"
            style={{ left: Math.max(40, dragTooltip.x), top: Math.max(10, dragTooltip.y) }}
          >
            <div className="font-semibold text-primary">{dragTooltip.text}</div>
            {dragTooltip.subtext && <div className="text-[9px] text-muted-foreground">{dragTooltip.subtext}</div>}
          </div>
        )}

        {/* Optional V2 Overlay / B-Roll Track */}
        {(showV2Overlay || v2Shots.length > 0 || Boolean(onMoveShot)) && (
          <div className="flex min-h-[36px] items-center gap-1 border-b border-border/30 pb-1.5" data-testid="track-v2-overlay">
            <div className="flex w-20 shrink-0 items-center justify-between pr-2">
              <span className="font-mono text-[10px] font-semibold text-muted-foreground">V2 B-Roll</span>
              <Badge variant="outline" className="text-[8px] px-1 py-0 h-4 border-primary/40 text-primary">
                Overlay
              </Badge>
            </div>
            <div
              className="relative flex min-w-0 flex-1 cursor-text items-center rounded border border-dashed border-border/60 bg-muted/10 h-8 px-1"
              data-timeline-track="2"
              data-testid="timeline-overlay-track"
              onMouseDown={startScrub}
            >
              {v2Shots.length > 0 ? (
                v2Shots.map((v2Shot) => {
                  const v2Start = v2Shot.startTimeSeconds ?? 0;
                  return (
                    <div
                      key={`v2-shot-${v2Shot.shotNumber}`}
                      data-timeline-clip
                      style={{
                        left: `${(v2Start / safeTotal) * 100}%`,
                        width: `${Math.max(6, (v2Shot.durationSeconds / safeTotal) * 100)}%`,
                      }}
                      className={cn(
                        "group absolute top-1 bottom-1 flex min-w-[60px] items-center justify-between rounded border border-primary/60 bg-primary/20 px-2 text-[9px] font-semibold text-foreground select-none cursor-grab active:cursor-grabbing",
                        FOCUS_RING
                      )}
                      onMouseDown={(e) => startDrag(e, v2Shot, v2Start, "move")}
                      data-testid={`v2-shot-${v2Shot.shotNumber}`}
                    >
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-primary/40 z-10"
                        onMouseDown={(e) => startDrag(e, v2Shot, v2Start, "trim-left")}
                        data-testid={`v2-trim-left-${v2Shot.shotNumber}`}
                      />
                      <span className="truncate">Shot {v2Shot.shotNumber} (Cutaway)</span>
                      <span className="font-mono text-[8px] text-muted-foreground">{v2Shot.durationSeconds}s</span>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-primary/40 z-10"
                        onMouseDown={(e) => startDrag(e, v2Shot, v2Start, "trim-right")}
                        data-testid={`v2-trim-right-${v2Shot.shotNumber}`}
                      />
                    </div>
                  );
                })
              ) : (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1 px-1">
                  <Plus className="h-3 w-3 text-muted-foreground/60" /> Drop cutaways, reaction B-roll, or graphics here
                </span>
              )}
            </div>
          </div>
        )}

        {/* Primary Video Track (V1) */}
        <div className="flex min-h-[60px] items-center gap-1">
          <div className="flex w-20 shrink-0 flex-col justify-center gap-0.5 pr-2">
            <span className="font-mono text-[10px] font-semibold text-foreground">V1 Video</span>
            <span className="font-mono text-[8px] text-muted-foreground">Main A-Roll</span>
          </div>

          <div
            className="relative flex min-w-0 flex-1 cursor-text items-center gap-1 py-1"
            data-timeline-track="1"
            data-testid="timeline-clip-track"
            onMouseDown={startScrub}
          >
            {/* Playhead Scrubber */}
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-30 w-0.5 bg-primary shadow-sm"
              style={{ left: `${playheadPercent}%` }}
              data-testid="timeline-playhead"
            >
              <div className="h-2 w-2 -translate-x-[3px] rotate-45 rounded-xs bg-primary" />
            </div>

            {v1Shots.map((shot, index) => {
              const take = shot.takes[shot.activeTakeIndex];
              const isSelected = index === activeShotIndex;
              const transition = shot.transition ?? "cut";
              const transitionDuration = shot.transitionDurationSeconds ?? (transition === "dip_to_black" ? 1.0 : 0.75);
              const nextShot = v1Shots[index + 1];
              const maxTransitionDuration = nextShot
                ? Math.min(shot.durationSeconds / 2, nextShot.durationSeconds / 2)
                : 1.0;

              return (
                <React.Fragment key={`shot-${shot.shotNumber}`}>
                  {/* Clip Block */}
                  <div
                    data-timeline-clip
                    onMouseDown={onMoveShot ? (e) => startDrag(e, shot, v1Offsets[index] ?? 0, "move") : undefined}
                    style={{
                      flexGrow: Math.max(1, shot.durationSeconds) * zoomLevel,
                      flexBasis: 0,
                    }}
                    className={cn(
                      "group relative flex min-w-[80px] flex-col justify-between overflow-hidden rounded-md border border-l-4 p-1.5 text-left transition-colors select-none",
                      isSelected
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "border-border/80 bg-card hover:bg-muted/50",
                      take ? STATUS_EDGE[take.status] : "border-l-muted-foreground/40",
                      FOCUS_RING
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectShot(index);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`Shot ${shot.shotNumber}, ${shot.durationSeconds} seconds, ${take ? TAKE_STATUS_LABEL[take.status] : "no takes"}`}
                    data-testid={`timeline-shot-clip-${shot.shotNumber}`}
                  >
                    {/* Top Row: Shot title + in-clip take dropdown */}
                    <div className="flex items-center justify-between gap-1 text-[10px] font-semibold text-foreground">
                      <span className="truncate">Shot {shot.shotNumber}</span>
                      {shot.takes.length > 1 && onSelectTake ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 rounded px-1 text-[9px] font-mono text-primary bg-primary/15 hover:bg-primary/25 transition-colors"
                              title="Switch take on timeline"
                              data-testid={`shot-${shot.shotNumber}-take-dropdown-btn`}
                            >
                              <span>T{take?.takeNumber ?? 1}</span>
                              <ChevronDown className="h-2.5 w-2.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-32 p-1">
                            {shot.takes.map((t, tIdx) => (
                              <DropdownMenuItem
                                key={t.takeId}
                                onClick={() => onSelectTake(shot.shotNumber, tIdx)}
                                className={cn(
                                  "text-xs flex items-center justify-between cursor-pointer",
                                  tIdx === shot.activeTakeIndex && "font-semibold text-primary"
                                )}
                              >
                                <span>Take {t.takeNumber}</span>
                                <Badge variant="outline" className="text-[9px] px-1 py-0">
                                  {t.status}
                                </Badge>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="font-mono text-[9px] text-muted-foreground">{shot.durationSeconds}s</span>
                      )}
                    </div>

                    {/* Bottom Row: Status Icon & Take label */}
                    <span className="truncate text-[9px] text-muted-foreground mt-1">
                      <StatusIcon status={take ? take.status : "none"} className="mr-0.5 inline h-2.5 w-2.5 align-[-2px]" />
                      {take ? `${TAKE_STATUS_LABEL[take.status]} · T${take.takeNumber}` : "No takes"}
                    </span>

                    {/* Non-destructive Trim Handles */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-2.5 z-20 cursor-ew-resize hover:bg-primary/40 transition-colors flex items-center justify-center group/trim-left"
                      title={`Trim In-Point (Head): ${formatTimecode(shot.trimInSeconds ?? 0)}`}
                      onMouseDown={(e) => startDrag(e, shot, v1Offsets[index] ?? 0, "trim-left")}
                      data-testid={`trim-handle-left-${shot.shotNumber}`}
                    >
                      <div className="w-0.5 h-3.5 bg-muted-foreground/50 group-hover/trim-left:bg-primary rounded-full transition-colors" />
                    </div>

                    <div
                      className="absolute right-0 top-0 bottom-0 w-2.5 z-20 cursor-ew-resize hover:bg-primary/40 transition-colors flex items-center justify-center group/trim-right"
                      title={`Trim Out-Point / Extend (Tail): ${formatTimecode(shot.trimOutSeconds ?? (shot.durationSeconds + (shot.trimInSeconds ?? 0)))}`}
                      onMouseDown={(e) => startDrag(e, shot, v1Offsets[index] ?? 0, "trim-right")}
                      data-testid={`trim-handle-right-${shot.shotNumber}`}
                    >
                      <div className="w-0.5 h-3.5 bg-muted-foreground/50 group-hover/trim-right:bg-primary rounded-full transition-colors" />
                    </div>

                    {shot.holdDurationSeconds && shot.holdDurationSeconds > 0 && (
                      <div
                        className="absolute right-3 bottom-1 rounded bg-amber-500/20 px-1 text-[8px] font-mono font-semibold text-amber-600 dark:text-amber-400"
                        title={`Freeze frame hold: +${shot.holdDurationSeconds}s`}
                      >
                        Hold +{shot.holdDurationSeconds}s
                      </div>
                    )}
                  </div>

                  {/* Transition Node Between Clips */}
                  {index < shots.length - 1 && (
                    onChangeTransition ? (
                      <div className="flex items-center shrink-0 -mx-1 z-10">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onChangeTransition(shot.shotNumber, NEXT_TRANSITION[transition]);
                          }}
                          aria-label={`Transition after shot ${shot.shotNumber}: ${TRANSITION_LABEL[transition]}. Click to cycle.`}
                          title={`${TRANSITION_LABEL[transition]} — click to cycle`}
                          className={cn(
                            "flex h-7 min-w-[24px] px-1.5 shrink-0 items-center justify-center gap-0.5 rounded-l border border-border/60 bg-muted/70 font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-all shadow-xs",
                            transition !== "cut" && "border-primary/40 text-primary bg-primary/10",
                            FOCUS_RING
                          )}
                          data-testid={`transition-node-${shot.shotNumber}`}
                        >
                          <span className="font-bold">{TRANSITION_GLYPH[transition]}</span>
                        </button>
                        <TransitionInspectorPopover
                          shotNumber={shot.shotNumber}
                          currentTransition={transition}
                          currentDurationSeconds={transitionDuration}
                          maxAllowedDuration={maxTransitionDuration}
                          onApply={(newType, newDuration) => {
                            onChangeTransition(shot.shotNumber, newType, newDuration);
                          }}
                          onApplyToAll={(newType, newDuration) => {
                            shots.forEach((s) => {
                              onChangeTransition(s.shotNumber, newType, newDuration);
                            });
                          }}
                        >
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Configure transition after shot ${shot.shotNumber}`}
                            title="Transition Inspector (duration & presets)"
                            className={cn(
                              "flex h-7 px-1 shrink-0 items-center justify-center rounded-r border-y border-r border-border/60 bg-muted/50 font-mono text-[8px] text-muted-foreground hover:bg-muted hover:text-foreground transition-all shadow-xs",
                              transition !== "cut" && "border-primary/40 text-primary bg-primary/5 font-medium"
                            )}
                            data-testid={`transition-inspector-btn-${shot.shotNumber}`}
                          >
                            <span className="tabular-nums">{transitionDuration}s</span>
                          </button>
                        </TransitionInspectorPopover>
                      </div>
                    ) : (
                      <span
                        title={TRANSITION_LABEL[transition]}
                        aria-label={`Transition after shot ${shot.shotNumber}: ${TRANSITION_LABEL[transition]}`}
                        className="flex h-6 w-5 shrink-0 items-center justify-center font-mono text-[8px] text-muted-foreground"
                        data-testid={`transition-marker-${shot.shotNumber}`}
                      >
                        {TRANSITION_GLYPH[transition]}
                      </span>
                    )
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Full 4-Stem Audio Tracks (A1 Voice, A2 Room, A3 Score, A4 Effects) */}
        {FULL_4_STEM_TRACKS.filter(({ type }) => stemsState.some((stem) => stem.type === type)).map(({ type, trackLabel, name, Icon }) => {
          const stems = stemsState.filter((stem) => stem.type === type);
          const isMuted = mutedTracks[type] || (soloTrack != null && soloTrack !== type);
          const isSolo = soloTrack === type;

          return (
            <div
              key={type}
              className="flex min-h-[32px] items-center gap-1 border-t border-border/30 pt-1"
              data-testid={`audio-track-${type}`}
            >
              {/* Audio Track Header */}
              <div className="flex w-20 shrink-0 items-center justify-between pr-2">
                <span className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground">
                  <Icon className="h-2.5 w-2.5 text-primary/80" />
                  <span className="font-semibold">{trackLabel}</span>
                  <span className="text-[8px] opacity-70 truncate max-w-[28px]">{name}</span>
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => toggleMute(type)}
                    className={cn(
                      "h-4 w-4 rounded text-[8px] font-mono flex items-center justify-center transition-colors",
                      isMuted
                        ? "bg-rose-500/20 text-rose-500 font-bold"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                    title={isMuted ? "Unmute track" : "Mute track (M)"}
                    aria-label={`Mute ${name} track`}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSolo(type)}
                    className={cn(
                      "h-4 w-4 rounded text-[8px] font-mono flex items-center justify-center transition-colors",
                      isSolo
                        ? "bg-amber-500/20 text-amber-500 font-bold"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                    title={isSolo ? "Clear solo" : "Solo track (S)"}
                    aria-label={`Solo ${name} track`}
                  >
                    S
                  </button>
                </div>
              </div>

              {/* Audio Track Lane */}
              <div className="relative h-6 flex-1 overflow-hidden rounded border border-border/40 bg-card/60">
                {stems.map((stem) => (
                  <div
                    key={stem.id}
                    className={cn(
                      "absolute top-0.5 flex h-4.5 items-center justify-between truncate rounded border px-1.5 font-mono text-[8px] transition-all",
                      isMuted
                        ? "opacity-40 border-border/50 bg-muted text-muted-foreground"
                        : "border-primary/40 bg-primary/15 text-foreground shadow-xs"
                    )}
                    style={{
                      left: `${(stem.startTimeSeconds / safeTotal) * 100}%`,
                      width: `${Math.max(8, (stem.durationSeconds / safeTotal) * 100)}%`,
                    }}
                    title={`${stem.title} (${stem.volumeDb} dB)`}
                  >
                    <span className="truncate">{stem.title}</span>
                    <span className="text-[7px] text-muted-foreground tabular-nums ml-1">
                      {stem.volumeDb}dB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {FULL_4_STEM_TRACKS.some(({ type }) => !stemsState.some((stem) => stem.type === type)) && (
          <div className="flex items-center justify-start pt-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  data-testid="add-audio-track-menu-btn"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Stem Track</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-36 p-1">
                {FULL_4_STEM_TRACKS.filter(({ type }) => !stemsState.some((stem) => stem.type === type)).map((trk) => (
                  <DropdownMenuItem
                    key={trk.type}
                    onClick={() => addStem(trk.type)}
                    className="text-xs cursor-pointer flex items-center gap-2"
                  >
                    <trk.Icon className="h-3 w-3 text-primary" />
                    <span>{trk.trackLabel} {trk.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}
