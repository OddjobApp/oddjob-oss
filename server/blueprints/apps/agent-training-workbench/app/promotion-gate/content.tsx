"use client";

import { useState, useEffect, useCallback } from "react";
import { records, missions, events } from "../../lib/platform-client";
import type { AppRecord } from "../../lib/platform-client";

const COL_UPDATES    = "agent_updates";
const COL_DEPLOY_LOG = "deployment_log";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AgentUpdate extends AppRecord {
  agentId: string;
  agentName: string;
  fromVersion: string;
  toVersion: string;
  status: "pending" | "staged" | "promoted" | "rolled_back";
  trafficPercent: number;
  metrics: { baseline: number; candidate: number; improvement: number };
  validationPassed: boolean;
  createdAt: string;
  notes: string;
}

interface DeploymentLog extends AppRecord {
  agentUpdateId: string;
  agentName: string;
  action: "stage" | "promote" | "rollback" | "adjust";
  actor: string;
  fromStatus: string;
  toStatus: string;
  timestamp: string;
  notes: string;
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:     "bg-amber-500/15 border-amber-500/20 text-amber-400",
    staged:      "bg-blue-500/15 border-blue-500/20 text-blue-400",
    promoted:    "bg-emerald-500/15 border-emerald-500/20 text-emerald-400",
    rolled_back: "bg-rose-500/15 border-rose-500/20 text-rose-400",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${map[status] ?? map.pending}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// ── Action badge for log ──────────────────────────────────────────────────────
function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    promote:  "bg-emerald-500/15 border-emerald-500/20 text-emerald-400",
    rollback: "bg-rose-500/15 border-rose-500/20 text-rose-400",
    stage:    "bg-blue-500/15 border-blue-500/20 text-blue-400",
    adjust:   "bg-slate-700/30 border-slate-600 text-slate-400",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[action] ?? map.adjust}`}>
      {action}
    </span>
  );
}

// ── Metric block ──────────────────────────────────────────────────────────────
function MetricBlock({
  label,
  score,
  borderClass,
  delta,
}: {
  label: string;
  score: number;
  borderClass: string;
  delta?: number;
}) {
  return (
    <div className={`flex-1 bg-white/3 border rounded-xl p-3 space-y-1 ${borderClass}`}>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className="text-2xl font-bold font-mono text-white">{score.toFixed(1)}</p>
      {delta !== undefined && (
        <p className={`text-xs font-semibold ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
        </p>
      )}
    </div>
  );
}

