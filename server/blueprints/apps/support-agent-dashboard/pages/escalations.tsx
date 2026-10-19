import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Activity, User, MessagesSquare, ArrowUpRight, CheckCircle2, RefreshCw } from "lucide-react";
import Layout from "../components/Layout";
import {
  SUPPORT_COLLECTIONS,
  escalationService,
  records,
  hil,
  missions,
  telemetry,
  requireLaunchedMission,
  type EscalationSession,
} from "../lib/platform-client";

interface ActionReceipt {
  ok: boolean;
  message: string;
}

export default function Escalations() {
  const [sessions, setSessions] = useState<EscalationSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<EscalationSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [receipts, setReceipts] = useState<Record<string, ActionReceipt>>({});

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const { sessions: list } = await escalationService.list();
      setSessions(list);
      setSelectedSession((prev) => {
        if (prev) {
          const found = list.find((s) => s.id === prev.id);
          if (found) return found;
        }
        return list[0] ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function handleEscalateToTier2(session: EscalationSession) {
    setActing(true);
    try {
      const hilRes = await hil.create(
        `Tier-2 Escalation for ${session.id} (${session.user}): ${session.reason}`,
        {
          sessionId: session.id,
          user: session.user,
          escalationRisk: session.escalationRisk,
          sentiment: session.currentSentiment,
          formRef: "l2_escalation_approval",
        }
      );

      const updatedPatch: Partial<EscalationSession> = {
        status: "escalated_l2",
        hilRequestId: hilRes.id,
        updatedAt: new Date().toISOString(),
      };

      try {
        await records.update(SUPPORT_COLLECTIONS.ESCALATIONS, session.recordId || session.id, updatedPatch);
      } catch {
        await records.create(SUPPORT_COLLECTIONS.ESCALATIONS, {
          sessionId: session.id,
          ...session,
          ...updatedPatch,
        }).catch(() => {});
      }

      const nextSession: EscalationSession = { ...session, ...updatedPatch };
      setSessions((prev) => prev.map((s) => (s.id === session.id ? nextSession : s)));
      setSelectedSession(nextSession);
      setReceipts((prev) => ({
        ...prev,
        [session.id]: {
          ok: true,
          message: `Escalated to Tier-2 Human Queue (HIL request #${hilRes.id}).`,
        },
      }));
      telemetry.emit("support_session_escalated", "warn", { sessionId: session.id, hilId: hilRes.id });
    } catch (err) {
      setReceipts((prev) => ({
        ...prev,
        [session.id]: {
          ok: false,
          message: err instanceof Error ? err.message : "Failed to create Tier-2 HIL escalation",
        },
      }));
    } finally {
      setActing(false);
    }
  }

  async function handleDispatchRemediation(session: EscalationSession) {
    setActing(true);
    try {
      const receipt = await missions.trigger("Automated Self-Healing Pipeline", {
        sessionId: session.id,
        user: session.user,
        reason: session.reason,
        escalationRisk: session.escalationRisk,
      });
      requireLaunchedMission(receipt);

      const updatedPatch: Partial<EscalationSession> = {
        status: "remediation_dispatched",
        lastMissionRunId: receipt.runId,
        updatedAt: new Date().toISOString(),
      };

      try {
        await records.update(SUPPORT_COLLECTIONS.ESCALATIONS, session.recordId || session.id, updatedPatch);
      } catch {
        await records.create(SUPPORT_COLLECTIONS.ESCALATIONS, {
          sessionId: session.id,
          ...session,
          ...updatedPatch,
        }).catch(() => {});
      }

      const nextSession: EscalationSession = { ...session, ...updatedPatch };
      setSessions((prev) => prev.map((s) => (s.id === session.id ? nextSession : s)));
      setSelectedSession(nextSession);
      setReceipts((prev) => ({
        ...prev,
        [session.id]: {
          ok: true,
          message: `Dispatched Automated Self-Healing Pipeline (Run #${receipt.runId}, status: ${receipt.status}).`,
        },
      }));
    } catch (err) {
      setReceipts((prev) => ({
        ...prev,
        [session.id]: {
          ok: false,
          message: err instanceof Error ? err.message : "Remediation mission did not start an active run",
        },
      }));
    } finally {
      setActing(false);
    }
  }

  return (
    <Layout title="Sentiment & Escalation Predictor" subtitle="Live monitoring of user sessions, escalation risk, and Tier-2 HIL routing">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-white/50">
            Select a high-risk session to route to Tier-2 HIL approval or dispatch automated remediation.
          </p>
          <button
            onClick={loadSessions}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Live Sessions */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-white/50">Monitored Sessions</h3>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Active
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {sessions.map((s) => (
                <div
                  key={s.recordId || s.id}
                  onClick={() => setSelectedSession(s)}
                  className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                    selectedSession?.id === s.id ? "bg-white/10 border-white/20" : "bg-white/5 border-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-white/40" />
                      <span className="font-medium text-sm text-slate-200">{s.user}</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        s.escalationRisk > 80
                          ? "bg-rose-500/20 text-rose-400 border border-rose-500/20"
                          : s.escalationRisk > 50
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/20"
                            : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                      }`}
                    >
                      {s.escalationRisk}% Risk
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400 mt-2">
                    <span className="flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5" />
                      <span className={s.currentSentiment === "Frustrated" || s.currentSentiment === "Angry" ? "text-rose-400" : "text-slate-300"}>
                        {s.initialSentiment} &rarr; {s.currentSentiment}
                      </span>
                    </span>
                    {s.status && s.status !== "monitoring" && (
                      <span className="text-[10px] font-mono text-indigo-300 uppercase">{s.status.replace("_", " ")}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Suggested Actions */}
          <div className="lg:col-span-2">
            {!selectedSession ? (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 min-h-[400px] flex items-center justify-center text-slate-400">
                Select a session to inspect escalation signals.
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 min-h-[400px] flex flex-col">
                <div className="mb-6 pb-6 border-b border-white/10">
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2">
                        <MessagesSquare className="w-5 h-5 text-indigo-400" /> Session {selectedSession.id}
                      </h2>
                      <p className="text-sm text-slate-400 mt-1">
                        User: <span className="text-slate-200 font-medium">{selectedSession.user}</span>
                      </p>
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Escalation Probability</div>
                      <div
                        className={`text-3xl font-bold tabular-nums ${
                          selectedSession.escalationRisk > 80
                            ? "text-rose-400"
                            : selectedSession.escalationRisk > 50
                              ? "text-amber-400"
                              : "text-emerald-400"
                        }`}
                      >
                        {selectedSession.escalationRisk}%
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 p-4 bg-black/20 rounded-xl border border-white/5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Session Context</div>
                    <p className="text-sm text-slate-300 leading-relaxed">{selectedSession.reason}</p>
                  </div>
                </div>

                {receipts[selectedSession.id] && (
                  <div
                    role="status"
                    className={`mb-4 p-3 rounded-xl border text-xs ${
                      receipts[selectedSession.id].ok
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                        : "bg-rose-500/10 border-rose-500/20 text-rose-300"
                    }`}
                  >
                    {receipts[selectedSession.id].message}
                  </div>
                )}

                <div className="flex-1">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-indigo-400 mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Operational Actions
                  </h3>

                  {selectedSession.escalationRisk > 80 ? (
                    <div className="space-y-3">
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => handleEscalateToTier2(selectedSession)}
                        className="w-full text-left p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 disabled:opacity-50 transition-colors group"
                      >
                        <div className="flex justify-between items-center">
                          <div className="font-semibold text-indigo-300 text-sm">
                            Escalate to Tier 2 Human Agent (Create HIL Approval)
                          </div>
                          <ArrowUpRight className="w-4 h-4 text-indigo-400 opacity-50 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-xs text-indigo-400/70 mt-1">
                          Creates a tracked `l2_escalation_approval` request in the platform HIL queue.
                        </p>
                      </button>

                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => handleDispatchRemediation(selectedSession)}
                        className="w-full text-left p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 transition-colors group"
                      >
                        <div className="flex justify-between items-center">
                          <div className="font-semibold text-slate-300 text-sm">
                            Dispatch Automated Self-Healing Pipeline
                          </div>
                          <ArrowUpRight className="w-4 h-4 text-slate-400 opacity-50 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          Triggers the L1 remediation mission and verifies an active execution run ID.
                        </p>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-32 text-slate-500 space-y-2">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500/50" />
                      <p className="text-sm">No immediate escalation required. Session within SLA parameters.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </Layout>
  );
}
