'use client'

import { useState } from "react";
import { MessageSquare, Target, Mail, ArrowRight, Bot, TrendingUp } from "lucide-react";

export default function DealCoach() {
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState("");

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => {
      setDraft("Hi Sarah,\n\nI understand that budget constraints are a primary concern for the Q3 rollout. Based on our last discussion, I've reviewed our proposal and identified a flexible licensing model that defers 30% of the upfront cost until Q4, aligning perfectly with your fiscal calendar.\n\nWould you have 10 minutes on Thursday to review this updated structure? I'm confident it addresses the board's concerns while keeping the project timeline intact.\n\nBest,\n[Your Name]");
      setGenerating(false);
    }, 2500);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🎯</span>
            <h1 className="text-3xl font-bold tracking-tight">Autonomous Deal Coach</h1>
          </div>
          <p className="text-sm text-slate-400 max-w-2xl">
            Select an opportunity to have the AI agent analyze recent communication threads, identify hidden buyer objections, 
            and generate a tailored closing strategy.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
          {/* Sidebar */}
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3">At-Risk Opportunities</h3>
              <div className="space-y-2">
                <button className="w-full text-left px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30">
                  <div className="font-semibold text-blue-300 text-sm">Acme Corp Enterprise</div>
                  <div className="text-xs text-slate-400 mt-1">Stalled for 14 days</div>
                </button>
                <button className="w-full text-left px-3 py-2 rounded-lg bg-white/5 border border-transparent hover:bg-white/10 transition-colors">
                  <div className="font-semibold text-slate-200 text-sm">Globex Expansion</div>
                  <div className="text-xs text-slate-400 mt-1">Pricing objection detected</div>
                </button>
              </div>
            </div>
            
            <div className="bg-[#0b1212]/40 border border-emerald-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-2">
                <TrendingUp className="w-4 h-4" /> Deal Likelihood
              </div>
              <div className="text-3xl font-bold text-white">42%</div>
              <p className="text-xs text-slate-400 mt-1">Predicted win probability based on sentiment analysis of recent calls.</p>
            </div>
          </div>

          {/* Main Content */}
          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2 mb-4">
                <Target className="w-5 h-5 text-blue-400" /> Objection Analysis: Acme Corp
              </h3>
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-white/[0.03] border border-white/5">
                  <h4 className="text-sm font-semibold text-slate-300 mb-2">Key Insights from Last Meeting (Oct 12)</h4>
                  <ul className="list-disc list-inside text-sm text-slate-400 space-y-1">
                    <li>Customer repeatedly mentioned Q3 budget freeze.</li>
                    <li>Technical champion is fully onboard, but CFO requires ROI proof.</li>
                    <li>Competitor X was mentioned regarding implementation speed.</li>
                  </ul>
                </div>
                
                <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <h4 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                    <Bot className="w-4 h-4" /> AI Recommended Strategy
                  </h4>
                  <p className="text-sm text-emerald-100/70">
                    Pivot the conversation from total cost to deferred payment terms. Highlight our implementation speed advantage over Competitor X to address the CFO's timeline concerns.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#0b1212]/40 border border-blue-500/20 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                  <Mail className="w-5 h-5 text-blue-400" /> Draft Follow-up
                </h3>
                <button 
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                >
                  {generating ? "Agent Thinking..." : "Autodraft Email"} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              
              <div className="w-full min-h-[200px] p-4 bg-[#050707] border border-white/10 rounded-lg text-sm text-slate-300 whitespace-pre-wrap font-mono">
                {draft || <span className="text-slate-600 italic">Click Autodraft to have the AI generate a tailored email based on the recommended strategy...</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
