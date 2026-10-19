"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  records,
  events,
  missions,
  hil,
  telemetry,
  SalesCollections,
  type SalesRecommendation,
  type RecommendationKind,
  type HilRequest,
} from "../../lib/platform-client";
import { OutboundBreakpoint } from "../components";

const KIND_META: Record<RecommendationKind, { icon: string; label: string; accent: string }> = {
  slip_risk: { icon: "!", label: "Slip Risk", accent: "border-rose-500/30 bg-rose-500/5" },
  stalled: { icon: "STOP", label: "Stalled", accent: "border-amber-500/30 bg-amber-500/5" },
  aging: { icon: "TIME", label: "Aging", accent: "border-orange-500/30 bg-orange-500/5" },
  next_best_action: { icon: "TIP", label: "Next Best Action", accent: "border-sky-500/30 bg-sky-500/5" },
  win: { icon: "WIN", label: "Win", accent: "border-emerald-500/30 bg-emerald-500/5" },
  loss: { icon: "LOSS", label: "Loss", accent: "border-slate-500/30 bg-slate-500/5" },
};

export default function AlertsContent() {
  const [recs, setRecs] = useState<SalesRecommendation[]>([]);
  const [gates, setGates] = useState<HilRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [formState, setFormState] = useState<Record<string, Record<string, string>>>({});
  const [dispatchFor, setDispatchFor] = useState<{ opportunityId: string; dealName: string } | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [r, g] = await Promise.all([
        records.list(SalesCollections.recommendations),
        hil.pending().catch(() => [] as HilRequest[]),
      ]);
      setRecs(r as SalesRecommendation[]);
      setGates(g as HilRequest[]);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const unsub = events.subscribe((ev) => {
      if (["mission.completed", "mission.status_changed", "hil.created", "dataset.updated"].includes(ev.type)) fetchAll();
    });
    return unsub;
  }, [fetchAll]);

  const visible = useMemo(
    () => recs.filter((r) => (showAll ? true : r.status === "OPEN")).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [recs, showAll],
  );

  const setStatus = async (rec: SalesRecommendation, status: SalesRecommendation["status"]) => {
    setRecs((prev) => prev.map((r) => (r.rec_id === rec.rec_id ? { ...r, status } : r)));
    try {
      await records.update(SalesCollections.recommendations, rec.id ?? rec.rec_id, { ...rec, status });
      telemetry.emit("recommendation_action", "info", { rec_id: rec.rec_id, status });
    } catch {
      fetchAll();
    }
  };

  const runScan = async () => {
    try {
      await missions.trigger("Deal Risk Scan");
      telemetry.emit("risk_scan_requested", "info");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to trigger scan");
    }
  };

  const submitGate = async (gate: HilRequest) => {
    const answers = formState[gate.id] ?? {};
    try {
      await hil.submit(gate.id, answers);
      setGates((prev) => prev.filter((g) => g.id !== gate.id));
      telemetry.emit("deal_window_decision_submitted", "info", { gate: gate.id });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit decision");
    }
  };

  const setField = (gateId: string, name: string, value: string) =>
    setFormState((prev) => ({ ...prev, [gateId]: { ...(prev[gateId] ?? {}), [name]: value } }));

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold rounded bg-amber-500/10 text-amber-300 px-2 py-1">DR</span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Deal Risk Center</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {visible.length} {showAll ? "total" : "open"} recommendations - {gates.length} pending gate(s) - advisory only.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAll((s) => !s)} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold rounded-lg">
              {showAll ? "Show open only" : "Show all"}
            </button>
            <button onClick={runScan} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg">Run risk scan</button>
          </div>
        </div>

        {error && <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 mb-4">{error}</div>}

        {/* Pending HIL gates */}
        {gates.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Pending Decision Gates</h2>
            <div className="space-y-3">
              {gates.map((gate) => (
                <div key={gate.id} className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4">
                  <p className="text-sm font-semibold text-amber-300 mb-1">{gate.formName}</p>
                  <p className="text-xs text-slate-500 mb-3">{gate.stage}</p>
                  <div className="space-y-2">
                    {gate.fields.map((f) => (
                      <div key={f.name}>
                        <label className="text-[11px] text-slate-400 block mb-1">{f.label}{f.required ? " *" : ""}</label>
                        {f.type === "select" && f.options ? (
                          <select
                            value={formState[gate.id]?.[f.name] ?? ""}
                            onChange={(e) => setField(gate.id, f.name, e.target.value)}
                            title={f.label}
                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">Select...</option>
                            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : f.type === "textarea" ? (
                          <textarea
                            value={formState[gate.id]?.[f.name] ?? ""}
                            onChange={(e) => setField(gate.id, f.name, e.target.value)}
                            placeholder={f.label}
                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600"
                            rows={2}
                          />
                        ) : (
                          <input
                            value={formState[gate.id]?.[f.name] ?? ""}
                            onChange={(e) => setField(gate.id, f.name, e.target.value)}
                            placeholder={f.label}
                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <button onClick={() => submitGate(gate)} className="mt-3 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg">
                    Submit decision
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Recommendations</h2>
        {loading && [1, 2, 3].map((i) => <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse mb-3" />)}
        {!loading && visible.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <p className="text-sm">No {showAll ? "" : "open "}recommendations.</p>
            <p className="text-xs mt-1">Run a risk scan to surface slip-risk, stalled, and aging deals.</p>
          </div>
        )}
        <div className="space-y-3">
          {visible.map((rec) => {
            const meta = KIND_META[rec.kind] ?? KIND_META.next_best_action;
            return (
              <div key={rec.rec_id} className={`border rounded-xl p-4 ${meta.accent}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <span className="text-lg leading-none">{meta.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{rec.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{rec.body}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/5 text-slate-400">{meta.label}</span>
                </div>
                {rec.status === "OPEN" ? (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {rec.opportunity_id && (
                      <button
                        onClick={() => setDispatchFor({ opportunityId: rec.opportunity_id, dealName: rec.title })}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 text-white inline-flex items-center gap-1"
                      >
                        ✉ Dispatch Followup
                      </button>
                    )}
                    <button onClick={() => setStatus(rec, "ACTED")} className="text-[11px] font-semibold px-2.5 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 text-white">Act</button>
                    <button onClick={() => setStatus(rec, "SNOOZED")} className="text-[11px] font-semibold px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300">Snooze</button>
                    <button onClick={() => setStatus(rec, "DISMISSED")} className="text-[11px] font-semibold px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-400">Dismiss</button>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-600 mt-2">Status: {rec.status}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {dispatchFor && (
        <OutboundBreakpoint
          opportunityId={dispatchFor.opportunityId}
          dealName={dispatchFor.dealName}
          onClose={() => setDispatchFor(null)}
          onDispatched={() => fetchAll()}
        />
      )}
    </div>
  );
}
