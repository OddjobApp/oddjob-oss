import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import {
  GitBranch,
  Plus,
  Trash2,
  Zap,
  ArrowRight,
  ShieldCheck,
  Code,
  Clock,
  Settings2,
  CheckCircle2,
  AlertCircle,
  Play,
  Shuffle,
  ListOrdered
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "./pod-event-bus.js";

export type StepType = "data_extract" | "ai_inference" | "hil_approval" | "action_dispatch" | "custom_tool";

export interface PipelineStepItem {
  id: string;
  name: string;
  type: StepType;
  toolName?: string;
  celCondition?: string;
  executionMode?: "sequential" | "parallel";
  timeoutSeconds?: number;
}

// Tools the registry actually has. Seven of the eight entries this list used to
// offer (agentic_analyzer, slack_incident_broadcast, dataset_insert, …) were never
// registered, so a step bound to one looked configured and could never run.
export const REGISTERED_ODDJOB_TOOLS = [
  { name: "add_dataset_items", label: "Add Records to a Dataset", type: "action_dispatch" },
  { name: "send_email", label: "Send Email", type: "action_dispatch" },
  { name: "request_human_input", label: "Request Human Input (HIL form)", type: "hil_approval" },
  { name: "geocoding", label: "Geocode an Address", type: "custom_tool" },
  { name: "get_entity_impact", label: "Knowledge Graph Entity Impact", type: "custom_tool" },
  { name: "execute_calculation_node", label: "Execute a Calculation Node", type: "custom_tool" }
];

export interface PipelineBuilderPodProps {
  stageId?: string;
  title?: string;
  pipelineName?: string;
  trigger?: "webhook" | "cron" | "event" | "manual";
  defaultTrigger?: "webhook" | "cron" | "event" | "manual";
  steps?: PipelineStepItem[];
  defaultSteps?: PipelineStepItem[];
  onStageComplete?: (payload: {
    trigger: string;
    steps: PipelineStepItem[];
    stageId: string;
    flowTopology?: "sequential" | "parallel_fan_out";
    timestamp?: string;
    _trace?: { traceparent: string; generatedAt: string };
  }) => void;
  className?: string;
}

const FALLBACK_STEPS: PipelineStepItem[] = [
  { id: "step-1", name: "Extract Ingestion Payload", type: "data_extract", celCondition: "payload.size > 0", executionMode: "sequential" },
  // No tool bindings on the example steps: "agentic_analyzer" and
  // "slack_incident_broadcast" were never registered tools.
  { id: "step-2", name: "AI Sentiment & Threat Analysis", type: "ai_inference", executionMode: "sequential" },
  { id: "step-3", name: "SOC2 Compliance Signoff", type: "hil_approval", celCondition: "threatScore >= 70", executionMode: "sequential" },
  { id: "step-4", name: "Dispatch Quarantine & Alert", type: "action_dispatch", executionMode: "parallel" }
];

function validateCelSyntax(expr?: string): { valid: boolean; message: string } {
  if (!expr || !expr.trim()) {
    return { valid: true, message: "Unconditional (Always Runs)" };
  }
  const clean = expr.trim();
  // Check parenthesis balance
  let openParen = 0;
  for (const ch of clean) {
    if (ch === "(") openParen++;
    if (ch === ")") openParen--;
    if (openParen < 0) return { valid: false, message: "Unmatched closing parenthesis ')'" };
  }
  if (openParen !== 0) return { valid: false, message: "Unclosed parenthesis '('" };

  // Disallow forbidden statements
  if (/[;{}]/.test(clean) || /\b(eval|function|return|delete|var|let|const)\b/.test(clean)) {
    return { valid: false, message: "Invalid CEL token or statements detected" };
  }

  // Basic recognized operators in CEL
  const validPattern = /^[a-zA-Z0-9_.\s'"><!=&|()\-+*%]+$/;
  if (!validPattern.test(clean)) {
    return { valid: false, message: "Contains unsupported symbols for CEL" };
  }

  return { valid: true, message: "CEL Syntax Valid" };
}

export default function PipelineBuilderPod(props: PipelineBuilderPodProps) {
  const {
    stageId = "stage-pipeline",
    title = props.pipelineName || "Pipeline & Execution Flow Builder",
    className,
    onStageComplete,
  } = props;

  const initialSteps = props.steps || props.defaultSteps || FALLBACK_STEPS;
  const initialTrigger = props.trigger || props.defaultTrigger || "webhook";

  const [trigger, setTrigger] = useState<string>(initialTrigger);
  const [steps, setSteps] = useState<PipelineStepItem[]>(initialSteps);
  const [activeStepId, setActiveStepId] = useState<string>(initialSteps[0]?.id || "");
  const [topologyMode, setTopologyMode] = useState<"sequential" | "parallel_fan_out">("sequential");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mockPayloadInput, setMockPayloadInput] = useState<string>('{"threatScore": 80, "payload": {"size": 150}}');
  const [testResult, setTestResult] = useState<{ passed: boolean; error?: string } | null>(null);

  // Two-way chat event bus
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if (action === "set-trigger" && payload?.trigger) {
      setTrigger(payload.trigger);
    } else if (action === "add-step" && payload?.name) {
      const newId = `step-${steps.length + 1}`;
      const newStep: PipelineStepItem = {
        id: newId,
        name: payload.name,
        type: payload.type || "ai_inference",
        toolName: payload.toolName,
        celCondition: payload.celCondition || "",
        executionMode: payload.executionMode || "sequential"
      };
      setSteps(prev => [...prev, newStep]);
      setActiveStepId(newId);
    } else if (action === "remove-step" && payload?.id) {
      removeStep(payload.id);
    } else if (action === "update-step" && payload?.id && payload?.updates) {
      setSteps(prev => prev.map(s => s.id === payload.id ? { ...s, ...payload.updates } : s));
    } else if (action === "confirm") {
      handleConfirm();
    }
  });

  const addStep = () => {
    const newId = `step-${steps.length + 1}`;
    const newStep: PipelineStepItem = {
      id: newId,
      name: `Step ${steps.length + 1} Action`,
      type: "ai_inference",
      celCondition: "",
      executionMode: "sequential"
    };
    setSteps([...steps, newStep]);
    setActiveStepId(newId);
  };

  const removeStep = (id: string) => {
    setSteps(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeStepId === id) {
        setActiveStepId(filtered[0]?.id || "");
      }
      return filtered;
    });
  };

  const updateActiveStep = (updates: Partial<PipelineStepItem>) => {
    setSteps(prev => prev.map(s => s.id === activeStepId ? { ...s, ...updates } : s));
  };

  const activeStep = steps.find(s => s.id === activeStepId);

  const celValidation = useMemo(() => {
    return validateCelSyntax(activeStep?.celCondition);
  }, [activeStep?.celCondition]);

  const testCelEvaluation = () => {
    if (!activeStep?.celCondition || !activeStep.celCondition.trim()) {
      setTestResult({ passed: true, error: "Unconditional: evaluated to true" });
      return;
    }
    try {
      const context = JSON.parse(mockPayloadInput);
      // Safe mock evaluation for preview purposes
      const keys = Object.keys(context);
      const values = Object.values(context);
      // Construct function with scoped parameters
      const fn = new Function(...keys, `return Boolean(${activeStep.celCondition});`);
      const res = fn(...values);
      setTestResult({ passed: Boolean(res) });
    } catch (err: any) {
      setTestResult({ passed: false, error: err.message || "Failed to evaluate CEL expression against mock context" });
    }
  };

  const handleConfirm = () => {
    setIsSubmitting(true);
    const traceparent = generateW3CTraceparent();
    const payload = {
      stageId,
      trigger,
      steps,
      flowTopology: topologyMode,
      timestamp: new Date().toISOString(),
      _trace: {
        traceparent,
        generatedAt: new Date().toISOString()
      }
    };

    if (onStageComplete) {
      onStageComplete(payload);
    }

    emitWorkbenchSaved(
      stageId,
      `Configured Pipeline with ${trigger} trigger and ${steps.length} steps (${topologyMode})`,
      payload
    );

    setTimeout(() => setIsSubmitting(false), 500);
  };

  return (
    <Card className={cn("border border-border/70 bg-card/80 shadow-md backdrop-blur-md", className)} data-testid="pipeline-builder-pod">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-amber-500/10 text-amber-500">
              <GitBranch className="w-4 h-4" />
            </span>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight">{title}</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Sequence workflow execution steps, CEL branching rules, and input triggers
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono uppercase bg-amber-500/5 text-amber-600 border-amber-500/20">
              {steps.length} Steps
            </Badge>
            <div className="flex rounded-md border border-border bg-background p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setTopologyMode("sequential")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                  topologyMode === "sequential" ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" : "text-muted-foreground"
                )}
                title="Strict Sequential Execution"
              >
                <ListOrdered className="w-3 h-3" /> Sequential
              </button>
              <button
                type="button"
                onClick={() => setTopologyMode("parallel_fan_out")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                  topologyMode === "parallel_fan_out" ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" : "text-muted-foreground"
                )}
                title="Parallel Execution Fan-Out"
              >
                <Shuffle className="w-3 h-3" /> Fan-Out
              </button>
            </div>
          </div>
        </div>

        {/* Trigger Selector */}
        <div className="flex items-center gap-2 pt-2 text-xs">
          <span className="text-muted-foreground font-medium text-[11px]">Trigger:</span>
          {["webhook", "cron", "event", "manual"].map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTrigger(t)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                trigger === t
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/30"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Step Nodes Track */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider text-[10px]">
              {topologyMode === "parallel_fan_out" ? "Concurrent / Parallel DAG Steps" : "Sequential Execution Steps"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={addStep}
              className="h-6 text-[11px] px-2 gap-1 border-dashed"
            >
              <Plus className="w-3 h-3" /> Add Step
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {steps.map((step, idx) => {
              const isActive = step.id === activeStepId;
              return (
                <div
                  key={step.id}
                  onClick={() => setActiveStepId(step.id)}
                  className={cn(
                    "cursor-pointer rounded-lg border p-2.5 transition-all text-left flex items-center justify-between gap-2",
                    isActive
                      ? "border-amber-500/60 bg-amber-500/5 shadow-xs"
                      : "border-border/60 bg-card/40 hover:border-border"
                  )}
                  data-testid={`step-node-${step.id}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-muted text-[10px] font-bold">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{step.name}</p>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono truncate">
                        <span>{step.type}</span>
                        {step.executionMode === "parallel" && (
                          <Badge variant="outline" className="h-3.5 px-1 text-[8px] border-blue-500/40 text-blue-600 bg-blue-500/10">
                            async
                          </Badge>
                        )}
                        {step.celCondition && (
                          <span className="truncate text-amber-600 dark:text-amber-400">
                            [if: {step.celCondition}]
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {steps.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeStep(step.id); }}
                        className="text-muted-foreground/60 hover:text-rose-500 p-1"
                        title="Delete Step"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Active Step Configurator */}
        {activeStep && (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                <Settings2 className="w-3.5 h-3.5 text-amber-500" />
                Configuring: {activeStep.name}
              </span>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[9px] font-mono">
                  {activeStep.id}
                </Badge>
                <button
                  type="button"
                  onClick={() => updateActiveStep({
                    executionMode: activeStep.executionMode === "parallel" ? "sequential" : "parallel"
                  })}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[9px] font-mono border transition-colors",
                    activeStep.executionMode === "parallel"
                      ? "border-blue-500/40 bg-blue-500/15 text-blue-600"
                      : "border-border text-muted-foreground"
                  )}
                >
                  Mode: {activeStep.executionMode || "sequential"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Step Name</label>
                <Input
                  value={activeStep.name}
                  onChange={(e) => updateActiveStep({ name: e.target.value })}
                  className="h-7 text-xs bg-background"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Step Category</label>
                <select
                  value={activeStep.type}
                  onChange={(e) => updateActiveStep({ type: e.target.value as any })}
                  className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                >
                  <option value="data_extract">Data Extraction & Transform</option>
                  <option value="ai_inference">AI Model Synthesis</option>
                  <option value="hil_approval">Human Approval Gate</option>
                  <option value="action_dispatch">Action & Tool Dispatch</option>
                  <option value="custom_tool">Custom Tool Integration</option>
                </select>
              </div>
            </div>

            {/* Tool Binding Picker */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
                Binding Tool Capability (Oddjob Tool Registry)
              </label>
              <select
                value={activeStep.toolName || ""}
                onChange={(e) => updateActiveStep({ toolName: e.target.value || undefined })}
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                <option value="">-- Direct Inline Execution (No External Tool) --</option>
                {REGISTERED_ODDJOB_TOOLS.map(t => (
                  <option key={t.name} value={t.name}>{t.label} ({t.name})</option>
                ))}
              </select>
            </div>

            {/* CEL Condition Gate with Live Syntax & Test Sandbox */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                  <Code className="w-3 h-3 text-amber-500" /> CEL Condition Gate (Optional)
                </label>
                <div className="flex items-center gap-1">
                  {celValidation.valid ? (
                    <span className="flex items-center gap-1 text-[9px] font-mono text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                      <CheckCircle2 className="w-2.5 h-2.5" /> {celValidation.message}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[9px] font-mono text-rose-600 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                      <AlertCircle className="w-2.5 h-2.5" /> {celValidation.message}
                    </span>
                  )}
                </div>
              </div>
              <Input
                placeholder="e.g. payload.size > 0 && threatScore >= 70"
                value={activeStep.celCondition || ""}
                onChange={(e) => updateActiveStep({ celCondition: e.target.value })}
                className="h-7 font-mono text-[11px] bg-background"
              />

              {/* CEL Mock Evaluation Drawer */}
              {activeStep.celCondition && (
                <div className="mt-2 p-2 rounded bg-background/60 border border-border/50 text-[10px] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-muted-foreground">Mock CEL Evaluation:</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={testCelEvaluation}
                      className="h-5 text-[9px] px-1.5 gap-1"
                    >
                      <Play className="w-2.5 h-2.5" /> Test Condition
                    </Button>
                  </div>
                  <Input
                    value={mockPayloadInput}
                    onChange={(e) => setMockPayloadInput(e.target.value)}
                    placeholder='{"threatScore": 80, "payload": {"size": 150}}'
                    className="h-6 font-mono text-[9px] bg-background"
                  />
                  {testResult && (
                    <div className={cn(
                      "p-1.5 rounded text-[9px] font-mono border",
                      testResult.passed
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                    )}>
                      Result: {testResult.passed ? "Condition PASS (Gate Opened)" : "Condition BLOCKED (Step Skipped)"}
                      {testResult.error && ` — ${testResult.error}`}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground">
            Pipeline DAG compiles to asynchronous distributed execution engine
          </span>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={steps.length === 0 || isSubmitting}
            className="bg-amber-600 text-white hover:bg-amber-500 text-xs h-8 px-4"
            data-testid="pipeline-builder-confirm"
          >
            {isSubmitting ? "Saving..." : "Save Pipeline Stage & Continue"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
