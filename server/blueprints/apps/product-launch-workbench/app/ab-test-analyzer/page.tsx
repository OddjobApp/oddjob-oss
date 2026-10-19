'use client'

import { useState } from "react";
import { Sparkles, BarChart3, SplitSquareHorizontal, CheckCircle2, FlaskConical, LayoutTemplate } from "lucide-react";

export default function ABTestAnalyzer() {
  const [generating, setGenerating] = useState(false);
  const [variants, setVariants] = useState<any[]>([]);

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => {
      setVariants([
        { id: "A", name: "Value Proposition Focus", copy: "Maximize your cloud ROI instantly. Stop paying for idle resources with our automated teardown engine.", predictedCtr: 4.2, status: "Ready" },
        { id: "B", name: "Urgency/Risk Focus", copy: "Is your cloud budget leaking? Find and terminate orphaned instances before your next billing cycle.", predictedCtr: 3.8, status: "Ready" },
        { id: "C", name: "Developer Experience Focus", copy: "Automate your infrastructure hygiene. Agentic PRs keep your codebase clean and your budget in check.", predictedCtr: 5.1, status: "Recommended" },
      ]);
      setGenerating(false);
    }, 2500);
  };

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🧪</span>
            <h1 className="text-3xl font-bold tracking-tight">Agentic A/B Test Analyzer</h1>
          </div>
          <p className="text-sm text-slate-400 max-w-2xl">
            Provide your core product specs, and our autonomous agent will generate high-converting copy variations, 
            predict their success rates based on demographic data, and prepare them for your email or ad campaigns.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Input Panel */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
                <LayoutTemplate className="w-4 h-4 text-fuchsia-400" /> Campaign Parameters
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Product / Feature Name</label>
                  <input type="text" defaultValue="Cloud Waste Remediation" className="w-full bg-[#050707] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:border-fuchsia-500/50 outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Target Audience</label>
                  <select className="w-full bg-[#050707] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:border-fuchsia-500/50 outline-none">
                    <option>VP of Engineering</option>
                    <option>FinOps Leads</option>
                    <option>DevOps Engineers</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Key Value Prop</label>
                  <textarea defaultValue="Automated cost savings via agentic teardown PRs" rows={3} className="w-full bg-[#050707] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:border-fuchsia-500/50 outline-none resize-none" />
                </div>
                
                <button 
                  onClick={handleGenerate}
                  disabled={generating}
                  className="w-full py-2.5 bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-fuchsia-900/20"
                >
                  {generating ? (
                    <>Agent Brainstorming...</>
                  ) : (
                    <><Sparkles className="w-4 h-4" /> Generate Variations</>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-2">
            <div className="bg-[#0b1212]/40 border border-fuchsia-500/20 rounded-xl p-6 min-h-[500px]">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                  <SplitSquareHorizontal className="w-5 h-5 text-fuchsia-400" /> Generated Variants
                </h3>
                {variants.length > 0 && (
                  <button className="text-sm px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg font-semibold transition-colors flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Push to Optimizely
                  </button>
                )}
              </div>

              {variants.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <div className="w-16 h-16 rounded-full bg-fuchsia-500/10 flex items-center justify-center mb-4">
                    <FlaskConical className="w-8 h-8 text-fuchsia-400/50" />
                  </div>
                  <p className="text-slate-500 text-sm max-w-sm">
                    Configure your campaign parameters and generate variations. The agent will predict CTR based on historical performance data.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {variants.map(v => (
                    <div key={v.id} className={`p-5 rounded-xl border relative overflow-hidden ${v.status === 'Recommended' ? 'bg-fuchsia-500/5 border-fuchsia-500/30' : 'bg-white/5 border-white/10'}`}>
                      {v.status === 'Recommended' && (
                        <div className="absolute top-0 right-0 bg-gradient-to-r from-fuchsia-600 to-pink-600 text-xs font-bold px-3 py-1 rounded-bl-lg shadow-sm">
                          Highest Confidence
                        </div>
                      )}
                      
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold text-lg text-slate-200">Variant {v.id}</span>
                            <span className="text-xs text-slate-500 px-2 py-0.5 rounded bg-white/5">{v.name}</span>
                          </div>
                          <p className="text-sm text-slate-300 italic mb-4">"{v.copy}"</p>
                        </div>
                        
                        <div className="shrink-0 text-right">
                          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Predicted CTR</div>
                          <div className={`text-2xl font-bold flex items-center gap-2 justify-end ${v.status === 'Recommended' ? 'text-fuchsia-400' : 'text-slate-300'}`}>
                            {v.predictedCtr}% <BarChart3 className="w-5 h-5 opacity-50" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
