import React, { useEffect, useMemo, useRef, useState } from "react";
import { stepLabel } from "../status";
import { Activity, Camera, Loader2, Maximize, Minimize, Pause, Play, Repeat, SkipBack, SkipForward, SplitSquareVertical, Sparkles, StepBack, StepForward, Volume2, VolumeX, Workflow } from "lucide-react";
import { StatusIcon } from "../StatusIcon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import StatusTimeline from "@domain-ui/core/ui/components/packaged/StatusTimeline";
import { TAKE_STATUS_LABEL, type MediaAspectRatio, type MediaShot, type MediaShotTake, type ShotTakeStatus } from "../types";
import { withAssetOrg } from "../api";

export interface MediaStageCanvasProps {
  activeShot: MediaShot | null;
  /** The take on screen. */
  activeTake: MediaShotTake | null;
  /** Another take of the shot with video, for A/B compare at the same moment. */
  compareTake: MediaShotTake | null;
  aspectRatio: MediaAspectRatio;
  isPlaying: boolean;
  /** Something in the scene can play; without it, Play is disabled. Defaults to whether this take has video. */
  canPlay?: boolean;
  /** Seconds into the take on screen. */
  currentTime: number;
  onTogglePlay: () => void;
  /** A seek by the viewer, or playback reporting its position. */
  onSeek: (seconds: number) => void;
  /** The take finished playing, and is not looping. */
  onEnded?: () => void;
  /** Changes when the full-screen shortcut is pressed. */
  fullscreenRequest?: number;
  /** Changes when a frame-step shortcut is pressed. */
  frameStepRequest?: { direction: 1 | -1; id: number } | null;
  /** Active V2 cutaway overlay shot playing at the same timestamp */
  activeOverlayShot?: MediaShot | null;
  /** Active take for the V2 cutaway */
  activeOverlayTake?: MediaShotTake | null;
  /** Offset in seconds into the V2 cutaway take */
  overlayOffsetSeconds?: number;
  className?: string;
}

/** Reels are cut at 24 frames a second (assembly-plan), so one frame is a 24th of a second. */
export const FRAME_SECONDS = 1 / 24;

const STATUS_CLASS: Record<ShotTakeStatus, string> = {
  pending_approval: "bg-muted text-muted-foreground border border-border",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30",
  ready_for_review: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
  rendering: "bg-primary/15 text-primary border border-primary/30",
  queued: "bg-muted text-muted-foreground",
  rejected: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30",
  simulated: "bg-muted text-muted-foreground border border-border",
  failed: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30",
};

const ASPECT_CLASS: Record<MediaAspectRatio, string> = {
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16] max-h-[360px]",
  "2.39:1": "aspect-[2.39/1]",
  "4:3": "aspect-[4/3]",
  "1:1": "aspect-square max-h-[360px]",
};

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const hundredths = Math.floor((safe % 1) * 100);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function noVideoMessage(take: MediaShotTake | null): string {
  if (!take) return "This shot has no takes yet.";
  switch (take.status) {
    case "simulated": return "Simulated take: no video was generated.";
    case "pending_approval": return "This take is waiting for approval to render.";
    case "queued":
    case "rendering": return "This take is still rendering.";
    case "failed": return "This take failed to render.";
    default: return "No video for this take.";
  }
}

/** Plays or pauses a video element, leaving it paused when the browser cannot play the file. */
function setPlaying(video: HTMLVideoElement | null, playing: boolean) {
  if (!video) return;
  try {
    if (playing) void video.play()?.catch(() => {});
    else video.pause();
  } catch { /* Not playable here. */ }
}

