"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Collections, QualityReport, records } from "../../lib/platform-client";

export default function MetricsContent() {
  const [reports, setReports] = useState<QualityReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await records.list(Collections.qualityReports);
      setReports(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load quality reports");
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const total = reports.length;
    if (total === 0) {
      return { total: 0, passRate: 0, avgFixAttempts: 0, avgMutation: 0, prCount: 0 };
    }
    const passed = reports.filter((r) => r.gate_passed).length;
    const fixAttempts = reports.reduce((s, r) => s + (r.fix_attempts ?? 0), 0);
    const mutationVals = reports
      .map((r) => r.mutation_score)
      .filter((v): v is number => typeof v === "number");
    const avgMutation =
      mutationVals.length > 0
        ? mutationVals.reduce((s, v) => s + v, 0) / mutationVals.length
        : 0;
    const prCount = reports.filter((r) => !!r.pr_url).length;
    return {
      total,
      passRate: (passed / total) * 100,
      avgFixAttempts: fixAttempts / total,
      avgMutation: avgMutation * (avgMutation <= 1 ? 100 : 1),
      prCount,
    };
  }, [reports]);

  const sorted = useMemo(
    () =>
      [...reports].sort(
        (a, b) =>
          new Date(b.created_at ?? b._createdAt ?? 0).getTime() -
          new Date(a.created_at ?? a._createdAt ?? 0).getTime(),
      ),
    [reports],
  );

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Quality Metrics &amp; Reporting
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Aggregate outcomes across autonomous pipeline runs.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
        >
          Refresh
        </button>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Quality-gate pass rate" value={`${stats.passRate.toFixed(0)}%`} accent="text-emerald-400" />
        <Stat label="Avg. fix attempts" value={stats.avgFixAttempts.toFixed(1)} accent="text-blue-400" />
        <Stat label="Avg. mutation score" value={`${stats.avgMutation.toFixed(0)}%`} accent="text-violet-400" />
        <Stat label="PRs generated" value={String(stats.prCount)} accent="text-amber-400" />
      </section>

      {loading ? (
        <p className="text-sm text-slate-500">Loading reports…</p>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.01] px-6 py-16 text-center">
          <p className="text-sm font-medium text-slate-300">No quality reports yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Reports are produced when a pipeline session reaches its quality gate.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Session</th>
                <th className="px-4 py-3 font-medium">Gate</th>
                <th className="px-4 py-3 font-medium">Fix attempts</th>
                <th className="px-4 py-3 font-medium">Mutation</th>
                <th className="px-4 py-3 font-medium">Verification</th>
                <th className="px-4 py-3 font-medium">PR</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-200">
                    {r.session_id ?? r.id}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        r.gate_passed
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {r.gate_passed ? "passed" : "failed"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{r.fix_attempts ?? 0}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {typeof r.mutation_score === "number"
                      ? `${(r.mutation_score <= 1 ? r.mutation_score * 100 : r.mutation_score).toFixed(0)}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{r.verification_level ?? "—"}</td>
                  <td className="px-4 py-3">
                    {r.pr_url ? (
                      <a
                        href={r.pr_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}
