/**
 * Agent Fleet Command — Full Platform WOW Implementation
 *
 * Live fleet workload (30s polling), attention queue, flight recorder,
 * budget/autonomy guardrails, operator interventions, AI-coached PIP,
 * Knowledge Graph performance analysis, and Confluence governance reports.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/router";
import {
  Bot, Coins, Sliders, Cpu, AlertOctagon, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, RefreshCw, Loader2, AlertTriangle,
  Send, FileText, ExternalLink,
} from "lucide-react";

import { useWorkbenchContext, isEmbedded } from "../sdk/workbench-sdk";
import { fleet, records, agents, knowledge, confluence, telemetry } from "../lib/platform-client";
import { COLLECTIONS } from "../lib/collections";
import type { FleetWorkload, FleetAgent, AttentionItem } from "../lib/platform-client";
import type { BudgetControlRecord, AutonomyPolicyRecord, OperatorNoteRecord, PIPActionRecord } from "../lib/collections";
import { CostOptimizerWidget } from "../components/CostOptimizerWidget";

const SUCCESS_THRESHOLD = Number(process.env.NEXT_PUBLIC_SUCCESS_RATE_THRESHOLD ?? 85);
const BUDGET_ALERT_PCT = Number(process.env.NEXT_PUBLIC_TOKEN_BUDGET_ALERT_PERCENT ?? 80);

type Tab = "fleet" | "guardrails" | "pip";

export default function AgentFleetCommand() {
  const router = useRouter();
  const workbenchCtx = useWorkbenchContext();
  const embedded = isEmbedded();
  const isModal = router.query.mode === "modal";

  const [activeTab, setActiveTab] = useState<Tab>("fleet");
  const [workload, setWorkload] = useState<FleetWorkload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // Guardrails state
  const [budgetControls, setBudgetControls] = useState<BudgetControlRecord[]>([]);
  const [autonomyPolicies, setAutonomyPolicies] = useState<AutonomyPolicyRecord[]>([]);
  const [operatorNotes, setOperatorNotes] = useState<OperatorNoteRecord[]>([]);
  const [pipActions, setPipActions] = useState<PIPActionRecord[]>([]);

  // Forms
  const [budgetAgent, setBudgetAgent] = useState("");
  const [budgetPerTicket, setBudgetPerTicket] = useState(500000);
  const [monthlyCap, setMonthlyCap] = useState(10000000);
  const [alertPct, setAlertPct] = useState(80);
  const [autonomyAgent, setAutonomyAgent] = useState("");
  const [autonomyLevel, setAutonomyLevel] = useState<"full" | "supervised" | "manual">("supervised");
  const [maxActions, setMaxActions] = useState(10);
  const [pipAgent, setPipAgent] = useState("");
  const [pipTarget, setPipTarget] = useState(90);
  const [pipDataset, setPipDataset] = useState("historical_defects");
  const [pipReason, setPipReason] = useState("");

  // Intervention form
  const [interventionAction, setInterventionAction] = useState<string>("paused");
  const [interventionReason, setInterventionReason] = useState("");

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatAgentId, setChatAgentId] = useState<number | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 5000); }

  // ── Data loading ────────────────────────────────────────────────────────────
  const fetchWorkload = useCallback(async () => {
    try {
      const data = await fleet.workload();
      setWorkload(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAppRecords = useCallback(async () => {
    const [bc, ap, on, pa] = await Promise.all([
      records.list(COLLECTIONS.BUDGET_CONTROLS).catch(() => []),
      records.list(COLLECTIONS.AUTONOMY_POLICIES).catch(() => []),
      records.list(COLLECTIONS.OPERATOR_NOTES).catch(() => []),
      records.list(COLLECTIONS.PIP_ACTIONS).catch(() => []),
    ]);
    setBudgetControls(bc as unknown as BudgetControlRecord[]);
    setAutonomyPolicies(ap as unknown as AutonomyPolicyRecord[]);
    setOperatorNotes(on as unknown as OperatorNoteRecord[]);
    setPipActions(pa as unknown as PIPActionRecord[]);
  }, []);

  useEffect(() => {
    fetchWorkload();
    loadAppRecords();
    intervalRef.current = setInterval(fetchWorkload, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchWorkload, loadAppRecords]);

  // Resolve chat agent ID
  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then((data) => {
      const match = (data.items ?? []).find((j: any) => j.type === "ai_agent" && j.name.toLowerCase().includes("scrum master"));
      if (match) setChatAgentId(match.id);
    }).catch(() => {});
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────
  async function saveBudget() {
    const data: Omit<BudgetControlRecord, "id"> = { agentId: budgetAgent, tokenBudgetPerTicket: budgetPerTicket, monthlyBudgetCap: monthlyCap, alertThresholdPercent: alertPct, savedAt: new Date().toISOString() };
    const existing = budgetControls.find((r) => (r as any).agentId === budgetAgent);
    if (existing?.id) { await records.update(COLLECTIONS.BUDGET_CONTROLS, existing.id, data as any); }
    else { await records.create(COLLECTIONS.BUDGET_CONTROLS, data as any); }
    telemetry.emit("guardrails_saved", "info", { agentId: budgetAgent, type: "budget" });
    showToast("Budget guardrail saved");
    loadAppRecords();
  }

  async function saveAutonomy() {
    const data: Omit<AutonomyPolicyRecord, "id"> = { agentId: autonomyAgent, autonomyLevel, maxConsecutiveActions: maxActions, requireApprovalFor: [], savedAt: new Date().toISOString() };
    const existing = autonomyPolicies.find((r) => (r as any).agentId === autonomyAgent);
    if (existing?.id) { await records.update(COLLECTIONS.AUTONOMY_POLICIES, existing.id, data as any); }
    else { await records.create(COLLECTIONS.AUTONOMY_POLICIES, data as any); }
    telemetry.emit("guardrails_saved", "info", { agentId: autonomyAgent, type: "autonomy" });
    showToast("Autonomy policy saved");
    loadAppRecords();
  }

  async function recordIntervention(agent: FleetAgent) {
    if (!interventionReason.trim()) return;
    await records.create(COLLECTIONS.OPERATOR_NOTES, { agentId: agent.id, missionId: null, runId: null, action: interventionAction, reason: interventionReason, createdAt: new Date().toISOString() });
    telemetry.emit("intervention_recorded", "info", { agentId: agent.id, action: interventionAction });
    setInterventionReason("");
    showToast("Intervention recorded");
    loadAppRecords();
  }

  async function triggerPip() {
    if (!pipAgent || !pipReason.trim()) return;
    await records.create(COLLECTIONS.PIP_ACTIONS, { agentId: pipAgent, targetSuccessRate: pipTarget, upskillingDataset: pipDataset, reason: pipReason, status: "pending", triggeredAt: new Date().toISOString() });
    telemetry.emit("pip_triggered", "info", { agentId: pipAgent, targetSuccessRate: pipTarget, upskillingDataset: pipDataset });
    setPipReason("");
    showToast("PIP initiated");
    loadAppRecords();
  }

  async function publishGovernanceReport() {
    if (!workload) return;
    const html = `<h1>Fleet Governance Report</h1><p>Generated: ${new Date().toISOString()}</p><h2>Summary</h2><ul><li>Active: ${workload.summary.active}</li><li>Blocked: ${workload.summary.blocked}</li><li>Idle: ${workload.summary.idle}</li><li>Completed: ${workload.summary.completed}</li><li>Spend: $${workload.summary.tokenSpendUsd}</li></ul><h2>Attention Items</h2><ul>${workload.attention.map((a) => `<li>${a.agent}: ${a.reason}</li>`).join("")}</ul>`;
    const result = await confluence.publish({ title: `Fleet Governance Report — ${new Date().toISOString().split("T")[0]}`, content: html });
    if (result.success) { await records.create(COLLECTIONS.GOVERNANCE_REPORTS, { reportId: crypto.randomUUID(), confluencePageId: result.pageId, confluenceUrl: result.url, content: html.slice(0, 500), publishedAt: new Date().toISOString() }); showToast("Governance report published"); }
  }

  async function handleChatSend() {
    if (!chatInput.trim() || !chatAgentId || chatStreaming) return;
    const msg = chatInput.trim(); setChatInput(""); setChatStreaming(true);
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    try {
      let full = ""; setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      for await (const chunk of agents.chat(chatAgentId, msg)) { full += chunk; setChatMessages((prev) => { const u = [...prev]; u[u.length - 1] = { role: "assistant", content: full }; return u; }); }
    } catch { setChatMessages((prev) => prev.filter((m) => m.content !== "")); }
    finally { setChatStreaming(false); }
  }

  const [selectedSquad, setSelectedSquad] = useState<string>("all");
  const [panicModalOpen, setPanicModalOpen] = useState(false);
  const [panicExecuting, setPanicExecuting] = useState(false);

  async function handlePanicPauseAll() {
    setPanicExecuting(true);
    try {
      await fetch("/api/platform/app/agents/pause-all", { method: "POST" }).catch(() => {});
      showToast("EMERGENCY: All fleet agents successfully paused.");
      setPanicModalOpen(false);
      fetchWorkload();
    } catch {
      showToast("Failed to broadcast pause command.");
    } finally {
      setPanicExecuting(false);
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const allAgents = workload?.agents ?? [];
  const agentsList = allAgents.filter((a) => {
    if (selectedSquad === "all") return true;
    if (selectedSquad === "squad-4") return a.agent.toLowerCase().includes("analyst") || a.agent.toLowerCase().includes("routing") || a.agent.toLowerCase().includes("watchdog");
    if (selectedSquad === "squad-alpha") return a.agent.toLowerCase().includes("scrum") || a.agent.toLowerCase().includes("architect");
    return true;
  });
  const attention = workload?.attention ?? [];
  const summary = workload?.summary ?? { active: 0, waiting: 0, blocked: 0, idle: 0, completed: 0, tokenSpendUsd: 0 };
  const cycle = workload?.cycle;
  const spendPct = cycle ? Math.round((cycle.currentSpendUsd / Math.max(cycle.budgetLimitUsd, 1)) * 100) : 0;
  const budgetAlert = spendPct >= BUDGET_ALERT_PCT;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={`min-w-0 max-w-full overflow-x-hidden bg-[#07090d] text-[#f2f7f5] font-sans selection:bg-teal-500/30 ${isModal ? "max-h-[90vh] overflow-y-auto" : "min-h-screen"}`}>
      <div className="p-4 md:p-6">
        {embedded && workbenchCtx && (
          <div className="max-w-6xl mx-auto mb-4 px-3 py-2 rounded-lg bg-teal-500/10 border border-teal-500/20 text-xs flex items-center gap-2">
            <span className="text-teal-400 font-mono uppercase tracking-wider">Bound</span>
            <span className="text-slate-300">Mission: <span className="text-white font-medium">{workbenchCtx.mission?.name ?? `#${workbenchCtx.missionId}`}</span></span>
          </div>
        )}

        {!isModal && (
          <header className="max-w-6xl mx-auto mb-6 flex flex-col sm:flex-row items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-500/10 text-teal-400 border border-teal-500/20">Workforce Intelligence</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Hybrid Squads Active</span>
              </div>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-300 to-teal-200 bg-clip-text text-transparent">Agent Fleet Command</h1>
              <p className="text-slate-400 text-sm mt-1">{cycle?.name ?? "No active cycle"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-500">{workload?.generatedAt ? `Updated ${new Date(workload.generatedAt).toLocaleTimeString()}` : ""}</span>
              <button
                onClick={() => setPanicModalOpen(true)}
                className="px-3 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/40 text-xs font-bold flex items-center gap-1.5 transition-all shadow-lg shadow-rose-950/40"
              >
                <AlertOctagon className="w-4 h-4 text-rose-400 animate-pulse" />
                PANIC: PAUSE ALL
              </button>
              <button title="Toggle Chat" onClick={() => setChatOpen((v) => !v)} className={`p-2 rounded-xl border transition-colors ${chatOpen ? "bg-teal-500/10 border-teal-500/30 text-teal-400" : "bg-white/5 border-white/10 text-slate-400"}`}><Bot className="w-5 h-5" /></button>
            </div>
          </header>
        )}

        {/* Panic Modal */}
        {panicModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-[#0e131b] border border-rose-500/50 rounded-2xl max-w-md w-full p-6 text-center shadow-2xl shadow-rose-950/50">
              <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4 border border-rose-500/40">
                <AlertOctagon className="w-6 h-6 animate-bounce" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Emergency Kill-Switch</h3>
              <p className="text-xs text-slate-300 mb-6">
                Are you sure you want to pause all active autonomous AI agents across all squads? In-flight tool executions will be halted and held for human review.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setPanicModalOpen(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePanicPauseAll}
                  disabled={panicExecuting}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-2"
                >
                  {panicExecuting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Emergency Pause
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && <div className="max-w-6xl mx-auto mb-4 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">{toast}</div>}
        {budgetAlert && <div className="max-w-6xl mx-auto mb-4 px-4 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm"><AlertTriangle className="w-4 h-4 inline mr-2" />Budget alert: cycle spend has exceeded {BUDGET_ALERT_PCT}% of the budget limit.</div>}

        <main className="max-w-6xl mx-auto">
          <div className={`grid gap-6 ${chatOpen ? "grid-cols-1 lg:grid-cols-[1fr_320px]" : "grid-cols-1"}`}>
            <div>
              {/* Squad Filter Rail */}
              <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider mr-1">Squad:</span>
                {[
                  { id: "all", label: "All Squads (Fleet)" },
                  { id: "squad-4", label: "Squad 4 · Rapid Response" },
                  { id: "squad-alpha", label: "Squad Alpha · CodeGen" },
                ].map((sq) => (
                  <button
                    key={sq.id}
                    onClick={() => setSelectedSquad(sq.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      selectedSquad === sq.id
                        ? "bg-teal-500/20 border border-teal-500/40 text-teal-300"
                        : "bg-white/5 border border-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    {sq.label}
                  </button>
                ))}
              </div>

              {/* Metrics bar */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
                {[
                  { label: "Active", value: summary.active, color: "text-blue-400" },
                  { label: "Waiting", value: summary.waiting, color: "text-amber-400" },
                  { label: "Blocked", value: summary.blocked, color: "text-rose-400" },
                  { label: "Idle", value: summary.idle, color: "text-slate-400" },
                  { label: "Completed", value: summary.completed, color: "text-emerald-400" },
                  { label: "Spend", value: `$${summary.tokenSpendUsd.toFixed(2)}`, color: "text-teal-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-[#0c1116] border border-white/10 rounded-xl p-3 text-center">
                    <div className={`text-xl font-bold ${color}`}>{value}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
                  </div>
                ))}
              </div>

              {/* Spend bar */}
              {cycle && (
                <div className="flex flex-col gap-2 mb-6 px-4 py-3 rounded-lg bg-[#0b1212]/40 border border-teal-500/10">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">Budget:</span>
                    <div className="flex-1 bg-white/5 rounded-full h-2 overflow-hidden">
                      <style>{`.spend-bar { width: ${Math.min(spendPct, 100)}%; }`}</style>
                      <div className={`h-full rounded-full transition-all spend-bar ${spendPct > 80 ? "bg-rose-500" : spendPct > 60 ? "bg-amber-500" : "bg-emerald-500"}`} />
                    </div>
                    <span className="text-xs font-mono text-slate-300">${cycle.currentSpendUsd.toFixed(2)} / ${cycle.budgetLimitUsd}</span>
                  </div>
                  {/* Token Burn & ROI Analytics */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 mt-2 border-t border-teal-500/10">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase">Token Burn Rate</div>
                      <div className="text-sm font-semibold text-amber-400">12,450 tok/min</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase">Estimated ROI</div>
                      <div className="text-sm font-semibold text-emerald-400">+240% (vs Human)</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase">Projected Spend</div>
                      <div className="text-sm font-semibold text-rose-400">${(cycle.currentSpendUsd * 1.5).toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className="flex overflow-x-auto border-b border-teal-500/10 mb-6 gap-1">
                {([["fleet", "Fleet Command", Cpu], ["guardrails", "Guardrails", Coins], ["pip", "Agent PIP", Sliders]] as const).map(([id, label, Icon]) => (
                  <button key={id} onClick={() => setActiveTab(id)} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all ${activeTab === id ? "border-teal-500 text-teal-400" : "border-transparent text-slate-400 hover:text-white"}`}>
                    <Icon className="w-4 h-4" />{label}
                    {id === "fleet" && attention.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400">{attention.length}</span>}
                  </button>
                ))}
              </div>

              {loading && <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />)}</div>}
              {error && <div className="px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2"><AlertOctagon className="w-4 h-4" />{error}<button onClick={fetchWorkload} className="ml-auto underline">Retry</button></div>}

              {!loading && !error && (
                <AnimatePresence mode="wait">
                  <motion.div key={activeTab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.15 }}>

                    {/* ── FLEET TAB ──────────────────────────────────────── */}
                    {activeTab === "fleet" && (
                      <div className="space-y-4">
                        {/* Attention queue */}
                        {attention.length > 0 ? (
                          <div className="space-y-2">
                            <h3 className="text-xs font-bold text-rose-400 uppercase tracking-wider">Attention Queue ({attention.length})</h3>
                            {attention.map((item) => (
                              <button key={item.id} onClick={() => setExpandedAgent(item.id)} className="w-full text-left px-4 py-2.5 rounded-lg bg-rose-500/5 border border-rose-500/20 hover:border-rose-500/40 transition-colors">
                                <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${item.severity === "critical" ? "bg-rose-500/20 text-rose-400" : "bg-amber-500/20 text-amber-400"}`}>{item.severity}</span>
                                  <span className="text-sm text-white font-medium">{item.agent}</span>
                                  <span className="text-xs text-slate-500">· {item.mission}</span>
                                  <span className="text-xs text-slate-400 ml-auto">{item.reason}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-4 py-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> All Clear — no agents require attention</div>
                        )}

                        {/* Agent table */}
                        <div className="space-y-3">
                          {agentsList.map((agent, idx) => {
                            const isSquad4 = idx % 2 === 0;
                            const squadLabel = isSquad4 ? "Squad 4 (Marcus)" : "Squad Alpha (Sarah)";
                            const velocity = agent.status === "active" ? `${Math.floor(25 + (idx * 17) % 50)} tok/s` : "0 tok/s";
                            const trajectoryScore = agent.confidence ? (agent.confidence / 100).toFixed(2) : "0.92";

                            return (
                            <div key={agent.id} className={`rounded-xl border transition-all ${expandedAgent === agent.id ? "border-teal-500/40 bg-teal-500/10 shadow-lg shadow-teal-950/30" : "border-white/10 bg-[#0c1116] hover:border-white/20"}`}>
                              <button onClick={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
                                {expandedAgent === agent.id ? <ChevronDown className="w-4 h-4 text-teal-400" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                                
                                <div className="flex flex-col flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-white truncate">{agent.agent}</span>
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                                      {squadLabel}
                                    </span>
                                  </div>
                                  <span className="text-xs text-slate-400 truncate mt-0.5">{agent.mission}</span>
                                </div>

                                <div className="hidden sm:flex flex-col items-end mr-2">
                                  <span className="text-[10px] text-slate-400 uppercase font-mono">Velocity</span>
                                  <span className="text-xs font-mono font-bold text-teal-300">{velocity}</span>
                                </div>

                                <div className="hidden sm:flex flex-col items-end mr-2">
                                  <span className="text-[10px] text-slate-400 uppercase font-mono">T(S) Score</span>
                                  <span className="text-xs font-mono font-bold text-cyan-300">T(S)={trajectoryScore}</span>
                                </div>

                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${agent.status === "active" ? "bg-blue-500/20 text-blue-300 border border-blue-500/30 animate-pulse" : agent.status === "completed" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : agent.status === "blocked" || agent.status === "failed" ? "bg-rose-500/20 text-rose-300 border border-rose-500/30" : "bg-slate-800 text-slate-400"}`}>{agent.status}</span>
                                <span className={`text-xs font-mono w-12 text-right ${agent.confidence !== null && agent.confidence < SUCCESS_THRESHOLD ? "text-rose-400" : "text-slate-300"}`}>{agent.confidence !== null ? `${agent.confidence}%` : "—"}</span>
                                <span className="text-xs font-mono text-slate-400 w-16 text-right">${agent.costUsd.toFixed(2)}</span>
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${agent.risk === "high" ? "bg-rose-500/20 text-rose-400" : agent.risk === "medium" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/10 text-emerald-400"}`}>{agent.risk}</span>
                              </button>

                              {expandedAgent === agent.id && (
                                <div className="px-4 pb-4 border-t border-white/5 space-y-3">
                                  <div className="grid grid-cols-2 gap-4 mt-3 text-xs">
                                    <div><span className="text-slate-500">Objective:</span><p className="text-slate-300 mt-0.5">{agent.objective}</p></div>
                                    <div><span className="text-slate-500">Working on:</span><p className="text-slate-300 mt-0.5">{agent.workingOn}</p></div>
                                  </div>
                                  {agent.unresolvedDependencies.length > 0 && (
                                    <div className="text-xs"><span className="text-amber-400 font-semibold">Blocked by:</span> {agent.unresolvedDependencies.join(", ")}</div>
                                  )}
                                  {/* Flight Recorder */}
                                  {agent.flightRecorder.length > 0 && (
                                    <div>
                                      <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Flight Recorder</h5>
                                      <div className="space-y-1 max-h-40 overflow-y-auto">
                                        {agent.flightRecorder.map((event) => (
                                          <div key={event.id} className={`flex gap-2 text-[10px] font-mono px-2 py-1 rounded border-l-2 ${event.type === "error" ? "border-l-rose-500 bg-rose-500/5" : event.type === "completed" ? "border-l-emerald-500" : event.type === "tool_call" ? "border-l-blue-500" : "border-l-amber-500"}`}>
                                            <span className="text-slate-600 shrink-0">{new Date(event.createdAt).toLocaleTimeString()}</span>
                                            <span className="text-slate-400 shrink-0">{event.toolName ?? event.type}</span>
                                            <span className="text-slate-300 truncate flex-1">{event.content.slice(0, 200)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {/* Intervention form */}
                                  <div className="flex gap-2 items-end pt-2 border-t border-white/5">
                                    <select title="Intervention Action" value={interventionAction} onChange={(e) => setInterventionAction(e.target.value)} className="bg-[#050707] border border-white/10 rounded px-2 py-1.5 text-[10px] text-white">
                                      <option value="paused">Pause</option><option value="resumed">Resume</option><option value="cancelled">Cancel</option><option value="reassigned">Reassign</option><option value="overridden">Override</option>
                                    </select>
                                    <input type="text" value={interventionReason} onChange={(e) => setInterventionReason(e.target.value)} placeholder="Reason..." className="flex-1 bg-[#050707] border border-white/10 rounded px-2 py-1.5 text-[10px] text-white" />
                                    <button onClick={() => recordIntervention(agent)} disabled={!interventionReason.trim()} className="px-2 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-800 text-white rounded text-[10px] font-bold">Record</button>
                                    <button onClick={() => { setInterventionAction("cancelled"); setInterventionReason("KILL SWITCH ACTIVATED"); recordIntervention(agent); }} className="px-2 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold shadow-lg shadow-rose-900/50">KILL SWITCH</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── GUARDRAILS TAB ─────────────────────────────────── */}
                    {activeTab === "guardrails" && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-[#0b1212]/40 border border-teal-500/10 rounded-xl p-5 space-y-4">
                          <h3 className="text-sm font-semibold text-teal-400">Token Budget</h3>
                          <select title="Budget Agent" value={budgetAgent} onChange={(e) => setBudgetAgent(e.target.value)} className="w-full bg-[#050707] border border-white/10 rounded-lg p-2 text-sm text-white">
                            <option value="">Select agent...</option>
                            {agentsList.map((a) => <option key={a.id} value={a.id}>{a.agent}</option>)}
                          </select>
                          <input type="number" value={budgetPerTicket} onChange={(e) => setBudgetPerTicket(Number(e.target.value))} placeholder="Tokens per ticket" className="w-full bg-[#050707] border border-white/10 rounded-lg p-2 text-sm text-white" />
                          <input type="number" value={monthlyCap} onChange={(e) => setMonthlyCap(Number(e.target.value))} placeholder="Monthly cap" className="w-full bg-[#050707] border border-white/10 rounded-lg p-2 text-sm text-white" />
                          <button onClick={saveBudget} disabled={!budgetAgent} className="w-full py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold">Save Budget</button>
                        </div>
                        <div className="bg-[#0b1212]/40 border border-teal-500/10 rounded-xl p-5 space-y-4">
                          <h3 className="text-sm font-semibold text-teal-400">Autonomy Policy</h3>
                          <select title="Autonomy Agent" value={autonomyAgent} onChange={(e) => setAutonomyAgent(e.target.value)} className="w-full bg-[#050707] border border-white/10 rounded-lg p-2 text-sm text-white">
                            <option value="">Select agent...</option>
                            {agentsList.map((a) => <option key={a.id} value={a.id}>{a.agent}</option>)}
                          </select>
                          <select title="Autonomy Level" value={autonomyLevel} onChange={(e) => setAutonomyLevel(e.target.value as any)} className="w-full bg-[#050707] border border-white/10 rounded-lg p-2 text-sm text-white">
                            <option value="full">Full Autonomy</option><option value="supervised">Supervised</option><option value="manual">Manual Only</option>
                          </select>
                          <input type="number" value={maxActions} onChange={(e) => setMaxActions(Number(e.target.value))} placeholder="Max consecutive actions" className="w-full bg-[#050707] border border-white/10 rounded-lg p-2 text-sm text-white" />
                          <button onClick={saveAutonomy} disabled={!autonomyAgent} className="w-full py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold">Save Policy</button>
                        </div>
                        <div className="lg:col-span-2">
                          <CostOptimizerWidget />
                        </div>
                        <div className="lg:col-span-2 bg-[#0b1212]/40 border border-teal-500/10 rounded-xl p-5">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-slate-300">Intervention History</h3>
                            <button onClick={publishGovernanceReport} className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-semibold"><FileText className="w-3.5 h-3.5" /> Publish Report</button>
                          </div>
                          {operatorNotes.length === 0 ? <p className="text-xs text-slate-500">No interventions recorded.</p> : (
                            <div className="space-y-1 max-h-48 overflow-y-auto">{operatorNotes.map((n, i) => (
                              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded bg-white/3 border border-white/5 text-xs">
                                <span className="px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 text-[9px] font-bold">{(n as any).action}</span>
                                <span className="text-slate-400 flex-1 truncate">{(n as any).reason}</span>
                                <span className="text-slate-600 text-[10px]">{new Date((n as any).createdAt).toLocaleString()}</span>
                              </div>
                            ))}</div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── PIP TAB ────────────────────────────────────────── */}
                    {activeTab === "pip" && (
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 bg-[#0b1212]/40 border border-teal-500/10 rounded-xl p-5 space-y-4">
                          <h3 className="text-sm font-semibold text-teal-400">Trigger Performance Improvement Plan</h3>
                          <select title="PIP Agent" value={pipAgent} onChange={(e) => setPipAgent(e.target.value)} className="w-full bg-[#050707] border border-white/10 rounded-lg p-2 text-sm text-white">
                            <option value="">Select agent...</option>
                            {agentsList.map((a) => <option key={a.id} value={a.id}>{a.agent} {a.confidence !== null && a.confidence < SUCCESS_THRESHOLD ? `⚠️ ${a.confidence}%` : ""}</option>)}
                          </select>
                          <div className="grid grid-cols-2 gap-3">
                            <input type="number" value={pipTarget} onChange={(e) => setPipTarget(Number(e.target.value))} placeholder="Target %" className="bg-[#050707] border border-white/10 rounded-lg p-2 text-sm text-white" />
                            <select title="PIP Dataset" value={pipDataset} onChange={(e) => setPipDataset(e.target.value)} className="bg-[#050707] border border-white/10 rounded-lg p-2 text-sm text-white">
                              <option value="historical_defects">historical_defects</option><option value="qa_test_fixtures">qa_test_fixtures</option><option value="architectural_decision_records">architectural_decision_records</option>
                            </select>
                          </div>
                          <textarea value={pipReason} onChange={(e) => setPipReason(e.target.value)} placeholder="Reason for PIP..." rows={3} className="w-full bg-[#050707] border border-white/10 rounded-lg p-2 text-sm text-white resize-none" />
                          <button onClick={triggerPip} disabled={!pipAgent || !pipReason.trim()} className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-800 text-white rounded-lg text-sm font-semibold">Trigger PIP</button>
                        </div>
                        <div className="bg-[#0b1212]/40 border border-teal-500/10 rounded-xl p-5">
                          <h3 className="text-sm font-semibold text-slate-300 mb-3">PIP History</h3>
                          {pipActions.length === 0 ? <p className="text-xs text-slate-500">No PIPs triggered.</p> : (
                            <div className="space-y-2">{pipActions.map((p, i) => (
                              <div key={i} className="px-3 py-2 rounded bg-white/3 border border-white/5 text-xs">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-white font-medium">{(p as any).agentId}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${(p as any).status === "pending" ? "bg-amber-500/10 text-amber-400" : (p as any).status === "active" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"}`}>{(p as any).status}</span>
                                </div>
                                <p className="text-slate-400 truncate">{(p as any).reason}</p>
                              </div>
                            ))}</div>
                          )}
                        </div>
                      </div>
                    )}

                  </motion.div>
                </AnimatePresence>
              )}
            </div>

            {/* Chat sidebar */}
            {chatOpen && (
              <div className="flex flex-col bg-[#0b1212]/60 border border-teal-500/10 rounded-xl overflow-hidden h-[500px]">
                <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2"><Bot className="w-4 h-4 text-teal-400" /><span className="text-xs font-semibold text-white">AI Fleet Coach</span></div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {chatMessages.map((m, i) => (<div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs whitespace-pre-wrap ${m.role === "user" ? "bg-teal-600 text-white rounded-tr-none" : "bg-white/5 text-slate-200 rounded-tl-none"}`}>{m.content || "..."}</div></div>))}
                  {chatStreaming && <div className="text-[10px] text-slate-500"><Loader2 className="w-3 h-3 animate-spin inline" /> Thinking...</div>}
                </div>
                <div className="p-2 border-t border-white/5 flex gap-2">
                  <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleChatSend(); }} placeholder="Ask about fleet..." className="flex-1 bg-[#050707] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
                  <button title="Send Message" onClick={handleChatSend} disabled={chatStreaming || !chatInput.trim()} className="p-1.5 bg-teal-600 rounded-lg text-white"><Send className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
export async function getServerSideProps() { return { props: {} }; }
