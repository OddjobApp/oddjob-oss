"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Collections,
  fmtCurrency,
  GenerationSession,
  missions,
  PHASES,
  PHASE_LABEL,
  phaseIndex,
  records,
  statusAccent,
  PhaseName,
} from "../../lib/platform-client";
import { 
  GitBranch, 
  ChevronRight, 
  Check, 
  X, 
  ExternalLink, 
  Terminal, 
  FileText, 
  Settings2
} from "lucide-react";
import { CycleStepBanner } from "../components/CycleStepBanner";

const TRIGGER_MISSION = "autonomous-codegen-run";

export default function PipelineContent() {
  const [sessions, setSessions] = useState<GenerationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [objective, setObjective] = useState("");
  
  // Advanced Configurations State
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [branch, setBranch] = useState("main");
  const [scopePaths, setScopePaths] = useState("");
  const [verificationLevel, setVerificationLevel] = useState("unit-tests");
  const [assignedSquad, setAssignedSquad] = useState("squad-alpha");

  // Detail Expansion State
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await records.list(Collections.sessions);
      setSessions(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startRun = useCallback(async () => {
    setStarting(true);
    setNotice(null);
    setError(null);
    try {
      const res = await missions.trigger(TRIGGER_MISSION, {
        objective: objective.trim() || "Autonomous code-generation run",
        branch,
        scopePaths: scopePaths.trim() ? scopePaths.split(",").map(p => p.trim()) : undefined,
        verificationLevel,
        assignedSquad,
        assignedTeamId: assignedSquad === "squad-alpha" ? 1 : 4,
      });
      setNotice(`Run started — mission run #${res.runId} (${res.status}).`);
      setObjective("");
      // Reset advanced config
      setScopePaths("");
      setShowAdvanced(false);
      // Give the backend a beat to create the session record, then refresh.
      setTimeout(load, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a run");
    } finally {
      setStarting(false);
    }
  }, [objective, branch, scopePaths, verificationLevel, assignedSquad, load]);

  const toggleExpand = (id: string) => {
    setExpandedSessions(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const at = new Date(a.started_at ?? a._createdAt ?? 0).getTime();
      const bt = new Date(b.started_at ?? b._createdAt ?? 0).getTime();
      return bt - at;
    });
  }, [sessions]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <CycleStepBanner />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>🤖</span> Pipeline Session Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Autonomous multi-phase code-generation sessions with interactive human steering.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </header>

      {/* Dynamic JIT Marketplace Alert (Mocked) */}
      <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 shadow-lg backdrop-blur-sm flex items-start gap-4">
        <div className="pt-0.5 text-amber-400">
          <Terminal className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-amber-400">Missing Tool Detected: `puppeteer`</h3>
          <p className="text-xs text-amber-200 mt-1">An agent in the active run attempted to use a headless browser to verify DOM elements, but the MCP Server for Puppeteer is not installed in this environment.</p>
          <div className="mt-3 flex gap-2">
            <button className="px-3 py-1.5 bg-amber-500 text-black text-xs font-bold rounded hover:bg-amber-400 transition-colors">Install via MCP Marketplace</button>
            <button className="px-3 py-1.5 bg-black/20 text-amber-400 border border-amber-500/30 text-xs font-bold rounded hover:bg-black/40 transition-colors">Ignore</button>
          </div>
        </div>
      </div>

      {/* Advanced Run Creation Form */}
      <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5 shadow-lg backdrop-blur-sm">
        <label className="block text-xs font-bold uppercase tracking-widest text-blue-400">
          Launch Autonomous Codegen Session
        </label>
        
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="System Objective — e.g. Add rate limiting to the export endpoint"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all"
          />
          <button
            onClick={startRun}
            disabled={starting}
            className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 active:scale-[0.98] transition-all"
          >
            {starting ? "Starting…" : "Start Run"}
          </button>
        </div>

        {/* Expandable Advanced Options Trigger */}
        <div className="mt-3">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>Advanced Configuration</span>
            <ChevronRight className={`h-3 w-3 transform transition-transform duration-200 ${showAdvanced ? "rotate-90" : ""}`} />
          </button>

          {/* Advanced Configurations panel */}
          {showAdvanced && (
            <div className="mt-4 grid gap-4 sm:grid-cols-4 border-t border-white/5 pt-4 transition-all">
              <div className="flex flex-col">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Assigned Squad
                </label>
                <select
                  value={assignedSquad}
                  onChange={(e) => setAssignedSquad(e.target.value)}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white focus:border-blue-500/50 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="squad-alpha" className="bg-slate-900">Squad Alpha · CodeGen (Sarah)</option>
                  <option value="squad-4" className="bg-slate-900">Squad 4 · Rapid Response (Marcus)</option>
                  <option value="squad-ghost" className="bg-slate-900">Squad Ghost · Hardening</option>
                </select>
              </div>

              <div className="flex flex-col">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Target Branch
                </label>
                <div className="relative">
                  <GitBranch className="absolute left-3 top-3 h-3.5 w-3.5 text-slate-500" />
                  <input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className="w-full rounded-lg border border-white/10 bg-black/20 pl-9 pr-3 py-2 text-xs text-white focus:border-blue-500/50 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Scope Paths (Comma Separated)
                </label>
                <input
                  value={scopePaths}
                  onChange={(e) => setScopePaths(e.target.value)}
                  placeholder="e.g. server/src/routes, client/src/*"
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none"
                />
              </div>

              <div className="flex flex-col">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Verification Level
                </label>
                <select
                  value={verificationLevel}
                  onChange={(e) => setVerificationLevel(e.target.value)}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white focus:border-blue-500/50 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="lint-only" className="bg-slate-900">Linting Only (Fastest)</option>
                  <option value="typecheck" className="bg-slate-900">Type Checking</option>
                  <option value="unit-tests" className="bg-slate-900">Unit Tests (Standard)</option>
                  <option value="full-integration" className="bg-slate-900">Full Integration Gates</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {notice && <p className="mt-3 text-xs text-emerald-400 font-medium flex items-center gap-1"><span>✓</span> {notice}</p>}
      </section>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading sessions…</p>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.01] px-6 py-16 text-center">
          <p className="text-sm font-medium text-slate-300">No generation sessions yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Start a run above to kick off the autonomous pipeline. Sessions will
            appear here as they progress through each phase.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {sorted.map((s) => (
            <SessionCard 
              key={s.id} 
              session={s} 
              isExpanded={!!expandedSessions[s.id]} 
              onToggleExpand={() => toggleExpand(s.id)} 
            />
          ))}
        </ul>
      )}
    </main>
  );
}

