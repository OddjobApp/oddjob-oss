"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, ComposedChart, Legend,
} from "recharts";
import {
  records,
  FinanceCollections,
  fmtCurrency,
  type FinanceAccount,
  type AccountType,
} from "../../lib/platform-client";

const LIABILITY: AccountType[] = ["CREDIT_CARD", "LOAN_LIABILITY"];

interface ProjPoint {
  year: number;
  nominal: number;
  real: number;
  low: number;
  high: number;
  band: [number, number];
}

function project(
  start: number,
  annualContribution: number,
  nominalReturn: number,
  inflation: number,
  volatility: number,
  years: number,
): ProjPoint[] {
  const out: ProjPoint[] = [];
  let nominal = start;
  let low = start;
  let high = start;
  for (let y = 0; y <= years; y++) {
    if (y > 0) {
      nominal = nominal * (1 + nominalReturn) + annualContribution;
      low = low * (1 + nominalReturn - volatility) + annualContribution;
      high = high * (1 + nominalReturn + volatility) + annualContribution;
    }
    const real = nominal / Math.pow(1 + inflation, y);
    out.push({
      year: new Date().getFullYear() + y,
      nominal: Math.round(nominal),
      real: Math.round(real),
      low: Math.round(Math.max(0, low)),
      high: Math.round(high),
      band: [Math.round(Math.max(0, low)), Math.round(high)],
    });
  }
  return out;
}

export default function ForecastContent() {
  const [startNetWorth, setStartNetWorth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // assumptions
  const [contribution, setContribution] = useState(24000);
  const [nominalReturn, setNominalReturn] = useState(0.07);
  const [inflation, setInflation] = useState(0.03);
  const [volatility, setVolatility] = useState(0.04);
  const [years] = useState(40);

  const fetchNetWorth = useCallback(async () => {
    try {
      const accounts = (await records.list(FinanceCollections.accounts)) as FinanceAccount[];
      let nw = 0;
      for (const a of accounts) {
        nw += LIABILITY.includes(a.account_type) ? -Math.abs(a.current_balance || 0) : (a.current_balance || 0);
      }
      setStartNetWorth(nw);
    } catch {
      setStartNetWorth(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchNetWorth(); }, [fetchNetWorth]);

  const data = useMemo(
    () => project(startNetWorth ?? 0, contribution, nominalReturn, inflation, volatility, years),
    [startNetWorth, contribution, nominalReturn, inflation, volatility, years],
  );

  const terminal = data[data.length - 1];

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📈</span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Net Worth Forecast</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {years}-year nominal vs inflation-adjusted projection with a volatility band.
              </p>
            </div>
          </div>
        </div>

        {/* Assumption controls */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
          <Slider label="Annual contribution" value={contribution} min={0} max={120000} step={1000}
            onChange={setContribution} fmt={(v) => fmtCurrency(v)} />
          <Slider label="Nominal return" value={nominalReturn} min={0} max={0.15} step={0.005}
            onChange={setNominalReturn} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
          <Slider label="Inflation" value={inflation} min={0} max={0.1} step={0.005}
            onChange={setInflation} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
          <Slider label="Volatility (±)" value={volatility} min={0} max={0.12} step={0.005}
            onChange={setVolatility} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
        </div>

        {/* Terminal KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Starting net worth</p>
            <p className="text-xl font-bold mt-1 font-mono">{loading ? "…" : fmtCurrency(startNetWorth ?? 0)}</p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-emerald-400/80 font-semibold">Nominal @ {terminal.year}</p>
            <p className="text-xl font-bold mt-1 font-mono text-emerald-300">{fmtCurrency(terminal.nominal)}</p>
          </div>
          <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-cyan-400/80 font-semibold">Inflation-adjusted @ {terminal.year}</p>
            <p className="text-xl font-bold mt-1 font-mono text-cyan-300">{fmtCurrency(terminal.real)}</p>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="year" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [fmtCurrency(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="high" stackId="band" stroke="none" fill="#34d39922" name="Volatility high" />
              <Area type="monotone" dataKey="low" stackId="bandlow" stroke="none" fill="#09111a" name="Volatility low" />
              <Line type="monotone" dataKey="nominal" stroke="#34d399" strokeWidth={2} dot={false} name="Nominal" />
              <Line type="monotone" dataKey="real" stroke="#22d3ee" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Inflation-adjusted" />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-slate-600 mt-2">
            Projection is illustrative — deterministic compounding around a ±volatility band, not investment advice.
          </p>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label, value, min, max, step, onChange, fmt,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt: (v: number) => string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-slate-400 font-medium">{label}</span>
        <span className="text-xs font-mono text-emerald-300">{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        title={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </div>
  );
}