export function MediaStageCanvas({
  activeShot,
  activeTake,
  compareTake,
  aspectRatio,
  isPlaying,
  canPlay,
  currentTime,
  onTogglePlay,
  onSeek,
  onEnded,
  fullscreenRequest,
  frameStepRequest,
  activeOverlayShot,
  activeOverlayTake,
  overlayOffsetSeconds,
  className,
}: MediaStageCanvasProps) {
  const [isSplitCompare, setIsSplitCompare] = useState(false);
  const [splitPosition, setSplitPosition] = useState(50);
  const [isMuted, setIsMuted] = useState(false);
  // Off by default, so playback runs on through the scene.
  const [isLooping, setIsLooping] = useState(false);
  const [showPipelineTimeline, setShowPipelineTimeline] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const compareRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLVideoElement>(null);

  const videoUrl = withAssetOrg(activeTake?.videoUrl);
  const compareUrl = withAssetOrg(compareTake?.videoUrl);
  const overlayUrl = withAssetOrg(activeOverlayTake?.videoUrl);
  const duration = activeTake?.durationSeconds ?? activeShot?.durationSeconds ?? 0;
  const comparing = isSplitCompare && Boolean(videoUrl && compareUrl);
  const playable = canPlay ?? Boolean(videoUrl || overlayUrl);

  const pipelineEvents = useMemo(() => {
    type EventStatus = "completed" | "in_progress" | "failed" | "pending" | "info";
    const isRendering = activeTake?.status === "rendering";
    const isQueued = activeTake?.status === "queued";
    const isDone = activeTake?.status === "approved" || activeTake?.status === "ready_for_review";
    const activeNode = activeTake?.streaming?.activeNodeId;

    const scribeStatus: EventStatus = isQueued ? "in_progress" : "completed";
    const charStatus: EventStatus = isQueued ? "pending" : activeNode === "ip_adapter" ? "in_progress" : "completed";
    const samplerStatus: EventStatus = isRendering && (!activeNode || activeNode === "sampler_node")
      ? "in_progress"
      : isDone || activeNode === "vae_decode"
      ? "completed"
      : isQueued
      ? "pending"
      : "completed";
    const vaeStatus: EventStatus = activeNode === "vae_decode"
      ? "in_progress"
      : isDone
      ? "completed"
      : "pending";
    const hilStatus: EventStatus = activeTake?.status === "approved" || activeTake?.status === "ready_for_review"
      ? "completed"
      : activeTake?.status === "pending_approval"
      ? "in_progress"
      : "pending";
    const sinkStatus: EventStatus = activeTake?.status === "approved" ? "completed" : "pending";

    return [
      {
        id: "stage-scribe",
        timestamp: "L0",
        title: "Scribe Scene Narrative",
        description: "Slugline, character dialogue stem and shot direction",
        status: scribeStatus,
      },
      {
        id: "stage-character",
        timestamp: "L1",
        title: "Character Continuity Anchor",
        description: activeTake?.characterAnchorId
          ? `Anchor: ${activeTake.characterAnchorId} with face tensor`
          : "Base character reference profile",
        status: charStatus,
      },
      {
        id: "stage-sampler",
        timestamp: "L2",
        title: "ComfyUI Diffusion Engine",
        description: activeTake?.streaming
          ? stepLabel(activeTake.streaming)
          : "HunyuanVideo Euler Normal sampling",
        status: samplerStatus,
      },
      {
        id: "stage-vae",
        timestamp: "L3",
        title: "Tiled VAE Spatial Decode",
        description: "Tiled latent temporal-to-RGB video frame decoding",
        status: vaeStatus,
      },
      {
        id: "stage-hil",
        timestamp: "L4",
        title: "Oddjob HIL Governance Gate",
        description: "W3C trace validation, safety checks and human sign-off",
        status: hilStatus,
      },
      {
        id: "stage-sink",
        timestamp: "L5",
        title: "Knowledge Garden Dataset Sink",
        description: "Indexing take, prompt vectors, and keyframes to dataset",
        status: sinkStatus,
      },
    ];
  }, [activeTake]);

  // Play or pause, including when a new take's video replaces the last one.
  useEffect(() => setPlaying(videoRef.current, isPlaying), [isPlaying, videoUrl]);
  useEffect(() => setPlaying(compareRef.current, isPlaying), [isPlaying, comparing, compareTake?.videoUrl]);
  useEffect(() => setPlaying(overlayRef.current, isPlaying), [isPlaying, overlayUrl]);

  // A seek moves the video. Playback reports its own position back through onSeek,
  // which stays within this tolerance and so does not seek again. The compared take
  // follows the same clock.
  useEffect(() => {
    const video = videoRef.current;
    if (video && Math.abs(video.currentTime - currentTime) > 0.5) video.currentTime = currentTime;
    const compare = compareRef.current;
    if (compare && Math.abs(compare.currentTime - currentTime) > 0.25) compare.currentTime = currentTime;
    const overlay = overlayRef.current;
    if (overlay && overlayOffsetSeconds !== undefined && Math.abs(overlay.currentTime - overlayOffsetSeconds) > 0.25) {
      overlay.currentTime = overlayOffsetSeconds;
    }
  }, [currentTime, videoUrl, comparing, compareTake?.videoUrl, overlayUrl, overlayOffsetSeconds]);

  // Full screen takes the stage with its controls. The browser can refuse (no user
  // gesture, or not supported), and Escape leaves it without telling the studio.
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(rootRef.current) && document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => {});
    else void root.requestFullscreen?.()?.catch(() => {});
  };

  /** Pauses and moves one frame, so a glitch or a cut can be looked at exactly. */
  const stepFrame = (direction: 1 | -1) => {
    if (!videoUrl) return;
    if (isPlaying) onTogglePlay();
    const video = videoRef.current;
    const from = video ? video.currentTime : currentTime;
    const to = Math.min(Math.max(0, from + direction * FRAME_SECONDS), duration || from);
    if (video) video.currentTime = to;
    if (compareRef.current) compareRef.current.currentTime = to;
    onSeek(to);
  };

  const lastFullscreenRequest = useRef(fullscreenRequest);
  useEffect(() => {
    if (fullscreenRequest === lastFullscreenRequest.current) return;
    lastFullscreenRequest.current = fullscreenRequest;
    toggleFullscreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreenRequest]);
  useEffect(() => {
    if (frameStepRequest) stepFrame(frameStepRequest.direction);
    // A request steps once, when its id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameStepRequest?.id]);

  return (
    <div
      ref={rootRef}
      className={cn("relative flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card", isFullscreen && "h-full w-full justify-center rounded-none border-0 bg-background", className)}
      data-testid="media-stage-canvas"
    >
      {/* Fills the stage rather than demanding a fixed 220px of it. In a CREW rail the
          canvas is about 135px tall, and a floor taller than the box it sits in is simply
          cut off by the overflow-hidden above — the take played with its bottom half gone.
          object-contain letterboxes into whatever height there is instead. */}
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-muted/40">
        <div className={cn("relative flex max-h-full w-full items-center justify-center", ASPECT_CLASS[aspectRatio])}>
          {videoUrl ? (
            <div className="relative h-full w-full">
              <video
                ref={videoRef}
                src={videoUrl}
                loop={isLooping}
                muted={isMuted}
                playsInline
                className="h-full w-full bg-background object-contain"
                onTimeUpdate={(event) => onSeek(event.currentTarget.currentTime)}
                onEnded={() => {
                  if (onEnded) onEnded();
                  else if (isPlaying) onTogglePlay();
                }}
                data-testid="stage-video"
              />
              {comparing && compareTake && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden border-r-2 border-primary" style={{ width: `${splitPosition}%` }}>
                  <video ref={compareRef} src={compareUrl} loop={isLooping} muted playsInline className="h-full w-full bg-background object-contain" data-testid="stage-compare-video" />
                  <div className="absolute left-2 top-2 rounded border border-border bg-card/90 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    Take {compareTake.takeNumber}
                  </div>
                </div>
              )}
              {overlayUrl && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/30 backdrop-blur-xs" data-testid="stage-v2-cutaway-overlay">
                  <video ref={overlayRef} src={overlayUrl} loop={isLooping} muted playsInline className="h-full w-full bg-background object-contain" data-testid="stage-overlay-video" />
                  <div className="absolute right-2 top-2 rounded border border-primary/40 bg-card/90 px-2 py-0.5 font-mono text-[10px] text-primary shadow-xs backdrop-blur-xs flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    <span>V2 Cutaway · Shot {activeOverlayShot?.shotNumber}</span>
                  </div>
                </div>
              )}
            </div>
          ) : activeTake?.streaming?.previewUrl ? (
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-background" data-testid="stage-streaming-preview">
              <img
                src={activeTake.streaming.previewUrl}
                alt="Live ComfyUI latent stream"
                className="h-full w-full object-contain"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
              <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-1.5 rounded-lg border border-border/80 bg-card/90 p-2 backdrop-blur-sm shadow-md">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    <span>Streaming Latents · {stepLabel(activeTake.streaming)}</span>
                  </div>
                  {(activeTake.streaming.activeNodeTitle || activeTake.streaming.activeNodeLabel) && (
                    <span className="truncate max-w-[150px] font-mono text-[10px] text-muted-foreground">
                      {activeTake.streaming.activeNodeTitle || activeTake.streaming.activeNodeLabel}
                    </span>
                  )}
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(5, (((activeTake.streaming.currentStep ?? activeTake.streaming.step ?? 0) / Math.max(1, activeTake.streaming.totalSteps))) * 100))}%` }}
                  />
                </div>
              </div>
            </div>
          ) : activeTake?.status === "rendering" || activeTake?.status === "queued" ? (
            <div className="flex flex-col items-center justify-center gap-3 p-6 text-center" data-testid="stage-rendering-progress">
              <div className="relative flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary stroke-[1.5]" />
                {activeTake.streaming && (
                  <span className="absolute font-mono text-[10px] font-bold text-primary">
                    {Math.round((((activeTake.streaming.currentStep ?? activeTake.streaming.step ?? 0) / Math.max(1, activeTake.streaming.totalSteps))) * 100)}%
                  </span>
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {activeTake.status === "queued" ? "Queued in ComfyUI Engine..." : "Rendering Take via ComfyUI DAG..."}
                </p>
                {activeTake.streaming && (
                  <div className="mt-1 flex flex-col items-center gap-1">
                    <p className="font-mono text-xs text-muted-foreground">
                      {stepLabel(activeTake.streaming)}
                      {(activeTake.streaming.activeNodeTitle || activeTake.streaming.activeNodeLabel) ? ` · ${activeTake.streaming.activeNodeTitle || activeTake.streaming.activeNodeLabel}` : ""}
                    </p>
                    {(activeTake.streaming.etc || activeTake.streaming.etaSeconds != null) && (
                      <p className="font-mono text-xs font-medium text-primary">
                        ETC: {activeTake.streaming.etc ?? "calculating..."}
                        {activeTake.streaming.etaSeconds != null ? ` (~${Math.ceil(activeTake.streaming.etaSeconds / 60)}m remaining)` : ""}
                      </p>
                    )}
                    <div className="mt-0.5 h-1.5 w-48 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-all duration-300 ease-out"
                        style={{ width: `${Math.min(100, Math.max(5, activeTake.streaming.percent ?? (((activeTake.streaming.currentStep ?? activeTake.streaming.step ?? 0) / Math.max(1, activeTake.streaming.totalSteps)) * 100)))}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              {activeShot && activeTake.prompt && (
                <p className="max-w-xs truncate text-xs text-muted-foreground">Shot {activeShot.shotNumber}: {activeTake.prompt}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 p-6 text-center" data-testid="stage-no-video">
              <Camera className="h-10 w-10 stroke-[1.25] text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">{noVideoMessage(activeTake)}</p>
              {activeShot && activeTake?.prompt && (
                <p className="max-w-xs text-xs text-muted-foreground">Shot {activeShot.shotNumber}: {activeTake.prompt}</p>
              )}
            </div>
          )}

          <div className="pointer-events-none absolute left-2.5 top-2.5 flex flex-wrap items-center gap-1.5">
            {activeTake?.seed !== undefined && activeTake.seed !== "" && (
              <Badge variant="outline" className="border-border bg-card/90 font-mono text-[10px] text-foreground">
                <Sparkles className="mr-1 h-2.5 w-2.5" />
                {String(activeTake.seed)}
              </Badge>
            )}
            {activeTake?.cameraMotion && (
              <Badge variant="outline" className="border-border bg-card/90 text-[10px] text-foreground">
                <Camera className="mr-1 h-2.5 w-2.5" />
                {activeTake.cameraMotion}
              </Badge>
            )}
            {activeTake?.workflowSnapshot && (
              <Badge variant="outline" className="border-border bg-card/90 font-mono text-[10px] text-foreground">
                <Workflow className="mr-1 h-2.5 w-2.5 text-primary" />
                {activeTake.workflowSnapshot.recipeName || activeTake.workflowSnapshot.templateId}
              </Badge>
            )}
            {activeTake?.workflowSnapshot?.cachedNodes && activeTake.workflowSnapshot.cachedNodes.length > 0 && (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                {activeTake.workflowSnapshot.cachedNodes.length} cached
              </Badge>
            )}
          </div>

          {activeTake && (
            <div className="pointer-events-none absolute right-2.5 top-2.5">
              <Badge className={cn("gap-1 text-[10px] font-medium", STATUS_CLASS[activeTake.status])} data-testid="stage-take-status">
                <StatusIcon status={activeTake.status} />
                {TAKE_STATUS_LABEL[activeTake.status]} · Take {activeTake.takeNumber}
              </Badge>
            </div>
          )}

          {comparing && (
            <div className="absolute inset-x-0 bottom-4 z-10 flex items-center gap-2 px-6">
              <input
                type="range"
                min="0"
                max="100"
                value={splitPosition}
                onChange={(event) => setSplitPosition(Number(event.target.value))}
                aria-label="Compare position"
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border/60 p-2">
        <input
          type="range"
          min="0"
          max={duration || 1}
          step="0.01"
          value={Math.min(currentTime, duration || 1)}
          disabled={!videoUrl}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Position in the take"
          className="h-1 w-full cursor-pointer appearance-none rounded bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="stage-time-scrubber"
        />

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={!videoUrl} onClick={() => onSeek(Math.max(0, currentTime - 1))} aria-label="Back one second" title="Back one second">
              <SkipBack className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={!videoUrl} onClick={() => stepFrame(-1)} aria-label="Back one frame" title="Back one frame (Shift+←)" data-testid="stage-frame-back-btn">
              <StepBack className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={!playable} onClick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"} title={isPlaying ? "Pause" : "Play"} data-testid="stage-play-pause-btn">
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={!videoUrl} onClick={() => stepFrame(1)} aria-label="Forward one frame" title="Forward one frame (Shift+→)" data-testid="stage-frame-forward-btn">
              <StepForward className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={!videoUrl} onClick={() => onSeek(Math.min(duration, currentTime + 1))} aria-label="Forward one second" title="Forward one second">
              <SkipForward className="h-3.5 w-3.5" />
            </Button>
            <span className="ml-2 font-mono text-[11px] tabular-nums text-muted-foreground" data-testid="stage-timecode">
              <span className="font-semibold text-foreground">{formatTime(Math.min(currentTime, duration))}</span> / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {videoUrl && compareTake?.videoUrl && (
              <Button type="button" variant={isSplitCompare ? "secondary" : "ghost"} size="sm" className="h-6 gap-1 px-1.5 text-[10px]" onClick={() => setIsSplitCompare((on) => !on)} aria-pressed={isSplitCompare} data-testid="stage-ab-compare-btn">
                <SplitSquareVertical className="h-3 w-3" />
                <span>Compare with take {compareTake.takeNumber}</span>
              </Button>
            )}
            <Button type="button" variant={isLooping ? "secondary" : "ghost"} size="icon" className="h-6 w-6" onClick={() => setIsLooping((on) => !on)} aria-pressed={isLooping} aria-label="Loop this take" title="Loop this take">
              <Repeat className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant={showPipelineTimeline ? "secondary" : "ghost"}
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10px]"
              onClick={() => setShowPipelineTimeline((on) => !on)}
              aria-pressed={showPipelineTimeline}
              data-testid="stage-pipeline-stages-btn"
            >
              <Activity className="h-3 w-3 text-primary" />
              <span>Stages</span>
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsMuted((on) => !on)} aria-label={isMuted ? "Unmute" : "Mute"} title={isMuted ? "Unmute" : "Mute"}>
              {isMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            </Button>
            <Button
              type="button" variant="ghost" size="icon" className="h-6 w-6"
              onClick={toggleFullscreen}
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
              title={isFullscreen ? "Exit full screen (F or Esc)" : "Full screen (F)"}
              data-testid="stage-fullscreen-btn"
            >
              {isFullscreen ? <Minimize className="h-3 w-3" /> : <Maximize className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      </div>

      {showPipelineTimeline && (
        <div className="border-t border-border/60 p-3 bg-muted/20" data-testid="stage-pipeline-timeline-container">
          <StatusTimeline
            events={pipelineEvents}
            title="Oddjob Cinematic Pipeline (5-Layer)"
            className="p-4 rounded-xl border border-border/60 bg-card/70"
          />
        </div>
      )}
    </div>
  );
}
