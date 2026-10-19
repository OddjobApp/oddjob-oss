"use client";

import { useState, useEffect, useCallback } from "react";
import {
  records,
  events,
  telemetry,
  FinanceCollections,
  fmtCurrency,
  type FinanceRecommendation,
  type DeadMansSwitch,
  type Subscription,
  type RecommendationKind,
} from "../../lib/platform-client";

const KIND_META: Record<RecommendationKind, { icon: string; label: string; accent: string }> = {
  dms_fault: { icon: "🛑", label: "Dead Man's Switch Fault", accent: "border-rose-500/30 bg-rose-500/5" },
  sweep: { icon: "💵", label: "Idle Cash Sweep", accent: "border-emerald-500/30 bg-emerald-500/5" },
  quarantine: { icon: "🧊", label: "Subscription Quarantine", accent: "border-sky-500/30 bg-sky-500/5" },
  capex_overrun: { icon: "🏗️", label: "CapEx Overrun", accent: "border-amber-500/30 bg-amber-500/5" },
};

export default function AlertsContent() {
  const [recs, setRecs] = useState<FinanceRecommendation[]>([]);
  const [switches, setSwitches] = useState<DeadMansSwitch[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [r, d, s] = await Promise.all([
        records.list(FinanceCollections.recommendations),
        records.list(FinanceCollections.deadMansSwitches),
        records.list(FinanceCollections.subscriptions),
      ]);
      setRecs(r as FinanceRecommendation[]);
      setSwitches(d as DeadMansSwitch[]);
      setSubs(s as Subscription[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const unsub = events.subscribe((ev) => {
      if (["mission.completed", "dataset.updated", "recommendation.created"].includes(ev.type)) fetchAll();
    });
    return unsub;
  }, [fetchAll]);

  const resolve = async (rec: FinanceRecommendation, status: "approved" | "dismissed") => {
    setBusy(rec.rec_id);
    setRecs((prev) => prev.map((p) => (p.rec_id === rec.rec_id ? { ...p, status } : p)));
    try {
      await records.update(FinanceCollections.recommendations, rec.rec_id, { ...rec, status });
      telemetry.emit("recommendation_resolved", "info", { kind: rec.kind, status });
    } catch {
      fetchAll();
    } finally {
      setBusy(null);
    }
  };

  const openRecs = recs.filter((r) => (r.status ?? "open") === "open");
  const faults = switches.filter((s) => s.status === "FAULT");
  const armed = switches.filter((s) => s.status === "ARMED");
  const quarantined = subs.filter((s) => s.quarantine_flag);

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛡️</span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Alerts & Recommendations</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {openRecs.length} open · {faults.length} switch faults · {quarantined.length} quarantined subs.
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 mb-4">{error}</div>
        )}

        {/* Dead Man's Switch pane */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Dead Man's Switches</h2>
          {switches.length === 0 ? (
            <p className="text-xs text-slate-500">No switches armed.</p>
          ) : (
            <div className="space-y-2">
              {[...faults, ...armed].map((s) => (
                <div key={s.switch_id}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 border ${
                    s.status === "FAULT" ? "border-rose-500/30 bg-rose-500/5" : "border-white/10 bg-white/3"
                  }`}>
                  <div>
                    <p className="text-sm font-medium text-slate-100">{s.label}</p>
                    <p className="text-[10px] text-slate-500">
                      {s.expected_direction} ≥ {fmtCurrency(s.amount_floor)} · deadline {new Date(s.expiration_deadline).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    s.status === "FAULT" ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/15 text-emerald-400"
                  }`}>{s.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recommendations */}
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Open Recommendations</h2>
        {loading && <div className="h-20 bg-white/5 rounded-xl animate-pulse" />}
        {!loading && openRecs.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <p className="text-sm">✅ Nothing needs your attention.</p>
            <p className="text-xs mt-1">The automation engines will raise recommendations here when they fire.</p>
          </div>
        )}

        <div className="space-y-3">
          {openRecs.map((rec) => {
            const meta = KIND_META[rec.kind] ?? { icon: "•", label: rec.kind, accent: "border-white/10 bg-white/3" };
            return (
              <div key={rec.rec_id} className={`border rounded-xl p-4 ${meta.accent}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span>{meta.icon}</span>
                      <span className="text-sm font-semibold text-white">{rec.title}</span>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{meta.label}</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{rec.body}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => resolve(rec, "approved")}
                      disabled={busy === rec.rec_id}
                      className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => resolve(rec, "dismissed")}
                      disabled={busy === rec.rec_id}
                      className="px-3 py-1.5 text-xs font-semibold bg-white/8 hover:bg-white/12 border border-white/10 disabled:opacity-50 text-slate-300 rounded-lg"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
