import React, { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";
import { Badge } from "./badge";
import { X, ArrowRight, ArrowLeft, CheckCircle2, Sparkles, BookOpen, Layers, Info, MousePointerClick, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScoreDimension } from "@shared/tutorials/registry";

export type { ScoreDimension };

export interface TutorialBubbleProps {
  /** Target element selector string (e.g. "#my-id", "[data-testid='...']") or HTMLElement */
  target: string | HTMLElement | null;
  step: number;
  totalSteps: number;
  scoreDimension?: ScoreDimension;
  title: string;
  description: string;
  /** What action it performs if any */
  action?: string;
  side?: "top" | "bottom" | "left" | "right";
  beacon?: boolean;
  nextLabel?: string;
  onNext?: () => void;
  onPrev?: () => void;
  onComplete?: () => void;
  onDismiss?: () => void;
  intervalMs?: number;
  isPaused?: boolean;
  onTogglePause?: () => void;
  moduleTitle?: string;
  moduleIndex?: number;
  totalModules?: number;
  className?: string;
  /** Hints & Deep-Links */
  shortcut?: string;
  hint?: string;
  docSlug?: string;
  componentId?: string;
}

const SCORE_LABELS: Record<ScoreDimension, { label: string; badgeClass: string }> = {
  S: { label: "Symptom · Objective", badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  C: { label: "Cause · Architecture", badgeClass: "bg-purple-500/20 text-purple-300 border-purple-500/40" },
  O: { label: "Outcome · Verifiable", badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
  R: { label: "Resource · Guided Tool", badgeClass: "bg-sky-500/20 text-sky-300 border-sky-500/40" },
  E: { label: "Effect · Governance", badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
};

export function TutorialBubble({
  target,
  step,
  totalSteps,
  scoreDimension = "S",
  title,
  description,
  action,
  side = "bottom",
  beacon = true,
  nextLabel,
  onNext,
  onPrev,
  onComplete,
  onDismiss,
  intervalMs,
  isPaused,
  onTogglePause,
  moduleTitle,
  moduleIndex,
  totalModules,
  className,
  shortcut,
  hint,
  docSlug,
  componentId,
}: TutorialBubbleProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [resolvedSide, setResolvedSide] = useState<"top" | "bottom" | "left" | "right">(side);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const resolveTarget = useCallback((): HTMLElement | null => {
    if (!target) return null;
    if (typeof target !== "string") return target;

    const selectors = target.split(",").map((s) => s.trim()).filter(Boolean);
    for (const selector of selectors) {
      try {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) return el;
      } catch {
        // Fallback for Playwright-style :has-text pseudo-classes
        const hasTextMatch = selector.match(/^([a-zA-Z0-9_-]+)?:has-text\(['"](.+?)['"]\)$/);
        if (hasTextMatch) {
          const tag = hasTextMatch[1] || "*";
          const text = hasTextMatch[2];
          try {
            const candidates = Array.from(document.querySelectorAll<HTMLElement>(tag));
            const found = candidates.find((c) => c.textContent?.includes(text));
            if (found) return found;
          } catch {
            // Ignore any querySelectorAll syntax error
          }
        }
      }
    }
    return null;
  }, [target]);

  const updatePosition = useCallback(() => {
    const el = resolveTarget();
    if (!el) {
      setTargetRect(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    setTargetRect(rect);

    // Auto-flip if overflowing screen — dynamically measure bubble height or fall back to realistic 360px
    const bubbleW = bubbleRef.current?.offsetWidth || 340;
    const bubbleH = bubbleRef.current?.offsetHeight || 360;
    let actualSide = side;

    if (side === "bottom" && rect.bottom + bubbleH + 20 > window.innerHeight) {
      actualSide = "top";
    } else if (side === "top" && rect.top - bubbleH - 20 < 0) {
      actualSide = "bottom";
    } else if (side === "right" && rect.right + bubbleW + 20 > window.innerWidth) {
      actualSide = "left";
    } else if (side === "left" && rect.left - bubbleW - 20 < 0) {
      actualSide = "right";
    }

    setResolvedSide(actualSide);
  }, [resolveTarget, side]);

  useEffect(() => {
    updatePosition();

    // Scroll into view on step change
    const el = resolveTarget();
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }

    const handleScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    // Polling retry for elements that mount late
    const interval = setInterval(updatePosition, 300);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      clearInterval(interval);
    };
  }, [updatePosition, resolveTarget]);

  const isLast = step >= totalSteps;
  const dimensionInfo = SCORE_LABELS[scoreDimension] || SCORE_LABELS.S;

  // Calculate bubble coordinates
  const bubbleWidth = bubbleRef.current?.offsetWidth || 340;
  const bubbleHeight = bubbleRef.current?.offsetHeight || 360;
  const margin = 12;

  let top = 120;
  let left = typeof window !== "undefined" ? Math.max(16, window.innerWidth / 2 - bubbleWidth / 2) : 200;

  if (targetRect) {
    if (resolvedSide === "bottom") {
      top = targetRect.bottom + margin;
      left = targetRect.left + targetRect.width / 2 - bubbleWidth / 2;
    } else if (resolvedSide === "top") {
      top = targetRect.top - margin - bubbleHeight;
      left = targetRect.left + targetRect.width / 2 - bubbleWidth / 2;
    } else if (resolvedSide === "right") {
      top = targetRect.top + targetRect.height / 2 - bubbleHeight / 2;
      left = targetRect.right + margin;
    } else {
      // left
      top = targetRect.top + targetRect.height / 2 - bubbleHeight / 2;
      left = targetRect.left - margin - bubbleWidth;
    }
  }

  // Strict viewport bounds clamping: ensure bubble and its Next button NEVER clip outside viewport
  if (typeof window !== "undefined") {
    left = Math.max(16, Math.min(window.innerWidth - bubbleWidth - 16, left));
    top = Math.max(16, Math.min(Math.max(16, window.innerHeight - bubbleHeight - 16), top));
  }

  // Auto-advance tutorial when user interacts directly with the highlighted target
  useEffect(() => {
    const el = resolveTarget();
    // onNext is optional. With no handler there is nothing to advance to, so
    // don't register a listener that would fire a timer and do nothing.
    if (!el || !onNext) return;

    const handleTargetClick = (e: MouseEvent) => {
      // Don't auto-advance if clicking inside the bubble itself
      if (bubbleRef.current?.contains(e.target as Node)) return;
      setTimeout(() => {
        onNext();
      }, 150);
    };

    el.addEventListener("click", handleTargetClick);
    return () => {
      el.removeEventListener("click", handleTargetClick);
    };
  }, [resolveTarget, onNext]);

  return createPortal(
    <>
      {/* 1. Target Element Pulsing Beacon Ring */}
      {targetRect && beacon && (
        <div
          data-testid="tutorial-target-beacon"
          className="fixed pointer-events-none z-tutorial transition-all duration-300 rounded-lg ring-4 ring-indigo-500/60 shadow-[0_0_20px_rgba(99,102,241,0.4)] animate-pulse"
          style={{
            top: `${Math.max(0, targetRect.top - 4)}px`,
            left: `${Math.max(0, targetRect.left - 4)}px`,
            width: `${targetRect.width + 8}px`,
            height: `${targetRect.height + 8}px`,
          }}
        />
      )}

      {/* 2. Interactive Floating Tutorial Bubble */}
      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="false"
        data-testid="tutorial-bubble"
        data-step={step}
        data-total-steps={totalSteps}
        className={cn(
          "fixed z-tutorial w-[340px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] flex flex-col rounded-xl border border-border/90 bg-card/95 text-card-foreground shadow-2xl backdrop-blur-xl p-4 transition-all duration-200 animate-in fade-in-0 zoom-in-95 pointer-events-auto",
          className
        )}
        style={{
          top: `${top}px`,
          left: `${left}px`,
        }}
      >
        {/* Pointer Beak (only when anchored) */}
        {targetRect && (
          <div
            className={cn(
              "absolute w-3 h-3 rotate-45 border border-border/80 bg-card/95 backdrop-blur-md",
              resolvedSide === "bottom" && "-top-1.5 left-1/2 -translate-x-1/2 border-b-0 border-r-0",
              resolvedSide === "top" && "-bottom-1.5 left-1/2 -translate-x-1/2 border-t-0 border-l-0",
              resolvedSide === "right" && "-left-1.5 top-1/2 -translate-y-1/2 border-t-0 border-r-0",
              resolvedSide === "left" && "-right-1.5 top-1/2 -translate-y-1/2 border-b-0 border-l-0"
            )}
          />
        )}

        {/* Top Header */}
        <div className="shrink-0 border-b border-border/50 pb-2 mb-2.5">
          {moduleTitle && (
            <div
              data-testid="tutorial-module-badge"
              className="flex items-center justify-between text-[10px] font-medium text-muted-foreground mb-2 bg-primary/10 border border-primary/20 px-2 py-1 rounded-md"
            >
              <span className="truncate font-semibold text-primary">
                {totalModules && totalModules > 1 ? `Module ${moduleIndex || 1} of ${totalModules}: ` : ""}{moduleTitle}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/80 shrink-0 ml-1.5">
                Playlist
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Badge data-testid="tutorial-score-badge" variant="outline" className={cn("text-[10px] px-1.5 py-0.5 font-mono font-bold tracking-wider", dimensionInfo.badgeClass)}>
                [{scoreDimension}] {dimensionInfo.label}
              </Badge>
              {shortcut && (
                <kbd
                  data-testid="tutorial-shortcut-badge"
                  className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-muted border border-border/80 rounded text-foreground/80 shadow-xs"
                >
                  {shortcut}
                </kbd>
              )}
            </div>

            <div className="flex items-center gap-2">
              {intervalMs && (
                <button
                  type="button"
                  onClick={onTogglePause}
                  data-testid="tutorial-pause-toggle"
                  className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border/40"
                  title={isPaused ? "Resume 8s auto-advance" : `Auto-advancing every ${Math.round(intervalMs / 1000)}s — click to pause`}
                >
                  {isPaused ? (
                    <>
                      <Play className="w-2.5 h-2.5 fill-current text-amber-500" />
                      <span>Paused</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-2.5 h-2.5 text-sky-400" />
                      <span>{Math.round(intervalMs / 1000)}s</span>
                    </>
                  )}
                </button>
              )}
              <span className="text-[11px] font-mono text-muted-foreground">
                {step} / {totalSteps}
              </span>
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded-sm opacity-70 hover:opacity-100 hover:bg-muted p-0.5 transition-colors"
                  title="Dismiss Tutorial"
                  aria-label="Dismiss Tutorial"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Bubble Body (Scrollable if content is tall) */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 mb-2">
          <h4 className="text-sm font-semibold text-foreground tracking-tight flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            {title}
          </h4>

          {/* What the component does */}
          {description && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1">
                <Info className="h-3 w-3 text-primary/80 shrink-0" />
                <span>What It Does</span>
              </div>
              <p data-testid="tutorial-description-text" className="text-xs text-muted-foreground leading-relaxed pl-4">
                {description}
              </p>
            </div>
          )}

          {/* What action it performs if any */}
          {action && (
            <div data-testid="tutorial-action-box" className="rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 mt-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1 mb-0.5">
                <MousePointerClick className="h-3 w-3 text-primary shrink-0" />
                <span>Action</span>
              </div>
              <p data-testid="tutorial-action-text" className="text-[11.5px] leading-snug text-foreground/90 font-medium pl-4">
                {action}
              </p>
            </div>
          )}

          {hint && (
            <div
              data-testid="tutorial-hint-box"
              className="bg-primary/5 border border-primary/15 rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground flex items-start gap-1.5 mt-2"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
              <span className="leading-snug">{hint}</span>
            </div>
          )}
        </div>

        {/* Action Controls - Pinned at bottom to ensure Next button is ALWAYS visible and NEVER overflows */}
        <div className="shrink-0 flex items-center justify-between gap-2 pt-2 border-t border-border/40 mt-auto bg-card/95 min-w-0 max-w-full">
          {onPrev && step > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              data-testid="tutorial-bubble-prev"
              onClick={onPrev}
              className="h-7 min-h-0 text-xs px-2 shrink-0"
            >
              <ArrowLeft className="w-3 h-3 mr-1 shrink-0" />
              Prev
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center justify-end gap-1.5 min-w-0 flex-1 max-w-full">
            {isLast ? (
              <Button
                variant="default"
                size="sm"
                data-testid="tutorial-bubble-next"
                onClick={onComplete || onNext}
                title={nextLabel || "Finish Tutorial"}
                className="h-7 min-h-0 text-xs px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium min-w-0 max-w-full inline-flex items-center justify-center overflow-hidden"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1 shrink-0" />
                <span className="truncate min-w-0">{nextLabel || "Finish Tutorial"}</span>
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                data-testid="tutorial-bubble-next"
                onClick={onNext}
                title={nextLabel || "Next Step"}
                className="h-7 min-h-0 text-xs px-3 bg-primary text-primary-foreground font-medium min-w-0 max-w-full inline-flex items-center justify-center overflow-hidden"
              >
                <span className="truncate min-w-0">{nextLabel || "Next Step"}</span>
                <ArrowRight className="w-3 h-3 ml-1 shrink-0" />
              </Button>
            )}
          </div>
        </div>

        {/* Deep Links / Spec & Gallery Footer */}
        {(docSlug || componentId) && (
          <div
            data-testid="tutorial-footer-links"
            className="shrink-0 flex items-center justify-between pt-2 mt-2 border-t border-border/40 text-[10px] text-muted-foreground"
          >
            {docSlug ? (
              <a
                href={`/knowledge/garden`}
                className="hover:text-primary transition-colors flex items-center gap-1"
                title={`Specification: ${docSlug}`}
              >
                <BookOpen className="w-3 h-3 text-muted-foreground/70" />
                <span>Specs</span>
              </a>
            ) : <span />}

            {componentId ? (
              <a
                href={`/platform-maintenance/components?search=${componentId}`}
                className="hover:text-primary transition-colors flex items-center gap-1 font-mono text-[9px]"
                title={`Gallery Component: ${componentId}`}
              >
                <Layers className="w-3 h-3 text-muted-foreground/70" />
                <span>Gallery</span>
              </a>
            ) : <span />}
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
