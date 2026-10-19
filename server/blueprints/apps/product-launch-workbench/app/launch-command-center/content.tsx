"use client";
import React, { useState, useEffect, useRef } from "react";
import { useWorkbenchContext } from "../../lib/workbench-sdk";
import { fleet, records, missions, telemetry, launch, predictions, hil, missionLogs, pipelines, knowledge, events, crossCycle } from "../../lib/platform-client";
import type { FleetWorkload, PredictionResult, LaunchReadiness } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";
import { MermaidRenderer } from "../components/MermaidRenderer";
import { AdvancedFilterBar, type FilterState } from "../components/AdvancedFilterBar";

const MISSIONS_LIST = [
  { name: "Launch Brief & Market Analysis", icon: "🔍", color: "bg-indigo-500/10 text-indigo-400" },
  { name: "GTM Strategy & Positioning", icon: "🎯", color: "bg-violet-500/10 text-violet-400" },
  { name: "Content & Asset Creation", icon: "✍️", color: "bg-pink-500/10 text-pink-400" },
  { name: "Sales Enablement & Training", icon: "🎓", color: "bg-amber-500/10 text-amber-400" },
  { name: "Beta Program Coordination", icon: "🧪", color: "bg-emerald-500/10 text-emerald-400" },
  { name: "Launch Day Execution", icon: "🎬", color: "bg-red-500/10 text-red-400" },
  { name: "Post-Launch Analysis & Iteration", icon: "📊", color: "bg-cyan-500/10 text-cyan-400" },
];

const GTM_ROADMAP_CHART = `graph TD
  Research[1. Market Research & Persona Intelligence] --> GTM[2. GTM Strategy & Value Positioning]
  GTM --> Content[3. Content & Collateral Studio]
  GTM --> Enable[4. Sales Enablement & Battlecards]
  Content --> Beta[5. Beta Program Coordination]
  Enable --> Beta
  Beta --> HIL{HIL Go/No-Go Decision Gate}
  HIL -->|Approved| LaunchDay[6. Launch Day Execution & Global PR]
  LaunchDay --> PostLaunch[7. Post-Launch Telemetry & NPS Insights]`;