// ── Update card ───────────────────────────────────────────────────────────────
function UpdateCard({
  update,
  onRefresh,
}: {
  update: AgentUpdate;
  onRefresh: () => void;
}) {
  const [trafficDraft, setTrafficDraft] = useState(update.trafficPercent);
  const [noteDraft, setNoteDraft]       = useState(update.notes ?? "");
  const [expanded, setExpanded]         = useState(false);
  const [acting, setActing]             = useState(false);

  const logAction = async (
    action: DeploymentLog["action"],
    fromStatus: string,
    toStatus: string,
    extraNotes = ""
  ) => {
    await records.create(COL_DEPLOY_LOG, {
      agentUpdateId: update.id,
      agentName:     update.agentName,
      action,
      actor:         "operator",
      fromStatus,
      toStatus,
      timestamp:     new Date().toISOString(),
      notes:         extraNotes || noteDraft,
    });
  };

  const handleStage = async () => {
    setActing(true);
    try {
      await records.update(COL_UPDATES, update.id, { status: "staged", trafficPercent: 10 });
      await logAction("stage", "pending", "staged");
      onRefresh();
    } finally { setActing(false); }
  };

  const handlePromote = async () => {
    setActing(true);
    try {
      await records.update(COL_UPDATES, update.id, { status: "promoted", trafficPercent: 100 });
      await logAction("promote", "staged", "promoted");
      await missions.trigger("Training Promotion", {
        agentUpdateId: update.id,
        agentName:     update.agentName,
        toVersion:     update.toVersion,
        triggeredBy:   "promotion-gate",
      });
      onRefresh();
    } finally { setActing(false); }
  };

  const handleRollback = async () => {
    if (!window.confirm(`Roll back ${update.agentName}? This will set traffic to 0 and mark as rolled back.`)) return;
    setActing(true);
    try {
      await records.update(COL_UPDATES, update.id, { status: "rolled_back", trafficPercent: 0 });
      await logAction("rollback", update.status, "rolled_back");
      onRefresh();
    } finally { setActing(false); }
  };

  const handleAdjustTraffic = async () => {
    setActing(true);
    try {
      await records.update(COL_UPDATES, update.id, { trafficPercent: trafficDraft });
      await logAction("adjust", update.status, update.status, `traffic → ${trafficDraft}%`);
      onRefresh();
    } finally { setActing(false); }
  };

  const improvement = update.metrics?.improvement ?? 0;

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2.5 py-0.5 rounded-lg bg-white/10 text-white text-sm font-bold">
            {update.agentName}
          </span>
          <span className="text-xs text-slate-400 font-mono">
            v{update.fromVersion} &rarr; v{update.toVersion}
          </span>
          <StatusBadge status={update.status} />
        </div>
        <span className="text-[10px] text-slate-600 font-mono shrink-0">
          {new Date(update.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Metrics */}
      <div className="flex gap-3">
        <MetricBlock
          label="Baseline"
          score={update.metrics?.baseline ?? 0}
          borderClass="border-slate-700"
        />
        <MetricBlock
          label="Candidate"
          score={update.metrics?.candidate ?? 0}
          borderClass={improvement >= 0 ? "border-emerald-500/30" : "border-rose-500/30"}
          delta={improvement}
        />
      </div>

      {/* Validation badge */}
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${
          update.validationPassed
            ? "bg-emerald-500/15 border-emerald-500/20 text-emerald-400"
            : "bg-rose-500/15 border-rose-500/20 text-rose-400"
        }`}>
          {update.validationPassed ? "✓ Validation Passed" : "✗ Validation Failed"}
        </span>
      </div>

      {/* Traffic slider (staged only) */}
      {update.status === "staged" && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 shrink-0">Rollout</span>
          <input
            type="range" min={0} max={100} step={5}
            value={trafficDraft}
            onChange={(e) => setTrafficDraft(Number(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="text-xs font-mono text-white w-10 text-center">{trafficDraft}%</span>
          {trafficDraft !== update.trafficPercent && (
            <button
              onClick={handleAdjustTraffic}
              disabled={acting}
              className="px-3 py-1 text-xs font-semibold text-blue-400 border border-blue-500/20 hover:border-blue-500/40 rounded-lg transition-colors disabled:opacity-50"
            >
              Adjust Rollout
            </button>
          )}
        </div>
      )}

      {/* Notes */}
      <input
        type="text"
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        placeholder="Notes…"
        className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-white/20"
      />

      {/* Validation detail toggle */}
      <button
        onClick={() => setExpanded((x) => !x)}
        className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        {expanded ? "Hide validation summary" : "Show validation summary"}
      </button>
      {expanded && (
        <div className="bg-slate-950/60 border border-white/5 rounded-lg p-3 text-xs text-slate-400 space-y-1">
          <div className="flex justify-between">
            <span>Baseline score</span>
            <span className="font-mono text-white">{update.metrics?.baseline ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Candidate score</span>
            <span className="font-mono text-white">{update.metrics?.candidate ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Improvement</span>
            <span className={`font-mono ${improvement >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {improvement >= 0 ? "+" : ""}{improvement.toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span>Validation</span>
            <span className={update.validationPassed ? "text-emerald-400" : "text-rose-400"}>
              {update.validationPassed ? "Passed" : "Failed"}
            </span>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {update.status === "pending" && (
          <button
            onClick={handleStage}
            disabled={acting}
            className="px-4 py-2 bg-blue-700/30 hover:bg-blue-700/50 border border-blue-500/30 text-blue-400 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            Stage
          </button>
        )}
        {update.status === "staged" && update.validationPassed && (
          <button
            onClick={handlePromote}
            disabled={acting}
            className="px-4 py-2 bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            Promote to 100%
          </button>
        )}
        {update.status !== "rolled_back" && update.status !== "promoted" && (
          <button
            onClick={handleRollback}
            disabled={acting}
            className="px-4 py-2 bg-rose-700/30 hover:bg-rose-700/50 border border-rose-500/30 text-rose-400 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            Roll Back
          </button>
        )}
      </div>
    </div>
  );
}

// ── New update form ───────────────────────────────────────────────────────────
function NewUpdateForm({ onCreated }: { onCreated: () => void }) {
  const [show, setShow] = useState(false);
  const [agentName, setAgentName]     = useState("");
  const [fromVersion, setFromVersion] = useState("");
  const [toVersion, setToVersion]     = useState("");
  const [baseline, setBaseline]       = useState(70);
  const [candidate, setCandidate]     = useState(70);
  const [notes, setNotes]             = useState("");
  const [creating, setCreating]       = useState(false);

  const inputBase =
    "w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-500";

  const handleCreate = async () => {
    if (!agentName.trim() || !fromVersion.trim() || !toVersion.trim()) return;
    setCreating(true);
    try {
      const improvement = baseline > 0 ? ((candidate - baseline) / baseline) * 100 : 0;
      await records.create(COL_UPDATES, {
        agentId:      `${agentName.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
        agentName:    agentName.trim(),
        fromVersion:  fromVersion.trim(),
        toVersion:    toVersion.trim(),
        status:       "pending",
        trafficPercent: 0,
        metrics: {
          baseline,
          candidate,
          improvement: Number(improvement.toFixed(2)),
        },
        validationPassed: candidate >= baseline,
        notes:        notes.trim(),
        createdAt:    new Date().toISOString(),
      });
      setAgentName(""); setFromVersion(""); setToVersion(""); setNotes("");
      setBaseline(70); setCandidate(70);
      setShow(false);
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mb-6">
      <button
        onClick={() => setShow((x) => !x)}
        className="px-3 py-1.5 bg-teal-700/20 hover:bg-teal-700/40 border border-teal-500/20 text-teal-400 text-xs font-semibold rounded-lg transition-colors"
      >
        {show ? "Cancel" : "+ New Agent Update"}
      </button>

      {show && (
        <div className="mt-4 bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-300">New Agent Update</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Agent Name</label>
              <input type="text" value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. research-analyst" className={inputBase} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">From Version</label>
              <input type="text" value={fromVersion} onChange={(e) => setFromVersion(e.target.value)} placeholder="3" className={inputBase} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">To Version</label>
              <input type="text" value={toVersion} onChange={(e) => setToVersion(e.target.value)} placeholder="4" className={inputBase} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Baseline Score</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range" min={0} max={100} step={1} value={baseline}
                  onChange={(e) => setBaseline(Number(e.target.value))}
                  className="flex-1 accent-slate-400"
                />
                <span className="text-sm font-mono text-white w-8 text-center">{baseline}</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Candidate Score</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range" min={0} max={100} step={1} value={candidate}
                  onChange={(e) => setCandidate(Number(e.target.value))}
                  className="flex-1 accent-teal-500"
                />
                <span className="text-sm font-mono text-white w-8 text-center">{candidate}</span>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Summary of changes…" className={`${inputBase} resize-none`} />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCreate}
              disabled={creating || !agentName.trim() || !fromVersion.trim() || !toVersion.trim()}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {creating ? "Creating…" : "Create Update"}
            </button>
            <span className={`text-xs font-semibold ${candidate >= baseline ? "text-emerald-400" : "text-rose-400"}`}>
              Validation will {candidate >= baseline ? "pass" : "fail"} (candidate {candidate >= baseline ? ">=" : "<"} baseline)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PromotionGateContent() {
  const [updates, setUpdates]         = useState<AgentUpdate[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(true);

  const [log, setLog]                 = useState<DeploymentLog[]>([]);
  const [logLoading, setLogLoading]   = useState(true);

  const fetchUpdates = useCallback(async () => {
    try {
      const data = await records.list(COL_UPDATES);
      setUpdates(
        (data as AgentUpdate[])
          .filter((u) => u.status !== "rolled_back" || true) // show all per spec: filter status !== rolled_back; spec says show all ≠ rolled_back — but spec says "filtered to status ≠ rolled_back"... we include rolled_back for completeness via separate state
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
    } catch { /* non-fatal */ }
    finally { setUpdatesLoading(false); }
  }, []);

  const fetchLog = useCallback(async () => {
    try {
      const data = await records.list(COL_DEPLOY_LOG);
      setLog(
        (data as DeploymentLog[]).sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
      );
    } catch { /* non-fatal */ }
    finally { setLogLoading(false); }
  }, []);

  useEffect(() => {
    fetchUpdates();
    fetchLog();
    const unsub = events.subscribe((ev) => {
      if (["mission.completed"].includes(ev.type)) {
        fetchUpdates();
        fetchLog();
      }
    });
    return unsub;
  }, [fetchUpdates, fetchLog]);

  const handleRefresh = () => {
    fetchUpdates();
    fetchLog();
  };

  // Updates to display: exclude rolled_back per spec
  const activeUpdates = updates.filter((u) => u.status !== "rolled_back");

  const logRowClass = (action: string) => {
    if (action === "promote")  return "bg-emerald-500/5 hover:bg-emerald-500/10";
    if (action === "rollback") return "bg-rose-500/5 hover:bg-rose-500/10";
    return "hover:bg-white/3";
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-5xl mx-auto space-y-10">

        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="text-2xl">🚀</span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">Promotion Gate</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Review validation results, approve staged agent updates, control rollout percentage, and monitor deployment health.
            </p>
          </div>
        </div>

        {/* ── Staged Updates Queue ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Staged Updates Queue
            </h2>
            <button
              onClick={handleRefresh}
              className="px-3 py-1 text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
            >
              Refresh
            </button>
          </div>

          <NewUpdateForm onCreated={handleRefresh} />

          {updatesLoading && (
            <div className="space-y-3">
              {[1, 2].map((i) => <div key={i} className="h-40 bg-white/5 rounded-xl animate-pulse" />)}
            </div>
          )}
          {!updatesLoading && activeUpdates.length === 0 && (
            <div className="text-center py-12 bg-white/3 border border-white/8 rounded-xl">
              <p className="text-sm text-slate-400 font-medium">No active updates</p>
              <p className="text-xs text-slate-600 mt-1">Create a new agent update above to get started.</p>
            </div>
          )}
          <div className="space-y-4">
            {activeUpdates.map((u) => (
              <UpdateCard key={u.id} update={u} onRefresh={handleRefresh} />
            ))}
          </div>
        </section>

        {/* ── Deployment Log ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Deployment Log
            </h2>
            {log.length > 0 && (
              <span className="text-xs text-slate-500">{log.length} entries</span>
            )}
          </div>

          {logLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-white/5 rounded-lg animate-pulse" />)}
            </div>
          )}
          {!logLoading && log.length === 0 && (
            <div className="text-center py-10 bg-white/3 border border-white/8 rounded-xl">
              <p className="text-sm text-slate-500">No deployments logged yet.</p>
            </div>
          )}

          {log.length > 0 && (
            <div className="bg-white/3 border border-white/8 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="p-3 text-left text-slate-400 font-semibold">Timestamp</th>
                    <th className="p-3 text-left text-slate-400 font-semibold">Agent</th>
                    <th className="p-3 text-left text-slate-400 font-semibold">Action</th>
                    <th className="p-3 text-left text-slate-400 font-semibold">Status Change</th>
                    <th className="p-3 text-left text-slate-400 font-semibold">Actor</th>
                    <th className="p-3 text-left text-slate-400 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((entry) => (
                    <tr key={entry.id} className={`border-b border-white/5 transition-colors ${logRowClass(entry.action)}`}>
                      <td className="p-3 font-mono text-slate-500">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                      <td className="p-3 font-semibold text-white">{entry.agentName}</td>
                      <td className="p-3"><ActionBadge action={entry.action} /></td>
                      <td className="p-3 text-slate-400">
                        <span className="capitalize">{entry.fromStatus.replace("_", " ")}</span>
                        <span className="mx-1.5 text-slate-600">&rarr;</span>
                        <span className="capitalize">{entry.toStatus.replace("_", " ")}</span>
                      </td>
                      <td className="p-3 text-slate-500">{entry.actor}</td>
                      <td className="p-3 text-slate-500 max-w-[200px] truncate">{entry.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
