import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  SplitSquareVertical,
  Flame,
  Layers,
  Sparkles,
  Check,
  X,
  Play,
  Pause,
  ArrowLeftRight,
} from "lucide-react";
import { withAssetOrg } from "../api";
import type { KeyframeView, PlotPointView, ProductionView, ReferenceView } from "@shared/media-studio";

export type DiffMode = "split" | "difference" | "onion" | "flicker";

export interface ComparisonTarget {
  id: string;
  label: string;
  sublabel: string;
  imageUrl: string;
  kind: "previous_keyframe" | "character" | "location" | "theme" | "custom";
}

interface VisualContinuityDiffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  production: ProductionView;
  plotPoint: PlotPointView;
  currentKeyframe: KeyframeView;
  previousKeyframe?: KeyframeView | null;
  previousPlotPointTitle?: string | null;
  onApprove?: () => void;
  onReject?: () => void;
  isBusy?: boolean;
}

export function VisualContinuityDiffModal({
  open,
  onOpenChange,
  production,
  plotPoint,
  currentKeyframe,
  previousKeyframe,
  previousPlotPointTitle,
  onApprove,
  onReject,
  isBusy = false,
}: VisualContinuityDiffModalProps) {
  // 1. Build Available Comparison Targets
  const rawTargets: ComparisonTarget[] = [];

  if (previousKeyframe?.imageUrl) {
    rawTargets.push({
      id: "prev-keyframe",
      label: previousPlotPointTitle ? `Previous: ${previousPlotPointTitle}` : "Previous Keyframe",
      sublabel: previousKeyframe.status === "approved" ? "Approved Frame" : "Preceding Frame",
      imageUrl: previousKeyframe.imageUrl,
      kind: "previous_keyframe",
    });
  }

  // Include approved character references
  for (const ref of production?.references ?? []) {
    if (ref.imageUrl && (ref.status === "approved" || ref.status === "ready")) {
      rawTargets.push({
        id: `ref-${ref.id}`,
        label: ref.name,
        sublabel: ref.kind === "character" ? "Character Reference" : ref.kind === "location" ? "Location Plate" : "Theme Anchor",
        imageUrl: ref.imageUrl,
        kind: ref.kind,
      });
    }
  }

  // Deduplicate targets by imageUrl & label
  const targets: ComparisonTarget[] = [];
  const seenUrls = new Set<string>();
  for (const t of rawTargets) {
    if (!seenUrls.has(t.imageUrl)) {
      seenUrls.add(t.imageUrl);
      targets.push(t);
    }
  }

  const [selectedTargetId, setSelectedTargetId] = useState<string>(() => targets[0]?.id ?? "");
  const [mode, setMode] = useState<DiffMode>("split");
  const [splitPos, setSplitPos] = useState<number>(50);
  const [onionOpacity, setOnionOpacity] = useState<number>(50);
  const [isFlickering, setIsFlickering] = useState<boolean>(false);
  const [flickerFrame, setFlickerFrame] = useState<"A" | "B">("B");

  // Keep target in sync if list changes
  useEffect(() => {
    if (targets.length > 0 && !targets.some((t) => t.id === selectedTargetId)) {
      setSelectedTargetId(targets[0].id);
    }
  }, [targets, selectedTargetId]);

  // Handle flicker animation
  useEffect(() => {
    if (!isFlickering || mode !== "flicker") return;
    const interval = setInterval(() => {
      setFlickerFrame((prev) => (prev === "A" ? "B" : "A"));
    }, 280);
    return () => clearInterval(interval);
  }, [isFlickering, mode]);

  const activeTarget = targets.find((t) => t.id === selectedTargetId) ?? targets[0];
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);

  const handlePointerMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = clientX - rect.left;
    const pct = Math.max(1, Math.min(99, (x / rect.width) * 100));
    setSplitPos(pct);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    handlePointerMove(e.clientX);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    isDraggingRef.current = true;
    if (e.touches[0]) handlePointerMove(e.touches[0].clientX);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDraggingRef.current) handlePointerMove(e.clientX);
    };
    const onUp = () => {
      isDraggingRef.current = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (isDraggingRef.current && e.touches[0]) handlePointerMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [handlePointerMove]);

  if (!currentKeyframe?.imageUrl) return null;

  const currentUrl = withAssetOrg(currentKeyframe.imageUrl);
  const targetUrl = activeTarget ? withAssetOrg(activeTarget.imageUrl) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[92vh] flex flex-col p-4 sm:p-5 gap-3 bg-card border-border/80 shadow-2xl"
        data-testid="visual-continuity-diff-modal"
      >
        <DialogHeader className="p-0 space-y-1">
          <div className="flex items-center justify-between gap-2 pr-6">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <SplitSquareVertical className="h-4 w-4" />
              </span>
              <div>
                <DialogTitle className="text-base font-semibold">
                  Visual Continuity Diff · {plotPoint?.title ?? "Keyframe"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Compare candidate keyframe against preceding frames and reference sheets.
                </DialogDescription>
              </div>
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">
              {production?.aspectRatio ?? "16:9"}
            </Badge>
          </div>
        </DialogHeader>

        {/* Toolbar: Comparison Target Picker & Mode Selector */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border/60 py-2">
          {/* Target Selector */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            <span className="text-xs font-medium text-muted-foreground shrink-0">Compare with:</span>
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTargetId(t.id)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-all shrink-0 border",
                  selectedTargetId === t.id
                    ? "bg-primary text-primary-foreground border-primary shadow-xs"
                    : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                )}
                data-testid={`diff-target-${t.id}`}
              >
                {t.label}
              </button>
            ))}
            {targets.length === 0 && (
              <span className="text-xs text-muted-foreground italic">No prior frames or references found</span>
            )}
          </div>

          {/* Mode Selector */}
          <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/60">
            <button
              type="button"
              onClick={() => setMode("split")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                mode === "split" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
              title="Split-Slider Swipe Diff"
              data-testid="mode-split-btn"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("difference")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                mode === "difference" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
              title="Pixel Difference Heatmap (Difference Blend)"
              data-testid="mode-difference-btn"
            >
              <Flame className="h-3.5 w-3.5 text-amber-500" />
              <span>Heatmap</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("onion")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                mode === "onion" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
              title="Onion Skin Opacity Slider"
              data-testid="mode-onion-btn"
            >
              <Layers className="h-3.5 w-3.5 text-cyan-400" />
              <span>Onion</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("flicker");
                setIsFlickering((prev) => !prev);
              }}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                mode === "flicker" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
              title="A/B Flicker Motion Toggle"
              data-testid="mode-flicker-btn"
            >
              {isFlickering && mode === "flicker" ? (
                <Pause className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Play className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span>Flicker</span>
            </button>
          </div>
        </div>

        {/* Diff Canvas Surface */}
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          className="relative w-full h-[380px] sm:h-[450px] md:h-[500px] overflow-hidden rounded-xl border border-border/80 bg-background dark:bg-neutral-950 select-none cursor-ew-resize isolate"
          data-testid="diff-canvas"
        >
          {targetUrl ? (
            <>
              {/* ── Mode 1: Split Slider ── */}
              {mode === "split" && (
                <div className="absolute inset-0 w-full h-full overflow-hidden">
                  {/* Underneath: Current Candidate Frame */}
                  <img
                    src={currentUrl}
                    alt="Current Candidate"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                  />
                  <span className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[10px] font-mono text-emerald-300 border border-emerald-500/30">
                    Candidate: Plot Point {(plotPoint?.position ?? 0) + 1}
                  </span>

                  {/* Overlaid: Comparison Target, clipped from the right via clip-path */}
                  <img
                    src={targetUrl}
                    alt={activeTarget?.label}
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none z-20"
                    style={{ clipPath: `inset(0 ${100 - splitPos}% 0 0)` }}
                  />
                  <span
                    className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[10px] font-mono text-cyan-300 border border-cyan-500/30"
                    style={{ opacity: splitPos > 12 ? 1 : 0 }}
                  >
                    {activeTarget?.label}
                  </span>

                  {/* Vertical Dividing Line */}
                  <div
                    className="absolute top-0 bottom-0 z-30 w-0.5 bg-primary pointer-events-none shadow-[0_0_10px_rgba(var(--primary),0.8)]"
                    style={{ left: `${splitPos}%` }}
                  />

                  {/* Interactive Slider Divider Handle */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 z-30 flex items-center justify-center pointer-events-none"
                    style={{ left: `${splitPos}%`, transform: "translate(-50%, -50%)" }}
                    data-testid="split-slider-handle"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl border-2 border-background ring-2 ring-primary/50">
                      <ArrowLeftRight className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Mode 2: Difference Heatmap ── */}
              {mode === "difference" && (
                <div className="absolute inset-0 w-full h-full overflow-hidden bg-black" data-testid="difference-view"> {/* theme-lint-ignore */}
                  {/* Base Image */}
                  <img
                    src={targetUrl}
                    alt="Base Reference"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                  />
                  {/* Difference Blended Image */}
                  <img
                    src={currentUrl}
                    alt="Candidate Diff"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                    style={{ mixBlendMode: "difference" }}
                  />
                  <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center justify-between px-3 py-1.5 rounded-lg bg-black/85 backdrop-blur-md border border-border/60 text-[11px]">
                    <span className="text-emerald-400 font-mono flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-black border border-emerald-400 inline-block" /> {/* theme-lint-ignore */}
                      Black = Identical pixels
                    </span>
                    <span className="text-amber-400 font-mono flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                      Glowing / Colors = Lighting & detail drift
                    </span>
                  </div>
                </div>
              )}

              {/* ── Mode 3: Onion Skin ── */}
              {mode === "onion" && (
                <div className="absolute inset-0 w-full h-full overflow-hidden" data-testid="onion-view">
                  <img
                    src={targetUrl}
                    alt="Target Base"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                  />
                  <img
                    src={currentUrl}
                    alt="Current Candidate"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none transition-opacity duration-75"
                    style={{ opacity: onionOpacity / 100 }}
                  />
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 w-72 px-3 py-2 rounded-lg bg-black/85 backdrop-blur-md border border-border/60 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                      <span>{activeTarget?.label}</span>
                      <span>{onionOpacity}% Candidate</span>
                    </div>
                    <Slider
                      value={[onionOpacity]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(val) => setOnionOpacity(val[0])}
                    />
                  </div>
                </div>
              )}

              {/* ── Mode 4: Flicker ── */}
              {mode === "flicker" && (
                <div className="absolute inset-0 w-full h-full overflow-hidden" data-testid="flicker-view">
                  <img
                    src={flickerFrame === "A" ? targetUrl : currentUrl}
                    alt={flickerFrame === "A" ? activeTarget?.label : "Candidate"}
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                  />
                  <span className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded bg-black/80 backdrop-blur-sm text-xs font-mono font-bold text-primary border border-primary/40">
                    Showing: {flickerFrame === "A" ? activeTarget?.label : "Candidate Frame"}
                  </span>
                </div>
              )}
            </>
          ) : (
            <img
              src={currentUrl}
              alt="Current frame only"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            />
          )}
        </div>

        {/* Footer Controls & Direct Action */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/60">
          <div className="text-xs text-muted-foreground">
            {activeTarget ? (
              <span>
                Comparing against <strong>{activeTarget.label}</strong> ({activeTarget.sublabel})
              </span>
            ) : (
              <span>No comparison target selected</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onReject && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isBusy}
                onClick={onReject}
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                data-testid="modal-reject-btn"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Reject
              </Button>
            )}
            {onApprove && (
              <Button
                type="button"
                size="sm"
                disabled={isBusy}
                onClick={onApprove}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="modal-approve-btn"
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                Approve Keyframe
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default VisualContinuityDiffModal;
