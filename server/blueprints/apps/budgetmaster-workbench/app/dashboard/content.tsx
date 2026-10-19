"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid,
} from "recharts";
import {
  records,
  events,
  FinanceCollections,
  fmtCurrency,
  type Transaction,
  type FinanceAccount,
  type BalanceSnapshot,
  type AccountType,
} from "../../lib/platform-client";

const LIABILITY: AccountType[] = ["CREDIT_CARD", "LOAN_LIABILITY"];
const CAT_COLORS = ["#34d399", "#22d3ee", "#a78bfa", "#fbbf24", "#fb7185", "#60a5fa", "#f472b6", "#4ade80"];

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className={`rounded-xl p-4 border ${accent}`}>
      <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
      <p className="text-xl font-bold mt-1 font-mono">{value}</p>
    </div>
  );
}

export default function DashboardContent() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [snapshots, setSnapshots] = useState<BalanceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [t, a, s] = await Promise.all([
        records.list(FinanceCollections.transactions),
        records.list(FinanceCollections.accounts),
        records.list(FinanceCollections.balanceSnapshots),
      ]);
      setTxns(t as Transaction[]);
      setAccounts(a as FinanceAccount[]);
      setSnapshots(s as BalanceSnapshot[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
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

  const { netWorth, inflow, outflow } = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    for (const a of accounts) {
      if (LIABILITY.includes(a.account_type)) liabilities += Math.abs(a.current_balance || 0);
      else assets += a.current_balance || 0;
    }
    let inflow = 0;
    let outflow = 0;
    for (const t of txns) {
      if (t.parent_tx_id) continue;
      if (t.amount > 0) inflow += t.amount;
      else outflow += Math.abs(t.amount);
    }
    return { netWorth: assets - liabilities, inflow, outflow };
  }, [accounts, txns]);

  const spendByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of txns) {
      if (t.parent_tx_id || t.amount >= 0) continue;
      const cat = t.category_id ?? "uncategorized";
      map.set(cat, (map.get(cat) ?? 0) + Math.abs(t.amount));
    }
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [txns]);

  const netWorthTrend = useMemo(
    () =>
      [...snapshots]
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((s) => ({ period: s.period, netWorth: s.net_worth })),
    [snapshots],
  );

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📊</span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Wealth Dashboard</h1>
              <p className="text-xs text-slate-500 mt-0.5">Net worth, cashflow, and spend by category.</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 mb-4">{error}</div>
        )}

        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Kpi label="Net Worth" value={fmtCurrency(netWorth)} accent="bg-white/5 border-white/10" />
          <Kpi label="Inflow" value={fmtCurrency(inflow)} accent="bg-emerald-500/10 border-emerald-500/20 text-emerald-300" />
          <Kpi label="Outflow" value={fmtCurrency(outflow)} accent="bg-rose-500/10 border-rose-500/20 text-rose-300" />
          <Kpi label="Net Flow" value={fmtCurrency(inflow - outflow)} accent="bg-teal-500/10 border-teal-500/20 text-teal-300" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Spend by category */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-4">Spend by Category</h2>
            {loading ? (
              <div className="h-64 bg-white/5 rounded animate-pulse" />
            ) : spendByCategory.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-slate-500">No spend recorded yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={spendByCategory} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="category" stroke="#94a3b8" fontSize={11} width={90} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmtCurrency(v)}
                  />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {spendByCategory.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Net worth trend */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-4">Net Worth Trend (locked snapshots)</h2>
            {loading ? (
              <div className="h-64 bg-white/5 rounded animate-pulse" />
            ) : netWorthTrend.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-slate-500">
                No monthly snapshots locked yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={netWorthTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="period" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmtCurrency(v)}
                  />
                  <Line type="monotone" dataKey="netWorth" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
