import React from "react";
import { AlertOctagon, ArrowUpRight, TrendingDown } from "lucide-react";
import type { BacklogRecord, BlockerRecord } from "../lib/collections";

interface Props {
  sprintNumber: number;
  blockers: BlockerRecord[];
  committedRecords: BacklogRecord[];
}

export function BottleneckAnalysisWidget({ sprintNumber, blockers, committedRecords }: Props) {
  // Mock data for bottleneck analysis
  const bottlenecks = [
    { id: "API-Gateway", type: "Infrastructure", impact: "High", delay: "2.5 days", reason: "Pending security review" },
    { id: "User-Auth-Service", type: "Code Review", impact: "Medium", delay: "1.2 days", reason: "Agent workload saturated" },
    { id: "Database-Migration", type: "Dependency", impact: "Low", delay: "0.5 days", reason: "Waiting on upstream team" }
  ];

  return (
    <div className="bg-[#15121e]/40 border border-white/5 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-rose-400" />
          <h3 className="text-sm font-semibold text-slate-200">Bottleneck Analysis</h3>
        </div>
        <div className="px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-xs font-semibold text-rose-400">
          {bottlenecks.length} Active
        </div>
      </div>

      <div className="space-y-3">
        {bottlenecks.map(b => (
          <div key={b.id} className="p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors">
            <div className="flex justify-between items-start mb-1">
              <span className="font-semibold text-sm text-slate-200">{b.id}</span>
              <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${b.impact === 'High' ? 'bg-rose-500/20 text-rose-400' : b.impact === 'Medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {b.impact} Impact
              </span>
            </div>
            
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" /> Delay: {b.delay}
            </div>
            
            <p className="text-xs text-slate-300"><strong>Reason:</strong> {b.reason}</p>
          </div>
        ))}
      </div>
      
      <button className="w-full py-2 flex items-center justify-center gap-2 text-xs font-semibold text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-lg transition-colors">
        View Detailed Bottleneck Report <ArrowUpRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
