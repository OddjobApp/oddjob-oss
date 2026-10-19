/**
 * Mission Supervisor Blueprint v2 - Mach 4 Platform Block Edition
 * Uses self-wiring PlatformMissionsBlock + PlatformMissionLogBlock — zero fetch/code
 */
import React, { useState, useEffect } from "react";
import { Activity, Cpu, DollarSign, Pause, Play, Square, Zap, Clock, TrendingUp } from "lucide-react";

// ─── PLATFORM BLOCK IMPORTS ─────────────────────────────────────────────────
// These are auto-wired to Oddjob APIs — zero fetch/state code required
// @ts-ignore - Injected by forge during assembly
import PlatformMissionsBlock from "@domain-ui/packaged/PlatformMissionsBlock";
// @ts-ignore - Injected by forge during assembly
import PlatformMissionLogBlock from "@domain-ui/packaged/PlatformMissionLogBlock";
// @ts-ignore - Injected by forge during assembly
import PlatformHILApprovalBlock from "@domain-ui/packaged/PlatformHILApprovalBlock";
// @ts-ignore - Injected by forge during assembly
import MetricGrid from "@domain-ui/packaged/MetricGrid";
import {
  missions,
  agents,
  events,
  pipelines,
  telemetry,
  type MissionExecution,
  type AgentExecution,
  type Pipeline,
  type PipelineTrigger,
} from "../lib/platform-client";

/**
 * ─── SLOT: Domain Configuration ───────────────────────────────────────────────
 * These tokens are injected by the App Forge Architect during Assembly.
 */
const APP_TITLE = "{{APP_TITLE}}";
// @ts-ignore - Injected by forge during assembly
const MISSION_ID: number | null = {{MISSION_ID}};

// @ts-ignore - Injected by forge during assembly
const METRICS: Array<{ label: string; valueAccessor: string; iconName?: string }> = {{METRICS}};

// Real Agent Topology Map Component
/**
 * ─── PIPELINE TRIGGER CONTROLS ────────────────────────────────────────────────
 *
 * Lists the pipelines this organization can run, shows how many triggers each
 * has configured, and starts a run on demand.
 *
 * Deliberately explicit about outcomes: starting a pipeline is a real side
 * effect, so the button reports the run id it created or the reason it failed
 * rather than silently returning to idle. Every attempt is emitted to telemetry
 * so a manual trigger is attributable afterwards.
 */