export default function LaunchCommandContent() {
  const workbenchCtx = useWorkbenchContext();
  const [workload, setWorkload] = useState<FleetWorkload | null>(null);
  const [readiness, setReadiness] = useState<LaunchReadiness | null>(null);
  const [timingPrediction, setTimingPrediction] = useState<PredictionResult | null>(null);
  const [riskPrediction, setRiskPrediction] = useState<PredictionResult | null>(null);
  const [day1Forecast, setDay1Forecast] = useState<PredictionResult | null>(null);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>({});
  const [activeTab, setActiveTab] = useState<"overview" | "roadmap" | "predictions" | "missions" | "approvals" | "live">("overview");
  const [isEmbedded, setIsEmbedded] = useState(false);
  const [triggeringMission, setTriggeringMission] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  async function fetchData() {
    const [w, r, m] = await Promise.all([
      fleet.workload().catch(() => null),
      launch.readiness().catch(() => null),
      records.list("launch_timeline_milestones").catch(() => []),
    ]);
    setWorkload(w); setReadiness(r); setMilestones(m);
    setLoading(false);
  }

  async function fetchPredictions() {
    const [timing, risk, forecast] = await Promise.all([
      predictions.launchTiming().catch(() => null),
      predictions.riskScore().catch(() => null),
      predictions.day1Forecast().catch(() => null),
    ]);
    setTimingPrediction(timing); setRiskPrediction(risk); setDay1Forecast(forecast);
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("embedded") === "true" || window.parent !== window) {
        setIsEmbedded(true);
      }
    }

    fetchData();
    fetchPredictions();
    intervalRef.current = setInterval(fetchData, 30000);

    // Subscribe to real-time event stream
    const unsubscribe = events.subscribe((event) => {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      const line = `[${timestamp}] ${event.type}: ${JSON.stringify(event.payload || {}).slice(0, 120)}`;
      setLiveLog(prev => [...prev.slice(-99), line]);
      // Auto-refresh data on significant events
      if (["mission.completed", "mission.failed", "agent.step_completed", "hil.submitted"].includes(event.type)) {
        fetchData();
      }
    });

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); unsubscribe(); };
  }, []);

  async function triggerMission(name: string) {
    setTriggeringMission(name);
    try {
      await missions.trigger(name);
      telemetry.emit("mission_triggered", "info", { mission: name });
    } catch {} finally { setTriggeringMission(null); fetchData(); }
  }

  const agents = workload?.agents ?? [];
  const attention = workload?.attention ?? [];
  const summary = workload?.summary ?? { active: 0, blocked: 0, idle: 0, completed: 0, tokenSpendUsd: 0 };
  const readinessScore = readiness?.overall ?? 0;

  const filteredMissions = MISSIONS_LIST.filter(m => {
    if (filters.search && !m.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/20">Command</span>
          <h1 className="text-2xl font-bold">Launch Command Center</h1>
          {isEmbedded && (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              CREW Room Canvas
            </span>
          )}
          {workload?.generatedAt && <span className="text-xs text-slate-500 ml-auto">Updated {new Date(workload.generatedAt).toLocaleTimeString()}</span>}
        </div>

        {/* Readiness + Predictions Hero */}
        <div className="grid grid-cols-7 gap-3 mb-6">
          <div className="col-span-2 bg-gradient-to-br from-violet-500/10 to-purple-500/10 border border-violet-500/20 rounded-xl p-4 text-center">
            <div className={`text-5xl font-bold ${readinessScore >= 80 ? "text-emerald-400" : readinessScore >= 50 ? "text-amber-400" : "text-rose-400"}`}>{readinessScore}%</div>
            <div className="text-xs text-slate-400 mt-1">Launch Readiness</div>
            <div className="mt-2 h-2 bg-slate-800 rounded-full overflow-hidden">
              <style>{`#readiness-bar { width: ${readinessScore}%; }`}</style>
              <div id="readiness-bar" className={`h-full rounded-full transition-all ${readinessScore >= 80 ? "bg-emerald-500" : readinessScore >= 50 ? "bg-amber-500" : "bg-rose-500"}`} />
            </div>
          </div>
          {/* Prediction cards */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className={`text-lg font-bold ${timingPrediction?.prediction?.includes("Optimal") ? "text-emerald-400" : timingPrediction?.prediction?.includes("HIGH") || timingPrediction?.prediction?.includes("Suboptimal") ? "text-rose-400" : "text-amber-400"}`}>
              {timingPrediction ? `${Math.round(timingPrediction.confidence * 100)}%` : "—"}
            </div>
            <div className="text-[9px] text-slate-500 uppercase">Timing Confidence</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className={`text-lg font-bold ${riskPrediction?.prediction === "LOW RISK" ? "text-emerald-400" : riskPrediction?.prediction === "MODERATE RISK" ? "text-amber-400" : "text-rose-400"}`}>
              {riskPrediction?.prediction?.replace(" RISK", "") || "—"}
            </div>
            <div className="text-[9px] text-slate-500 uppercase">Risk Level</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-lg font-bold text-blue-400">{summary.active}</div>
            <div className="text-[9px] text-slate-500 uppercase">Active</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-lg font-bold text-rose-400">{summary.blocked}</div>
            <div className="text-[9px] text-slate-500 uppercase">Blocked</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-lg font-bold text-violet-400">${(summary.tokenSpendUsd ?? 0).toFixed(2)}</div>
            <div className="text-[9px] text-slate-500 uppercase">Spend</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-white/5 pb-2 mb-6">
          {(["overview", "roadmap", "predictions", "missions", "approvals", "live"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === tab ? "bg-violet-500/10 text-violet-400" : "text-slate-400 hover:text-white"}`}>
              {tab === "roadmap" ? "Launch Roadmap" : tab === "live" ? "Live Feed" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className={isEmbedded ? "w-full" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>
          <div className={isEmbedded ? "space-y-4" : "lg:col-span-2 space-y-4"}>

            {/* Launch Roadmap Tab */}
            {activeTab === "roadmap" && (
              <div className="space-y-4">
                <MermaidRenderer
                  chart={GTM_ROADMAP_CHART}
                  scope="product-launch"
                />
              </div>
            )}

            {/* Overview Tab */}
            {activeTab === "overview" && (
              <>
                {attention.length > 0 && (
                  <div className="space-y-2">
                    <h2 className="text-xs font-bold text-rose-400 uppercase tracking-wider">Attention Required ({attention.length})</h2>
                    {attention.map((item, i) => (
                      <div key={i} className="px-4 py-2 rounded-lg bg-rose-500/5 border border-rose-500/20 flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${item.severity === "critical" ? "bg-rose-500/20 text-rose-400" : "bg-amber-500/20 text-amber-400"}`}>{item.severity}</span>
                        <span className="text-sm text-white">{item.agent}</span>
                        <span className="text-xs text-slate-500">· {item.mission}</span>
                        <span className="text-xs text-slate-400 ml-auto">{item.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Agent Fleet</h2>
                  {loading && [1,2,3].map(i => <div key={i} className="h-14 bg-white/5 rounded-lg animate-pulse" />)}
                  {!loading && agents.map(agent => (
                    <div key={agent.agent} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/3 border border-white/5">
                      <span className="text-sm font-medium text-white flex-1">{agent.agent}</span>
                      <span className="text-xs text-slate-500 w-40 truncate">{agent.mission}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${agent.status === "active" ? "bg-blue-500/10 text-blue-400" : agent.status === "completed" ? "bg-emerald-500/10 text-emerald-400" : agent.status === "blocked" ? "bg-rose-500/10 text-rose-400" : "bg-slate-700 text-slate-400"}`}>{agent.status}</span>
                    </div>
                  ))}
                  {!loading && agents.length === 0 && <p className="text-sm text-slate-500 text-center py-6">No active agents. Trigger a mission to start.</p>}
                </div>
              </>
            )}

            {/* Predictions Tab — WOW Feature */}
            {activeTab === "predictions" && (
              <div className="space-y-4">
                <h2 className="text-xs font-bold text-violet-400 uppercase tracking-wider">🔮 Prediction Intelligence</h2>

                {/* Launch Timing */}
                {timingPrediction && (
                  <div className="bg-gradient-to-r from-violet-500/5 to-indigo-500/5 border border-violet-500/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">⏰</span>
                      <h3 className="text-sm font-semibold text-white">Launch Timing Prediction</h3>
                      <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/20 text-violet-400">{Math.round(timingPrediction.confidence * 100)}% confidence</span>
                    </div>
                    <p className="text-sm text-slate-300 mb-2">{timingPrediction.prediction}</p>
                    <p className="text-xs text-slate-400 italic mb-3">💡 {timingPrediction.recommendation}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {timingPrediction.factors.map((f, i) => (
                        <div key={i} className="px-2 py-1.5 rounded bg-white/3 border border-white/5">
                          <span className="text-[10px] text-slate-500">{f.factor}</span>
                          <p className="text-xs text-slate-300">{f.signal}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Risk Score */}
                {riskPrediction && (
                  <div className={`border rounded-xl p-4 ${riskPrediction.prediction === "HIGH RISK" ? "bg-rose-500/5 border-rose-500/20" : riskPrediction.prediction === "MODERATE RISK" ? "bg-amber-500/5 border-amber-500/20" : "bg-emerald-500/5 border-emerald-500/20"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">⚠️</span>
                      <h3 className="text-sm font-semibold text-white">Launch Risk Assessment</h3>
                      <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold ${riskPrediction.prediction === "HIGH RISK" ? "bg-rose-500/20 text-rose-400" : riskPrediction.prediction === "MODERATE RISK" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>{riskPrediction.prediction}</span>
                    </div>
                    <p className="text-xs text-slate-400 italic mb-3">💡 {riskPrediction.recommendation}</p>
                    <div className="space-y-1.5">
                      {riskPrediction.factors.map((f, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="w-24 text-[10px] text-slate-500">{f.factor}</div>
                          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <style>{`#risk-factor-${i} { width: ${f.weight * 100}%; }`}</style>
                            <div id={`risk-factor-${i}`} className="h-full bg-gradient-to-r from-emerald-500 to-rose-500 rounded-full" />
                          </div>
                          <span className="text-[10px] text-slate-400 w-32 text-right">{f.signal}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Day-1 Forecast */}
                {day1Forecast && (
                  <div className="bg-gradient-to-r from-blue-500/5 to-cyan-500/5 border border-blue-500/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">📈</span>
                      <h3 className="text-sm font-semibold text-white">Day-1 Forecast</h3>
                      <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400">{Math.round(day1Forecast.confidence * 100)}% confidence</span>
                    </div>
                    <p className="text-sm text-slate-300 mb-2">{day1Forecast.prediction}</p>
                    <p className="text-xs text-slate-400 italic mb-3">💡 {day1Forecast.recommendation}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {day1Forecast.factors.map((f, i) => (
                        <div key={i} className="px-2 py-1.5 rounded bg-white/3 border border-white/5">
                          <span className="text-[10px] text-slate-500">{f.factor}</span>
                          <p className="text-xs text-slate-300">{f.signal}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!timingPrediction && !riskPrediction && !day1Forecast && (
                  <div className="text-center py-8">
                    <p className="text-sm text-slate-500">Predictions will appear once you have competitive data, beta feedback, and content assets.</p>
                    <button onClick={fetchPredictions} className="mt-3 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold">Refresh Predictions</button>
                  </div>
                )}
              </div>
            )}

            {/* Missions Tab */}
            {activeTab === "missions" && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Launch Missions</h2>
                {MISSIONS_LIST.map(m => (
                  <div key={m.name} data-mission={m.name} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-xl">{m.icon}</span>
                    <span className="text-sm font-medium text-white flex-1">{m.name}</span>
                    <button onClick={() => triggerMission(m.name)} disabled={triggeringMission === m.name} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${triggeringMission === m.name ? "bg-slate-700 text-slate-400" : "bg-violet-600 hover:bg-violet-500 text-white"}`}>
                      {triggeringMission === m.name ? "Launching..." : "Trigger"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Approvals Tab — HIL Integration */}
            {activeTab === "approvals" && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pending Approvals (HIL)</h2>
                <p className="text-sm text-slate-500">In-app approval forms will appear here when missions reach human decision gates (GTM Strategy Approval, Beta Readiness, Go/No-Go).</p>
                <div className="grid grid-cols-1 gap-3">
                  {["GTM Strategy Approval", "Beta Readiness Gate", "Launch Go/No-Go", "Post-Launch Review"].map(gate => (
                    <div key={gate} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-slate-600" />
                      <span className="text-sm text-white flex-1">{gate}</span>
                      <span className="text-[10px] text-slate-500">Not yet triggered</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live Feed Tab — Mission Log Streaming */}
            {activeTab === "live" && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Live Agent Execution Feed</h2>
                <div ref={logRef} className="bg-slate-950 border border-white/10 rounded-xl p-4 h-80 overflow-y-auto font-mono text-xs space-y-1">
                  {liveLog.length === 0 && <p className="text-slate-500">No active execution. Trigger a mission to see live agent activity here.</p>}
                  {liveLog.map((line, i) => <p key={i} className="text-slate-300">{line}</p>)}
                </div>
                <p className="text-[10px] text-slate-500">Connected to platform event stream. Updates appear in real-time when agents execute.</p>
              </div>
            )}
          </div>

          {/* Agent Chat (Only displayed in standalone mode; hidden in CREW Rooms) */}
          {!isEmbedded && (
            <div>
              <AgentChat
                agentName="Launch Coordinator"
                agentRole="Launch Operations"
                defaultGreeting="Hello! I'm your Launch Coordinator. I have access to prediction intelligence, readiness scoring, and cross-functional status. Ask me about launch timing, risk factors, blockers, or what to do next."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
