import { useState, useRef, useCallback } from "react";
import type { MediaShot } from "../types";

export type TimelineDragType = "move" | "trim-left" | "trim-right" | "reorder";

export interface TimelineDragState {
  type: TimelineDragType;
  shotNumber: number;
  track: number;
  startClientX: number;
  startClientY: number;
  originalStart: number;
  originalDuration: number;
  originalTrimIn: number;
  originalTrimOut: number;
  sourceDuration: number;
  currentDeltaSeconds: number;
  /** The lane the pointer is over now: 1 primary, 2 overlay. Dragging between them is
   *  how a shot becomes a cutaway, and how a cutaway is brought back into the cut. */
  currentTrack: number;
}

export interface DragTooltipInfo {
  x: number;
  y: number;
  text: string;
  subtext?: string;
}

export interface UseMediaTimelineGanttOptions {
  shots: MediaShot[];
  totalDurationSeconds: number;
  fps?: number;
  defaultPixelsPerSecond?: number;
  minPixelsPerSecond?: number;
  maxPixelsPerSecond?: number;
  onTrimShot?: (shotNumber: number, trimIn: number, trimOut: number, newDuration: number) => void;
  onMoveShot?: (shotNumber: number, newStartTime: number, targetTrack: number) => void;
  onReorderShots?: (sourceShotNumber: number, targetIndex: number) => void;
}

export function formatTimecodeDisplay(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * 24);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

