"use client";
import { useState, useEffect } from "react";
import { useWorkbenchContext, isEmbedded, triggerCycle } from "../lib/workbench-sdk";
import { fleet, launch, predictions } from "../lib/platform-client";
import type { FleetWorkload, LaunchReadiness, PredictionResult } from "../lib/platform-client";

const MODULES = [
  { id: "launch-command-center", name: "Launch Command Center", icon: "🚀", color: "from-violet-500/20 to-purple-500/20", border: "border-violet-500/30", href: "/launch-command-center", desc: "Readiness score, timeline, cross-functional status" },
  { id: "market-research", name: "Market Research", icon: "🔍", color: "from-indigo-500/20 to-blue-500/20", border: "border-indigo-500/30", href: "/market-research", desc: "Competitive analysis, personas, market sizing" },
  { id: "content-studio", name: "Content Studio", icon: "✍️", color: "from-pink-500/20 to-rose-500/20", border: "border-pink-500/30", href: "/content-studio", desc: "Copy, blogs, emails, social, press releases" },
  { id: "sales-enablement", name: "Sales Enablement Hub", icon: "🎓", color: "from-amber-500/20 to-yellow-500/20", border: "border-amber-500/30", href: "/sales-enablement", desc: "Playbooks, battle cards, demo scripts, training" },
  { id: "feedback-insights", name: "Feedback & Insights", icon: "📊", color: "from-cyan-500/20 to-teal-500/20", border: "border-cyan-500/30", href: "/feedback-insights", desc: "Beta feedback, NPS, sentiment, iteration priorities" },
  { id: "ab-test-analyzer", name: "Agentic A/B Test Analyzer", icon: "🧪", color: "from-fuchsia-500/20 to-pink-500/20", border: "border-fuchsia-500/30", href: "/ab-test-analyzer", desc: "Autonomous marketing copy generation, success prediction, and A/B test preparation" },
];

export default function HubContent() {
  // Force recompile
  const workbenchCtx = useWorkbenchContext();
  const embedded = isEmbedded();
  const [workload, setWorkload] = useState<FleetWorkload | null>(null);
  const [readinessData, setReadinessData] = useState<LaunchReadiness | null>(null);
  const [riskPrediction, setRiskPrediction] = useState<PredictionResult | null>(null);

  useEffect(() => {
    fleet.workload().then(setWorkload).catch(() => {});
    launch.readiness().then(setReadinessData).catch(() => {});
    predictions.riskScore().then(setRiskPrediction).catch(() => {});
  }, []);

  const summary = workload?.summary ?? { active: 0, blocked: 0, idle: 0, completed: 0, tokenSpendUsd: 0 };
  const readiness = readinessData?.overall ?? 0;

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <span className="text-3xl">🚀</span>
          <div>
            <h1 className="text-2xl font-bold">Product Launch Workbench</h1>
            <p className="text-sm text-slate-400">Cross-functional launch management powered by AI agents</p>
          </div>
          {embedded && (
            <button
              type="button"
              onClick={() => triggerCycle("Product Launch Workbench requested a fresh run", { source: "product-launch-hub" })}
              className="ml-auto rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15"
            >
              Run cycle
            </button>
          )}
        </div>

        {/* Readiness metrics */}
        <div className="grid grid-cols-6 gap-3 mb-8">
          {[
            { label: "Readiness", value: `${readiness}%`, color: readiness >= 80 ? "text-emerald-400" : readiness >= 50 ? "text-amber-400" : "text-rose-400" },
            { label: "Risk", value: riskPrediction?.prediction?.replace(" RISK", "") || "—", color: riskPrediction?.prediction === "LOW RISK" ? "text-emerald-400" : riskPrediction?.prediction === "MODERATE RISK" ? "text-amber-400" : "text-rose-400" },
            { label: "Active Agents", value: summary.active, color: "text-blue-400" },
            { label: "Blocked", value: summary.blocked, color: "text-rose-400" },
            { label: "Completed", value: summary.completed, color: "text-emerald-400" },
            { label: "Spend", value: `$${(summary.tokenSpendUsd ?? 0).toFixed(2)}`, color: "text-violet-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
              <div className={`text-xl font-bold ${color}`}>{value}</div>
              <div className="text-[10px] text-slate-500 uppercase">{label}</div>
            </div>
          ))}
        </div>

        {/* Module cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map(mod => (
            <div 
              key={mod.id} 
              onClick={() => {
                const base = window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname + '/';
                window.location.href = base + mod.id;
              }}
              className={`block p-5 rounded-xl bg-gradient-to-br ${mod.color} border ${mod.border} hover:scale-[1.02] transition-transform cursor-pointer`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{mod.icon}</span>
                <h2 className="text-sm font-semibold text-white">{mod.name}</h2>
              </div>
              <p className="text-xs text-slate-400">{mod.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
