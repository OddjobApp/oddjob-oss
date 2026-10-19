"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, Legend,
} from "recharts";
import {
  records,
  events,
  missions,
  telemetry,
  SalesCollections,
  fmtCurrency,
  type Opportunity,
  type OpportunityWindow,
  type WindowSnapshot,
  type Forecast,
  type Quota,
} from "../../lib/platform-client";

const STAGE_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#fb923c"];

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className={`rounded-xl p-4 border ${accent}`}>
      <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
      <p className="text-xl font-bold mt-1 font-mono">{value}</p>
    </div>
  );
}

export default function ForecastContent() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [windows, setWindows] = useState<OpportunityWindow[]>([]);
  const [snapshots, setSnapshots] = useState<WindowSnapshot[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [o, w, s, f, q] = await Promise.all([
        records.list(SalesCollections.opportunities),
        records.list(SalesCollections.opportunityWindows),
        records.list(SalesCollections.windowSnapshots),
        records.list(SalesCollections.forecasts),
        records.list(SalesCollections.quotas),
      ]);
      setOpps(o as Opportunity[]);
      setWindows(w as OpportunityWindow[]);
      setSnapshots(s as WindowSnapshot[]);
      setForecasts(f as Forecast[]);
      setQuotas(q as Quota[]);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load forecast");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const unsub = events.subscribe((ev) => {
      if (["mission.completed", "dataset.updated"].includes(ev.type)) fetchAll();
    });
    return unsub;
  }, [fetchAll]);

  const stageByOpp = useMemo(() => new Map(opps.map((o) => [o.opportunity_id, o.stage])), [opps]);

  // Live rollup from window ceilings (mirrors forecast_rollup).
  const live = useMemo(() => windows.filter((w) => w.status === "ARMED" || w.status === "DECAYING"), [windows]);
  const rollup = useMemo(() => {
    let weighted = 0, committed = 0, best = 0;
    for (const w of live) {
      weighted += (w.amount * w.current_ceiling) / 100;
      best += w.amount;
      if (w.current_ceiling >= 90) committed += (w.amount * w.current_ceiling) / 100;
    }
    return { weighted: Math.round(weighted), committed: Math.round(committed), best: Math.round(best), count: live.length };
  }, [live]);

  const latestForecast = useMemo(
    () => [...forecasts].sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime())[0] ?? null,
    [forecasts],
  );

  const weightedByStage = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of live) {
      const stage = stageByOpp.get(w.opportunity_id) ?? "UNKNOWN";
      m.set(stage, (m.get(stage) ?? 0) + (w.amount * w.current_ceiling) / 100);
    }
    return Array.from(m.entries()).map(([stage, weighted]) => ({ stage, weighted: Math.round(weighted) }));
  }, [live, stageByOpp]);

  // Gate calibration: realized win-rate per rung vs stated ceiling.
  const calibration = useMemo(() => {
    const byRung = new Map<number, { wins: number; total: number }>();
    for (const s of snapshots) {
      if (s.realized_outcome == null) continue;
      const rung = s.ceiling_after;
      if (rung <= 0 || rung >= 100) continue;
      const b = byRung.get(rung) ?? { wins: 0, total: 0 };
      b.total++;
      if ((s.realized_outcome ?? 0) >= 100) b.wins++;
      byRung.set(rung, b);
    }
    return Array.from(byRung.entries())
      .map(([rung, { wins, total }]) => ({
        rung: `${rung}%`,
        stated: rung,
        realized: Math.round((wins / total) * 100),
        cohort: total,
      }))
      .sort((a, b) => b.stated - a.stated);
  }, [snapshots]);

  const runForecast = async () => {
    try {
      await missions.trigger("Generate Revenue Forecast");
      setNotice("Forecast generation requested.");
      telemetry.emit("forecast_requested", "info");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to trigger forecast");
    }
  };

  const publishForecast = async () => {
    try {
      await missions.trigger("Publish Forecast");
      setNotice("Forecast routed to the Forecast Review gate.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to publish forecast");
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold rounded bg-indigo-500/10 text-indigo-300 px-2 py-1">FC</span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Forecast &amp; Gate Calibration</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Live weighted pipeline from window ceilings{latestForecast ? ` - last forecast ${new Date(latestForecast.generated_at).toLocaleDateString()}` : ""}.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={runForecast} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg">Run forecast</button>
            <button onClick={publishForecast} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold rounded-lg">Publish</button>
          </div>
        </div>

        {error && <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 mb-4">{error}</div>}
        {notice && <div className="text-sm text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 mb-4">{notice}</div>}

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Kpi label="Committed" value={fmtCurrency(rollup.committed)} accent="bg-emerald-500/10 border-emerald-500/20 text-emerald-300" />
          <Kpi label="Weighted Pipeline" value={fmtCurrency(rollup.weighted)} accent="bg-indigo-500/10 border-indigo-500/20 text-indigo-300" />
          <Kpi label="Best Case" value={fmtCurrency(rollup.best)} accent="bg-white/5 border-white/10" />
          <Kpi label="Live Deals" value={String(rollup.count)} accent="bg-white/5 border-white/10" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Weighted by stage */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-4">Weighted Pipeline by Stage</h2>
            {loading ? (
              <div className="h-64 bg-white/5 rounded animate-pulse" />
            ) : weightedByStage.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-slate-500">No live windows yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={weightedByStage} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="stage" stroke="#94a3b8" fontSize={11} width={90} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => fmtCurrency(v)} />
                  <Bar dataKey="weighted" radius={[0, 4, 4, 0]}>
                    {weightedByStage.map((_, i) => <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Gate calibration */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-4">Gate Calibration - stated vs realized win-rate</h2>
            {loading ? (
              <div className="h-64 bg-white/5 rounded animate-pulse" />
            ) : calibration.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-slate-500 text-center px-4">
                No labelled snapshots yet. Calibration appears once deals close and the win/loss reconcile backfills outcomes.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={calibration}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="rung" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `${v}%`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="stated" name="Stated" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="realized" name="Realized" fill="#34d399" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Quota attainment */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mt-6">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Quota Attainment</h2>
          {quotas.length === 0 ? (
            <p className="text-xs text-slate-600">No quotas set for this period.</p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-slate-400">
                  <th className="text-left font-semibold p-2 border-b border-white/10">Owner</th>
                  <th className="text-left font-semibold p-2 border-b border-white/10">Period</th>
                  <th className="text-right font-semibold p-2 border-b border-white/10">Target</th>
                  <th className="text-right font-semibold p-2 border-b border-white/10">Attainment</th>
                </tr>
              </thead>
              <tbody>
                {quotas.map((q) => (
                  <tr key={q.quota_id}>
                    <td className="p-2 border-b border-white/5 text-slate-300">{q.owner_rep}</td>
                    <td className="p-2 border-b border-white/5 text-slate-400">{q.period}</td>
                    <td className="p-2 border-b border-white/5 text-right font-mono text-slate-300">{fmtCurrency(q.target_amount)}</td>
                    <td className="p-2 border-b border-white/5 text-right font-mono text-emerald-300">{q.attainment != null ? `${Math.round(q.attainment)}%` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
