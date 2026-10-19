import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import {
  Bot,
  Users,
  Brain,
  Wrench,
  Shield,
  Check,
  Star,
  Zap,
  DollarSign,
  Activity,
  Sliders,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronUp,
  Plus,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "./pod-event-bus.js";

export type AutonomyTier = "L1" | "L2" | "L3";

export interface AgentConfig {
  autonomyTier: AutonomyTier;
  modelProvider: string;
  budgetUsd: number;
  maxTokens: number;
  customCapabilities: string[];
}

export interface AgentRosterMember {
  id: string;
  name: string;
  role: string;
  soulArchetype: string;
  modelTier: "tier-1-frontier" | "tier-2-fast" | "tier-3-local";
  capabilities: string[];
  autonomyTier?: AutonomyTier;
  modelProvider?: string;
  budgetUsd?: number;
  maxTokens?: number;
}

export const AVAILABLE_AGENT_PERSONAS: AgentRosterMember[] = [
  {
    id: "agent-sentinel",
    name: "Sentinel Custodian",
    role: "Domain Custodian & Guardrail Enforcer",
    soulArchetype: "Vigilant Guardian",
    modelTier: "tier-1-frontier",
    capabilities: ["xray_impact_trace", "evaluate_functional_gaps", "hil_request_signoff"],
    autonomyTier: "L2",
    modelProvider: "anthropic/claude-3-5-sonnet",
    budgetUsd: 15.0,
    maxTokens: 500000
  },
  {
    id: "agent-art-director",
    name: "Pixel Maestro",
    role: "Visual Style, Theme & Art Direction Specialist",
    soulArchetype: "Visionary Aesthetician",
    modelTier: "tier-1-frontier",
    capabilities: ["select_design_system", "synthesize_art_direction_prompts", "validate_wcag_contrast"],
    autonomyTier: "L2",
    modelProvider: "google/gemini-2.0-flash",
    budgetUsd: 10.0,
    maxTokens: 300000
  },
  {
    id: "agent-info-architect",
    name: "Copy & Block Sculptor",
    role: "Content Distiller & Structural Block Specialist",
    soulArchetype: "Socratic Editor",
    modelTier: "tier-1-frontier",
    capabilities: ["distill_content_blocks", "lint_text_density", "optimize_slide_structure"],
    autonomyTier: "L2",
    modelProvider: "anthropic/claude-3-5-sonnet",
    budgetUsd: 8.0,
    maxTokens: 250000
  },
  {
    id: "agent-data-storyteller",
    name: "Quant Narrative Analyst",
    role: "Metrics, Charts & Data Visualization Specialist",
    soulArchetype: "Precision Strategist",
    modelTier: "tier-2-fast",
    capabilities: ["extract_metric_callouts", "build_comparison_matrix", "generate_timeline_nodes"],
    autonomyTier: "L2",
    modelProvider: "google/gemini-2.0-flash",
    budgetUsd: 5.0,
    maxTokens: 200000
  },
  {
    id: "agent-brand-guardian",
    name: "Sentinel Brand Officer",
    role: "Brand Hygiene & HIL Approval Gatekeeper",
    soulArchetype: "Vigilant Brand Officer",
    modelTier: "tier-2-fast",
    capabilities: ["enforce_brand_hygiene", "mount_hil_signoff_gate", "verify_publication_compliance"],
    autonomyTier: "L1",
    modelProvider: "anthropic/claude-3-5-sonnet",
    budgetUsd: 5.0,
    maxTokens: 150000
  },
  {
    id: "agent-copilot",
    name: "Oddjob Copilot",
    role: "Conversational Workflow Architect",
    soulArchetype: "Empathetic Co-Creator",
    modelTier: "tier-1-frontier",
    capabilities: ["resolve_assembly_dag", "render_workflow_diagram", "mount_builder_pod"],
    autonomyTier: "L2",
    modelProvider: "anthropic/claude-3-5-sonnet",
    budgetUsd: 20.0,
    maxTokens: 1000000
  },
  {
    id: "agent-forensic",
    name: "Audit & Forensic Scribe",
    role: "Telemetry & Lineage Logger",
    soulArchetype: "Meticulous Historian",
    modelTier: "tier-2-fast",
    capabilities: ["w3c_trace_context", "log_forensic_evidence", "sha256_fingerprint"],
    autonomyTier: "L3",
    modelProvider: "qwen/qwen-2.5-coder-32b",
    budgetUsd: 5.0,
    maxTokens: 400000
  },
  {
    id: "agent-executor",
    name: "Task Fleet Worker",
    role: "High-Throughput Job Execution",
    soulArchetype: "Relentless Builder",
    modelTier: "tier-2-fast",
    capabilities: ["execute_batch_job", "vector_search", "database_query"],
    autonomyTier: "L3",
    modelProvider: "ollama/deepseek-r1",
    budgetUsd: 10.0,
    maxTokens: 800000
  }
];

export const MODEL_PROVIDERS = [
  { id: "anthropic/claude-3-5-sonnet", label: "Claude 3.5 Sonnet (Frontier Reasoning)" },
  { id: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash (Low Latency / Multimodal)" },
  { id: "qwen/qwen-2.5-coder-32b", label: "Qwen 2.5 Coder 32B (Deterministic Coding)" },
  { id: "ollama/deepseek-r1", label: "Ollama DeepSeek R1 (Local Air-Gapped Reasoning)" },
  { id: "openai/gpt-4o", label: "GPT-4o (Omni Frontier)" }
];

export const AUTONOMY_TIERS: { tier: AutonomyTier; label: string; desc: string }[] = [
  { tier: "L1", label: "L1 Assistive", desc: "Requires human signoff for each discrete tool execution" },
  { tier: "L2", label: "L2 Bounded", desc: "Autonomous within scoped domain guardrails; escalates anomalies" },
  { tier: "L3", label: "L3 Autonomous", desc: "Unsupervised execution with streaming forensic telemetry" }
];

interface AgenticHRPodProps {
  stageId?: string;
  title?: string;
  defaultRoster?: string[];
  onStageComplete?: (payload: {
    primaryAgentId: string;
    assignedRoster: AgentRosterMember[];
    stageId: string;
    totalBudgetCapUsd?: number;
    timestamp?: string;
    _trace?: { traceparent: string; generatedAt: string };
  }) => void;
  className?: string;
}

export default function AgenticHRPod({
  stageId = "stage-agent-hr",
  title = "Agentic HR & Roster Allocation",
  defaultRoster = ["agent-sentinel", "agent-copilot"],
  onStageComplete,
  className
}: AgenticHRPodProps) {
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(defaultRoster);
  const [primaryAgentId, setPrimaryAgentId] = useState<string>(defaultRoster[0] || "agent-sentinel");
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newCapabilityInput, setNewCapabilityInput] = useState<string>("");

  // Per-agent configuration map
  const [agentConfigs, setAgentConfigs] = useState<Record<string, AgentConfig>>(() => {
    const initial: Record<string, AgentConfig> = {};
    AVAILABLE_AGENT_PERSONAS.forEach(agent => {
      initial[agent.id] = {
        autonomyTier: agent.autonomyTier || "L2",
        modelProvider: agent.modelProvider || "anthropic/claude-3-5-sonnet",
        budgetUsd: agent.budgetUsd || 10.0,
        maxTokens: agent.maxTokens || 500000,
        customCapabilities: [...agent.capabilities]
      };
    });
    return initial;
  });

  // Two-way event listener from Crew Chat
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if (action === "toggle-agent" && payload?.agentId) {
      toggleAgent(payload.agentId);
    } else if (action === "set-primary-agent" && payload?.agentId) {
      if (AVAILABLE_AGENT_PERSONAS.some(a => a.id === payload.agentId)) {
        if (!selectedAgentIds.includes(payload.agentId)) {
          setSelectedAgentIds(prev => [...prev, payload.agentId]);
        }
        setPrimaryAgentId(payload.agentId);
      }
    } else if (action === "update-agent-tier" && payload?.agentId) {
      setAgentConfigs(prev => {
        const current = prev[payload.agentId] || {
          autonomyTier: "L2",
          modelProvider: "anthropic/claude-3-5-sonnet",
          budgetUsd: 10,
          maxTokens: 500000,
          customCapabilities: []
        };
        return {
          ...prev,
          [payload.agentId]: {
            ...current,
            autonomyTier: payload.autonomyTier || current.autonomyTier,
            modelProvider: payload.modelProvider || current.modelProvider,
            budgetUsd: typeof payload.budgetUsd === "number" ? payload.budgetUsd : current.budgetUsd,
            maxTokens: typeof payload.maxTokens === "number" ? payload.maxTokens : current.maxTokens
          }
        };
      });
    } else if (action === "confirm") {
      handleConfirm();
    }
  });

  const toggleAgent = (id: string) => {
    setSelectedAgentIds(prev => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev; // Keep at least one
        const updated = prev.filter(aId => aId !== id);
        if (primaryAgentId === id) {
          setPrimaryAgentId(updated[0] || "");
        }
        return updated;
      } else {
        return [...prev, id];
      }
    });
  };

  const updateConfig = (agentId: string, updates: Partial<AgentConfig>) => {
    setAgentConfigs(prev => ({
      ...prev,
      [agentId]: {
        ...prev[agentId],
        ...updates
      }
    }));
  };

  const addCapability = (agentId: string) => {
    if (!newCapabilityInput.trim()) return;
    const cleanCap = newCapabilityInput.trim().toLowerCase().replace(/\s+/g, "_");
    setAgentConfigs(prev => {
      const current = prev[agentId];
      if (current.customCapabilities.includes(cleanCap)) return prev;
      return {
        ...prev,
        [agentId]: {
          ...current,
          customCapabilities: [...current.customCapabilities, cleanCap]
        }
      };
    });
    setNewCapabilityInput("");
  };

  const removeCapability = (agentId: string, cap: string) => {
    setAgentConfigs(prev => ({
      ...prev,
      [agentId]: {
        ...prev[agentId],
        customCapabilities: prev[agentId].customCapabilities.filter(c => c !== cap)
      }
    }));
  };

  const totalBudgetCap = selectedAgentIds.reduce((sum, id) => {
    return sum + (agentConfigs[id]?.budgetUsd || 10);
  }, 0);

  const handleConfirm = () => {
    setIsSubmitting(true);
    const traceparent = generateW3CTraceparent();
    const assignedRoster: AgentRosterMember[] = AVAILABLE_AGENT_PERSONAS
      .filter(a => selectedAgentIds.includes(a.id))
      .map(a => {
        const cfg = agentConfigs[a.id];
        return {
          ...a,
          capabilities: cfg?.customCapabilities || a.capabilities,
          autonomyTier: cfg?.autonomyTier || "L2",
          modelProvider: cfg?.modelProvider || "anthropic/claude-3-5-sonnet",
          budgetUsd: cfg?.budgetUsd || 10.0,
          maxTokens: cfg?.maxTokens || 500000
        };
      });

    const payload = {
      stageId,
      primaryAgentId,
      assignedRoster,
      totalBudgetCapUsd: totalBudgetCap,
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
      `Allocated ${assignedRoster.length} agents. Lead: ${primaryAgentId}. Spend cap: $${totalBudgetCap.toFixed(2)} USD`,
      payload
    );

    setTimeout(() => setIsSubmitting(false), 500);
  };

  return (
    <Card className={cn("border border-border/70 bg-card/80 shadow-md backdrop-blur-md", className)} data-testid="agentic-hr-pod">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-purple-500/10 text-purple-500">
              <Bot className="w-4 h-4" />
            </span>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight">{title}</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Assign domain custodian agents, intelligence tiers, model backends, and autonomy governance
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono uppercase bg-purple-500/5 text-purple-600 border-purple-500/20">
              {selectedAgentIds.length} Active / {AVAILABLE_AGENT_PERSONAS.length} Total
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono text-emerald-600 border-emerald-500/30 bg-emerald-500/5">
              ${totalBudgetCap.toFixed(2)} Cap
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {AVAILABLE_AGENT_PERSONAS.map(agent => {
            const isSelected = selectedAgentIds.includes(agent.id);
            const isLead = primaryAgentId === agent.id;
            const isExpanded = expandedAgentId === agent.id;
            const cfg = agentConfigs[agent.id];

            return (
              <div
                key={agent.id}
                className={cn(
                  "rounded-lg border transition-all text-left relative",
                  isSelected
                    ? "border-purple-500/60 bg-purple-500/5 shadow-xs"
                    : "border-border/60 bg-card/40 opacity-70 hover:opacity-100 hover:border-border"
                )}
                data-testid={`agent-card-${agent.id}`}
              >
                <div
                  className="p-3 cursor-pointer"
                  onClick={() => toggleAgent(agent.id)}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        {agent.name}
                        {isLead && (
                          <Badge variant="warning" className="h-4 px-1 text-[8px] uppercase tracking-wide gap-0.5">
                            <Star className="w-2.5 h-2.5 fill-current" /> Lead
                          </Badge>
                        )}
                      </span>
                      <span className="text-[10px] text-muted-foreground block">{agent.role}</span>
                    </div>

                    <div className={cn(
                      "h-4 w-4 rounded-full border grid place-items-center transition-colors",
                      isSelected ? "border-purple-500 bg-purple-500 text-white" : "border-muted-foreground/40"
                    )}>
                      {isSelected && <Check className="h-2.5 w-2.5" />}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mt-2">
                    <span className="rounded bg-purple-500/10 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 text-[9px] font-mono font-medium">
                      {cfg?.autonomyTier || agent.autonomyTier || "L2"}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground font-medium">
                      {agent.soulArchetype}
                    </span>
                    <span className="rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 text-[9px] font-mono">
                      ${cfg?.budgetUsd || 10} USD
                    </span>
                  </div>
                </div>

                {isSelected && (
                  <div className="px-3 pb-2 pt-1 border-t border-border/40">
                    <div className="flex items-center justify-between text-[10px]">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground font-mono">
                          {cfg?.customCapabilities.length || agent.capabilities.length} Tools
                        </span>
                        {!isLead && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPrimaryAgentId(agent.id);
                            }}
                            className="text-purple-600 hover:underline font-medium"
                          >
                            Set as Lead
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedAgentId(isExpanded ? null : agent.id);
                        }}
                        className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground font-medium"
                      >
                        <Sliders className="w-3 h-3 text-purple-500" />
                        <span>{isExpanded ? "Hide Controls" : "Configure"}</span>
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </div>

                    {/* Extended Configuration Drawer */}
                    {isExpanded && (
                      <div className="mt-2.5 pt-2.5 border-t border-border/50 space-y-2.5 bg-muted/30 p-2.5 rounded-md text-xs">
                        {/* Autonomy Tier Selection */}
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                            Autonomy Tier
                          </label>
                          <div className="grid grid-cols-3 gap-1">
                            {AUTONOMY_TIERS.map(t => (
                              <button
                                key={t.tier}
                                type="button"
                                onClick={() => updateConfig(agent.id, { autonomyTier: t.tier })}
                                className={cn(
                                  "rounded px-1.5 py-1 text-[10px] font-medium border text-center transition-all",
                                  cfg?.autonomyTier === t.tier
                                    ? "border-purple-500 bg-purple-500/15 text-purple-700 dark:text-purple-300 font-semibold"
                                    : "border-border/50 bg-background/50 text-muted-foreground hover:bg-background"
                                )}
                                title={t.desc}
                              >
                                {t.tier}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Model Provider Override */}
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                            Model Provider
                          </label>
                          <select
                            value={cfg?.modelProvider || "anthropic/claude-3-5-sonnet"}
                            onChange={(e) => updateConfig(agent.id, { modelProvider: e.target.value })}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
                          >
                            {MODEL_PROVIDERS.map(m => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Budget & Token Limit */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                              Max Spend ($)
                            </label>
                            <Input
                              type="number"
                              min={1}
                              max={500}
                              value={cfg?.budgetUsd || 10}
                              onChange={(e) => updateConfig(agent.id, { budgetUsd: Number(e.target.value) || 1 })}
                              className="h-6 text-[11px] font-mono bg-background"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                              Token Limit
                            </label>
                            <Input
                              type="number"
                              step={50000}
                              min={50000}
                              max={5000000}
                              value={cfg?.maxTokens || 500000}
                              onChange={(e) => updateConfig(agent.id, { maxTokens: Number(e.target.value) || 50000 })}
                              className="h-6 text-[11px] font-mono bg-background"
                            />
                          </div>
                        </div>

                        {/* Capabilities Tag Editor */}
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                            Tool Capabilities ({cfg?.customCapabilities.length || 0})
                          </label>
                          <div className="flex flex-wrap gap-1 mb-1.5 max-h-20 overflow-y-auto">
                            {(cfg?.customCapabilities || []).map(c => (
                              <span
                                key={c}
                                className="inline-flex items-center gap-1 rounded bg-background border border-border/60 px-1.5 py-0.5 text-[9px] font-mono"
                              >
                                {c}
                                <button
                                  type="button"
                                  onClick={() => removeCapability(agent.id, c)}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-1">
                            <Input
                              placeholder="Add tool capability..."
                              value={newCapabilityInput}
                              onChange={(e) => setNewCapabilityInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addCapability(agent.id);
                                }
                              }}
                              className="h-6 text-[10px] font-mono bg-background"
                            />
                            <Button
                              size="sm"
                              type="button"
                              onClick={() => addCapability(agent.id)}
                              className="h-6 text-[10px] px-2"
                              variant="outline"
                            >
                              <Plus className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Shield className="w-3.5 h-3.5 text-purple-500" />
            Enforcing Layer 3 Roster Allocations & L1-L3 Autonomy Guardrails
          </span>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={selectedAgentIds.length === 0 || isSubmitting}
            className="bg-purple-600 text-white hover:bg-purple-500 text-xs h-8 px-4"
            data-testid="agentic-hr-confirm"
          >
            {isSubmitting ? "Assigning..." : "Assign Roster & Continue"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
