import React, { useState } from 'react';
import { Activity, Bot, AlertTriangle, ShieldCheck, Play, CheckCircle2 } from 'lucide-react';

export function IncidentTriagerWidget() {
  const [mitigating, setMitigating] = useState(false);
  const [resolved, setResolved] = useState(false);

  const handleMitigate = () => {
    setMitigating(true);
    setTimeout(() => {
      setMitigating(false);
      setResolved(true);
    }, 2500);
  };

  return (
    <div className="bg-[#111827]/40 border border-white/5 rounded-xl overflow-hidden shadow-lg">
      <div className="px-6 py-5 border-b border-white/5 bg-[#0d1117] flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 text-rose-400 mb-1">
            <Activity className="w-5 h-5" />
            <h3 className="font-bold text-lg">INC-893: High Latency on Order API</h3>
          </div>
          <p className="text-xs text-slate-400">
            PagerDuty Alert triggered 2 minutes ago. Agent has diagnosed the issue.
          </p>
        </div>
        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${resolved ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
          {resolved ? 'Resolved' : 'Critical (Active)'}
        </span>
      </div>
      
      <div className="p-6 space-y-6">
        {/* Agent Analysis */}
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-5">
          <h4 className="text-sm font-bold text-blue-300 flex items-center gap-2 mb-3">
            <Bot className="w-4 h-4" /> Agent Root Cause Analysis
          </h4>
          <p className="text-sm text-slate-300 mb-4">
            I ingested logs from <code className="bg-black/30 px-1 rounded text-blue-200">production-order-svc</code> and cross-referenced with Datadog APM traces. 
            The database connection pool is exhausted (498/500 connections active), causing requests to queue and timeout. 
            This matches the signature of Runbook <code className="bg-black/30 px-1 rounded text-blue-200">RB-DB-04: Connection Pool Exhaustion</code>.
          </p>
          
          <div className="bg-black/40 border border-white/5 rounded p-3 font-mono text-xs text-slate-400 mb-4 overflow-x-auto">
            > select count(*) from pg_stat_activity where state = 'active';<br/>
            <span className="text-orange-400 font-bold">Result: 498 (Max: 500)</span>
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-4">
            <h5 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Proposed Mitigation
            </h5>
            <p className="text-xs text-emerald-200/80 mb-3">
              Safely recycle idle connections via PgBouncer and temporarily scale up replicas to absorb the backlog.
            </p>
            <div className="bg-black/30 p-2 rounded text-[10px] font-mono text-emerald-300">
              $ kubectl scale deployment order-api --replicas=5<br/>
              $ pgbouncer -c "RELOAD;"
            </div>
            
            <div className="mt-4 flex justify-end">
              {resolved ? (
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold bg-emerald-500/20 px-4 py-2 rounded-lg border border-emerald-500/30">
                  <CheckCircle2 className="w-4 h-4" /> Mitigation Applied Successfully
                </div>
              ) : (
                <button 
                  onClick={handleMitigate}
                  disabled={mitigating}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-emerald-900/20"
                >
                  {mitigating ? (
                    <>Executing Runbook...</>
                  ) : (
                    <><Play className="w-4 h-4" /> 1-Click Mitigate (Execute Runbook)</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
