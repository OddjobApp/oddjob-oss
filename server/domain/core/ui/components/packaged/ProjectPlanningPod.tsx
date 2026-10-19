import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { 
  GitBranch, 
  Users, 
  Bot, 
  UserCheck, 
  ShieldAlert, 
  Clock, 
  DollarSign, 
  Zap, 
  Sliders, 
  CheckCircle2, 
  Flame, 
  Layers, 
  Rocket, 
  Plus, 
  Trash2,
  Calendar,
  Sparkles,
  BarChart3
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "./pod-event-bus.js";

export interface WavePlanItem {
  id: string;
  name: string;
  waveNumber: number;
  objective: string;
  isCriticalPath: boolean;
  estimatedDurationHours: number;
  assignee: {
    type: "human" | "agent" | "hybrid";
    name: string;
    role: string;
    competency?: string;
    estimatedCostUsd?: number;
  };
}

export interface ProjectPlanningPodProps {
  stageId?: string;
  title?: string;
  projectTitle?: string;
  objective?: string;
  defaultBudgetLimitUsd?: number;
  defaultTokenLimit?: number;
  defaultTargetSlaDays?: number;
  defaultMaxParallelMissions?: number;
  waves?: WavePlanItem[];
  defaultWaves?: WavePlanItem[];
  onStageComplete?: (payload: {
    stageId: string;
    projectTitle: string;
    objective: string;
    waves: WavePlanItem[];
    budgetLimitUsd: number;
    tokenLimit: number;
    maxParallelMissions: number;
    targetSlaDays: number;
    timestamp: string;
    _trace?: { traceparent: string; generatedAt: string };
  }) => void;
  className?: string;
}

const FALLBACK_WAVES: WavePlanItem[] = [
  {
    id: "wave-1",
    name: "Discovery & Architectural Ingestion",
    waveNumber: 1,
    objective: "Index existing APIs, telemetry schemas, and dependency graphs via X-Ray.",
    isCriticalPath: true,
    estimatedDurationHours: 12,
    assignee: {
      type: "agent",
      name: "Security & Architecture Sentinel",
      role: "System Analyst",
      competency: "AST & Telemetry Ingestion",
      estimatedCostUsd: 1.50
    }
  },
  {
    id: "wave-2",
    name: "Synthesis & Remediation Drafting",
    waveNumber: 2,
    objective: "Author technical specifications in Scribe Studio and compile verification tests.",
    isCriticalPath: true,
    estimatedDurationHours: 24,
    assignee: {
      type: "hybrid",
      name: "Lead Systems Architect + Scribe Critic",
      role: "Lead Engineer / AI Pair",
      competency: "Contract & SOW Engineering",
      estimatedCostUsd: 4.25
    }
  },
  {
    id: "wave-3",
    name: "Canary Benchmark & Production Signoff",
    waveNumber: 3,
    objective: "Execute 4-Eyes dual approval and deploy runtime container instances.",
    isCriticalPath: false,
    estimatedDurationHours: 8,
    assignee: {
      type: "human",
      name: "Designated Supervisory Human Lead",
      role: "Operations Director",
      competency: "SOC2 Compliance & Change Approval",
      estimatedCostUsd: 0.00
    }
  }
];

export default function ProjectPlanningPod(props: ProjectPlanningPodProps) {
  const {
    stageId = "stage-project-planning",
    title = "Hybrid Operational Cycle Planner",
    defaultBudgetLimitUsd = 250.00,
    defaultTokenLimit = 2500000,
    defaultTargetSlaDays = 5,
    defaultMaxParallelMissions = 3,
    className,
    onStageComplete,
  } = props;

  const [projectTitle, setProjectTitle] = useState(props.projectTitle || "Enterprise Incident Remediation & SOC2 Rollout");
  const [objective, setObjective] = useState(props.objective || "Execute autonomous investigation, co-author policy in Scribe, and secure human authorization.");
  const [waves, setWaves] = useState<WavePlanItem[]>(props.waves || props.defaultWaves || FALLBACK_WAVES);
  const [budgetLimitUsd, setBudgetLimitUsd] = useState(defaultBudgetLimitUsd);
  const [tokenLimit, setTokenLimit] = useState(defaultTokenLimit);
  const [targetSlaDays, setTargetSlaDays] = useState(defaultTargetSlaDays);
  const [maxParallelMissions, setMaxParallelMissions] = useState(defaultMaxParallelMissions);
  const [activeTab, setActiveTab] = useState<"waves" | "gantt" | "resources" | "guardrails">("waves");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Two-way chat event bus
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if (action === "set-project-title" && payload?.title) {
      setProjectTitle(payload.title);
    } else if (action === "add-wave" && payload?.name) {
      const nextWaveNum = waves.length + 1;
      const newWave: WavePlanItem = {
        id: `wave-${Date.now()}`,
        name: payload.name,
        waveNumber: nextWaveNum,
        objective: payload.objective || "Execute stage deliverables",
        isCriticalPath: Boolean(payload.isCriticalPath),
        estimatedDurationHours: payload.durationHours || 16,
        assignee: payload.assignee || {
          type: "agent",
          name: "Autonomous Subagent",
          role: "Specialist",
          competency: "Operations Execution",
          estimatedCostUsd: 2.00
        }
      };
      setWaves(prev => [...prev, newWave]);
    } else if (action === "remove-wave" && payload?.id) {
      removeWave(payload.id);
    } else if (action === "toggle-critical-path" && payload?.id) {
      toggleCriticalPath(payload.id);
    } else if (action === "set-budget") {
      if (typeof payload?.budgetLimitUsd === "number") setBudgetLimitUsd(payload.budgetLimitUsd);
      if (typeof payload?.tokenLimit === "number") setTokenLimit(payload.tokenLimit);
    } else if (action === "confirm") {
      handleCommit();
    }
  });

  const totalEstimatedCost = waves.reduce((acc, w) => acc + (w.assignee.estimatedCostUsd || 0), 0);
  const criticalPathDurationHours = waves.filter(w => w.isCriticalPath).reduce((acc, w) => acc + w.estimatedDurationHours, 0);
  const totalDurationHours = waves.reduce((acc, w) => acc + w.estimatedDurationHours, 0);

  const toggleCriticalPath = (id: string) => {
    setWaves(waves.map(w => w.id === id ? { ...w, isCriticalPath: !w.isCriticalPath } : w));
  };

  const removeWave = (id: string) => {
    setWaves(waves.filter(w => w.id !== id));
  };

  const addWave = () => {
    const nextWaveNum = waves.length + 1;
    const newWave: WavePlanItem = {
      id: `wave-${Date.now()}`,
      name: `Wave ${nextWaveNum}: Task Execution`,
      waveNumber: nextWaveNum,
      objective: "Execute stage deliverables and synchronize blackboard context.",
      isCriticalPath: false,
      estimatedDurationHours: 16,
      assignee: {
        type: "agent",
        name: "Autonomous Subagent",
        role: "Specialist",
        competency: "Operations Execution",
        estimatedCostUsd: 2.00
      }
    };
    setWaves([...waves, newWave]);
  };

  const handleCommit = () => {
    setIsSubmitting(true);
    const traceparent = generateW3CTraceparent();
    const payload = {
      stageId,
      projectTitle,
      objective,
      waves,
      budgetLimitUsd,
      tokenLimit,
      maxParallelMissions,
      targetSlaDays,
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
      `Committed Cycle "${projectTitle}": ${waves.length} waves, $${totalEstimatedCost.toFixed(2)} / $${budgetLimitUsd.toFixed(2)} USD`,
      payload
    );

    setTimeout(() => setIsSubmitting(false), 500);
  };

  return (
    <Card className={cn("border border-border/70 bg-card/95 shadow-xl backdrop-blur-md overflow-hidden", className)} data-testid="project-planning-pod">
      <CardHeader className="border-b border-border/60 bg-gradient-to-r from-violet-500/10 via-emerald-500/5 to-transparent pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px] font-mono uppercase tracking-wider">
                CPM WAVE ENGINE
              </Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] font-mono uppercase">
                HYBRID PAIRING
              </Badge>
            </div>
            <CardTitle className="text-lg font-bold tracking-tight text-foreground mt-1 flex items-center gap-2">
              <Layers className="w-5 h-5 text-primary" /> {title}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Topological Critical Path Scheduling with Automated Human-Agent Allocation & Interactive Horizon Gantt
            </CardDescription>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block tracking-wider">Budget Cap</span>
            <span className="text-sm font-mono font-bold text-foreground">${budgetLimitUsd.toFixed(2)} USD</span>
          </div>
        </div>

        {/* Project Title & Objective Inputs */}
        <div className="mt-3 space-y-2">
          <Input 
            value={projectTitle} 
            onChange={(e) => setProjectTitle(e.target.value)}
            className="text-xs font-semibold h-8 bg-background/50"
            placeholder="Operational Cycle Title"
          />
          <Textarea 
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="text-xs min-h-[46px] resize-none bg-background/50"
            placeholder="Primary Campaign Objective"
          />
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 mt-4 pt-2 border-t border-border/40">
          <Button
            size="sm"
            variant={activeTab === "waves" ? "default" : "ghost"}
            onClick={() => setActiveTab("waves")}
            className="text-xs h-7 gap-1.5"
          >
            <GitBranch className="w-3.5 h-3.5" /> CPM Waves ({waves.length})
          </Button>
          <Button
            size="sm"
            variant={activeTab === "gantt" ? "default" : "ghost"}
            onClick={() => setActiveTab("gantt")}
            className="text-xs h-7 gap-1.5"
          >
            <BarChart3 className="w-3.5 h-3.5" /> Horizon Gantt
          </Button>
          <Button
            size="sm"
            variant={activeTab === "resources" ? "default" : "ghost"}
            onClick={() => setActiveTab("resources")}
            className="text-xs h-7 gap-1.5"
          >
            <Users className="w-3.5 h-3.5" /> Hybrid Squad
          </Button>
          <Button
            size="sm"
            variant={activeTab === "guardrails" ? "default" : "ghost"}
            onClick={() => setActiveTab("guardrails")}
            className="text-xs h-7 gap-1.5"
          >
            <Sliders className="w-3.5 h-3.5" /> Fiscal & SLAs
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {activeTab === "waves" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
              <span>TOPOLOGICAL EXECUTION ORDER</span>
              <span className="flex items-center gap-1 text-amber-500 font-semibold">
                <Flame className="w-3.5 h-3.5" /> Critical Path: {criticalPathDurationHours}h
              </span>
            </div>

            <div className="space-y-2.5">
              {waves.map((wave, idx) => (
                <div 
                  key={wave.id}
                  className={cn(
                    "p-3 rounded-lg border text-xs transition-all",
                    wave.isCriticalPath 
                      ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10" 
                      : "border-border/60 bg-muted/20"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary/20 text-primary font-bold text-[10px] flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className="font-semibold text-foreground">{wave.name}</span>
                      {wave.isCriticalPath && (
                        <Badge variant="outline" className="text-[9px] border-amber-500 text-amber-500 bg-amber-500/10 gap-1 px-1.5 py-0">
                          <Flame className="w-2.5 h-2.5" /> Critical Path
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        onClick={() => toggleCriticalPath(wave.id)}
                        className="h-6 w-6 text-muted-foreground hover:text-amber-500"
                        title="Toggle Critical Path"
                      >
                        <Flame className="w-3 h-3" />
                      </Button>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        onClick={() => removeWave(wave.id)}
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  <p className="mt-1 text-muted-foreground text-[11px] leading-relaxed">
                    {wave.objective}
                  </p>

                  <div className="mt-2.5 pt-2 border-t border-border/40 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {wave.estimatedDurationHours}h
                      </span>
                      <span className="text-muted-foreground">•</span>
                      <span className="flex items-center gap-1">
                        {wave.assignee.type === "agent" && <Bot className="w-3 h-3 text-cyan-400" />}
                        {wave.assignee.type === "human" && <UserCheck className="w-3 h-3 text-emerald-400" />}
                        {wave.assignee.type === "hybrid" && <Users className="w-3 h-3 text-violet-400" />}
                        <span className="capitalize font-semibold text-foreground">{wave.assignee.name}</span>
                      </span>
                    </div>
                    <span className="text-muted-foreground font-mono">
                      Est. ${wave.assignee.estimatedCostUsd?.toFixed(2) || "0.00"}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <Button 
              size="sm" 
              variant="outline" 
              onClick={addWave} 
              className="w-full text-xs border-dashed gap-1.5 h-8"
            >
              <Plus className="w-3.5 h-3.5" /> Add Execution Wave
            </Button>
          </div>
        )}

        {/* Visual Gantt / Horizon Bar Tab */}
        {activeTab === "gantt" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
              <span>CRITICAL PATH HORIZON TIMELINE</span>
              <span>Total Work: {totalDurationHours}h</span>
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              {waves.map((wave, idx) => {
                const maxHours = Math.max(totalDurationHours, 1);
                const widthPct = Math.min(100, Math.max(15, Math.round((wave.estimatedDurationHours / maxHours) * 100)));
                return (
                  <div key={`gantt-${wave.id}`} className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="font-semibold text-foreground flex items-center gap-1">
                        {wave.isCriticalPath && <Flame className="w-2.5 h-2.5 text-amber-500" />}
                        W{idx + 1}: {wave.name}
                      </span>
                      <span className="text-muted-foreground">{wave.estimatedDurationHours}h ({wave.assignee.name})</span>
                    </div>
                    <div className="h-4 w-full rounded bg-muted/50 overflow-hidden flex">
                      <div
                        style={{ width: `${widthPct}%` }}
                        className={cn(
                          "h-full rounded transition-all flex items-center px-1.5 text-[9px] font-mono font-bold",
                          wave.isCriticalPath ? "bg-amber-500 text-amber-950" : "bg-primary text-primary-foreground"
                        )}
                      >
                        {wave.estimatedDurationHours}h
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "resources" && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Review actor competencies and cost breakdown across assigned human leads and agents.
            </div>

            <div className="space-y-2">
              {waves.map((wave) => (
                <div key={`res-${wave.id}`} className="p-3 rounded-lg border border-border/60 bg-muted/10 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {wave.assignee.type === "agent" && (
                        <div className="p-1 rounded bg-cyan-500/10 text-cyan-400">
                          <Bot className="w-4 h-4" />
                        </div>
                      )}
                      {wave.assignee.type === "human" && (
                        <div className="p-1 rounded bg-emerald-500/10 text-emerald-400">
                          <UserCheck className="w-4 h-4" />
                        </div>
                      )}
                      {wave.assignee.type === "hybrid" && (
                        <div className="p-1 rounded bg-violet-500/10 text-violet-400">
                          <Users className="w-4 h-4" />
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-foreground">{wave.assignee.name}</div>
                        <div className="text-[10px] text-muted-foreground">{wave.assignee.role}</div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[10px] capitalize font-mono">
                      {wave.assignee.type}
                    </Badge>
                  </div>

                  {wave.assignee.competency && (
                    <div className="mt-2 text-[10px] flex items-center gap-1.5 text-muted-foreground">
                      <span className="font-semibold text-foreground">Competency:</span>
                      <span className="bg-background px-1.5 py-0.5 rounded border border-border/50">
                        {wave.assignee.competency}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "guardrails" && (
          <div className="space-y-3 text-xs">
            <div className="space-y-2">
              <label className="font-semibold text-foreground flex items-center justify-between">
                <span>Budget Cap ($ USD)</span>
                <span className="font-mono text-primary font-bold">${budgetLimitUsd}</span>
              </label>
              <Input 
                type="number"
                value={budgetLimitUsd}
                onChange={(e) => setBudgetLimitUsd(Number(e.target.value))}
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-2">
              <label className="font-semibold text-foreground flex items-center justify-between">
                <span>Token Limit (Compute Ceiling)</span>
                <span className="font-mono text-cyan-400 font-bold">{(tokenLimit / 1000000).toFixed(1)}M</span>
              </label>
              <Input 
                type="number"
                value={tokenLimit}
                onChange={(e) => setTokenLimit(Number(e.target.value))}
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-foreground text-[11px]">Max Parallel Missions</label>
                <Input 
                  type="number"
                  value={maxParallelMissions}
                  onChange={(e) => setMaxParallelMissions(Number(e.target.value))}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-foreground text-[11px]">Target SLA (Days)</label>
                <Input 
                  type="number"
                  value={targetSlaDays}
                  onChange={(e) => setTargetSlaDays(Number(e.target.value))}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* Footer Controls & Commit CTA */}
        <div className="pt-3 border-t border-border/60 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-3">
            <span>Estimated Cost: <strong className="text-foreground">${totalEstimatedCost.toFixed(2)}</strong></span>
            <span>•</span>
            <span>Waves: <strong className="text-foreground">{waves.length}</strong></span>
          </div>

          <Button
            size="sm"
            onClick={handleCommit}
            disabled={isSubmitting || waves.length === 0}
            className="bg-primary text-primary-foreground text-xs font-semibold gap-1.5 h-8 px-4 shadow-md hover:shadow-lg transition-all"
          >
            <Rocket className="w-3.5 h-3.5" /> Commit & Launch Cycle
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
