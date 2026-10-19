import React, { useEffect, useState } from "react";
import { Camera, CheckCircle2, ChevronDown, History, Layers, MessageSquare, RefreshCw, SplitSquareVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import PlatformImageComparisonBlock from "@domain-ui/core/ui/components/packaged/PlatformImageComparisonBlock";
import { TAKE_STATUS_LABEL, type DefectClass, type MediaShot, type MediaShotTake } from "../types";
import { shortcutKeys } from "../shortcuts";
import { promptHistory } from "../film";
import { FOCUS_RING, StatusIcon } from "../StatusIcon";

export interface MediaDailiesInspectorProps {
  activeShot: MediaShot | null;
  activeTake: MediaShotTake | null;
  activeTakeIndex: number;
  onSelectTake: (takeIndex: number) => void;
  onApproveTake?: (sceneId: string, shotNumber: number, takeId: string) => void;
  onRerollTake?: (sceneId: string, shotNumber: number, takeId: string, defect: DefectClass, promptDelta?: string) => void;
  onDiscussTake?: (sceneId: string, shotNumber: number, takeId: string) => void;
  /** Asks for a take of a shot that has none. */
  onRequestTake?: (sceneId: string, shotNumber: number) => void;
  /** Changes when the re-shoot shortcut is pressed, to open the re-shoot menu. */
  reshootRequest?: number;
  className?: string;
}

const DEFECT_OPTIONS: Array<{ id: DefectClass; label: string; description: string }> = [
  { id: "character_drift", label: "Character drift", description: "Face or wardrobe changed from the continuity seed" },
  { id: "unnatural_motion", label: "Unnatural motion", description: "Too fast, morphing objects, or camera jitter" },
  { id: "wrong_framing", label: "Wrong framing or lens", description: "Composition, angle or focal length is off" },
  { id: "lighting_mismatch", label: "Lighting or color shift", description: "Color temperature, key light or mood doesn't match" },
  { id: "artifact_glitch", label: "Render glitch", description: "Distortions, extra limbs or frame tearing" },
];

export function MediaDailiesInspector({
  activeShot,
  activeTake,
  activeTakeIndex,
  onSelectTake,
  onApproveTake,
  onRerollTake,
  onDiscussTake,
  onRequestTake,
  reshootRequest,
  className,
}: MediaDailiesInspectorProps) {
  const [showDefectMenu, setShowDefectMenu] = useState(false);
  const [showContinuityWipe, setShowContinuityWipe] = useState(false);
  const [promptDelta, setPromptDelta] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (reshootRequest) setShowDefectMenu(true);
  }, [reshootRequest]);

  if (!activeShot) {
    return (
      <div className={cn("flex flex-col items-center justify-center rounded-xl border border-border/70 bg-card p-6 text-center", className)} data-testid="media-dailies-inspector">
        <Layers className="mb-2 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium text-foreground">Select a shot on the timeline</p>
      </div>
    );
  }

  const hasActions = Boolean(onApproveTake || onRerollTake);
  const canApprove = activeTake?.status === "ready_for_review";

  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3", className)} data-testid="media-dailies-inspector">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-bold text-foreground">Shot {activeShot.shotNumber}</span>
          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">{activeShot.sceneId}</Badge>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Takes">
          {activeShot.takes.map((take, index) => (
            <button
              key={take.takeId}
              type="button"
              onClick={() => onSelectTake(index)}
              aria-pressed={index === activeTakeIndex}
              aria-label={`Take ${take.takeNumber}, ${TAKE_STATUS_LABEL[take.status]}`}
              className={cn(
                "inline-flex items-center gap-0.5 rounded px-2 py-0.5 font-mono text-[10px] font-medium transition-colors",
                index === activeTakeIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                FOCUS_RING,
              )}
              data-testid={`take-selector-tab-${take.takeNumber}`}
            >
              <StatusIcon status={take.status} className="h-2.5 w-2.5" />T{take.takeNumber}
            </button>
          ))}
        </div>
      </div>

      {activeTake ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/40 bg-muted/30 p-2.5 text-xs">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <Camera className="h-3 w-3 text-primary" />
            <span>Direction</span>
            <span className="ml-auto font-normal text-muted-foreground">{TAKE_STATUS_LABEL[activeTake.status]}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{activeTake.prompt || "No prompt recorded."}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/30 pt-1.5 text-[10px] text-muted-foreground">
            {activeTake.cameraMotion && <span><strong>Motion:</strong> {activeTake.cameraMotion}</span>}
            {activeTake.seed !== undefined && activeTake.seed !== "" && (
              <span><strong>Seed:</strong> <code className="font-mono text-foreground">{String(activeTake.seed)}</code></span>
            )}
            <span><strong>Duration:</strong> {activeTake.durationSeconds}s</span>
            {activeTake.costUsd != null && <span><strong>Cost:</strong> ${activeTake.costUsd.toFixed(2)}</span>}
          </div>
          {activeTake.defectClass && (
            <p className="text-[10px] text-muted-foreground">
              <strong>Defect:</strong> {DEFECT_OPTIONS.find((option) => option.id === activeTake.defectClass)?.label ?? activeTake.defectClass}
              {activeTake.notes ? ` — ${activeTake.notes}` : ""}
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-1.5 rounded-lg border border-dashed border-border p-2.5 text-xs" data-testid="dailies-no-takes">
          <p className="font-medium text-foreground">This shot has no takes yet</p>
          <p className="text-[11px] text-muted-foreground">
            A take renders the shot's direction and dialogue. A live take waits for your approval in the Decision Inbox before anything is spent.
          </p>
          {onRequestTake && (
            <div>
              <Button type="button" size="sm" className="h-7" onClick={() => onRequestTake(activeShot.sceneId, activeShot.shotNumber)} data-testid="dailies-request-take-btn">
                Ask for a take
              </Button>
            </div>
          )}
        </div>
      )}

      {activeShot.takes.length > 1 && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-2" data-testid="dailies-prompt-history">
          <Button
            type="button"
            variant={showHistory ? "secondary" : "ghost"}
            size="sm"
            className="h-7 w-full justify-between px-2 text-[11px]"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((open) => !open)}
            data-testid="dailies-prompt-history-toggle"
          >
            <span className="flex items-center gap-1.5 font-medium"><History className="h-3.5 w-3.5 text-primary" />Prompt history</span>
            <span className="font-mono text-[10px] text-muted-foreground">{activeShot.takes.length} takes</span>
          </Button>
          {showHistory && (
            <ol className="mt-1.5 grid gap-1">
              {promptHistory(activeShot).map((step, stepIndex) => {
                const index = activeShot.takes.findIndex((take) => take.takeId === step.takeId);
                const reason = step.after ? DEFECT_OPTIONS.find((option) => option.id === step.after?.defectClass)?.label ?? step.after.defectClass : null;
                return (
                  <li key={step.takeId}>
                    <button
                      type="button"
                      onClick={() => onSelectTake(index)}
                      aria-current={index === activeTakeIndex ? "true" : undefined}
                      className={cn(
                        "grid w-full gap-0.5 rounded-md border p-1.5 text-left text-[11px]",
                        index === activeTakeIndex ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-muted/60",
                        FOCUS_RING,
                      )}
                      data-testid={`prompt-history-take-${step.takeNumber}`}
                    >
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <StatusIcon status={step.status} />Take {step.takeNumber}
                        <span className="font-normal text-muted-foreground">{TAKE_STATUS_LABEL[step.status]}</span>
                        <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                          {stepIndex === 0 ? "First take" : step.changed ? "Prompt changed" : "Same prompt"}
                        </span>
                      </span>
                      {step.after && (
                        <span className="text-[10px] text-muted-foreground">
                          Re-shot from take {step.after.takeNumber}: {reason}{step.after.notes ? `, "${step.after.notes}"` : ""}
                        </span>
                      )}
                      <span className="line-clamp-2 text-[10px] text-muted-foreground">{step.prompt || "No prompt recorded."}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {/* A/B Continuity Split-Wipe via PlatformImageComparisonBlock */}
      {activeTake && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-muted/20 p-2">
          <Button
            type="button"
            variant={showContinuityWipe ? "secondary" : "ghost"}
            size="sm"
            className="h-7 w-full justify-between px-2 text-[11px]"
            onClick={() => setShowContinuityWipe((open) => !open)}
            data-testid="dailies-continuity-wipe-toggle"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <SplitSquareVertical className="h-3.5 w-3.5 text-primary" />
              <span>A/B Continuity Wipe</span>
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {showContinuityWipe ? "Hide" : "Inspect Split"}
            </span>
          </Button>

          {showContinuityWipe && (
            <div className="mt-1 overflow-hidden rounded-lg border border-border/80 shadow-md" data-testid="dailies-continuity-wipe-container">
              <PlatformImageComparisonBlock
                beforeImage={
                  activeTakeIndex > 0
                    ? activeShot.takes[activeTakeIndex - 1]?.thumbnailUrl || activeShot.takes[activeTakeIndex - 1]?.streaming?.previewUrl || activeShot.storyboardUrl || activeTake.thumbnailUrl || ""
                    : activeShot.storyboardUrl || activeTake.thumbnailUrl || ""
                }
                afterImage={activeTake.thumbnailUrl || activeTake.streaming?.previewUrl || activeTake.videoUrl || ""}
                beforeLabel={activeTakeIndex > 0 ? `Take ${activeShot.takes[activeTakeIndex - 1]?.takeNumber}` : "Storyboard Reference"}
                afterLabel={`Take ${activeTake.takeNumber}`}
                height="200px"
              />
            </div>
          )}
        </div>
      )}

      {onDiscussTake && activeTake && (
        <Button
          type="button" variant="ghost" size="sm" className="h-7 justify-start gap-1.5 text-xs"
          onClick={() => onDiscussTake(activeShot.sceneId, activeShot.shotNumber, activeTake.takeId)}
          data-testid="dailies-discuss-take-btn"
        >
          <MessageSquare className="h-3.5 w-3.5" />Discuss take {activeTake.takeNumber} in chat
        </Button>
      )}

      {hasActions && activeTake && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-1.5">
            {onApproveTake && (
              <Button
                type="button"
                variant={activeTake.status === "approved" ? "secondary" : "default"}
                size="sm"
                className="h-8 gap-1.5 text-xs font-semibold"
                disabled={!canApprove}
                title={canApprove ? `Approve take (${shortcutKeys("approveTake")})` : "Only a take ready for review can be approved."}
                onClick={() => onApproveTake(activeShot.sceneId, activeShot.shotNumber, activeTake.takeId)}
                data-testid="dailies-approve-take-btn"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{activeTake.status === "approved" ? "Approved" : "Approve take"}</span>
              </Button>
            )}
            {onRerollTake && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                aria-expanded={showDefectMenu}
                title={`Re-shoot (${shortcutKeys("reshootTake")})`}
                onClick={() => setShowDefectMenu((open) => !open)}
                data-testid="dailies-reroll-btn"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Re-shoot</span>
                <ChevronDown className="ml-auto h-3 w-3 opacity-70" />
              </Button>
            )}
          </div>

          {onRerollTake && showDefectMenu && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border/80 bg-card p-2 shadow-lg" data-testid="dailies-defect-menu">
              <label className="grid gap-1 text-[10px] font-medium text-foreground" htmlFor={`reshoot-delta-${activeShot.shotNumber}`}>
                What to change (optional)
                <input
                  id={`reshoot-delta-${activeShot.shotNumber}`}
                  type="text"
                  value={promptDelta}
                  onChange={(event) => setPromptDelta(event.target.value)}
                  className="w-full rounded border border-border bg-muted/50 px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <p className="text-[10px] font-semibold text-foreground">What was wrong with this take?</p>
              {DEFECT_OPTIONS.map((defect) => (
                <button
                  key={defect.id}
                  type="button"
                  onClick={() => {
                    onRerollTake(activeShot.sceneId, activeShot.shotNumber, activeTake.takeId, defect.id, promptDelta.trim() || undefined);
                    setShowDefectMenu(false);
                    setPromptDelta("");
                  }}
                  className={cn("flex flex-col rounded-md p-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-muted/70", FOCUS_RING)}
                  data-testid={`defect-option-${defect.id}`}
                >
                  <span className="font-medium">{defect.label}</span>
                  <span className="text-[10px] text-muted-foreground">{defect.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