export function useMediaTimelineGantt({
  shots,
  totalDurationSeconds,
  fps = 24,
  defaultPixelsPerSecond = 32,
  minPixelsPerSecond = 8,
  maxPixelsPerSecond = 160,
  onTrimShot,
  onMoveShot,
  onReorderShots,
}: UseMediaTimelineGanttOptions) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(defaultPixelsPerSecond);
  const [dragState, setDragState] = useState<TimelineDragState | null>(null);
  const [dragTooltip, setDragTooltip] = useState<DragTooltipInfo | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const frameSnap = useCallback(
    (sec: number) => Math.max(0, Math.round(sec * fps) / fps),
    [fps]
  );

  const zoom = useCallback(
    (direction: 1 | -1) => {
      setPixelsPerSecond((prev) => {
        const step = prev < 20 ? 4 : prev < 50 ? 8 : 16;
        return Math.min(maxPixelsPerSecond, Math.max(minPixelsPerSecond, prev + direction * step));
      });
    },
    [minPixelsPerSecond, maxPixelsPerSecond]
  );

  const zoomToFit = useCallback(
    (availableWidth: number) => {
      const safeTime = Math.max(1, totalDurationSeconds);
      const optimal = Math.max(minPixelsPerSecond, Math.min(maxPixelsPerSecond, Math.floor(availableWidth / safeTime)));
      setPixelsPerSecond(optimal);
    },
    [totalDurationSeconds, minPixelsPerSecond, maxPixelsPerSecond]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      zoom(delta);
    },
    [zoom]
  );

  const startDrag = useCallback(
    (
      e: React.MouseEvent,
      shot: MediaShot,
      computedStartTime: number,
      type: TimelineDragType
    ) => {
      e.preventDefault();
      e.stopPropagation();

      const sourceDur = shot.sourceDurationSeconds ?? shot.durationSeconds;
      const trimIn = shot.trimInSeconds ?? 0;
      const trimOut = shot.trimOutSeconds ?? (trimIn + shot.durationSeconds);

      const state: TimelineDragState = {
        type,
        shotNumber: shot.shotNumber,
        track: shot.track ?? 1,
        startClientX: e.clientX,
        startClientY: e.clientY,
        originalStart: computedStartTime,
        originalDuration: shot.durationSeconds,
        originalTrimIn: trimIn,
        originalTrimOut: trimOut,
        sourceDuration: sourceDur,
        currentDeltaSeconds: 0,
        currentTrack: shot.track ?? 1,
      };

      setDragState(state);

      // One tooltip update per animation frame. A mouse reports moves far faster than
      // the screen redraws, and every setDragTooltip re-renders the whole sequencer —
      // every clip on every track — so an unthrottled drag spends its time rendering
      // frames nobody sees.
      let frame: number | null = null;
      let pending: MouseEvent | null = null;
      const showTooltip = (info: DragTooltipInfo) => setDragTooltip(info);

      const onPointerMove = (event: MouseEvent) => {
        pending = event;
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          const latest = pending;
          pending = null;
          if (latest) measure(latest);
        });
      };

      const measure = (me: MouseEvent) => {
        const deltaPx = me.clientX - state.startClientX;
        const deltaSec = deltaPx / pixelsPerSecond;
        const snappedDelta = frameSnap(deltaSec);

        state.currentDeltaSeconds = snappedDelta;

        const containerRect = containerRef.current?.getBoundingClientRect();
        const tooltipX = containerRect ? me.clientX - containerRect.left : me.clientX;
        const tooltipY = containerRect ? me.clientY - containerRect.top - 36 : me.clientY - 36;

        if (type === "trim-left") {
          // Adjust In-point (Head trim). Cannot exceed trimOut - 0.2s
          const maxTrimIn = state.originalTrimOut - 0.2;
          const newTrimIn = Math.min(maxTrimIn, Math.max(0, state.originalTrimIn + snappedDelta));
          const actualDelta = newTrimIn - state.originalTrimIn;
          const newDuration = Math.max(0.2, state.originalDuration - actualDelta);

          showTooltip({
            x: tooltipX,
            y: tooltipY,
            text: `In: ${formatTimecodeDisplay(newTrimIn)} (Dur: ${newDuration.toFixed(2)}s)`,
            subtext: actualDelta > 0 ? `+${actualDelta.toFixed(2)}s trimmed` : `${actualDelta.toFixed(2)}s`,
          });
        } else if (type === "trim-right") {
          // Adjust Out-point (Tail trim / extend)
          const newTrimOut = Math.max(state.originalTrimIn + 0.2, state.originalTrimOut + snappedDelta);
          const newDuration = Math.max(0.2, state.originalDuration + snappedDelta);
          const isExtendedPastSource = newTrimOut > state.sourceDuration;

          showTooltip({
            x: tooltipX,
            y: tooltipY,
            text: `Out: ${formatTimecodeDisplay(newTrimOut)} (Dur: ${newDuration.toFixed(2)}s)`,
            subtext: isExtendedPastSource
              ? `Hold frame: +${(newTrimOut - state.sourceDuration).toFixed(1)}s`
              : snappedDelta > 0
              ? `+${snappedDelta.toFixed(2)}s extended`
              : `${snappedDelta.toFixed(2)}s trimmed`,
          });
        } else if (type === "move") {
          const newStart = Math.max(0, state.originalStart + snappedDelta);
          // The lane under the pointer, asked of the page rather than guessed from a
          // pixel threshold: the lanes are different heights and move as the stack scrolls.
          const overLane = (document.elementFromPoint(me.clientX, me.clientY) as HTMLElement | null)
            ?.closest("[data-timeline-track]")
            ?.getAttribute("data-timeline-track");
          state.currentTrack = overLane ? Number(overLane) : state.track;
          const movedLane = state.currentTrack !== state.track;
          showTooltip({
            x: tooltipX,
            y: tooltipY,
            text: movedLane
              ? state.currentTrack === 2 ? "Make it a cutaway" : "Back into the cut"
              : `Start: ${formatTimecodeDisplay(newStart)}`,
            subtext: movedLane
              ? state.currentTrack === 2
                ? `Hangs off the shot under ${formatTimecodeDisplay(newStart)}`
                : "Follows the shot before it again"
              : `Offset +${newStart.toFixed(2)}s`,
          });
        } else if (type === "reorder") {
          showTooltip({
            x: tooltipX,
            y: tooltipY,
            text: `Reordering Shot ${shot.shotNumber}`,
          });
        }
      };

      const onPointerUp = () => {
        document.removeEventListener("mousemove", onPointerMove);
        document.removeEventListener("mouseup", onPointerUp);
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        pending = null;

        const d = state;
        if (d && d.type === "move" && d.currentTrack !== d.track) {
          // Dropped on the other lane: where it lands in time is the same reading as a
          // move, and the caller works out what it hangs off.
          onMoveShot?.(d.shotNumber, Math.max(0, d.originalStart + d.currentDeltaSeconds), d.currentTrack);
        } else if (d && Math.abs(d.currentDeltaSeconds) > 0.001) {
          if (d.type === "trim-left") {
            const maxTrimIn = d.originalTrimOut - 0.2;
            const newTrimIn = Math.min(maxTrimIn, Math.max(0, d.originalTrimIn + d.currentDeltaSeconds));
            const actualDelta = newTrimIn - d.originalTrimIn;
            const newDuration = Math.max(0.2, d.originalDuration - actualDelta);
            onTrimShot?.(d.shotNumber, newTrimIn, d.originalTrimOut, newDuration);
          } else if (d.type === "trim-right") {
            const newTrimOut = Math.max(d.originalTrimIn + 0.2, d.originalTrimOut + d.currentDeltaSeconds);
            const newDuration = Math.max(0.2, d.originalDuration + d.currentDeltaSeconds);
            onTrimShot?.(d.shotNumber, d.originalTrimIn, newTrimOut, newDuration);
          } else if (d.type === "move") {
            const newStart = Math.max(0, d.originalStart + d.currentDeltaSeconds);
            onMoveShot?.(d.shotNumber, newStart, d.track);
          }
        }

        setDragState(null);
        setDragTooltip(null);
      };

      document.addEventListener("mousemove", onPointerMove);
      document.addEventListener("mouseup", onPointerUp);
    },
    [pixelsPerSecond, frameSnap, onTrimShot, onMoveShot]
  );

  return {
    pixelsPerSecond,
    setPixelsPerSecond,
    zoom,
    zoomToFit,
    handleWheel,
    startDrag,
    dragState,
    dragTooltip,
    containerRef,
    frameSnap,
  };
}
