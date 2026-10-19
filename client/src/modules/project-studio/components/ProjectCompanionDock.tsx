import React, { useState, useEffect } from "react";
import { 
  Sliders, 
  Users, 
  Bot, 
  UserCheck, 
  ShieldCheck, 
  Flame, 
  ChevronRight, 
  ChevronLeft, 
  Clock, 
  DollarSign, 
  CheckCircle2, 
  AlertTriangle,
  Fingerprint,
  Boxes
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { WavePlanItem, CompanionTab, WaveAssignee, WaveGovernance, StudioDeliverableTarget } from "../types";

export interface ProjectCompanionDockProps {
  wave: WavePlanItem | null;
  allWaves: WavePlanItem[];
  onUpdateWave: (updatedWave: WavePlanItem) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeTab?: CompanionTab;
  onTabChange?: (tab: CompanionTab) => void;
  className?: string;
}

interface AvailableAgentCard {
  id: string;
  name: string;
  role: string;
  tools?: string[];
  specialties?: string[];
}

export const ProjectCompanionDock: React.FC<ProjectCompanionDockProps> = ({
  wave,
  allWaves,
  onUpdateWave,
  isCollapsed,
  onToggleCollapse,
  activeTab = "inspector",
  onTabChange,
  className,
}) => {
  const [currentTab, setCurrentTab] = useState<CompanionTab>(activeTab);
  const [availableAgents, setAvailableAgents] = useState<AvailableAgentCard[]>([
    {
      id: "agent-arch",
      name: "Security & Architecture Sentinel",
      role: "System Analyst",
      tools: ["xray_ast_inspect", "telemetry_probe"],
      specialties: ["Security", "Architecture"],
    },
    {
      id: "agent-critic",
      name: "Scribe Critic & Synthesis Lead",
      role: "Content Specialist",
      tools: ["scribe_eval", "markdown_linter"],
      specialties: ["PRD Review", "Contract Design"],
    },
    {
      id: "agent-qa",
      name: "Canary Testing Supervisor",
      role: "QA Engineer",
      tools: ["playwright_test", "canary_probe"],
      specialties: ["E2E", "Regression Testing"],
    },
    {
      id: "agent-dev",
      name: "Autonomous Engineering Agent",
      role: "Full-Stack Engineer",
      tools: ["git_commit", "npm_verify", "drizzle_migrate"],
      specialties: ["Full Stack", "TypeScript"],
    },
  ]);

  useEffect(() => {
    setCurrentTab(activeTab);
  }, [activeTab]);

  // Fetch real agent cards from platform API
  useEffect(() => {
    fetch("/api/agent-cards")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setAvailableAgents(
            data.map((a: any) => ({
              id: a.agentCardId || a.id,
              name: a.name || a.agentCardId,
              role: a.role || a.specialty || "Agent Specialist",
              tools: Array.isArray(a.tools) ? a.tools : [],
              specialties: Array.isArray(a.specialties) ? a.specialties : [a.specialty].filter(Boolean),
            }))
          );
        }
      })
      .catch(() => {
        // Fallback default agents already set in state
      });
  }, []);

  const handleTabSelect = (tab: CompanionTab) => {
    setCurrentTab(tab);
    onTabChange?.(tab);
  };

  if (isCollapsed) {
    return (
      <div
        data-testid="companion-dock-collapsed"
        className={cn(
          "flex flex-col items-center py-3 border-l border-border/70 bg-card/60 w-11 shrink-0 gap-3 select-none",
          className
        )}
      >
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onToggleCollapse}
          title="Expand Companion Dock"
          data-testid="expand-companion-dock-btn"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="w-5 h-px bg-border/60" />
        <button
          type="button"
          onClick={() => {
            onToggleCollapse();
            handleTabSelect("inspector");
          }}
          className={cn(
            "p-1.5 rounded-md transition-colors",
            currentTab === "inspector" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
          )}
          title="Inspector"
        >
          <Sliders className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            onToggleCollapse();
            handleTabSelect("squad");
          }}
          className={cn(
            "p-1.5 rounded-md transition-colors",
            currentTab === "squad" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
          )}
          title="Hybrid Squad"
        >
          <Users className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            onToggleCollapse();
            handleTabSelect("governance");
          }}
          className={cn(
            "p-1.5 rounded-md transition-colors",
            currentTab === "governance" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
          )}
          title="Governance & Invariants"
        >
          <ShieldCheck className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="project-companion-dock"
      className={cn(
        "flex flex-col h-full border-l border-border/70 bg-card/80 w-80 min-w-[20rem] select-none overflow-hidden backdrop-blur-sm",
        className
      )}
    >
      {/* Header & Tab Switcher */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-1 bg-muted/50 p-0.5 rounded-lg border border-border/50">
          <button
            type="button"
            onClick={() => handleTabSelect("inspector")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all",
              currentTab === "inspector"
                ? "bg-background text-foreground shadow-xs border border-border"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid="tab-inspector"
          >
            <Sliders className="w-3 h-3 text-primary" />
            <span>Inspector</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabSelect("squad")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all",
              currentTab === "squad"
                ? "bg-background text-foreground shadow-xs border border-border"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid="tab-squad"
          >
            <Users className="w-3 h-3 text-amber-500" />
            <span>Squad</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabSelect("governance")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all",
              currentTab === "governance"
                ? "bg-background text-foreground shadow-xs border border-border"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid="tab-governance"
          >
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
            <span>Governance</span>
          </button>
        </div>

        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={onToggleCollapse}
          title="Collapse Companion Dock"
          data-testid="collapse-companion-dock-btn"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!wave ? (
          <div className="text-center text-xs text-muted-foreground font-mono py-8">
            Select a wave to inspect properties.
          </div>
        ) : (
          <>
            {/* TAB 1: INSPECTOR */}
            {currentTab === "inspector" && (
              <div className="space-y-4" data-testid="inspector-panel">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Wave Station Name</label>
                  <Input
                    value={wave.name}
                    onChange={(e) => onUpdateWave({ ...wave, name: e.target.value })}
                    className="text-xs bg-background/60"
                  />
                </div>

                {/* Deliverable Studio Target */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Boxes className="w-3.5 h-3.5 text-indigo-400" /> Deliverable Target Studio
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono capitalize">
                      {wave.studioTarget || "none"}
                    </Badge>
                  </div>
                  <select
                    value={wave.studioTarget || "none"}
                    onChange={(e) =>
                      onUpdateWave({
                        ...wave,
                        studioTarget: e.target.value as StudioDeliverableTarget,
                      })
                    }
                    className="w-full text-xs rounded-md border border-border bg-background/80 p-2 text-foreground"
                    data-testid="studio-target-select"
                  >
                    <option value="none">Standard Pipeline (No Studio)</option>
                    <option value="scribe">Scribe Studio (PRD & Manuscript)</option>
                    <option value="app_studio">App Studio (React Pod / UI)</option>
                    <option value="media">Media Studio (Video & Dailies)</option>
                    <option value="computer">Computer Use (OS / Browser Automation)</option>
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Directs generated deliverables into specialized Studio workspaces for deep authoring.
                  </p>
                </div>

                {/* Critical Path Toggle */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-rose-500" /> Critical Path Lock
                    </span>
                    <Button
                      size="sm"
                      variant={wave.isCriticalPath ? "default" : "outline"}
                      className={cn(
                        "h-6 text-xs px-2",
                        wave.isCriticalPath && "bg-rose-600 hover:bg-rose-500 text-white"
                      )}
                      onClick={() => onUpdateWave({ ...wave, isCriticalPath: !wave.isCriticalPath })}
                    >
                      {wave.isCriticalPath ? "Locked (Zero Float)" : "Standard"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Critical path waves directly dictate the total cycle completion SLA.
                  </p>
                </div>

                {/* PERT 3-Point Duration Estimator */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-primary" /> PERT Duration:{" "}
                      {wave.estimateSource === "unestimated" || wave.estimatedDurationHours <= 0
                        ? "not estimated"
                        : `${wave.estimatedDurationHours}h`}
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      (O + 4M + P) / 6
                    </Badge>
                  </div>

                  {/* Optimistic Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Optimistic (O)</span>
                      <span>{wave.optimisticHours || Math.round(wave.estimatedDurationHours * 0.7)}h</span>
                    </div>
                    <Slider
                      value={[wave.optimisticHours || Math.round(wave.estimatedDurationHours * 0.7)]}
                      min={1}
                      max={72}
                      step={1}
                      onValueChange={([val]) => {
                        const m = wave.realisticHours || wave.estimatedDurationHours;
                        const p = wave.pessimisticHours || Math.round(wave.estimatedDurationHours * 1.5);
                        const expected = Math.round((val + 4 * m + p) / 6);
                        onUpdateWave({
                          ...wave,
                          optimisticHours: val,
                          estimatedDurationHours: expected,
                        });
                      }}
                    />
                  </div>

                  {/* Realistic Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Realistic (M)</span>
                      <span>{wave.realisticHours || wave.estimatedDurationHours}h</span>
                    </div>
                    <Slider
                      value={[wave.realisticHours || wave.estimatedDurationHours]}
                      min={1}
                      max={72}
                      step={1}
                      onValueChange={([val]) => {
                        const o = wave.optimisticHours || Math.round(val * 0.7);
                        const p = wave.pessimisticHours || Math.round(val * 1.5);
                        const expected = Math.round((o + 4 * val + p) / 6);
                        onUpdateWave({
                          ...wave,
                          realisticHours: val,
                          estimatedDurationHours: expected,
                        });
                      }}
                    />
                  </div>

                  {/* Pessimistic Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Pessimistic (P)</span>
                      <span>{wave.pessimisticHours || Math.round(wave.estimatedDurationHours * 1.5)}h</span>
                    </div>
                    <Slider
                      value={[wave.pessimisticHours || Math.round(wave.estimatedDurationHours * 1.5)]}
                      min={1}
                      max={96}
                      step={1}
                      onValueChange={([val]) => {
                        const o = wave.optimisticHours || Math.round(wave.estimatedDurationHours * 0.7);
                        const m = wave.realisticHours || wave.estimatedDurationHours;
                        const expected = Math.round((o + 4 * m + val) / 6);
                        onUpdateWave({
                          ...wave,
                          pessimisticHours: val,
                          estimatedDurationHours: expected,
                        });
                      }}
                    />
                  </div>
                </div>

                {/* Predecessors / Dependencies */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-2">
                  <span className="text-xs font-semibold text-foreground">
                    Prerequisite Upstream Waves
                  </span>
                  <div className="space-y-1.5">
                    {allWaves
                      .filter((w) => w.id !== wave.id && w.waveNumber < wave.waveNumber)
                      .map((otherWave) => {
                        const isDep = (wave.dependencies || []).includes(otherWave.id);
                        return (
                          <button
                            key={otherWave.id}
                            type="button"
                            onClick={() => {
                              const nextDeps = isDep
                                ? (wave.dependencies || []).filter((id) => id !== otherWave.id)
                                : [...(wave.dependencies || []), otherWave.id];
                              onUpdateWave({ ...wave, dependencies: nextDeps });
                            }}
                            className={cn(
                              "w-full flex items-center justify-between p-2 rounded-lg border text-xs text-left transition-all",
                              isDep
                                ? "bg-primary/10 border-primary/60 text-foreground"
                                : "bg-background/40 border-border/60 text-muted-foreground hover:bg-muted/40"
                            )}
                          >
                            <span>W{otherWave.waveNumber}: {otherWave.name}</span>
                            {isDep && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                          </button>
                        );
                      })}
                    {allWaves.filter((w) => w.id !== wave.id && w.waveNumber < wave.waveNumber).length === 0 && (
                      <p className="text-[11px] text-muted-foreground italic">
                        Initial wave station has no preceding waves.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: HYBRID SQUAD */}
            {currentTab === "squad" && (
              <div className="space-y-4" data-testid="squad-panel">
                {/* Pairing Mode Switcher */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Pairing Architecture</label>
                  <div className="grid grid-cols-3 gap-1 bg-muted/50 p-1 rounded-lg border border-border/60">
                    {(["agent", "hybrid", "human"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() =>
                          onUpdateWave({
                            ...wave,
                            assignee: { ...wave.assignee, type: m },
                          })
                        }
                        className={cn(
                          "py-1.5 text-xs font-bold rounded-md capitalize transition-all",
                          wave.assignee.type === m
                            ? "bg-background text-foreground shadow-xs border border-border"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Assignee Card */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Assigned Lead / Pair</label>
                    <Input
                      value={wave.assignee.name}
                      onChange={(e) =>
                        onUpdateWave({
                          ...wave,
                          assignee: { ...wave.assignee, name: e.target.value },
                        })
                      }
                      className="text-xs bg-background/60"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Operational Role</label>
                    <Input
                      value={wave.assignee.role}
                      onChange={(e) =>
                        onUpdateWave({
                          ...wave,
                          assignee: { ...wave.assignee, role: e.target.value },
                        })
                      }
                      className="text-xs bg-background/60"
                    />
                  </div>

                  {/* Pick from Agent Cards */}
                  {wave.assignee.type !== "human" && availableAgents.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <label className="text-[11px] font-semibold text-muted-foreground">
                        Select Platform Specialist Agent
                      </label>
                      <select
                        value={wave.assignee.agentCardId || ""}
                        onChange={(e) => {
                          const agent = availableAgents.find((a) => a.id === e.target.value);
                          if (agent) {
                            onUpdateWave({
                              ...wave,
                              assignee: {
                                ...wave.assignee,
                                name: agent.name,
                                role: agent.role,
                                agentCardId: agent.id,
                                tools: agent.tools,
                                specialties: agent.specialties,
                              },
                            });
                          }
                        }}
                        className="w-full text-xs rounded-md border border-border bg-background/80 p-2 text-foreground"
                        data-testid="primary-agent-select"
                      >
                        <option value="">-- Choose Agent Card --</option>
                        {availableAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.role})
                          </option>
                        ))}
                      </select>
                      {/* Capabilities Badges for Selected Agent */}
                      {(() => {
                        const selectedAgent = availableAgents.find(
                          (a) => a.id === wave.assignee.agentCardId
                        );
                        if (!selectedAgent) return null;
                        return (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {(selectedAgent.specialties || []).map((s) => (
                              <Badge
                                key={s}
                                variant="outline"
                                className="text-[9px] bg-primary/10 text-primary border-primary/20 px-1.5 py-0 font-medium"
                              >
                                {s}
                              </Badge>
                            ))}
                            {(selectedAgent.tools || []).map((t) => (
                              <Badge
                                key={t}
                                variant="outline"
                                className="text-[9px] bg-muted/60 text-muted-foreground border-border/50 px-1.5 py-0 font-mono"
                              >
                                {t}
                              </Badge>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Hourly Cost & Budget Burn */}
                  <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-500" /> Est. Cost (USD)
                    </span>
                    <Input
                      type="number"
                      step="0.25"
                      value={wave.assignee.estimatedCostUsd ?? 2.0}
                      onChange={(e) =>
                        onUpdateWave({
                          ...wave,
                          assignee: {
                            ...wave.assignee,
                            estimatedCostUsd: parseFloat(e.target.value) || 0,
                          },
                        })
                      }
                      className="w-20 text-xs font-mono text-right bg-background/60 h-7"
                    />
                  </div>
                </div>

                {/* Secondary Reviewer / Critic */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-indigo-400" /> Reviewer / Critic Pair
                    </span>
                    {wave.squad?.reviewers?.[0] && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-[10px] px-1 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          const nextSquad = {
                            lead: wave.assignee,
                            reviewers: [],
                            sentinels: wave.squad?.sentinels || [],
                          };
                          onUpdateWave({ ...wave, squad: nextSquad });
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <select
                    value={wave.squad?.reviewers?.[0]?.agentCardId || ""}
                    onChange={(e) => {
                      const agent = availableAgents.find((a) => a.id === e.target.value);
                      const reviewer = agent
                        ? {
                            type: "agent" as const,
                            name: agent.name,
                            role: agent.role,
                            agentCardId: agent.id,
                            tools: agent.tools,
                            specialties: agent.specialties,
                          }
                        : undefined;
                      const nextSquad = {
                        lead: wave.assignee,
                        reviewers: reviewer ? [reviewer] : [],
                        sentinels: wave.squad?.sentinels || [],
                      };
                      onUpdateWave({ ...wave, squad: nextSquad });
                    }}
                    className="w-full text-xs rounded-md border border-border bg-background/80 p-2 text-foreground"
                    data-testid="reviewer-agent-select"
                  >
                    <option value="">-- No Designated Critic --</option>
                    {availableAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Independent agent performing critique, AST verification, or PRD proofreading.
                  </p>
                </div>

                {/* Sentinel / QA Guard */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> QA Sentinel Guard
                    </span>
                    {wave.squad?.sentinels?.[0] && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-[10px] px-1 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          const nextSquad = {
                            lead: wave.assignee,
                            reviewers: wave.squad?.reviewers || [],
                            sentinels: [],
                          };
                          onUpdateWave({ ...wave, squad: nextSquad });
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <select
                    value={wave.squad?.sentinels?.[0]?.agentCardId || ""}
                    onChange={(e) => {
                      const agent = availableAgents.find((a) => a.id === e.target.value);
                      const sentinel = agent
                        ? {
                            type: "agent" as const,
                            name: agent.name,
                            role: agent.role,
                            agentCardId: agent.id,
                            tools: agent.tools,
                            specialties: agent.specialties,
                          }
                        : undefined;
                      const nextSquad = {
                        lead: wave.assignee,
                        reviewers: wave.squad?.reviewers || [],
                        sentinels: sentinel ? [sentinel] : [],
                      };
                      onUpdateWave({ ...wave, squad: nextSquad });
                    }}
                    className="w-full text-xs rounded-md border border-border bg-background/80 p-2 text-foreground"
                    data-testid="sentinel-agent-select"
                  >
                    <option value="">-- No Sentinel Guard --</option>
                    {availableAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Enforces automated canary probes, regression benchmarks, and runtime assertions.
                  </p>
                </div>
              </div>
            )}

            {/* TAB 3: GOVERNANCE & SMT INVARIANTS */}
            {currentTab === "governance" && (
              <div className="space-y-4" data-testid="governance-panel">
                {/* Risk Tiering */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-2">
                  <span className="text-xs font-semibold text-foreground">Blast Radius Risk Tier</span>
                  <div className="grid grid-cols-4 gap-1">
                    {(["low", "medium", "high", "critical"] as const).map((r) => {
                      const currentRisk = wave.governance?.riskTier || "medium";
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() =>
                            onUpdateWave({
                              ...wave,
                              governance: {
                                ...(wave.governance || { requiresDualSignOff: false, smtInvariants: [] }),
                                riskTier: r,
                              },
                            })
                          }
                          className={cn(
                            "py-1 text-[10px] font-bold rounded-md uppercase transition-all",
                            currentRisk === r
                              ? r === "critical"
                                ? "bg-rose-500 text-white shadow-xs"
                                : r === "high"
                                ? "bg-amber-500 text-white shadow-xs"
                                : "bg-primary text-primary-foreground shadow-xs"
                              : "bg-muted/40 text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {r}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4-Eyes Dual Approval */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> 4-Eyes Dual Sign-Off
                    </span>
                    <Button
                      size="sm"
                      variant={wave.governance?.requiresDualSignOff ? "default" : "outline"}
                      className={cn(
                        "h-6 text-xs px-2",
                        wave.governance?.requiresDualSignOff && "bg-emerald-600 hover:bg-emerald-500 text-white"
                      )}
                      onClick={() =>
                        onUpdateWave({
                          ...wave,
                          governance: {
                            ...(wave.governance || { riskTier: "medium", smtInvariants: [] }),
                            requiresDualSignOff: !wave.governance?.requiresDualSignOff,
                          },
                        })
                      }
                    >
                      {wave.governance?.requiresDualSignOff ? "Required" : "Optional"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Requires supervisory human verification before autonomous mutation triggers.
                  </p>
                </div>

                {/* SMT Formal Invariants */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/60 space-y-2">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <Fingerprint className="w-3.5 h-3.5 text-indigo-400" /> SMT Formal Invariants
                  </span>
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2 p-1.5 rounded-md bg-background/50 border border-border/50 text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>Zero float on critical path predecessors</span>
                    </div>
                    <div className="flex items-center gap-2 p-1.5 rounded-md bg-background/50 border border-border/50 text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>Bounded budget ceiling &lt; total stage limit</span>
                    </div>
                    <div className="flex items-center gap-2 p-1.5 rounded-md bg-background/50 border border-border/50 text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>W3C traceparent provenance validation</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
