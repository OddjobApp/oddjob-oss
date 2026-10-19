'use client'

import React, { useState } from 'react';
import { ShieldAlert, Play, CheckCircle2, ShieldCheck, Activity, Target, Shield, Skull } from 'lucide-react';
import Link from 'next/link';
import { WorkbenchShell } from '../components/WorkbenchShell';

export default function SimulationArena() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultsReady, setResultsReady] = useState(false);

  const startSimulation = () => {
    setRunning(true);
    setProgress(0);
    setResultsReady(false);
    
    let current = 0;
    const interval = setInterval(() => {
      current += 10;
      setProgress(current);
      if (current >= 100) {
        clearInterval(interval);
        setRunning(false);
        setResultsReady(true);
      }
    }, 400);
  };

  return (
    <WorkbenchShell title="Agentic Simulation Arena" tagline="Adversarial stress-testing for agents" badge="Arena">
      <div className="max-w-5xl mx-auto w-full px-6 py-10">
        
        {/* Header */}
        <div className="mb-10 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <ShieldAlert className="w-8 h-8 text-red-500" />
              <h1 className="text-3xl font-bold bg-gradient-to-r from-red-400 to-rose-400 bg-clip-text text-transparent">
                Agentic Simulation Arena
              </h1>
            </div>
            <p className="text-sm text-slate-400 max-w-2xl">
              Deploy your agents into a sandboxed environment where an adversarial AI generates edge-case scenarios, tricky user inputs, and rate-limit simulations to aggressively stress-test their resilience.
            </p>
          </div>
          <Link href="/" className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-semibold transition-colors">
            Back to Hub
          </Link>
        </div>

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div className="lg:col-span-2 space-y-6">
            
            <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6">
              <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2 mb-4">
                <Target className="w-5 h-5 text-red-400" /> Simulation Config
              </h2>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Target Agent</label>
                  <select className="w-full bg-slate-900 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-red-500">
                    <option>Customer Support Agent v2.4 (RC)</option>
                    <option>Sales Co-pilot v1.1</option>
                    <option>DevOps Mitigator v3.0</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Adversarial Suite</label>
                  <select className="w-full bg-slate-900 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-red-500">
                    <option>OWASP Prompt Injection Matrix</option>
                    <option>Chaos Engineering (Rate limits, 500s)</option>
                    <option>Aggressive / Toxic Persona Simulator</option>
                  </select>
                </div>
              </div>

              {!running && !resultsReady && (
                <button 
                  onClick={startSimulation}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-red-900/20"
                >
                  <Skull className="w-4 h-4" /> Release the Adversary
                </button>
              )}

              {running && (
                <div className="bg-black/30 border border-white/5 rounded-lg p-5 text-center">
                  <Activity className="w-8 h-8 text-red-500 animate-pulse mx-auto mb-3" />
                  <div className="text-sm font-bold text-red-400 mb-2">Simulation in Progress...</div>
                  <div className="w-full bg-slate-800 rounded-full h-2 mb-2 overflow-hidden">
                    <div className="bg-red-500 h-2 transition-all duration-300" style={{ width: `${progress}%` }}></div>
                  </div>
                  <div className="text-xs text-slate-500 font-mono">{progress}% Complete · Running Prompt Injection Suite</div>
                </div>
              )}

              {resultsReady && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                    <div>
                      <div className="font-bold text-emerald-300">Simulation Complete</div>
                      <div className="text-xs text-emerald-400/70">Agent successfully deflected 98% of adversarial attacks.</div>
                    </div>
                    <button 
                      onClick={() => setResultsReady(false)}
                      className="ml-auto px-3 py-1.5 bg-white/10 hover:bg-white/20 text-xs font-semibold rounded transition-colors"
                    >
                      Run Again
                    </button>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm bg-black/20 p-2 rounded">
                      <span className="text-slate-300">Direct Prompt Injection Deflection</span>
                      <span className="text-emerald-400 font-bold">100% (50/50)</span>
                    </div>
                    <div className="flex items-center justify-between text-sm bg-black/20 p-2 rounded">
                      <span className="text-slate-300">Roleplay Jailbreak Attempts</span>
                      <span className="text-amber-400 font-bold">92% (46/50)</span>
                    </div>
                    <div className="flex items-center justify-between text-sm bg-black/20 p-2 rounded">
                      <span className="text-slate-300">PII Extraction Attempts</span>
                      <span className="text-emerald-400 font-bold">100% (50/50)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400" /> Arena Stats
              </h3>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Simulations Run (All Time)</div>
                  <div className="text-2xl font-bold text-slate-200">1,204</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Average Deflection Rate</div>
                  <div className="text-2xl font-bold text-emerald-400">94.2%</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </WorkbenchShell>
  );
}
