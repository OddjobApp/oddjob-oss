"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import {
  records,
  missions,
  events,
  telemetry,
  FinanceCollections,
  fmtCurrency,
  type PurchaseSandbox,
} from "../../lib/platform-client";

const SANDBOX_MISSION = "Capital Purchase Sandbox";

interface Row { month: number; payment: number; interest: number; principalPaid: number; balance: number }
interface Result {
  financed: number; monthlyPayment: number; totalPaid: number; totalInterest: number;
  opportunityCostOfDownPayment: number; trueCost: number; schedule: Row[];
}

/** Mirror of server amortization.service.ts so the sandbox previews instantly. */
function simulate(principal: number, downPayment: number, annualRate: number, termMonths: number, opportunityRate: number): Result {
  const financed = Math.max(0, principal - downPayment);
  const n = Math.max(1, Math.round(termMonths));
  const r = annualRate / 12;
  const round = (x: number) => Math.round(x * 100) / 100;
  const monthlyPayment = r === 0 ? financed / n : (financed * r) / (1 - Math.pow(1 + r, -n));
  const schedule: Row[] = [];
  let balance = financed;
  let totalInterest = 0;
  for (let month = 1; month <= n; month++) {
    const interest = balance * r;
    let principalPaid = monthlyPayment - interest;
    if (month === n) principalPaid = balance;
    balance = Math.max(0, balance - principalPaid);
    totalInterest += interest;
    schedule.push({ month, payment: round(interest + principalPaid), interest: round(interest), principalPaid: round(principalPaid), balance: round(balance) });
  }
  const opportunityCostOfDownPayment = downPayment * (Math.pow(1 + opportunityRate / 12, n) - 1);
  return {
    financed: round(financed),
    monthlyPayment: round(monthlyPayment),
    totalPaid: round(financed + totalInterest),
    totalInterest: round(totalInterest),
    opportunityCostOfDownPayment: round(opportunityCostOfDownPayment),
    trueCost: round(totalInterest + opportunityCostOfDownPayment),
    schedule,
  };
}

function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt: (v: number) => string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-slate-400 font-medium">{label}</span>
        <span className="text-xs font-mono text-violet-300">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} title={label}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-violet-500" />
    </div>
  );
}

export default function SandboxesContent() {
  const [label, setLabel] = useState("New Vehicle");
  const [principal, setPrincipal] = useState(40000);
  const [downPayment, setDownPayment] = useState(8000);
  const [annualRate, setAnnualRate] = useState(0.069);
  const [termMonths, setTermMonths] = useState(60);
  const [opportunityRate, setOpportunityRate] = useState(0.07);

  const [saved, setSaved] = useState<PurchaseSandbox[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const result = useMemo(
    () => simulate(principal, downPayment, annualRate, termMonths, opportunityRate),
    [principal, downPayment, annualRate, termMonths, opportunityRate],
  );

  const fetchSaved = useCallback(async () => {
    try {
      const s = await records.list(FinanceCollections.purchaseSandboxes);
      setSaved(s as PurchaseSandbox[]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchSaved();
    const unsub = events.subscribe((ev) => {
      if (["mission.completed", "dataset.updated"].includes(ev.type)) fetchSaved();
    });
    return unsub;
  }, [fetchSaved]);

  const runServerSim = async () => {
    setTriggering(true);
    setToast(null);
    try {
      await missions.trigger(SANDBOX_MISSION, {
        sandboxId: `sbx_${Date.now()}`,
        label, principal, downPayment, annualRate, termMonths, opportunityRate,
      });
      telemetry.emit("sandbox_mission_triggered", "info", { label });
      setToast("Server simulation queued — results will appear under Saved Scenarios.");
    } catch (e: unknown) {
      setToast(`Could not trigger mission: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧮</span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Capital Purchase Sandbox</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Model a financed purchase — see the true cost including the opportunity cost of your down payment.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controls */}
          <div className="space-y-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <span className="text-[11px] text-slate-400 font-medium">Label</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500" />
            </div>
            <Slider label="Purchase price" value={principal} min={1000} max={150000} step={1000} onChange={setPrincipal} fmt={fmtCurrency} />
            <Slider label="Down payment" value={downPayment} min={0} max={principal} step={500} onChange={setDownPayment} fmt={fmtCurrency} />
            <Slider label="APR" value={annualRate} min={0} max={0.25} step={0.001} onChange={setAnnualRate} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
            <Slider label="Term (months)" value={termMonths} min={6} max={120} step={6} onChange={setTermMonths} fmt={(v) => `${v} mo`} />
            <Slider label="Opportunity rate" value={opportunityRate} min={0} max={0.15} step={0.005} onChange={setOpportunityRate} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
            <button onClick={runServerSim} disabled={triggering}
              className="w-full px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
              {triggering ? "Queuing…" : "Run & Save Server Simulation"}
            </button>
            {toast && <p className="text-xs text-slate-400">{toast}</p>}
          </div>

          {/* Results */}
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Metric label="Financed" value={fmtCurrency(result.financed)} />
              <Metric label="Monthly payment" value={fmtCurrency(result.monthlyPayment)} accent="text-violet-300" />
              <Metric label="Total interest" value={fmtCurrency(result.totalInterest)} accent="text-amber-300" />
              <Metric label="Down-payment opp. cost" value={fmtCurrency(result.opportunityCostOfDownPayment)} accent="text-rose-300" />
              <Metric label="True cost" value={fmtCurrency(result.trueCost)} accent="text-rose-300" />
              <Metric label="Total paid" value={fmtCurrency(result.totalPaid)} />
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Balance Paydown</h2>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={result.schedule}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmtCurrency(v)} />
                  <Area type="monotone" dataKey="balance" stroke="#a78bfa" fill="#a78bfa22" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {saved.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-3">Saved Scenarios ({saved.length})</h2>
                <div className="space-y-2">
                  {saved.map((s) => (
                    <div key={s.sandbox_id} className="flex items-center justify-between text-xs bg-slate-950/40 border border-white/5 rounded-lg px-3 py-2">
                      <span className="font-medium text-slate-200">{s.label}</span>
                      <span className="font-mono text-slate-400">
                        {fmtCurrency(s.result?.monthlyPayment ?? 0)}/mo · true cost {fmtCurrency(s.result?.trueCost ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, accent = "text-white" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
      <p className={`text-base font-bold mt-1 font-mono ${accent}`}>{value}</p>
    </div>
  );
}
