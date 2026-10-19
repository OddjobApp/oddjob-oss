import React, { useState } from "react";
import { Coins, AlertTriangle, TrendingDown, PauseCircle, PlayCircle } from "lucide-react";

interface AgentPerformance {
  id: string;
  name: string;
  taskSuccessRate: number;
  tokenSpend: number;
  status: "Active" | "Paused (Runaway Spend)" | "Warning";
}

const initialData: AgentPerformance[] = [
  { id: "A-01", name: "Data Aggregator Alpha", taskSuccessRate: 98, tokenSpend: 15.2, status: "Active" },
  { id: "A-02", name: "Legacy System Sync", taskSuccessRate: 42, tokenSpend: 284.5, status: "Warning" },
  { id: "A-03", name: "Recursive Scraper", taskSuccessRate: 12, tokenSpend: 950.0, status: "Paused (Runaway Spend)" },
];

export function CostOptimizerWidget() {
  const [agents, setAgents] = useState<AgentPerformance[]>(initialData);

  const toggleStatus = (id: string) => {
    setAgents(agents.map(a => {
      if (a.id === id) {
        if (a.status.includes("Paused")) {
          return { ...a, status: "Active" };
        } else {
          return { ...a, status: "Paused (Runaway Spend)" };
        }
      }
      return a;
    }));
  };

  return (
    <div className="bg-[#15121e]/40 border border-white/5 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-teal-400" />
          <h3 className="text-lg font-bold text-slate-200">Autonomous Cost-Per-Outcome Optimizer</h3>
        </div>
        <div className="px-2 py-1 rounded bg-teal-500/10 border border-teal-500/20 text-xs text-teal-400 font-semibold flex items-center gap-1">
          <TrendingDown className="w-3.5 h-3.5" /> Savings Watchdog Active
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Automatically tracks token spend against task success rates. Halts agents stuck in loops or producing high failure rates.
      </p>

      <div className="space-y-3 mt-4">
        {agents.map(agent => (
          <div key={agent.id} className={`p-4 rounded-xl border flex items-center justify-between transition-colors ${agent.status.includes('Paused') ? 'bg-rose-500/10 border-rose-500/20' : agent.status === 'Warning' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-white/5 border-white/10'}`}>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-slate-200">{agent.name}</span>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${agent.status.includes('Paused') ? 'bg-rose-500/20 text-rose-400' : agent.status === 'Warning' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                  {agent.status}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs">
                <div>
                  <span className="text-slate-500">Success Rate: </span>
                  <span className={`font-mono ${agent.taskSuccessRate < 50 ? 'text-rose-400' : 'text-emerald-400'}`}>{agent.taskSuccessRate}%</span>
                </div>
                <div>
                  <span className="text-slate-500">Cycle Spend: </span>
                  <span className={`font-mono ${agent.tokenSpend > 200 ? 'text-rose-400' : 'text-slate-300'}`}>${agent.tokenSpend.toFixed(2)}</span>
                </div>
              </div>
            </div>
            
            <div className="shrink-0">
              <button 
                onClick={() => toggleStatus(agent.id)}
                className={`p-2 rounded-lg border transition-colors ${agent.status.includes('Paused') ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30' : 'bg-rose-500/20 border-rose-500/30 text-rose-400 hover:bg-rose-500/30'}`}
                title={agent.status.includes('Paused') ? 'Resume Agent' : 'Pause Agent'}
              >
                {agent.status.includes('Paused') ? <PlayCircle className="w-5 h-5" /> : <PauseCircle className="w-5 h-5" />}
              </button>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-4 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        <p className="text-xs text-indigo-300">
          The Watchdog Agent has saved an estimated <strong>$1,240.50</strong> this cycle by prematurely halting runaway loops and enforcing token-per-outcome thresholds.
        </p>
      </div>
    </div>
  );
}