interface SessionCardProps {
  session: GenerationSession;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function SessionCard({ session, isExpanded, onToggleExpand }: SessionCardProps) {
  const accent = statusAccent(session.status);
  const activeIdx = phaseIndex(session.current_phase);
  const isDone = session.status === "completed";

  // Steering check: If active and in change_plan phase, simulate HIL review gate
  const isHILGateRequired = !isDone && session.status !== "failed" && session.current_phase === "change_plan";
  const [hilStatus, setHilStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [nudgeText, setNudgeText] = useState("");

  const handleApprove = () => {
    setHilStatus("approved");
  };

  const handleReject = () => {
    setHilStatus("rejected");
  };

  // Log line color-formatter helper
  function formatLogLine(line: string) {
    const timestampMatch = line.match(/^(\[\d{2}:\d{2}:\d{2}\])\s+(.*)$/);
    if (!timestampMatch) return <span>{line}</span>;
    const ts = timestampMatch[1];
    const rest = timestampMatch[2];
    
    const agentMatch = rest.match(/^(\[[a-zA-Z0-9_-]+\])\s+(.*)$/);
    if (!agentMatch) return <span><span className="text-slate-500">{ts}</span> {rest}</span>;
    const agent = agentMatch[1];
    const msg = agentMatch[2];

    let agentColor = "text-slate-400";
    if (agent.includes("context-analyzer")) agentColor = "text-sky-400 font-semibold";
    else if (agent.includes("change-planner")) agentColor = "text-violet-400 font-semibold";
    else if (agent.includes("verification-agent")) agentColor = "text-amber-400 font-semibold";
    else if (agent.includes("test-loop-agent")) {
      agentColor = msg.toLowerCase().includes("fail") ? "text-rose-400 font-semibold" : "text-emerald-400 font-semibold";
    } else if (agent.includes("pr-generator")) agentColor = "text-indigo-400 font-bold";

    let msgColor = "text-slate-300";
    if (msg.toLowerCase().includes("failed") || msg.toLowerCase().includes("errors")) msgColor = "text-rose-300/90";
    else if (msg.toLowerCase().includes("success") || msg.toLowerCase().includes("passed")) msgColor = "text-emerald-300/90";

    return (
      <span className="block leading-relaxed">
        <span className="text-slate-500">{ts}</span>{" "}
        <span className={agentColor}>{agent}</span>{" "}
        <span className={msgColor}>{msg}</span>
      </span>
    );
  }

  return (
    <li className={`rounded-2xl border ${accent.border} ${accent.bg} p-5 transition-all shadow-md hover:shadow-lg backdrop-blur-[2px]`}>
      <div 
        className="flex flex-wrap items-start justify-between gap-3 cursor-pointer select-none"
        onClick={onToggleExpand}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">
              <ChevronRight className={`h-4 w-4 transform transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
            </span>
            <h3 className="truncate text-base font-semibold text-white hover:text-blue-400 transition-colors">
              {session.objective || session.session_id || `Session ${session.id}`}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              {session.assigned_team_id === 4 ? "Squad 4 (Marcus)" : "Squad Alpha (Sarah)"}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 pl-6">
            {session.repository ? `repo: ${session.repository} · ` : ""}
            {session.started_at
              ? new Date(session.started_at).toLocaleString()
              : "not started"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {typeof session.total_cost_usd === "number" && (
            <span className="text-xs text-slate-400">
              {fmtCurrency(session.total_cost_usd)}
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${accent.text} ${accent.bg} border ${accent.border}`}
          >
            {session.status ?? "unknown"}
          </span>
          {/* PR / heal badges in header for collapsed completed sessions */}
          {isDone && (
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 text-[9px] text-slate-400 font-medium">
                1 Repair
              </span>
              <a 
                href="https://github.com/org/repo/pull/294"
                target="_blank" 
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()} // Prevent toggle expand
                className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-0.5 text-[9px] text-indigo-400 font-bold hover:bg-indigo-500/20 transition-all"
              >
                PR #294 <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Phase progress rail */}
      <div className="mt-5 flex flex-col pl-6">
        <div className="flex items-center gap-1.5">
          {PHASES.map((phase, i) => {
            const reached = isDone || (activeIdx >= 0 && i <= activeIdx);
            const current = !isDone && i === activeIdx;
            return (
              <div key={phase} className="flex-1" title={PHASE_LABEL[phase]}>
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    current
                      ? "bg-blue-400 animate-pulse"
                      : reached
                        ? "bg-emerald-500/70"
                        : "bg-white/10"
                  }`}
                />
                <p
                  className={`mt-1.5 hidden text-[10px] font-semibold sm:block ${
                    current ? "text-blue-300" : reached ? "text-slate-400" : "text-slate-600"
                  }`}
                >
                  {PHASE_LABEL[phase]}
                </p>
              </div>
            );
          })}
        </div>
        {/* Mobile current phase label */}
        <p className="mt-2 text-[10px] font-bold text-slate-400 sm:hidden">
          Active Phase: <span className="text-blue-400">{PHASE_LABEL[session.current_phase as PhaseName] || session.current_phase || "None"}</span>
        </p>
      </div>

      {/* Interactive HIL Gate Banner (Change Plan Step) */}
      {isHILGateRequired && hilStatus === "pending" && (
        <div className="mt-5 ml-6 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 transition-all shadow-inner">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-400 mb-2">
            <span>🚦</span> Human Steering Checkpoint Required
          </div>
          <p className="text-xs text-slate-300 mb-3 leading-relaxed">
            The change planner has completed the edit plan. Review the blueprint below and approve to initiate edits, or reject to re-plan.
          </p>
          
          <div className="border border-white/5 bg-black/40 rounded-lg p-3 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Proposed Plan Summary</span>
            <div className="text-xs space-y-1.5 text-slate-400">
              <div className="flex items-center gap-2 text-yellow-500/90 font-mono"><span className="text-[10px] bg-yellow-500/10 px-1 border border-yellow-500/20 rounded">Modify</span> server/routes/export.ts</div>
              <div className="flex items-center gap-2 text-green-500/90 font-mono"><span className="text-[10px] bg-green-500/10 px-1 border border-green-500/20 rounded">Create</span> server/middleware/rate-limiter.ts</div>
            </div>
          </div>

          <div className="border border-white/5 bg-[#0d1117] rounded-lg overflow-hidden mb-3">
            <div className="bg-[#161b22] px-3 py-2 border-b border-white/5 text-[10px] font-bold text-slate-400 flex items-center justify-between">
              <span>AST Diff Viewer — <span className="text-slate-300">server/routes/export.ts</span></span>
              <span className="flex gap-2"><span className="text-emerald-400">+5 lines</span><span className="text-rose-400">-1 line</span></span>
            </div>
            <div className="p-3 text-[10px] font-mono whitespace-pre overflow-x-auto leading-relaxed">
              <div className="text-slate-500">  import {"{"} Router {"}"} from "express";</div>
              <div className="bg-rose-500/10 text-rose-300 border-l-2 border-rose-500 pl-2">- const router = Router();</div>
              <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 pl-2">+ import rateLimit from "express-rate-limit";</div>
              <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 pl-2">+</div>
              <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 pl-2">+ const limiter = rateLimit({"{"} windowMs: 60000, max: 100 {"}"});</div>
              <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 pl-2">+ const router = Router();</div>
              <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 pl-2">+ router.use(limiter);</div>
              <div className="text-slate-500">  export default router;</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={nudgeText}
              onChange={(e) => setNudgeText(e.target.value)}
              placeholder="Inject feedback (e.g., 'Make sure limit is 100/min')"
              className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500/50"
            />
            <button
              onClick={handleApprove}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white flex items-center gap-1 transition-colors"
            >
              <Check className="h-3.5 w-3.5" /> Approve Plan
            </button>
            <button
              onClick={handleReject}
              className="rounded-lg bg-red-600/30 border border-red-500/25 hover:bg-red-600/40 px-3 py-1.5 text-xs font-semibold text-red-400 flex items-center gap-1 transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Reject & Re-plan
            </button>
          </div>
        </div>
      )}

      {isHILGateRequired && hilStatus === "approved" && (
        <div className="mt-4 ml-6 text-xs text-emerald-400 font-semibold flex items-center gap-1">
          <span>✓</span> Change plan approved. Applying edits and initiating verification loop.
        </div>
      )}

      {isHILGateRequired && hilStatus === "rejected" && (
        <div className="mt-4 ml-6 text-xs text-red-400 font-semibold flex items-center gap-1">
          <span>✗</span> Plan rejected. Re-submitting session back to change planner with steering parameters.
        </div>
      )}

      {/* Expanded details (Live Console, Diff, and PR link) */}
      <div className={`mt-5 ml-6 overflow-hidden transition-all duration-300 ${isExpanded ? "max-h-[600px] opacity-100 pt-4 border-t border-white/5" : "max-h-0 opacity-0"}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Live thought stream / logs console */}
          <div className="rounded-xl border border-white/5 bg-black/45 p-4 font-mono text-[11px] text-slate-300">
            <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-3">
              <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-400">
                <Terminal className="h-3.5 w-3.5 text-blue-400" /> Live Agent Thought Log
              </span>
              <span className="flex items-center gap-1 text-[10px] text-blue-400 animate-pulse font-semibold">
                <span className="h-1.5 w-1.5 bg-blue-400 rounded-full"></span> Live
              </span>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1 select-text">
              {formatLogLine("[02:04:12] [context-analyzer] Loaded workspace file structure. 142 files scored.")}
              {formatLogLine("[02:04:18] [context-analyzer] Scored server/routes/export.ts: Relevance 0.94")}
              {formatLogLine("[02:04:31] [change-planner] Created 2 change operations in topologically sorted order.")}
              {activeIdx >= 2 && (
                <>
                  {formatLogLine("[02:04:45] [verification-agent] Editing server/routes/export.ts...")}
                  {formatLogLine("[02:04:52] [verification-agent] Creating server/middleware/rate-limiter.ts...")}
                </>
              )}
              {activeIdx >= 3 && (
                <>
                  {formatLogLine("[02:05:01] [test-loop-agent] Running tests... Failed: TypeError in export.test.ts")}
                  {formatLogLine("[02:05:08] [test-loop-agent] Repair attempt #1: importing config into export.ts")}
                  {formatLogLine("[02:05:15] [test-loop-agent] Test suite passed successfully. 0 errors.")}
                </>
              )}
              {isDone && (
                formatLogLine("[02:05:32] [pr-generator] Pull request #294 created and published.")
              )}
            </div>
          </div>

          {/* Diff View / File Diff Summary */}
          <div className="rounded-xl border border-white/5 bg-black/45 p-4 font-mono text-[11px] select-text">
            <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-3">
              <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-400">
                <FileText className="h-3.5 w-3.5 text-indigo-400" /> File Diff Summary
              </span>
              {isDone && (
                <a 
                  href="https://github.com/org/repo/pull/294"
                  target="_blank" 
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-white font-semibold"
                >
                  View PR <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            
            <div className="space-y-3">
              <div>
                <span className="text-[10px] font-bold text-slate-500 block mb-1">server/routes/export.ts</span>
                <div className="bg-black/20 p-2 rounded border border-white/5 text-[10px] leading-relaxed text-slate-400">
                  <div className="text-red-400/95 font-semibold">- router.post("/export", exportController);</div>
                  <div className="text-green-400/95 font-semibold">+ router.post("/export", rateLimiter, exportController);</div>
                </div>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 block mb-1">server/middleware/rate-limiter.ts</span>
                <div className="bg-black/20 p-2 rounded border border-white/5 text-[10px] leading-relaxed text-slate-400">
                  <div className="text-green-400/95 font-semibold">{'+ export const rateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