const PipelineTriggerPanel = () => {
  const [items, setItems] = useState<Pipeline[]>([]);
  const [triggersByPipeline, setTriggersByPipeline] = useState<Record<number, PipelineTrigger[]>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<number | null>(null);
  const [result, setResult] = useState<{ id: number; ok: boolean; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await pipelines.list();
        if (cancelled) return;
        setItems(list);
        // Trigger counts are per-pipeline; failures here must not blank the list.
        const entries = await Promise.all(
          list.map(async (p) => {
            try {
              return [p.id, await pipelines.listTriggers(p.id)] as const;
            } catch {
              return [p.id, [] as PipelineTrigger[]] as const;
            }
          })
        );
        if (!cancelled) setTriggersByPipeline(Object.fromEntries(entries));
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTrigger = async (pipeline: Pipeline) => {
    setRunning(pipeline.id);
    setResult(null);
    try {
      const res = await pipelines.execute(pipeline.id);
      const ok = res?.success !== false;
      setResult({
        id: pipeline.id,
        ok,
        message: ok ? `Run ${res?.runId ?? "started"}` : res?.error ?? "Trigger rejected",
      });
      telemetry.emit("pipeline_triggered", ok ? "info" : "warn", {
        pipelineId: pipeline.id,
        runId: res?.runId ?? null,
      });
    } catch (err: any) {
      setResult({ id: pipeline.id, ok: false, message: err?.message ?? "Trigger failed" });
      telemetry.emit("pipeline_trigger_failed", "error", {
        pipelineId: pipeline.id,
        error: err?.message ?? String(err),
      });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
          <Zap className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Pipeline Triggers</h3>
          <p className="text-xs text-slate-500">Start a pipeline run, or review its configured triggers.</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading pipelines…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400">No pipelines are available to this organization.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((pipeline) => {
            const triggers = triggersByPipeline[pipeline.id] ?? [];
            const isRunning = running === pipeline.id;
            const outcome = result?.id === pipeline.id ? result : null;
            return (
              <li key={pipeline.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{pipeline.name}</p>
                  <p className="text-xs text-slate-500">
                    {triggers.length} trigger{triggers.length === 1 ? "" : "s"} configured
                    {outcome && (
                      <span className={outcome.ok ? " text-emerald-600" : " text-rose-600"}>
                        {" "}· {outcome.message}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => handleTrigger(pipeline)}
                  disabled={isRunning}
                  className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                >
                  <Play className="w-4 h-4" />
                  {isRunning ? "Triggering…" : "Trigger"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const AgentTopologyMap = ({ missionId }: { missionId: number }) => {
  const [agentList, setAgentList] = useState<AgentExecution[]>([]);
  const [execution, setExecution] = useState<MissionExecution | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [agentData, execData] = await Promise.all([
          agents.list().catch(() => []),
          missions.getExecution(missionId).catch(() => null),
        ]);
        setAgentList(agentData);
        setExecution(execData);
      } catch (e) {
        console.error('Failed to load topology data:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Subscribe to real-time updates
    const unsub = events.subscribe((event) => {
      if (event.type === "agent.status_changed" || event.type === "mission.step_completed") {
        loadData();
      }
    });

    return unsub;
  }, [missionId]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 flex items-center justify-center h-[500px]">
        <div className="text-center">
          <Activity className="w-8 h-8 text-slate-400 mx-auto mb-3 animate-spin" />
          <p className="text-slate-500">Loading agent topology...</p>
        </div>
      </div>
    );
  }

  // Generate topology from real data
  const activeAgents = agentList.filter(a => a.status === "busy");
  const idleAgents = agentList.filter(a => a.status === "idle");

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative h-[500px]">
      <div className="absolute top-4 left-4 bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2">
        <Activity className="w-3.5 h-3.5" />
        Live Swarm Topology
      </div>
      <div className="absolute top-4 right-4 flex gap-2">
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-semibold">
          {activeAgents.length} Active
        </div>
        <div className="bg-slate-100 border border-slate-200 text-slate-600 px-3 py-1 rounded-full text-xs font-semibold">
          {idleAgents.length} Idle
        </div>
      </div>

      <svg className="w-full h-full">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f46e5" />
          </marker>
        </defs>
        
        {/* Dynamic connections based on execution steps */}
        {execution?.steps.map((step, idx) => {
          if (!step.agentId || idx === 0) return null;
          const prevStep = execution.steps[idx - 1];
          if (!prevStep?.agentId) return null;
          
          // Calculate positions (simplified layout)
          const positions: Record<string, {x: number, y: number}> = {
            'chief': { x: 200, y: 100 },
            'analyzer': { x: 100, y: 200 },
            'coder': { x: 300, y: 200 },
            'tool': { x: 400, y: 300 },
          };
          
          const from = positions[prevStep.agentId] || { x: 200, y: 100 };
          const to = positions[step.agentId] || { x: 300, y: 200 };
          const isActive = step.status === "running";
          
          return (
            <line
              key={`${prevStep.agentId}-${step.agentId}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={isActive ? "#4f46e5" : "#cbd5e1"}
              strokeWidth={isActive ? 3 : 2}
              markerEnd={isActive ? "url(#arrow-active)" : "url(#arrow)"}
              strokeDasharray={isActive ? "5,5" : "0"}
            >
              {isActive && <animate attributeName="stroke-dashoffset" from="10" to="0" dur="1s" repeatCount="indefinite" />}
            </line>
          );
        })}

        {/* Agent nodes */}
        {agentList.map((agent: AgentExecution, idx: number) => {
          const positions = [
            { x: 140, y: 70 },   // Chief
            { x: 40, y: 200 },   // Analyzer
            { x: 290, y: 200 },  // Coder
            { x: 390, y: 300 },  // Tool
          ];
          const pos = positions[idx % positions.length];
          const isActive = agent.status === "busy";
          const colors = {
            idle: "#94a3b8",
            busy: "#4f46e5",
            error: "#ef4444",
          };
          
          return (
            <g key={agent.agentId} transform={`translate(${pos.x}, ${pos.y})`}>
              <rect
                width={120}
                height={60}
                rx={8}
                fill={colors[agent.status as keyof typeof colors] || colors.idle}
                className={isActive ? "animate-pulse" : ""}
              />
              <text x={60} y={35} fill="white" textAnchor="middle" fontSize="14" fontWeight="600">
                {agent.agentName}
              </text>
              {isActive && (
                <circle cx={120} cy={0} r={6} fill="#ef4444" className="animate-pulse" />
              )}
            </g>
          );
        })}
      </svg>

      {/* Performance metrics overlay */}
      {execution && (
        <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur border border-slate-200 rounded-lg p-3 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <DollarSign className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-600">Total Cost:</span>
            <span className="font-semibold text-slate-900">${execution.totalCost?.toFixed(2) || "0.00"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-600">Duration:</span>
            <span className="font-semibold text-slate-900">{execution.totalDuration ? `${Math.round(execution.totalDuration / 1000)}s` : "0s"}</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-600">Steps:</span>
            <span className="font-semibold text-slate-900">{execution.steps.filter(s => s.status === "completed").length} / {execution.steps.length}</span>
          </div>
        </div>
      )}
    </div>
  );
};


export default function MissionSupervisor() {
  const [selectedMissionId, setSelectedMissionId] = useState<number | null>(typeof MISSION_ID === 'number' ? MISSION_ID : null);
  const [execution, setExecution] = useState<MissionExecution | null>(null);
  const [controlling, setControlling] = useState<string | null>(null);

  // Load execution data when mission is selected
  useEffect(() => {
    if (!selectedMissionId) return;
    
    const loadExecution = async () => {
      try {
        // Use the runId from the mission if available, otherwise use missionId
        const execData = await missions.getExecution(selectedMissionId).catch(() => null);
        setExecution(execData);
      } catch (e) {
        console.error('Failed to load execution:', e);
      }
    };

    loadExecution();

    // Subscribe to real-time updates
    const unsub = events.subscribe((event) => {
      if (event.type === "mission.status_changed" || event.type === "mission.step_completed") {
        loadExecution();
      }
    });

    return unsub;
  }, [selectedMissionId]);

  const handlePause = async () => {
    if (!selectedMissionId) return;
    setControlling('pause');
    try {
      await missions.pause(selectedMissionId);
    } catch (e) {
      console.error('Failed to pause mission:', e);
    } finally {
      setControlling(null);
    }
  };

  const handleResume = async () => {
    if (!selectedMissionId) return;
    setControlling('resume');
    try {
      await missions.resume(selectedMissionId);
    } catch (e) {
      console.error('Failed to resume mission:', e);
    } finally {
      setControlling(null);
    }
  };

  const handleAbort = async () => {
    if (!selectedMissionId) return;
    if (!confirm('Are you sure you want to abort this mission?')) return;
    setControlling('abort');
    try {
      await missions.abort(selectedMissionId);
    } catch (e) {
      console.error('Failed to abort mission:', e);
    } finally {
      setControlling(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans antialiased text-slate-900">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header Section */}
        <header className="flex items-center justify-between border-b pb-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-indigo-900">
              {APP_TITLE || "Mission Supervisor"}
            </h1>
            <p className="text-slate-500 font-medium">
              Coordinating autonomous agents with human intelligence overrides.
            </p>
          </div>
        </header>

        {/* Status Dashboard - Self-wired Metrics */}
        <MetricGrid 
          metrics={METRICS?.map((m: any) => ({
            label: m.label,
            value: `{{METRIC_VALUE:${m.valueAccessor}}}`,
            iconName: m.iconName || "Activity",
            trend: "neutral"
          })) || [
            { label: "Mission Health", value: "Stable", iconName: "Activity", trend: "neutral" },
            { label: "Active Steps", value: "4 / 12", iconName: "Cpu", trend: "neutral" },
            { label: "Total Spend", value: "$1.24", iconName: "DollarSign", trend: "neutral" }
          ]}
          columns={3}
        />

        {/* HIL Approvals - Self-wiring Platform Block */}
        <PlatformHILApprovalBlock
          title="Pending Approvals"
          filter="pending"
          showHistory={true}
          maxItems={5}
        />

        {/* Two-Column Layout: Missions List + Selected Mission Log */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Mission List - Self-wiring Platform Block */}
          <PlatformMissionsBlock
            title="Active Missions"
            allowLaunch={true}
            allowAbort={true}
            useSSE={true}
            onSelect={(missionId) => setSelectedMissionId(missionId)}
          />

          {/* Mission Log / Topology - Self-wiring Platform Block (driven by selection) */}
          {selectedMissionId ? (
            <div className="space-y-6">
              {/* Mission Controls */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-100">
                      <Zap className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">Mission Controls</h3>
                      <p className="text-xs text-slate-500">
                        {execution?.status === "running" ? "Mission is currently executing" : 
                         execution?.status === "paused" ? "Mission is paused" :
                         execution?.status === "completed" ? "Mission completed" :
                         execution?.status === "failed" ? "Mission failed" : "Mission status unknown"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {execution?.status === "running" && (
                      <button
                        onClick={handlePause}
                        disabled={controlling === 'pause'}
                        className="flex items-center gap-2 px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        <Pause className="w-4 h-4" />
                        {controlling === 'pause' ? 'Pausing...' : 'Pause'}
                      </button>
                    )}
                    {execution?.status === "paused" && (
                      <button
                        onClick={handleResume}
                        disabled={controlling === 'resume'}
                        className="flex items-center gap-2 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        <Play className="w-4 h-4" />
                        {controlling === 'resume' ? 'Resuming...' : 'Resume'}
                      </button>
                    )}
                    {(execution?.status === "running" || execution?.status === "paused") && (
                      <button
                        onClick={handleAbort}
                        disabled={controlling === 'abort'}
                        className="flex items-center gap-2 px-3 py-2 bg-rose-500 hover:bg-rose-600 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        <Square className="w-4 h-4" />
                        {controlling === 'abort' ? 'Aborting...' : 'Abort'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <PlatformMissionLogBlock
                missionId={selectedMissionId as number}
                title={`Mission #${selectedMissionId} Log`}
                maxLines={200}
                autoScroll={true}
                height="300px"
              />
              <AgentTopologyMap missionId={selectedMissionId as number} />
              <PipelineTriggerPanel />
            </div>
          ) : (
            <div className="space-y-4">
              <PipelineTriggerPanel />
              <div className="bg-white/50 backdrop-blur rounded-2xl p-8 text-center border border-slate-200">
                <p className="text-slate-400">Select a mission to view its live log and topology</p>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
