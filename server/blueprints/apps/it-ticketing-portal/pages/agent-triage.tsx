import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  CheckCircle2,
  ShieldAlert,
  GitBranch,
  Zap,
  BookOpen,
  Sparkles,
  Play,
  Clock,
  RefreshCw,
} from "lucide-react";
import Layout from "../components/Layout";
import type { Ticket, TriageRecord } from "./api/tickets";
import {
  IT_COLLECTIONS,
  ticketService,
  records,
  missions,
  knowledge,
  hil,
  telemetry,
  evaluateTicketTriage,
  requireLaunchedMission,
} from "../lib/platform-client";

interface MissionOutcome {
  runId: number | null;
  status: string;
  message: string;
  error?: string;
}

export default function AgentTriage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [triageResults, setTriageResults] = useState<Record<string, TriageRecord>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});
  const [missionOutcome, setMissionOutcome] = useState<Record<string, MissionOutcome>>({});
  const [executingTicketId, setExecutingTicketId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [{ tickets: loadedTickets }, savedTriage] = await Promise.all([
        ticketService.list(),
        records.list<TriageRecord & { id: string }>(IT_COLLECTIONS.TRIAGE_RUNS).catch(() => []),
      ]);
      setTickets(loadedTickets);
      const byTicket: Record<string, TriageRecord> = {};
      for (const row of savedTriage) {
        if (row.ticketId && !byTicket[row.ticketId]) {
          byTicket[row.ticketId] = row;
        }
      }
      setTriageResults(byTicket);
      setSelectedTicket((prev) => {
        if (prev) {
          const updated = loadedTickets.find((t) => t.id === prev.id);
          if (updated) return updated;
        }
        return loadedTickets[0] ?? null;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load tickets for triage");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const runTriageAnalysis = useCallback(async (ticket: Ticket) => {
    setAnalyzing((prev) => ({ ...prev, [ticket.id]: true }));
    try {
      let matchedTitles: string[] = [];
      try {
        const kbRes = await knowledge.query(`${ticket.category} ${ticket.subject}`, 3);
        const fromNodes = (kbRes.nodes ?? []).map((n) => n.title || n.label).filter((v): v is string => !!v);
        const fromMatches = (kbRes.matches ?? []).map((m) => m.title).filter((v): v is string => !!v);
        matchedTitles = [...fromNodes, ...fromMatches];
      } catch {
        // Knowledge query is optional when running standalone
      }

      const evaluated = evaluateTicketTriage(ticket, matchedTitles);
      let persisted: TriageRecord = evaluated;

      try {
        const existingId = triageResults[ticket.id]?.id;
        if (existingId) {
          persisted = await records.update<TriageRecord>(IT_COLLECTIONS.TRIAGE_RUNS, existingId, evaluated as unknown as Record<string, unknown>);
        } else {
          persisted = await records.create<TriageRecord>(IT_COLLECTIONS.TRIAGE_RUNS, evaluated as unknown as Record<string, unknown>);
        }
      } catch {
        // Keep evaluated triage in state when standalone
      }

      setTriageResults((prev) => ({ ...prev, [ticket.id]: persisted }));
      telemetry.emit("it_ticket_triaged", "info", {
        ticketId: ticket.id,
        confidence: persisted.confidence,
        status: persisted.status,
      });
    } finally {
      setAnalyzing((prev) => ({ ...prev, [ticket.id]: false }));
    }
  }, [triageResults]);

  useEffect(() => {
    if (selectedTicket && !triageResults[selectedTicket.id] && !analyzing[selectedTicket.id]) {
      runTriageAnalysis(selectedTicket);
    }
  }, [selectedTicket, triageResults, analyzing, runTriageAnalysis]);

  const currentTriage = selectedTicket ? triageResults[selectedTicket.id] : null;

  async function triggerResolutionMission(ticket: Ticket) {
    setExecutingTicketId(ticket.id);
    setMissionOutcome((prev) => ({
      ...prev,
      [ticket.id]: {
        runId: null,
        status: "dispatching",
        message: "Dispatching Automated Self-Healing Pipeline…",
      },
    }));

    try {
      const receipt = await missions.trigger("Automated Self-Healing Pipeline", {
        ticketId: ticket.id,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        requester: ticket.requester,
      });
      requireLaunchedMission(receipt);

      const updatedTicket = await ticketService.updateStatus(ticket, "In Progress");
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? updatedTicket : t)));
      setSelectedTicket(updatedTicket);

      setMissionOutcome((prev) => ({
        ...prev,
        [ticket.id]: {
          runId: receipt.runId,
          status: receipt.status,
          message: `Mission run #${receipt.runId} launched (${receipt.status}). Ticket moved to In Progress.`,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Mission launch failed";
      setMissionOutcome((prev) => ({
        ...prev,
        [ticket.id]: {
          runId: null,
          status: "blocked",
          message: "Mission did not start an active execution run.",
          error: msg,
        },
      }));
    } finally {
      setExecutingTicketId(null);
    }
  }

  async function escalateToHumanL2(ticket: Ticket, triage: TriageRecord) {
    setExecutingTicketId(ticket.id);
    try {
      const hilRes = await hil.create(
        `L2 Escalation requested for ${ticket.id}: ${ticket.subject} (${ticket.priority} priority, ${triage.confidence}% L1 confidence)`,
        {
          ticketId: ticket.id,
          category: ticket.category,
          priority: ticket.priority,
          confidence: triage.confidence,
          stage: "l2_escalation_approval",
        }
      );
      setMissionOutcome((prev) => ({
        ...prev,
        [ticket.id]: {
          runId: null,
          status: "awaiting_hil",
          message: `Routed to L2 Human-in-the-Loop queue (HIL #${hilRes.id}).`,
        },
      }));
    } catch (err) {
      setMissionOutcome((prev) => ({
        ...prev,
        [ticket.id]: {
          runId: null,
          status: "error",
          message: "Could not create HIL escalation request.",
          error: err instanceof Error ? err.message : "HIL endpoint unavailable",
        },
      }));
    } finally {
      setExecutingTicketId(null);
    }
  }

  return (
    <Layout title="Agentic Triage Dashboard" subtitle="L1 triage assessments, knowledge matching, and verified mission dispatch">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-white/50">
            Showing {tickets.length} ticket(s) from the active ticket store.
          </p>
          <button
            onClick={loadAll}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh Inbox
          </button>
        </div>

        {loadError && (
          <div role="alert" className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {loadError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Ticket List */}
          <div className="lg:col-span-1 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-white/50">Triage Inbox</h3>
            {loading ? (
              <div className="h-32 animate-pulse bg-white/5 rounded-xl" />
            ) : tickets.length === 0 ? (
              <div className="p-6 rounded-xl bg-white/5 border border-white/10 text-xs text-white/40 text-center">
                No tickets in inbox.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {tickets.map((t) => {
                  const triage = triageResults[t.id];
                  const isAnalyzing = analyzing[t.id];
                  return (
                    <div
                      key={t.recordId || t.id}
                      onClick={() => setSelectedTicket(t)}
                      className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                        selectedTicket?.id === t.id
                          ? "bg-white/10 border-white/20"
                          : "bg-white/5 border-white/5 hover:bg-white/10"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-mono text-xs text-white/40">{t.id} · {t.status}</span>
                        {isAnalyzing ? (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400 animate-pulse">
                            Evaluating…
                          </span>
                        ) : triage ? (
                          <span
                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                              triage.confidence >= 85
                                ? "bg-emerald-500/20 text-emerald-400"
                                : triage.confidence >= 60
                                  ? "bg-amber-500/20 text-amber-400"
                                  : "bg-rose-500/20 text-rose-400"
                            }`}
                          >
                            {triage.confidence}% Confidence
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400">
                            Pending
                          </span>
                        )}
                      </div>
                      <h4 className="font-medium text-sm text-slate-200">{t.subject}</h4>
                      <div className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
                        {triage?.status === "Autonomous Resolution" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : triage?.status === "Human Escalation" ? (
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                        )}
                        {triage?.status || "Awaiting Evaluation"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Flow Visualization */}
          <div className="lg:col-span-2">
            {!selectedTicket ? (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 min-h-[400px] flex items-center justify-center">
                <p className="text-slate-400">Select a ticket to view triage analysis</p>
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 min-h-[400px]">
                <div className="flex items-center gap-3 mb-8 pb-4 border-b border-white/10">
                  <div className="p-3 rounded-xl bg-indigo-500/20 border border-indigo-500/30">
                    <Bot className="w-6 h-6 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-200">Agent Resolution Flow</h2>
                    <p className="text-sm text-slate-400">
                      {selectedTicket.id} • {selectedTicket.category} • {selectedTicket.priority} Priority
                    </p>
                  </div>
                  <div className="ml-auto">
                    <button
                      onClick={() => runTriageAnalysis(selectedTicket)}
                      disabled={analyzing[selectedTicket.id]}
                      className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {analyzing[selectedTicket.id] ? "Evaluating…" : "Re-evaluate"}
                    </button>
                  </div>
                </div>

                {!currentTriage ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <Sparkles className="w-8 h-8 text-slate-500 mx-auto mb-3 animate-pulse" />
                      <p className="text-slate-400">Evaluating ticket against knowledge base and triage rules…</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Knowledge Match */}
                    {currentTriage.knowledgeMatch && (
                      <div className="mb-6 p-4 rounded-xl bg-sky-500/10 border border-sky-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <BookOpen className="w-4 h-4 text-sky-400" />
                          <span className="text-xs font-semibold text-sky-300 uppercase tracking-wider">Knowledge Match</span>
                        </div>
                        <p className="text-sm text-slate-300">{currentTriage.knowledgeMatch}</p>
                      </div>
                    )}

                    {/* Agent Reasoning */}
                    {currentTriage.reasoning && (
                      <div className="mb-6 p-4 rounded-xl bg-slate-900/40 border border-slate-700/50">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-4 h-4 text-indigo-400" />
                          <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Triage Evaluation</span>
                        </div>
                        <p className="text-sm text-slate-300">{currentTriage.reasoning}</p>
                      </div>
                    )}

                    {/* Resolution Steps */}
                    <div className="space-y-6 relative ml-4 pl-8 border-l-2 border-white/10">
                      {currentTriage.steps.map((step: string, idx: number) => (
                        <div key={idx} className="relative">
                          <div
                            className={`absolute -left-[41px] w-5 h-5 rounded-full border-4 border-[#09090b] flex items-center justify-center ${
                              idx === currentTriage.steps.length - 1 && currentTriage.status === "Autonomous Resolution"
                                ? "bg-emerald-500"
                                : "bg-indigo-500"
                            }`}
                          />

                          <div className="bg-white/[0.03] border border-white/10 p-4 rounded-xl">
                            <div className="flex items-center gap-2 mb-1">
                              <GitBranch className="w-4 h-4 text-white/40" />
                              <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Step {idx + 1}</span>
                            </div>
                            <p className="text-slate-300 text-sm font-medium">{step}</p>
                          </div>
                        </div>
                      ))}

                      <div className="relative pt-4">
                        <div
                          className={`absolute -left-[41px] top-6 w-5 h-5 rounded-full border-4 border-[#09090b] flex items-center justify-center ${
                            currentTriage.status === "Autonomous Resolution"
                              ? "bg-emerald-500"
                              : currentTriage.status === "Human Escalation"
                                ? "bg-rose-500"
                                : "bg-amber-500"
                          }`}
                        />

                        <div
                          className={`p-4 rounded-xl border flex items-start gap-3 ${
                            currentTriage.status === "Autonomous Resolution"
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-200"
                              : currentTriage.status === "Human Escalation"
                                ? "bg-rose-500/10 border-rose-500/20 text-rose-200"
                                : "bg-amber-500/10 border-amber-500/20 text-amber-200"
                          }`}
                        >
                          {currentTriage.status === "Autonomous Resolution" ? (
                            <Zap className="w-5 h-5 text-emerald-400 shrink-0" />
                          ) : (
                            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
                          )}
                          <div className="flex-1">
                            <h4 className="font-bold">{currentTriage.status}</h4>
                            <p className="text-xs opacity-80 mt-1">
                              {currentTriage.status === "Autonomous Resolution"
                                ? "Ticket qualifies for the Automated Self-Healing Pipeline mission."
                                : "Ticket requires L2 human operator review before execution."}
                            </p>
                          </div>
                          {currentTriage.status === "Autonomous Resolution" ? (
                            <button
                              onClick={() => triggerResolutionMission(selectedTicket)}
                              disabled={executingTicketId === selectedTicket.id}
                              className="ml-auto px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              {executingTicketId === selectedTicket.id ? "Dispatching…" : "Dispatch Mission"}
                            </button>
                          ) : (
                            <button
                              onClick={() => escalateToHumanL2(selectedTicket, currentTriage)}
                              disabled={executingTicketId === selectedTicket.id}
                              className="ml-auto px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              {executingTicketId === selectedTicket.id ? "Routing…" : "Route to L2 HIL"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Verified Mission / HIL Dispatch Receipt */}
                    {missionOutcome[selectedTicket.id] && (
                      <div className="mt-6 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-4 h-4 text-indigo-400" />
                          <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Dispatch Receipt</span>
                          <span
                            className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                              missionOutcome[selectedTicket.id].error
                                ? "bg-rose-500/20 text-rose-300"
                                : "bg-emerald-500/20 text-emerald-300"
                            }`}
                          >
                            {missionOutcome[selectedTicket.id].status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-200">{missionOutcome[selectedTicket.id].message}</p>
                        {missionOutcome[selectedTicket.id].error && (
                          <p role="alert" className="text-xs text-rose-300 mt-1">
                            {missionOutcome[selectedTicket.id].error}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </Layout>
  );
}
