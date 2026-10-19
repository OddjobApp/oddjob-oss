import React, { useState } from "react";
import { useMultiStepApp } from "../context/MultiStepAppContext.js";
import { Check, ChevronRight, ArrowLeft, ArrowRight, Eye, Code, Database } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { cn } from "@/lib/utils";

export interface MultiStepScreenContainerProps {
  renderStepContent?: (stageId: string, inputs: Record<string, unknown>, onSubmit: (outputs: Record<string, unknown>) => void) => React.ReactNode;
  className?: string;
}

export function MultiStepScreenContainer({
  renderStepContent,
  className,
}: MultiStepScreenContainerProps) {
  const {
    blueprint,
    activeStageId,
    activeStageIndex,
    activeStage,
    stages,
    stageResults,
    isCompleted,
    getStageInputs,
    submitStage,
    goToStage,
    canNavigateTo,
    isLoading,
    error,
    refresh,
  } = useMultiStepApp();

  const [showStateBag, setShowStateBag] = useState<boolean>(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const currentInputs = activeStage ? getStageInputs(activeStage.id) : {};

  const handleFieldChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleAutoFillMockData = () => {
    if (!activeStage?.outputsSchema) return;
    const mock: Record<string, unknown> = {};
    Object.entries(activeStage.outputsSchema).forEach(([k, def]: [string, any]) => {
      if (def?.type === "number") {
        mock[k] = Math.floor(Math.random() * 1000) + 1;
      } else if (def?.type === "boolean") {
        mock[k] = true;
      } else {
        mock[k] = `sample_${k}_${Date.now().toString(36).slice(-4)}`;
      }
    });
    setFormData(mock);
  };

  const handleNext = async () => {
    if (!activeStage || isLoading) return;
    // The server decides whether this stage may complete. Only clear the form once
    // it has accepted — otherwise a rejected submission silently loses the input.
    const { isDone, nextStageId } = await submitStage(activeStage.id, formData);
    if (isDone || nextStageId) setFormData({});
  };

  const handleBack = () => {
    if (activeStageIndex > 0) {
      goToStage(stages[activeStageIndex - 1].id);
    }
  };

  if (isCompleted) {
    return (
      <Card className={cn("w-full max-w-4xl mx-auto border-emerald-500/30 bg-card/60 backdrop-blur-md shadow-2xl", className)}>
        <CardHeader className="text-center pb-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3">
            <Check className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-bold text-foreground">
            Application Flow Completed
          </CardTitle>
          <CardDescription>
            All {stages.length} steps of <strong>{blueprint?.name ?? "this run"}</strong> were successfully executed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border/50 bg-background/50 p-4 font-mono text-xs overflow-auto max-h-96">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/40 text-muted-foreground font-semibold">
              <span className="flex items-center gap-1.5"><Database className="w-3.5 h-3.5 text-primary" /> Session State Bag</span>
              <Badge variant="outline" className="text-[10px]">JSON Output</Badge>
            </div>
            <pre className="text-foreground">{JSON.stringify(stageResults, null, 2)}</pre>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end gap-3 pt-2">
          {/* No client-side "restart": the run belongs to the server, and wiping it
              locally would only desynchronise the view. Starting again means
              creating a new session. */}
          <Button variant="outline" onClick={() => void refresh()} disabled={isLoading}>
            Refresh
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // Distinguish "still loading" from "loaded and empty" — a blank wizard that
  // looks merely empty is how a failed load gets mistaken for a finished one.
  if (isLoading && stages.length === 0) {
    return (
      <Card className={cn("w-full max-w-4xl mx-auto", className)}>
        <CardContent className="p-12 text-center text-sm text-muted-foreground">
          Loading run…
        </CardContent>
      </Card>
    );
  }

  if (error && stages.length === 0) {
    return (
      <Card className={cn("w-full max-w-4xl mx-auto border-destructive/40", className)}>
        <CardContent className="p-12 text-center space-y-4">
          <p className="text-sm font-semibold text-destructive" role="alert">{error}</p>
          <Button variant="outline" onClick={() => void refresh()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("w-full max-w-5xl mx-auto space-y-6", className)}>
      {error && (
        <div
          role="alert"
          data-testid="multistep-error"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs font-semibold text-destructive"
        >
          {error}
        </div>
      )}

      {/* ── Step Progress Indicator ── */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2 border-b border-border/40">
        {stages.map((stage, idx) => {
          const isDone = Boolean(stageResults[stage.id]);
          const isActive = stage.id === activeStageId;
          const isClickable = canNavigateTo(stage.id);

          return (
            <React.Fragment key={stage.id}>
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => goToStage(stage.id)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : isDone
                    ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 cursor-pointer"
                    : isClickable
                    ? "bg-muted/40 text-muted-foreground hover:bg-muted/60 cursor-pointer"
                    : "opacity-40 text-muted-foreground cursor-not-allowed"
                )}
              >
                <span
                  className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                    isActive
                      ? "bg-primary-foreground text-primary"
                      : isDone
                      ? "bg-emerald-500 text-white"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {isDone ? <Check className="w-3 h-3" /> : idx + 1}
                </span>
                <span className="truncate max-w-[140px]">{stage.name}</span>
              </button>
              {idx < stages.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Active Stage Main Surface ── */}
      {activeStage && (
        <Card className="border-border/60 bg-card/60 backdrop-blur-md shadow-xl">
          <CardHeader className="flex flex-row items-start justify-between pb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider">
                  Step {activeStageIndex + 1} of {stages.length} • {activeStage.type.replace(/_/g, " ")}
                </Badge>
                {activeStage.responsibleAgentRole && (
                  <Badge variant="secondary" className="text-[10px]">
                    Lead: {activeStage.responsibleAgentRole}
                  </Badge>
                )}
              </div>
              <CardTitle className="text-xl font-bold text-foreground">
                {activeStage.name}
              </CardTitle>
              {activeStage.description && (
                <CardDescription className="mt-1 text-sm">
                  {activeStage.description}
                </CardDescription>
              )}
            </div>

            <div className="flex items-center gap-2">
              {activeStage.outputsSchema && Object.keys(activeStage.outputsSchema).length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAutoFillMockData}
                  className="text-xs text-primary hover:bg-primary/10 border-primary/30"
                >
                  <Eye className="w-3.5 h-3.5 mr-1" />
                  Auto-Fill Test Data
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowStateBag((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <Code className="w-3.5 h-3.5 mr-1" />
                {showStateBag ? "Hide Context" : "Inspect Context"}
              </Button>
            </div>
          </CardHeader>

          {/* Optional Inbound Props Banner */}
          {Object.keys(currentInputs).length > 0 && (
            <div className="mx-6 mb-4 p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs">
              <span className="font-semibold text-primary block mb-1.5 flex items-center gap-1">
                <Eye className="w-3.5 h-3.5" /> Injected Upstream Data ({Object.keys(currentInputs).length} variables)
              </span>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(currentInputs).map(([k, v]) => (
                  <div key={k} className="p-1.5 rounded bg-background/60 border border-border/40 font-mono text-[11px]">
                    <span className="text-muted-foreground">{k}:</span>{" "}
                    <span className="text-foreground font-semibold">
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live State Bag Inspector Drawer */}
          {showStateBag && (
            <div className="mx-6 mb-4 p-3 rounded-lg border border-border bg-muted/20 font-mono text-xs">
              <span className="text-muted-foreground font-semibold block mb-1">State Bag:</span>
              <pre className="text-foreground text-[11px] overflow-auto max-h-40">{JSON.stringify(stageResults, null, 2)}</pre>
            </div>
          )}

          <CardContent className="space-y-4">
            {renderStepContent ? (
              renderStepContent(activeStage.id, currentInputs, (outs) => { void submitStage(activeStage.id, outs); })
            ) : (
              <div className="space-y-4 py-2">
                {/* Default Form Fields based on outputsSchema if provided */}
                {activeStage.outputsSchema && Object.keys(activeStage.outputsSchema).length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground font-medium">Please provide the required information for this step:</p>
                    {Object.entries(activeStage.outputsSchema).map(([fieldKey, fieldDef]: [string, any]) => (
                      <div key={fieldKey} className="space-y-1">
                        <label className="text-xs font-semibold text-foreground capitalize">
                          {fieldKey.replace(/_/g, " ")} {fieldDef?.required && <span className="text-destructive">*</span>}
                        </label>
                        <input
                          type={fieldDef?.type === "number" ? "number" : "text"}
                          placeholder={fieldDef?.description ?? `Enter ${fieldKey}`}
                          value={String(formData[fieldKey] ?? "")}
                          onChange={(e) => handleFieldChange(fieldKey, fieldDef?.type === "number" ? Number(e.target.value) : e.target.value)}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center border border-dashed border-border/60 rounded-lg text-muted-foreground text-sm">
                    Builder Pod component <code>{activeStage.podComponent}</code> ready for execution.
                  </div>
                )}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex items-center justify-between border-t border-border/40 pt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={activeStageIndex === 0}
              onClick={handleBack}
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back
            </Button>

            <Button
              size="sm"
              onClick={handleNext}
              className="bg-primary text-primary-foreground font-semibold"
            >
              {activeStageIndex === stages.length - 1 ? "Complete & Submit" : "Continue to Next Step"}
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
