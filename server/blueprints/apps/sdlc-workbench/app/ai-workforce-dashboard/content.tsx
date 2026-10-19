"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { requestCrewInput } from "../../lib/workbench-bridge";
import {
  fleet,
  events,
  records,
  missions,
  telemetry,
  integrations,
  hil,
} from "../../lib/platform-client";
import type {
  FleetWorkload,
  AppRecord,
  HilRequest,
} from "../../lib/platform-client";

const COL = {
  OPERATOR_NOTES: "fleet_command_operator_notes",
  PIP_ACTIONS: "fleet_command_pip_actions",
  AUTONOMY_POLICIES: "fleet_command_autonomy_policies",
};

type Tab = "fleet" | "autonomy" | "sla";

export default function FleetCommandContent() {
  const [activeTab, setActiveTab] = useState<Tab>("fleet");

  // ── Fleet state ──────────────────────────────────────────────────────────────
  const [workload, setWorkload] = useState<FleetWorkload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Operator note form
  const [noteAgent, setNoteAgent] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);

  // PIP
  const [pipAgent, setPipAgent] = useState<string | null>(null);
  const [pipSaving, setPipSaving] = useState(false);
  const [recoveryBrief, setRecoveryBrief] = useState("");

  // ── Autonomy state ───────────────────────────────────────────────────────────
  const [autonomyPolicies, setAutonomyPolicies] = useState<AppRecord[]>([]);
  const [policyRole, setPolicyRole] = useState("");
  const [policyMaxSteps, setPolicyMaxSteps] = useState(10);
  const [policyBudget, setPolicyBudget] = useState(5.0);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  // ── SLA state ────────────────────────────────────────────────────────────────
  const [hilRequests, setHilRequests] = useState<HilRequest[]>([]);
  const notifiedBreaches = useRef<Set<string>>(new Set());

  const keepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch helpers ─────────────────────────────────────────────────────────────
  const fetchWorkload = useCallback(async () => {
    try {
      const data = await fleet.workload();
      setWorkload(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPolicies = useCallback(async () => {
    try {
      const data = await records.list(COL.AUTONOMY_POLICIES);
      // Legacy rows predate the one-policy-per-role upsert: collapse duplicates
      // by agentRole, keeping the most recently updated row.
      const byRole = new Map<string, AppRecord>();
      for (const record of data) {
        const role = String(record.agentRole ?? "").toLowerCase();
        const prev = byRole.get(role);
        const prevAt = Date.parse(String(prev?.updatedAt ?? prev?._updatedAt ?? 0)) || 0;
        const nextAt = Date.parse(String(record.updatedAt ?? record._updatedAt ?? 0)) || 0;
        if (!prev || nextAt >= prevAt) byRole.set(role, record);
      }
      setAutonomyPolicies([...byRole.values()]);
    } catch {}
  }, []);

  const fetchHilRequests = useCallback(async () => {
    try {
      const data = await hil.pending();
      setHilRequests(data);
    } catch {}
  }, []);

  // ── SLA breach checker ───────────────────────────────────────────────────────
  const checkSlaBreaches = useCallback((requests: HilRequest[]) => {
    for (const req of requests) {
      if (!req.slaHours) continue;
      const elapsed =
        (Date.now() - new Date(req.createdAt).getTime()) / 3600000;
      if (elapsed >= req.slaHours && !notifiedBreaches.current.has(req.id)) {
        notifiedBreaches.current.add(req.id);
        // fire and forget
        integrations.slack.post({
          message: `⏰ SLA breached: ${req.formName} (${req.stage}) — ${elapsed.toFixed(1)}h elapsed, SLA was ${req.slaHours}h`,
        });
        telemetry.emit("sla_breach_notified", "critical", {
          hilId: req.id,
          formName: req.formName,
          elapsedHours: elapsed,
        });
      }
    }
  }, []);

  // ── Mount / SSE ───────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchWorkload();
    fetchPolicies();
    fetchHilRequests();

    const unsub = events.subscribe((event) => {
      const fleetEvents = [
        "mission.completed",
        "mission.blocked",
        "mission.status_changed",
        "mission.progress_updated",
        "cycle.status_changed",
        "agent.step_completed",
      ];
      if (fleetEvents.includes(event.type)) fetchWorkload();
      if (event.type === "hil.raised") fetchHilRequests();
    });

    keepaliveRef.current = setInterval(fetchWorkload, 60000);

    return () => {
      unsub();
      if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    };
  }, [fetchWorkload, fetchPolicies, fetchHilRequests]);

  // Run breach check whenever hilRequests changes
  useEffect(() => {
    checkSlaBreaches(hilRequests);
  }, [hilRequests, checkSlaBreaches]);

  // ── Fleet handlers ────────────────────────────────────────────────────────────
  async function handleLogNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteSaving(true);
    try {
      await records.create(COL.OPERATOR_NOTES, {
        agent: noteAgent,
        note: noteText,
        timestamp: new Date().toISOString(),
      });
      telemetry.emit("operator_note_logged", "info", { agent: noteAgent });
      setNoteText("");
      setNoteAgent("");
      setShowNoteForm(false);
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleTriggerPip(agentName: string) {
    setPipAgent(agentName); setPipSaving(true);
    try {
      const response = await requestCrewInput({ kind: 'question', title: `Recovery brief for ${agentName}`, fields: [{ key: 'objective', label: 'What recovery outcome should CREW investigate?', required: true }] });
      setRecoveryBrief(response.status === 'submitted' ? `Recovery brief: ${String(response.data?.objective ?? '')}. Review before proposing execution; no mission launched.` : 'Recovery request cancelled.');
    } catch (error) { setRecoveryBrief((error as Error).message); }
    finally { setPipSaving(false); setPipAgent(null); }
  }

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (!policyRole.trim()) return;
    setPolicySaving(true);
    setPolicyError(null);
    try {
      const role = policyRole.trim();
      const existing = autonomyPolicies.find(
        (p) => String(p.agentRole ?? "").toLowerCase() === role.toLowerCase(),
      );
      const payload = {
        agentRole: existing ? String(existing.agentRole) : role,
        maxSteps: policyMaxSteps,
        budgetUsd: policyBudget,
        updatedAt: new Date().toISOString(),
      };
      // One policy per agentRole: update the existing row instead of stacking
      // duplicates that a reader cannot reconcile.
      if (existing?.id != null) {
        await records.update(COL.AUTONOMY_POLICIES, String(existing.id), payload);
      } else {
        await records.create(COL.AUTONOMY_POLICIES, payload);
      }
      setPolicyRole("");
      setPolicyMaxSteps(10);
      setPolicyBudget(5.0);
      await fetchPolicies();
    } catch (err: any) {
      setPolicyError(err.message ?? "Failed to save policy");
    } finally {
      setPolicySaving(false);
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────────
  const agents = workload?.agents ?? [];
  const attention = workload?.attention ?? [];
  const summary = workload?.summary ?? {
    active: 0,
    blocked: 0,
    idle: 0,
    completed: 0,
    tokenSpendUsd: 0,
  };

  const sortedHilRequests = [...hilRequests].sort((a, b) => {
    const elapsedA = (Date.now() - new Date(a.createdAt).getTime()) / 3600000;
    const elapsedB = (Date.now() - new Date(b.createdAt).getTime()) / 3600000;
    const breachedA = a.slaHours != null && elapsedA >= a.slaHours;
    const breachedB = b.slaHours != null && elapsedB >= b.slaHours;
    if (breachedA && !breachedB) return -1;
    if (!breachedA && breachedB) return 1;
    return elapsedB - elapsedA;
  });

  const breachCount = sortedHilRequests.filter((req) => {
    if (!req.slaHours) return false;
    const elapsed = (Date.now() - new Date(req.createdAt).getTime()) / 3600000;
    return elapsed >= req.slaHours;
  }).length;

  // ── Tab labels ────────────────────────────────────────────────────────────────
  const tabLabel = (tab: Tab) => {
    if (tab === "sla" && breachCount > 0) {
      return (
        <span>
          SLA Monitor{" "}
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-rose-500/20 text-rose-400">
            {breachCount} breached
          </span>
        </span>
      );
    }
    if (tab === "fleet") return "Fleet";
    if (tab === "autonomy") return "Autonomy";
    return "SLA Monitor";
  };

  return (
    <div className="min-h-screen bg-[#050909] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* ── Header ── */}
        <div className="flex items-center gap-3 mb-6">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-500/10 text-teal-400 border border-teal-500/20">
            Intelligence
          </span>
          <h1 className="text-2xl font-bold">Agent Fleet Command</h1>
          {recoveryBrief && <p role="status" className="text-sm text-slate-400">{recoveryBrief}</p>}
          <div className="ml-auto flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-slate-500">
                Live · updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            {activeTab === "fleet" && (
              <button
                data-testid="fleet-add-note"
                onClick={() => setShowNoteForm((v) => !v)}
                className="px-3 py-1.5 text-xs font-semibold bg-teal-600/20 hover:bg-teal-600/30 text-teal-400 border border-teal-500/20 rounded-lg transition-colors"
              >
                + Note
              </button>
            )}
            <button
              onClick={() => {
                fetchWorkload();
                fetchPolicies();
                fetchHilRequests();
              }}
              className="px-3 py-1.5 text-xs font-semibold bg-white/5 hover:bg-white/10 text-slate-400 border border-white/10 rounded-lg transition-colors"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-4">Organization scope · {workload?.cycle?.name ?? "No cycle"}. This is the latest organization cycle, not a room-specific development swarm.</p>
        {/* ── Tab bar ── */}
        <div className="flex gap-1 mb-6 border-b border-white/10">
          {(["fleet", "autonomy", "sla"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors -mb-px ${
                activeTab === tab
                  ? "bg-teal-500/10 text-teal-400 border border-teal-500/20 border-b-[#050909]"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* FLEET TAB                                                              */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "fleet" && (
          <>
            {/* Operator note form */}
            {showNoteForm && (
              <form
                onSubmit={handleLogNote}
                className="mb-6 bg-teal-500/5 border border-teal-500/20 rounded-xl p-4 space-y-3"
              >
                <h2 className="text-sm font-semibold text-teal-400">
                  Log Operator Note
                </h2>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">
                      Agent (optional)
                    </label>
                    <input
                      type="text"
                      value={noteAgent}
                      onChange={(e) => setNoteAgent(e.target.value)}
                      placeholder="e.g. Backend Developer"
                      className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-500 uppercase">
                      Note
                    </label>
                    <input
                      type="text"
                      required
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Intervention, observation, or decision…"
                      className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    data-testid="fleet-save-note"
                    type="submit"
                    disabled={noteSaving}
                    className="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
                  >
                    {noteSaving ? "Saving…" : "Save Note"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNoteForm(false)}
                    className="px-4 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 rounded-lg text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Metrics */}
            <div className="grid grid-cols-5 gap-3 mb-6">
              {[
                {
                  label: "Active",
                  value: summary.active,
                  color: "text-blue-400",
                },
                {
                  label: "Blocked",
                  value: summary.blocked,
                  color: "text-rose-400",
                },
                { label: "Idle", value: summary.idle, color: "text-slate-400" },
                {
                  label: "Completed",
                  value: summary.completed,
                  color: "text-emerald-400",
                },
                {
                  label: "Spend",
                  value: `$${(summary.tokenSpendUsd ?? 0).toFixed(2)}`,
                  color: "text-teal-400",
                },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="bg-white/5 border border-teal-500/10 rounded-xl p-3 text-center"
                >
                  <div className={`text-xl font-bold ${color}`}>{value}</div>
                  <div className="text-[10px] text-slate-500">{label}</div>
                </div>
              ))}
            </div>

            {/* Attention queue */}
            {attention.length > 0 && (
              <div className="mb-6 space-y-2">
                <h2 className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                  Attention Queue ({attention.length})
                </h2>
                {attention.map((item, i) => (
                  <div
                    key={i}
                    className="px-4 py-2 rounded-lg bg-rose-500/5 border border-rose-500/20 flex items-center gap-2"
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${item.severity === "critical" ? "bg-rose-500/20 text-rose-400" : "bg-amber-500/20 text-amber-400"}`}
                    >
                      {item.severity}
                    </span>
                    <span className="text-sm text-white">{item.agent}</span>
                    <span className="text-xs text-slate-500">
                      · {item.mission}
                    </span>
                    <span className="text-xs text-slate-400 flex-1 text-right truncate">
                      {item.reason}
                    </span>
                    <button
                      onClick={() => handleTriggerPip(item.agent)}
                      disabled={pipSaving && pipAgent === item.agent}
                      className="px-2 py-0.5 text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded hover:bg-amber-500/20 transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {pipSaving && pipAgent === item.agent ? "Waiting…" : "Request recovery brief"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Agent table */}
            {loading && (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-14 bg-white/5 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            )}
            {error && (
              <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 mb-4">
                {error}
              </div>
            )}

            {!loading && agents.length > 0 && (
              <>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Mission Run Roster
                </h2>
                <div className="space-y-2">
                  {agents.map((agent) => (
                    <div
                      key={agent.agent}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/3 border border-white/5"
                    >
                      <span className="text-sm font-medium text-white flex-1">
                        {agent.agent}
                      </span>
                      <span className="text-xs text-slate-500 w-48 truncate">
                        {agent.mission}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          agent.status === "active"
                            ? "bg-blue-500/10 text-blue-400"
                            : agent.status === "completed"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : agent.status === "blocked"
                                ? "bg-rose-500/10 text-rose-400"
                                : "bg-slate-700 text-slate-400"
                        }`}
                      >
                        {agent.status}
                      </span>
                      <span className="text-xs font-mono text-slate-400 w-12 text-right">
                        {agent.confidence !== null
                          ? `${agent.confidence}%`
                          : "—"}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          agent.risk === "high"
                            ? "bg-rose-500/20 text-rose-400"
                            : agent.risk === "medium"
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-emerald-500/10 text-emerald-400"
                        }`}
                      >
                        {agent.risk}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!loading && agents.length === 0 && !error && (
              <p className="text-sm text-slate-500 text-center py-8">
                No active operational cycle. Install a cycle blueprint to see
                agent workload.
              </p>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* AUTONOMY TAB                                                           */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "autonomy" && (
          <div className="space-y-6">
            {/* Description */}
            <p className="text-sm text-slate-400 bg-teal-500/5 border border-teal-500/20 rounded-xl px-4 py-3">
              Stored planning preferences only. Runtime enforcement is not connected; these records do not stop agents or limit spending.
            </p>

            {/* Policy table */}
            {autonomyPolicies.length > 0 ? (
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Current Policies
                </h2>
                <div className="rounded-xl border border-white/10 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/5 text-[10px] text-slate-500 uppercase tracking-wider">
                        <th className="text-left px-4 py-2">Agent Role</th>
                        <th className="text-right px-4 py-2">Max Steps</th>
                        <th className="text-right px-4 py-2">
                          Token Budget ($)
                        </th>
                        <th className="text-right px-4 py-2">Last Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {autonomyPolicies.map((policy) => (
                        <tr
                          key={policy.id}
                          className="border-t border-white/5 hover:bg-white/3 transition-colors"
                        >
                          <td className="px-4 py-2.5 text-white font-medium">
                            {String(policy.agentRole ?? "—")}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-teal-400">
                            {String(policy.maxSteps ?? "—")}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-teal-400">
                            {policy.budgetUsd != null
                              ? `$${Number(policy.budgetUsd).toFixed(2)}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-500 text-xs">
                            {policy.updatedAt
                              ? new Date(
                                  String(policy.updatedAt),
                                ).toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-6 bg-white/3 rounded-xl border border-white/5">
                No autonomy policies defined yet.
              </p>
            )}

            {/* Add Planning Preference form */}
            <div className="bg-teal-500/5 border border-teal-500/20 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-teal-400 mb-4">
                Add Planning Preference
              </h2>
              <form onSubmit={handleSavePolicy} className="space-y-4">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase">
                    Agent Role
                  </label>
                  <input
                    type="text"
                    required
                    value={policyRole}
                    onChange={(e) => setPolicyRole(e.target.value)}
                    placeholder="e.g. Backend Developer"
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm focus:border-teal-500/50 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 uppercase">
                    Max Steps
                  </label>
                  <div className="flex items-center gap-3 mt-1">
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={policyMaxSteps}
                      onChange={(e) =>
                        setPolicyMaxSteps(Number(e.target.value))
                      }
                      className="flex-1 accent-teal-500"
                    />
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={policyMaxSteps}
                      onChange={(e) =>
                        setPolicyMaxSteps(
                          Math.min(100, Math.max(1, Number(e.target.value))),
                        )
                      }
                      className="w-20 bg-slate-900 border border-white/10 rounded p-2 text-sm text-right font-mono focus:border-teal-500/50 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 uppercase">
                    Token Budget (USD)
                  </label>
                  <div className="relative mt-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                      $
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={policyBudget}
                      onChange={(e) => setPolicyBudget(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-white/10 rounded pl-6 pr-3 py-2 text-sm font-mono focus:border-teal-500/50 outline-none"
                    />
                  </div>
                </div>

                {policyError && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded p-2">
                    {policyError}
                  </p>
                )}

                <button
                  data-testid="fleet-save-policy"
                  type="submit"
                  disabled={policySaving}
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  {policySaving ? "Saving…" : "Save Planning Preference"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* SLA MONITOR TAB                                                        */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "sla" && (
          <div className="space-y-4">
            {breachCount > 0 && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30">
                <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-sm font-semibold text-rose-400">
                  {breachCount} SLA {breachCount === 1 ? "breach" : "breaches"}{" "}
                  detected
                </span>
              </div>
            )}

            {sortedHilRequests.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-10 bg-white/3 rounded-xl border border-white/5">
                No pending HIL requests.
              </p>
            )}

            {sortedHilRequests.map((req) => {
              const elapsed =
                (Date.now() - new Date(req.createdAt).getTime()) / 3600000;
              const elapsedH = Math.floor(elapsed);
              const elapsedM = Math.floor((elapsed - elapsedH) * 60);
              const breached = req.slaHours != null && elapsed >= req.slaHours;
              const remaining =
                req.slaHours != null ? req.slaHours - elapsed : null;
              const contextPairs = Object.entries(req.context ?? {}).slice(
                0,
                3,
              );

              return (
                <div
                  key={req.id}
                  className={`rounded-xl border p-4 space-y-3 ${
                    breached
                      ? "bg-rose-500/5 border-rose-500/30"
                      : "bg-white/3 border-white/10"
                  }`}
                >
                  {/* Card header */}
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">
                        {req.formName}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {req.stage}
                      </div>
                    </div>

                    {/* Elapsed time badge */}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/5 text-slate-400 flex-shrink-0">
                      {elapsedH}h {elapsedM}m
                    </span>

                    {/* SLA status badge */}
                    {req.slaHours == null ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-700 text-slate-400 flex-shrink-0">
                        No SLA set
                      </span>
                    ) : breached ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse flex-shrink-0">
                        SLA BREACHED ({Math.abs(remaining!).toFixed(1)}h
                        overdue)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 flex-shrink-0">
                        Within SLA ({remaining!.toFixed(1)}h remaining)
                      </span>
                    )}
                  </div>

                  {/* Context summary */}
                  {contextPairs.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {contextPairs.map(([key, val]) => (
                        <div
                          key={key}
                          className="bg-white/5 rounded-lg px-3 py-1.5"
                        >
                          <div className="text-[9px] text-slate-500 uppercase truncate">
                            {key}
                          </div>
                          <div className="text-xs text-slate-300 truncate">
                            {String(val)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
