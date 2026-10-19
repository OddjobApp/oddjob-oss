"use client";

import { useState } from "react";
import { Terminal, Play, Loader2 } from "lucide-react";

export default function SimulationArenaContent() {
  const [promptInput, setPromptInput] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [logsA, setLogsA] = useState<string[]>([]);
  const [logsB, setLogsB] = useState<string[]>([]);

  const runSimulation = () => {
    if (!promptInput.trim()) return;
    setSimulating(true);
    setLogsA([]);
    setLogsB([]);

    // Mock streaming logs
    const linesA = [
      "[10:04:12] [Agent v1.0] Received prompt.",
      "[10:04:13] [Agent v1.0] Calling tool `search_kb`...",
      "[10:04:15] [Agent v1.0] Tool returned 4 results.",
      "[10:04:16] [Agent v1.0] Generating response...",
      "[10:04:18] [Agent v1.0] Completed successfully."
    ];
    
    const linesB = [
      "[10:04:12] [Agent v1.1] Received prompt.",
      "[10:04:12] [Agent v1.1] Extracting entities for fast query...",
      "[10:04:13] [Agent v1.1] Calling tool `search_kb_optimized`...",
      "[10:04:14] [Agent v1.1] Tool returned 4 results. Filtering noise.",
      "[10:04:15] [Agent v1.1] Generating precise response...",
      "[10:04:16] [Agent v1.1] Completed successfully (2s faster)."
    ];

    let step = 0;
    const interval = setInterval(() => {
      if (step < linesA.length) {
        setLogsA(prev => [...prev, linesA[step]]);
      }
      if (step < linesB.length) {
        setLogsB(prev => [...prev, linesB[step]]);
      }
      step++;
      if (step >= Math.max(linesA.length, linesB.length)) {
        clearInterval(interval);
        setSimulating(false);
      }
    }, 800);
  };

  return (
    <div className="min-h-screen bg-[#090d16] p-6 text-slate-300">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          ⚔️ Simulation Arena
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Pit two agent versions against each other in real-time to observe differing behaviors.
        </p>
      </header>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
        <label className="block text-xs font-bold uppercase tracking-widest text-emerald-400 mb-2">
          Test Prompt
        </label>
        <div className="flex gap-3">
          <input 
            type="text" 
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder="Enter a prompt to issue to both agents..."
            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
            onKeyDown={(e) => e.key === 'Enter' && runSimulation()}
          />
          <button 
            onClick={runSimulation}
            disabled={simulating || !promptInput.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-bold px-6 py-2 rounded-lg flex items-center gap-2"
          >
            {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Simulation
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agent A */}
        <div className="bg-[#0d1117] border border-white/10 rounded-xl overflow-hidden flex flex-col h-[500px]">
          <div className="bg-[#161b22] border-b border-white/10 p-3 flex justify-between items-center">
            <select className="bg-black/20 border border-white/5 rounded text-sm text-white px-2 py-1">
              <option>Agent v1.0 (Production)</option>
              <option>Agent v0.9 (Legacy)</option>
            </select>
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <Terminal className="w-3 h-3" /> Console
            </span>
          </div>
          <div className="p-4 font-mono text-[11px] overflow-y-auto flex-1">
            {logsA.length === 0 && !simulating && <p className="text-slate-600">Waiting for simulation...</p>}
            {logsA.map((log, i) => (
              <div key={i} className="mb-1 text-slate-300">
                <span className="text-slate-500 mr-2">{log.substring(0, 10)}</span>
                {log.substring(10)}
              </div>
            ))}
          </div>
        </div>

        {/* Agent B */}
        <div className="bg-[#0d1117] border border-white/10 rounded-xl overflow-hidden flex flex-col h-[500px]">
          <div className="bg-[#161b22] border-b border-white/10 p-3 flex justify-between items-center">
            <select className="bg-black/20 border border-white/5 rounded text-sm text-white px-2 py-1">
              <option>Agent v1.1 (Candidate)</option>
              <option>Agent v1.2-beta</option>
            </select>
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <Terminal className="w-3 h-3" /> Console
            </span>
          </div>
          <div className="p-4 font-mono text-[11px] overflow-y-auto flex-1">
            {logsB.length === 0 && !simulating && <p className="text-slate-600">Waiting for simulation...</p>}
            {logsB.map((log, i) => (
              <div key={i} className="mb-1 text-emerald-400/90">
                <span className="text-slate-500 mr-2">{log.substring(0, 10)}</span>
                {log.substring(10)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
