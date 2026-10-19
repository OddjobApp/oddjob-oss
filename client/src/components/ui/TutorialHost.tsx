import React, { useState, useEffect, useCallback } from "react";
import { TutorialBubble } from "./TutorialBubble";
import { Button } from "./button";
import { Sparkles, X, Info, MousePointerClick, ArrowRight } from "lucide-react";
import {
  type TutorialDefinition,
  CANONICAL_TUTORIALS,
  CANONICAL_CHAINS,
  TUTORIAL_SNIPPETS,
  createChainedTutorial,
  emitTutorialOutcome,
  startTutorial,
} from "@/lib/tutorial-engine";
import { resolveSpaTemplate } from "@shared/spa-routes";
import { useGlobalHoverTutorial } from "@/lib/useHoverTutorial";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

const TUTORIAL_STORAGE_KEY = "oddjob:active-tutorial-state";

export function TutorialHost() {
  const [activeTutorial, setActiveTutorial] = useState<TutorialDefinition | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(TUTORIAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.tutorial && Array.isArray(parsed.tutorial.steps)) {
          return parsed.tutorial;
        }
      }
    } catch {}
    return null;
  });

  const [currentStepIndex, setCurrentStepIndex] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      const raw = sessionStorage.getItem(TUTORIAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.stepIndex === "number") {
          return parsed.stepIndex;
        }
      }
    } catch {}
    return 0;
  });

  const [isPaused, setIsPaused] = useState<boolean>(false);

  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const { toast } = useToast();

  // Automatically track component hover and countdown to display tutorial snippet
  const hoverPreview = useGlobalHoverTutorial(activeTutorial !== null);

  const handleStart = useCallback((event: Event) => {
    const customEvent = event as CustomEvent<TutorialDefinition | string>;
    const detail = customEvent.detail;
    let def: TutorialDefinition | undefined;

    if (typeof detail === "string") {
      if (CANONICAL_CHAINS[detail]) {
        def = createChainedTutorial(CANONICAL_CHAINS[detail]);
      } else if (CANONICAL_TUTORIALS[detail]) {
        def = CANONICAL_TUTORIALS[detail];
      } else if (TUTORIAL_SNIPPETS[detail]) {
        const snippet = TUTORIAL_SNIPPETS[detail];
        def = createChainedTutorial({
          id: snippet.id,
          name: snippet.title,
          snippetIds: [snippet.id],
        });
      }
    } else if (detail && Array.isArray((detail as any).steps)) {
      def = detail as TutorialDefinition;
    }

    if (def && Array.isArray(def.steps)) {
      setActiveTutorial(def);
      setCurrentStepIndex(0);
      setIsPaused(false);
      try {
        sessionStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify({ tutorial: def, stepIndex: 0 }));
      } catch {}
    }
  }, []);

  useEffect(() => {
    window.addEventListener("oddjob:start-tutorial", handleStart as EventListener);

    // Deep-link auto-launcher: check if ?tutorial=... is present in the URL query parameters
    if (typeof window !== "undefined") {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const requestedTutorial = urlParams.get("tutorial");
        if (requestedTutorial) {
          handleStart(new CustomEvent("oddjob:start-tutorial", { detail: requestedTutorial }));
          // Clean query parameter from URL bar without a hard page reload
          urlParams.delete("tutorial");
          const newSearch = urlParams.toString();
          const cleanUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
          window.history.replaceState(null, "", cleanUrl);
        }
      } catch {}
    }

    return () => {
      window.removeEventListener("oddjob:start-tutorial", handleStart as EventListener);
    };
  }, [handleStart]);

  const currentStep = activeTutorial?.steps[currentStepIndex];

  // Auto-navigate between routes if a step in a chained playlist targets another route
  useEffect(() => {
    if (!currentStep) return;
    if (currentStep.targetRoute && typeof window !== "undefined") {
      const currentFullPath = window.location.pathname + window.location.search;
      const targetFullPath = currentStep.targetRoute;
      const currentPath = window.location.pathname;
      const targetPath = targetFullPath.split("?")[0];
      if (currentFullPath !== targetFullPath) {
        console.log(`[TutorialHost] Auto-navigating to ${currentStep.targetRoute} for module "${currentStep.moduleTitle || 'Next'}"`);
        const currentTemplate = resolveSpaTemplate(currentPath);
        const targetTemplate = resolveSpaTemplate(targetPath);
        if (currentTemplate && targetTemplate && currentTemplate !== targetTemplate) {
          window.location.assign(currentStep.targetRoute);
        } else {
          window.history.pushState(null, "", currentStep.targetRoute);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      }
    }
  }, [currentStep]);

  const totalSteps = activeTutorial?.steps?.length || 0;
  const isLast = currentStepIndex >= totalSteps - 1;

  const handleComplete = useCallback(() => {
    if (!activeTutorial) return;
    const id = activeTutorial.id;
    try {
      sessionStorage.removeItem(TUTORIAL_STORAGE_KEY);
    } catch {}
    setActiveTutorial(null);
    setCurrentStepIndex(0);
    setIsPaused(false);
    emitTutorialOutcome(id);

    toast({
      title: "🎉 Tutorial Completed!",
      description: `You've finished "${activeTutorial.name}". S.C.O.R.E. Outcome score calibrated.`,
      variant: "default",
    });
  }, [activeTutorial, toast]);

  const handleNext = useCallback(() => {
    if (isLast) {
      handleComplete();
    } else {
      const nextIdx = currentStepIndex + 1;
      setCurrentStepIndex(nextIdx);
      try {
        if (activeTutorial) {
          sessionStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify({ tutorial: activeTutorial, stepIndex: nextIdx }));
        }
      } catch {}
    }
  }, [isLast, handleComplete, currentStepIndex, activeTutorial]);

  // Auto-advance timer when activeTutorial specifies intervalMs (e.g. 8000ms pacing)
  useEffect(() => {
    if (!activeTutorial || !activeTutorial.intervalMs || isPaused) return;
    const timer = setTimeout(() => {
      handleNext();
    }, activeTutorial.intervalMs);

    return () => clearTimeout(timer);
  }, [activeTutorial, currentStepIndex, isPaused, handleNext]);

  const handlePrev = useCallback(() => {
    const prevIdx = Math.max(0, currentStepIndex - 1);
    setCurrentStepIndex(prevIdx);
    try {
      if (activeTutorial) {
        sessionStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify({ tutorial: activeTutorial, stepIndex: prevIdx }));
      }
    } catch {}
  }, [currentStepIndex, activeTutorial]);

  const handleDismiss = useCallback(() => {
    try {
      sessionStorage.removeItem(TUTORIAL_STORAGE_KEY);
    } catch {}
    setActiveTutorial(null);
    setCurrentStepIndex(0);
    setIsPaused(false);
  }, []);

  if (!activeTutorial || !currentStep) {
    if (hoverPreview) {
      let previewTop = 100;
      let previewLeft = 100;
      try {
        const rect = hoverPreview.anchorEl.getBoundingClientRect();
        const bubbleHeight = 320;
        const bubbleWidth = 340;
        previewTop = rect.bottom + 8 + bubbleHeight < (typeof window !== "undefined" ? window.innerHeight - 16 : 800)
          ? rect.bottom + 8
          : Math.max(16, rect.top - bubbleHeight - 8);
        previewTop = Math.max(16, Math.min(typeof window !== "undefined" ? window.innerHeight - bubbleHeight - 16 : 600, previewTop));
        previewLeft = typeof window !== "undefined"
          ? Math.max(16, Math.min(window.innerWidth - bubbleWidth - 16, rect.left + rect.width / 2 - bubbleWidth / 2))
          : 100;
      } catch {}

      // ── Triggered: lightweight info bubble (no tour) ──────────────────────
      if (hoverPreview.triggered) {
        return (
          <div
            data-testid="hover-info-bubble"
            className="fixed z-tutorial w-84 max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-[0_12px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 pointer-events-auto"
            style={{ top: `${previewTop}px`, left: `${previewLeft}px` }}
          >
            {/* Header */}
            <div className="shrink-0 flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5 bg-muted/30 border-b border-border/50">
              <div className="flex items-start gap-2 min-w-0">
                <Sparkles className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                <span className="text-[13px] font-semibold leading-snug text-foreground break-words">
                  {hoverPreview.title}
                </span>
              </div>
              <button
                type="button"
                onClick={hoverPreview.dismiss}
                data-testid="hover-info-dismiss"
                aria-label="Dismiss"
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-all -mr-1 -mt-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Content: What It Does & Action Performed */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-2.5">
              {/* What the component does */}
              {hoverPreview.description && (
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1.5">
                    <Info className="h-3 w-3 text-primary/80 shrink-0" />
                    <span>What It Does</span>
                  </div>
                  <p data-testid="hover-info-description" className="text-[12px] leading-relaxed text-muted-foreground pl-4">
                    {hoverPreview.description}
                  </p>
                </div>
              )}

              {/* What action it performs */}
              {hoverPreview.action && (
                <div data-testid="hover-info-action-container" className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1.5 mb-1">
                    <MousePointerClick className="h-3 w-3 text-primary shrink-0" />
                    <span>Action</span>
                  </div>
                  <p data-testid="hover-info-action" className="text-[11.5px] leading-snug text-foreground/90 font-medium pl-4">
                    {hoverPreview.action}
                  </p>
                </div>
              )}

              {/* Pro-tip / Hint footer */}
              {hoverPreview.hint && (
                <div data-testid="hover-info-hint" className="rounded-lg bg-muted/50 border border-border/40 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground flex items-start gap-1.5">
                  <span className="shrink-0">💡</span>
                  <span className="italic">{hoverPreview.hint}</span>
                </div>
              )}
            </div>

            {/* Bottom Actions Bar - Ensures Next / Proceed action is always available and never overflows */}
            <div className="shrink-0 px-4 py-2 bg-muted/20 border-t border-border/40 flex items-center justify-between gap-2 mt-auto min-w-0 max-w-full">
              <Button
                variant="ghost"
                size="sm"
                onClick={hoverPreview.dismiss}
                className="h-7 min-h-0 text-xs px-2 text-muted-foreground hover:text-foreground shrink-0"
              >
                Close
              </Button>
              <div className="flex items-center justify-end gap-1.5 min-w-0 flex-1 max-w-full">
                <Button
                  variant="default"
                  size="sm"
                  data-testid="hover-info-next"
                  onClick={() => {
                    const targetSnippet = hoverPreview.snippetId || "snippet:rescue-launchpad";
                    hoverPreview.dismiss();
                    startTutorial(targetSnippet);
                  }}
                  className="h-7 min-h-0 text-xs px-3 bg-primary text-primary-foreground font-medium min-w-0 max-w-full inline-flex items-center justify-center overflow-hidden"
                >
                  <span className="truncate min-w-0">Start Guided Tour</span>
                  <ArrowRight className="w-3 h-3 ml-1 shrink-0" />
                </Button>
              </div>
            </div>
          </div>
        );
      }

      // Nothing shown during the 3-second wait — bubble appears only after delay
      return null;
    }
    return null;
  }

  return (
    <TutorialBubble
      target={currentStep.target}
      step={currentStepIndex + 1}
      totalSteps={totalSteps}
      scoreDimension={currentStep.scoreDimension}
      title={currentStep.title}
      description={currentStep.description}
      action={currentStep.action}
      side={currentStep.side || "bottom"}
      beacon={true}
      nextLabel={currentStep.nextLabel}
      intervalMs={activeTutorial.intervalMs}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
      moduleTitle={currentStep.moduleTitle}
      moduleIndex={currentStep.moduleIndex}
      totalModules={currentStep.totalModules}
      shortcut={currentStep.shortcut}
      hint={currentStep.hint}
      docSlug={currentStep.docSlug}
      componentId={currentStep.componentId}
      onNext={handleNext}
      onPrev={handlePrev}
      onComplete={handleComplete}
      onDismiss={handleDismiss}
    />
  );
}
