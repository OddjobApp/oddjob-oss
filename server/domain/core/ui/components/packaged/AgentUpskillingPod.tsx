import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { 
  GraduationCap, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  ShieldCheck, 
  Wrench, 
  FileCode, 
  Cpu, 
  ArrowRight, 
  Star,
  Activity,
  Zap,
  ChevronDown,
  ChevronUp,
  Play,
  FileDiff
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "./pod-event-bus.js";

export type UpskillingStrategy = "prompt_optimization" | "golden_samples" | "fine_tuning";

export interface TrajectoryError {
  id: string;
  toolName: string;
  errorPattern: string;
  occurredCount: number;
  severity: "low" | "medium" | "high";
  stackTrace?: string;
  samplePayload?: string;
}

export interface AgentUpskillingPodProps {
  stageId?: string;
  agentId?: string;
  agentName?: string;
  targetCompetency?: string;
  currentProficiency?: number;
  recentErrors?: TrajectoryError[];
  selectedStrategy?: UpskillingStrategy;
  canaryScore?: number;
  onStageComplete?: (payload: {
    stageId: string;
    agentId: string;
    agentName: string;
    targetCompetency: string;
    promotedProficiency: number;
    strategy: UpskillingStrategy;
    canaryScore: number;
    ratifiedAt: string;
    timestamp?: string;
    _trace?: { traceparent: string; generatedAt: string };
  }) => void;
  onUpskillingConfirmed?: (payload: any) => void;
}

const DEFAULT_ERRORS: TrajectoryError[] = [
  {
    id: "err-1",
    toolName: "geocoding_service",
    errorPattern: "Missing required ISO 3166-1 country_code in payload",
    occurredCount: 4,
    severity: "high",
    stackTrace: "ValidationError: country_code is mandatory for geocode resolution\n  at resolveVenueCoordinates (geocoding_service.ts:42:15)\n  at executeToolAction (agent-runner.ts:118:9)",
    samplePayload: '{"address": "742 Evergreen Terrace", "city": "Springfield"}'
  },
  {
    id: "err-2",
    toolName: "database_insert",
    errorPattern: "Type mismatch: expected integer cents, received float currency",
    occurredCount: 2,
    severity: "medium",
    stackTrace: "TypeError: column 'amount_cents' expected integer, got 45.50\n  at pgInsert (db-adapter.ts:88:20)",
    samplePayload: '{"amount_cents": 45.50, "account_id": "acc-99"}'
  },
  {
    id: "err-3",
    toolName: "webhook_dispatch",
    errorPattern: "Timeout waiting for upstream webhook acknowledgement (5000ms)",
    occurredCount: 1,
    severity: "low",
    stackTrace: "TimeoutError: Upstream endpoint timed out after 5000ms\n  at dispatchWebhook (webhook.ts:31:12)",
    samplePayload: '{"url": "https://hooks.slack.com/services/...", "retries": 1}'
  },
];

export default function AgentUpskillingPod({
  stageId = "stage-agent-upskilling",
  agentId = "agent-data-wrangler-04",
  agentName = "Data Wrangler Prime",
  targetCompetency = "Geospatial Data Normalization",
  currentProficiency = 2,
  recentErrors: initialErrors = DEFAULT_ERRORS,
  selectedStrategy: initialStrategy = "prompt_optimization",
  canaryScore = 96.5,
  onStageComplete,
  onUpskillingConfirmed,
}: AgentUpskillingPodProps) {
  const [strategy, setStrategy] = useState<UpskillingStrategy>(initialStrategy);
  const [isRatified, setIsRatified] = useState(false);
  const [promotedProficiency, setPromotedProficiency] = useState<number>(Math.min(5, currentProficiency + 1));
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const [showPromptDiff, setShowPromptDiff] = useState(false);
  const [liveCanaryScore, setLiveCanaryScore] = useState(canaryScore);
  const [isRunningCanary, setIsRunningCanary] = useState(false);

  // Two-way chat event bus
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if (action === "set-strategy" && payload?.strategy) {
      setStrategy(payload.strategy);
    } else if (action === "set-proficiency" && typeof payload?.level === "number") {
      setPromotedProficiency(payload.level);
    } else if (action === "run-canary") {
      runCanarySandbox();
    } else if (action === "confirm") {
      handleRatify();
    }
  });

  const runCanarySandbox = () => {
    setIsRunningCanary(true);
    setTimeout(() => {
      setLiveCanaryScore(99.2);
      setIsRunningCanary(false);
    }, 600);
  };

  const handleRatify = () => {
    setIsRatified(true);
    const traceparent = generateW3CTraceparent();
    const payload = {
      stageId,
      agentId,
      agentName,
      targetCompetency,
      promotedProficiency,
      strategy,
      canaryScore: liveCanaryScore,
      ratifiedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      _trace: {
        traceparent,
        generatedAt: new Date().toISOString()
      }
    };

    if (onStageComplete) {
      onStageComplete(payload);
    }
    if (onUpskillingConfirmed) {
      onUpskillingConfirmed(payload);
    }

    emitWorkbenchSaved(
      stageId,
      `Promoted ${agentName} to ${targetCompetency} (Level ${promotedProficiency}) via ${strategy}`,
      payload
    );
  };

  return (
    <Card 
      className="w-full border-border bg-card text-card-foreground shadow-2xl backdrop-blur-md"
      data-testid="agent-upskilling-pod"
    >
      <CardHeader className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-indigo-400" />
            <div>
              <CardTitle className="text-xl font-bold tracking-tight text-foreground">
                Agent Upskilling: {agentName}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Competency Evolution, Trajectory Debugging & Canary Verification • Stage: {stageId}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-indigo-500/40 bg-indigo-500/10 text-indigo-300">
              Target: {targetCompetency}
            </Badge>
            <div className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-amber-300">
              <span>Proficiency:</span>
              <div className="flex text-amber-400">
                {[1, 2, 3, 4, 5].map((lvl) => (
                  <Star 
                    key={lvl} 
                    className={cn("h-3 w-3", lvl <= currentProficiency ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} 
                  />
                ))}
              </div>
            </div>
            {isRatified ? (
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-500">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Competency Promoted
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-amber-900/40 text-amber-300">
                <Activity className="mr-1 h-3 w-3" /> Diagnostic Ready
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* PANE 1: Trajectory Error Analysis with Expandable Stack Traces */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground/70">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              1. Execution Trajectory Diagnostics ({initialErrors.length} Detected Anomalies)
            </h3>
            <span className="text-xs text-muted-foreground">Click anomaly for telemetry trace & payload inspect</span>
          </div>

          <div className="space-y-2">
            {initialErrors.map((err) => {
              const isExpanded = expandedErrorId === err.id;
              return (
                <div 
                  key={err.id}
                  className="rounded-lg border border-border bg-background/60 p-3 text-xs cursor-pointer hover:border-border transition-colors"
                  onClick={() => setExpandedErrorId(isExpanded ? null : err.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-cyan-400">{err.toolName}</span>
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-[10px] px-1.5 py-0",
                            err.severity === "high" && "border-rose-500/40 text-rose-300 bg-rose-500/10",
                            err.severity === "medium" && "border-amber-500/40 text-amber-300 bg-amber-500/10",
                            err.severity === "low" && "border-blue-500/40 text-blue-300 bg-blue-500/10"
                          )}
                        >
                          {err.severity.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-foreground/70">{err.errorPattern}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <span className="font-mono text-sm font-bold text-amber-400">{err.occurredCount}x</span>
                        <span className="block text-[10px] text-muted-foreground">frequency</span>
                      </div>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                  </div>

                  {isExpanded && err.stackTrace && (
                    <div className="mt-2.5 pt-2.5 border-t border-border space-y-2">
                      <div>
                        <span className="text-[10px] font-semibold text-muted-foreground block mb-1">Stack Trace:</span>
                        <pre className="p-2 rounded bg-muted border border-border text-[10px] font-mono text-rose-400 dark:text-rose-300 overflow-x-auto">
                          {err.stackTrace}
                        </pre>
                      </div>
                      {err.samplePayload && (
                        <div>
                          <span className="text-[10px] font-semibold text-muted-foreground block mb-1">Offending Payload:</span>
                          <pre className="p-2 rounded bg-muted border border-border text-[10px] font-mono text-cyan-400 dark:text-cyan-300 overflow-x-auto">
                            {err.samplePayload}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* PANE 2: Upskilling Strategy Selector */}
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Wrench className="h-4 w-4 text-cyan-400" />
            2. Upskilling Strategy & Remediation Tier
          </h3>

          <div className="grid gap-3 md:grid-cols-3">
            {/* Tier 1: Prompt Patch */}
            <div
              onClick={() => setStrategy("prompt_optimization")}
              className={cn(
                "cursor-pointer rounded-lg border p-4 transition-all",
                strategy === "prompt_optimization"
                  ? "border-indigo-500 bg-accent/80 shadow-md ring-1 ring-indigo-500/50"
                  : "border-border bg-card/60 hover:border-border/80"
              )}
              data-testid="strategy-prompt"
            >
              <div className="flex items-center justify-between">
                <FileCode className="h-5 w-5 text-indigo-400" />
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 text-[10px]">
                  Fast • Zero Cost
                </Badge>
              </div>
              <h4 className="mt-2 text-sm font-bold text-foreground">Tier 1: Directive Patch</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Synthesizes anti-pattern rules directly into system prompt instructions and parameter validators.
              </p>
            </div>

            {/* Tier 2: Golden Samples */}
            <div
              onClick={() => setStrategy("golden_samples")}
              className={cn(
                "cursor-pointer rounded-lg border p-4 transition-all",
                strategy === "golden_samples"
                  ? "border-indigo-500 bg-accent/80 shadow-md ring-1 ring-indigo-500/50"
                  : "border-border bg-card/60 hover:border-border/80"
              )}
              data-testid="strategy-samples"
            >
              <div className="flex items-center justify-between">
                <Sparkles className="h-5 w-5 text-amber-400" />
                <Badge variant="outline" className="border-cyan-500/40 text-cyan-300 text-[10px]">
                  RAG Exemplars
                </Badge>
              </div>
              <h4 className="mt-2 text-sm font-bold text-foreground">Tier 2: Golden Samples</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Curates verified high-performing execution trajectories into few-shot vector context.
              </p>
            </div>

            {/* Tier 3: LoRA Fine-Tuning */}
            <div
              onClick={() => setStrategy("fine_tuning")}
              className={cn(
                "cursor-pointer rounded-lg border p-4 transition-all",
                strategy === "fine_tuning"
                  ? "border-indigo-500 bg-accent/80 shadow-md ring-1 ring-indigo-500/50"
                  : "border-border bg-card/60 hover:border-border/80"
              )}
              data-testid="strategy-finetune"
            >
              <div className="flex items-center justify-between">
                <Cpu className="h-5 w-5 text-purple-400" />
                <Badge variant="outline" className="border-purple-500/40 text-purple-300 text-[10px]">
                  Adapter Checkpoint
                </Badge>
              </div>
              <h4 className="mt-2 text-sm font-bold text-foreground">Tier 3: LoRA Fine-Tuning</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Trains a parameter-efficient domain LoRA adapter checkpoint on historical task outcomes.
              </p>
            </div>
          </div>
        </div>

        {/* PANE 3: Canary Benchmark & Verification Preview */}
        <div className="rounded-lg border border-border bg-card/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  Canary Benchmark Verification Sandbox
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xl font-bold text-emerald-500 dark:text-emerald-400">{liveCanaryScore}%</span>
                <span className="text-xs text-muted-foreground">Pass Rate (5/5 synthetic test cases verified)</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runCanarySandbox}
                  disabled={isRunningCanary}
                  className="h-6 text-[10px] px-2 gap-1 border-border bg-muted"
                >
                  <Play className="w-2.5 h-2.5 text-emerald-400" />
                  {isRunningCanary ? "Simulating..." : "Re-Run Canary"}
                </Button>
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs text-muted-foreground">Proposed Competency Progression</div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary" className="bg-muted text-foreground">
                  Level {currentProficiency}
                </Badge>
                <ArrowRight className="h-3 w-3 text-indigo-400" />
                <Badge className="bg-indigo-600 text-white">
                  Level {promotedProficiency} (Verified)
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* PANE 4: Ratification Cockpit */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Action: Grant Verified Competency
              </div>
              <div className="text-sm font-medium text-foreground mt-0.5">
                Apply {strategy.replace(/_/g, " ")} & grant <span className="text-indigo-400 font-semibold">{targetCompetency} (L{promotedProficiency})</span> to {agentName}
              </div>
            </div>

            <Button
              onClick={handleRatify}
              disabled={isRatified}
              className="bg-indigo-600 text-white hover:bg-indigo-500 font-semibold px-6 shadow-lg shadow-indigo-600/20"
              data-testid="agent-upskilling-confirm"
            >
              {isRatified ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Competency Granted
                </>
              ) : (
                <>
                  <GraduationCap className="mr-2 h-4 w-4" />
                  Ratify & Grant Competency
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
