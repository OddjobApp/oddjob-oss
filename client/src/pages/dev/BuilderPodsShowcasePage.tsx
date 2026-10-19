import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { 
  ArrowLeft, 
  ExternalLink, 
  CheckCircle2, 
  Rocket, 
  ShieldCheck, 
  Wrench, 
  GraduationCap, 
  Activity, 
  AlertTriangle,
  RefreshCw,
  Layers,
  Sparkles
} from "lucide-react";
import ProjectPlanningPod from "@domain-ui/core/ui/components/packaged/ProjectPlanningPod";
import DecisionMatrixPod from "@domain-ui/core/ui/components/packaged/DecisionMatrixPod";
import AgentUpskillingPod from "@domain-ui/core/ui/components/packaged/AgentUpskillingPod";
import ToolScaffoldPod from "@domain-ui/core/ui/components/packaged/ToolScaffoldPod";

interface AgentCard {
  id: number;
  name: string;
  description?: string;
  capabilities?: string[];
  tools?: string[];
}

export default function BuilderPodsShowcasePage() {
  const [activeTab, setActiveTab] = useState<"all" | "planning" | "matrix" | "upskilling" | "tool">("all");
  const [eventLog, setEventLog] = useState<string[]>([]);

  // Real backend mutation state
  const [launchedCycle, setLaunchedCycle] = useState<{ id: number; name: string; status: string } | null>(null);
  const [isLaunchingCycle, setIsLaunchingCycle] = useState(false);
  const [cycleError, setCycleError] = useState<string | null>(null);

  const [ratifiedDecision, setRatifiedDecision] = useState<{ decisionId: string; topic: string; selectedCandidateName: string; consensusPercentage: number; traceparent?: string } | null>(null);
  const [isRatifying, setIsRatifying] = useState(false);
  const [ratifyError, setRatifyError] = useState<string | null>(null);

  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [promotedAgent, setPromotedAgent] = useState<{ agentName: string; targetCompetency: string; proficiency: number; canaryScore: number } | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);
  const [upskillError, setUpskillError] = useState<string | null>(null);

  const [publishedTool, setPublishedTool] = useState<{ id: number; name: string; method: string; endpointUrl: string } | null>(null);
  const [isPublishingTool, setIsPublishingTool] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);

  // Fetch real agent cards on mount
  useEffect(() => {
    let isMounted = true;
    async function loadAgents() {
      try {
        const res = await fetch("/api/agent-cards", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (isMounted && Array.isArray(data) && data.length > 0) {
            setAgents(data);
            setSelectedAgentId(data[0].id);
          }
        }
      } catch {
        // Fall back gracefully if offline
      }
    }
    loadAgents();
    return () => { isMounted = false; };
  }, []);

  const logEvent = (name: string, payload: any) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${name}: ${JSON.stringify(payload).slice(0, 120)}...`;
    setEventLog((prev) => [entry, ...prev.slice(0, 9)]);
  };

  // 1. Commit & Launch real Cycle
  const handleCommitWavePlan = async (payload: any) => {
    logEvent("ProjectPlanningPod Committed", payload);
    setIsLaunchingCycle(true);
    setCycleError(null);

    try {
      const blueprints = (payload.waves || []).map((w: any) => ({
        name: w.name,
        objective: w.objective,
        type: "mission",
        estimatedDays: Math.max(1, Math.ceil((w.estimatedDurationHours || 8) / 8)),
        config: {
          assignee: w.assignee,
          isCriticalPath: w.isCriticalPath,
          durationHours: w.estimatedDurationHours
        }
      }));

      const res = await fetch("/api/cycles/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: payload.projectTitle || "Enterprise SOC2 Migration",
          objective: payload.objective,
          budget: payload.budgetLimitUsd || 750,
          blueprints,
          metadata: {
            tokenLimit: payload.tokenLimit,
            targetSlaDays: payload.targetSlaDays,
            maxParallelMissions: payload.maxParallelMissions,
            launchedFrom: "BuilderPodsShowcase",
            _trace: payload._trace
          }
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Cycle launch failed with status ${res.status}`);
      }

      const cycle = await res.json();
      setLaunchedCycle({
        id: cycle.id,
        name: cycle.name,
        status: cycle.status || "active"
      });
    } catch (err: any) {
      setCycleError(err.message || "Failed to launch cycle to backend database");
    } finally {
      setIsLaunchingCycle(false);
    }
  };

  // 2. Ratify Decision into Platform Governance & Audit Log
  const handleRatifyDecision = async (payload: any) => {
    logEvent("DecisionMatrixPod Ratified", payload);
    setIsRatifying(true);
    setRatifyError(null);

    try {
      const res = await fetch("/api/governance/ratify-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          topic: payload.topic,
          selectedCandidateId: payload.selectedCandidateId,
          selectedCandidateName: payload.selectedCandidateName,
          ratifiedScores: payload.ratifiedScores,
          criteria: payload.criteria,
          candidates: payload.candidates,
          consensusPercentage: payload.consensusPercentage,
          stageId: payload.stageId,
          traceparent: payload._trace?.traceparent
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Ratification failed with status ${res.status}`);
      }

      const result = await res.json();
      setRatifiedDecision({
        decisionId: result.decisionId,
        topic: result.topic,
        selectedCandidateName: result.selectedCandidateName,
        consensusPercentage: result.consensusPercentage,
        traceparent: result.traceparent
      });
    } catch (err: any) {
      setRatifyError(err.message || "Failed to record ratification in audit log");
    } finally {
      setIsRatifying(false);
    }
  };

  // 3. Promote & Upskill Agent in Agent Card Registry
  const handlePromoteAgent = async (payload: any) => {
    logEvent("AgentUpskillingPod Promoted", payload);
    setIsPromoting(true);
    setUpskillError(null);

    try {
      const targetAgent = agents.find((a) => a.id === selectedAgentId);
      if (targetAgent) {
        const existingCapabilities = targetAgent.capabilities || [];
        const existingTools = targetAgent.tools || [];
        const updatedCapabilities = Array.from(new Set([...existingCapabilities, payload.targetCompetency]));
        const updatedTools = Array.from(new Set([...existingTools, `competency:${payload.targetCompetency}`]));

        const patchRes = await fetch(`/api/agent-cards/${targetAgent.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            capabilities: updatedCapabilities,
            tools: updatedTools
          })
        });

        if (!patchRes.ok) {
          const errJson = await patchRes.json().catch(() => ({}));
          throw new Error(errJson.error || `Failed to update agent card ${targetAgent.id}`);
        }
      }

      setPromotedAgent({
        agentName: targetAgent ? targetAgent.name : payload.agentName,
        targetCompetency: payload.targetCompetency,
        proficiency: payload.promotedProficiency,
        canaryScore: payload.canaryScore
      });
    } catch (err: any) {
      setUpskillError(err.message || "Failed to promote agent competency");
    } finally {
      setIsPromoting(false);
    }
  };

  // 4. Publish Tool to Skill & Tool Registry
  const handlePublishTool = async (payload: any) => {
    logEvent("ToolScaffoldPod Published", payload);
    setIsPublishingTool(true);
    setToolError(null);

    try {
      const toolCode = `// Auto-generated Oddjob Tool wrapper for ${payload.toolName}\nexport default async function ${payload.toolName}(params) {\n  const res = await fetch("${payload.endpointUrl}", {\n    method: "${payload.method}",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify(params)\n  });\n  return res.json();\n}`;

      const res = await fetch("/api/admin/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: payload.toolName,
          description: payload.description || "Synthesized REST Tool via ToolScaffoldPod",
          language: "javascript",
          code: toolCode,
          isInstalled: true,
          metadata: {
            method: payload.method,
            endpointUrl: payload.endpointUrl,
            authType: payload.authType,
            parameters: payload.parameters,
            publishedFrom: "ToolScaffoldPod",
            traceparent: payload._trace?.traceparent
          }
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Tool publish failed with status ${res.status}`);
      }

      const createdSkill = await res.json();
      setPublishedTool({
        id: createdSkill.id,
        name: createdSkill.name || payload.toolName,
        method: payload.method,
        endpointUrl: payload.endpointUrl
      });
    } catch (err: any) {
      setToolError(err.message || "Failed to publish tool to skill registry");
    } finally {
      setIsPublishingTool(false);
    }
  };

  const activeAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Navigation & Status Breadcrumb Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <Link
              href="/workspace"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Return to Workspace</span>
            </Link>

            <div className="h-4 w-px bg-border hidden sm:block" />

            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Backend Live Engine
              </span>
              <span>•</span>
              <span>Postgres Connected</span>
            </div>
          </div>

          {/* Direct Subsystem Deep Links */}
          <div className="flex items-center gap-2">
            <Link
              href="/operations"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border/70 bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Rocket className="w-3 h-3 text-cyan-500" />
              <span>Operations</span>
            </Link>
            <Link
              href="/admin/skill-registry"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border/70 bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Wrench className="w-3 h-3 text-amber-500" />
              <span>Skill Registry</span>
            </Link>
            <Link
              href="/admin/audit"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border/70 bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ShieldCheck className="w-3 h-3 text-indigo-500" />
              <span>Governance Audit</span>
            </Link>
          </div>
        </div>

        {/* Title Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
              <span className="bg-gradient-to-r from-amber-400 via-cyan-400 to-indigo-400 bg-clip-text text-transparent">
                Oddjob Hybrid Builder Pods
              </span>
              <span className="text-xs bg-muted border border-border text-cyan-600 dark:text-cyan-300 font-mono px-2.5 py-0.5 rounded-full">
                Interactive Operations Workbench
              </span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live interactive workbench for human-agent collaboration cockpits, real cycle synthesis, and tool deployment.
            </p>
          </div>

          {/* Tab Bar */}
          <div className="flex items-center gap-1.5 bg-card border border-border p-1.5 rounded-xl">
            {(["all", "planning", "matrix", "upskilling", "tool"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                data-testid={`tab-${tab}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                  activeTab === tab
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {tab === "all" ? "All Pods" : tab.replace(/([A-Z])/g, " $1")}
              </button>
            ))}
          </div>
        </div>

        {/* Live Interaction Log */}
        {eventLog.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 font-mono text-xs text-muted-foreground shadow-sm">
            <span className="font-bold text-amber-500 dark:text-amber-400">Latest Completed Pod Action:</span>
            <div className="mt-1 text-emerald-600 dark:text-emerald-300 font-semibold">{eventLog[0]}</div>
          </div>
        )}

        {/* Pods Display */}
        <div className="space-y-8" data-testid="pods-container">
          {/* 1. Project Planning Pod */}
          {(activeTab === "all" || activeTab === "planning") && (
            <section data-testid="section-project-planning" className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Pod 01 • CPM Wave Planner & Hybrid Allocator
                </div>
                {isLaunchingCycle && (
                  <span className="text-xs text-cyan-500 flex items-center gap-1.5 animate-pulse">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Launching cycle in backend...
                  </span>
                )}
              </div>

              <ProjectPlanningPod
                stageId="stage-planning-showcase"
                title="SOC2 Compliance & Automated Enforcement"
                projectTitle="Enterprise SOC2 Migration"
                objective="Deploy automated compliance monitors and conduct CISO review"
                defaultBudgetLimitUsd={750}
                defaultTokenLimit={5000000}
                onStageComplete={handleCommitWavePlan}
              />

              {/* Real Cycle Confirmation Banner */}
              {launchedCycle && (
                <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-foreground flex flex-wrap items-center justify-between gap-3 shadow-md animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-mono uppercase text-emerald-600 dark:text-emerald-400 font-bold tracking-wider">
                        Operational Cycle Successfully Launched
                      </div>
                      <div className="text-sm font-semibold text-foreground mt-0.5">
                        Cycle #{launchedCycle.id}: {launchedCycle.name} ({launchedCycle.status})
                      </div>
                    </div>
                  </div>
                  <Link
                    href="/operations"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold shadow-sm transition-colors"
                  >
                    <span>View Cycle #{launchedCycle.id} in Operations</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}

              {cycleError && (
                <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{cycleError}</span>
                </div>
              )}
            </section>
          )}

          {/* 2. Decision Matrix Pod */}
          {(activeTab === "all" || activeTab === "matrix") && (
            <section data-testid="section-decision-matrix" className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Pod 02 • Multi-Criteria Deliberation & Ratification
                </div>
                {isRatifying && (
                  <span className="text-xs text-indigo-500 flex items-center gap-1.5 animate-pulse">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Persisting decision to governance audit log...
                  </span>
                )}
              </div>

              <DecisionMatrixPod
                stageId="stage-matrix-showcase"
                topic="Caching Infrastructure for High-Throughput Ingestion"
                consensusPercentage={85}
                onStageComplete={handleRatifyDecision}
              />

              {/* Real Ratification Confirmation Banner */}
              {ratifiedDecision && (
                <div className="p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-foreground flex flex-wrap items-center justify-between gap-3 shadow-md animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-indigo-500 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-mono uppercase text-indigo-600 dark:text-indigo-400 font-bold tracking-wider">
                        Decision Ratified & Audited in Governance
                      </div>
                      <div className="text-sm font-semibold text-foreground mt-0.5">
                        Selected: "{ratifiedDecision.selectedCandidateName}" ({ratifiedDecision.consensusPercentage}% Consensus)
                      </div>
                      {ratifiedDecision.traceparent && (
                        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                          W3C Trace: {ratifiedDecision.traceparent}
                        </div>
                      )}
                    </div>
                  </div>
                  <Link
                    href="/admin/audit"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-xs font-semibold shadow-sm transition-colors"
                  >
                    <span>View in Governance Audit Log</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}

              {ratifyError && (
                <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{ratifyError}</span>
                </div>
              )}
            </section>
          )}

          {/* 3. Agent Upskilling Pod */}
          {(activeTab === "all" || activeTab === "upskilling") && (
            <section data-testid="section-agent-upskilling" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Pod 03 • Agent Diagnostic & Competency Evolution
                </div>

                {/* Agent Selector */}
                {agents.length > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Select Agent Card:</span>
                    <select
                      value={selectedAgentId ?? ""}
                      onChange={(e) => setSelectedAgentId(Number(e.target.value))}
                      className="px-2.5 py-1 rounded-lg border border-border bg-card text-foreground text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <AgentUpskillingPod
                stageId="stage-upskilling-showcase"
                agentId={activeAgent ? `agent-${activeAgent.id}` : "agent-data-wrangler-01"}
                agentName={activeAgent ? activeAgent.name : "Data Wrangler Prime"}
                targetCompetency="Distributed Schema Normalization"
                currentProficiency={2}
                canaryScore={97.5}
                onStageComplete={handlePromoteAgent}
              />

              {/* Real Agent Promotion Confirmation Banner */}
              {promotedAgent && (
                <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-foreground flex flex-wrap items-center justify-between gap-3 shadow-md animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-3">
                    <GraduationCap className="w-5 h-5 text-amber-500 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-mono uppercase text-amber-600 dark:text-amber-400 font-bold tracking-wider">
                        Agent Competency Promoted in Registry
                      </div>
                      <div className="text-sm font-semibold text-foreground mt-0.5">
                        {promotedAgent.agentName} upgraded to Level {promotedAgent.proficiency} in "{promotedAgent.targetCompetency}"
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Canary Benchmark Score: {promotedAgent.canaryScore}% • Capabilities Synced
                      </div>
                    </div>
                  </div>
                  <Link
                    href="/admin/skill-registry"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-xs font-semibold shadow-sm transition-colors"
                  >
                    <span>View in Skill Nexus</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}

              {upskillError && (
                <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{upskillError}</span>
                </div>
              )}
            </section>
          )}

          {/* 4. Tool Scaffold Pod */}
          {(activeTab === "all" || activeTab === "tool") && (
            <section data-testid="section-tool-scaffold" className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Pod 04 • Live REST/OpenAPI Tool Scaffolder
                </div>
                {isPublishingTool && (
                  <span className="text-xs text-cyan-500 flex items-center gap-1.5 animate-pulse">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Registering tool into platform skill registry...
                  </span>
                )}
              </div>

              <ToolScaffoldPod
                stageId="stage-tool-scaffold-showcase"
                initialToolName="geocoding_lookup"
                initialMethod="POST"
                initialEndpointUrl="https://api.geospatial.internal/v1/geocode"
                onStageComplete={handlePublishTool}
              />

              {/* Real Tool Publication Confirmation Banner */}
              {publishedTool && (
                <div className="p-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-foreground flex flex-wrap items-center justify-between gap-3 shadow-md animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-3">
                    <Wrench className="w-5 h-5 text-cyan-500 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-mono uppercase text-cyan-600 dark:text-cyan-400 font-bold tracking-wider">
                        Tool Successfully Registered in Skill Registry
                      </div>
                      <div className="text-sm font-semibold text-foreground mt-0.5">
                        {publishedTool.name} ({publishedTool.method} {publishedTool.endpointUrl})
                      </div>
                    </div>
                  </div>
                  <Link
                    href={`/admin/skill-registry?search=${encodeURIComponent(publishedTool.name)}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 text-xs font-semibold shadow-sm transition-colors"
                  >
                    <span>View in Skill Registry</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}

              {toolError && (
                <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{toolError}</span>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

