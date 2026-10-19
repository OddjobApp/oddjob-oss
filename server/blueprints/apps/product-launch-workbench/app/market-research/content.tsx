"use client";
import { useState, useEffect } from "react";
import { records, confluence, missions, telemetry, knowledge, predictions } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";

export default function MarketResearchContent() {
  const [reports, setReports] = useState<any[]>([]);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [personas, setPersonas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"competitors" | "personas" | "reports">("competitors");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    Promise.all([
      records.list("competitive_intelligence").catch(() => []),
      records.list("customer_personas").catch(() => []),
      records.list("market_analysis_reports").catch(() => []),
    ]).then(([c, p, r]) => { setCompetitors(c); setPersonas(p); setReports(r); }).finally(() => setLoading(false));
  }, []);

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      // Search both Confluence AND the Knowledge Graph for comprehensive results
      const [confResult, kgResult] = await Promise.all([
        confluence.search(searchQuery, 5),
        knowledge.query(searchQuery, 5),
      ]);
      const combined = [
        ...(confResult.success ? confResult.results.map((r: any) => ({ ...r, source: "confluence" })) : []),
        ...(kgResult.results || []).map((r: any) => ({ title: r.content?.slice(0, 80), excerpt: r.content, source: "knowledge_graph", relevance: r.relevance })),
      ];
      setSearchResults(combined);
    } catch {} finally { setSearching(false); }
  }

  async function triggerAnalysis() {
    await missions.trigger("Launch Brief & Market Analysis");
    telemetry.emit("market_analysis_triggered", "info");
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Research</span>
          <h1 className="text-2xl font-bold">Market Research Workbench</h1>
          <button onClick={triggerAnalysis} className="ml-auto px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold">Generate Analysis</button>
        </div>

        {/* Confluence Search */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
          <h2 className="text-sm font-semibold text-indigo-400 mb-3">Search Competitive Intelligence</h2>
          <div className="flex gap-2">
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} placeholder="Search competitors, market data, personas..." className="flex-1 bg-slate-900 border border-white/10 rounded-lg p-2.5 text-sm" />
            <button onClick={handleSearch} disabled={searching} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold">{searching ? "..." : "Search"}</button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-3 space-y-2">{searchResults.map((r, i) => (
              <div key={i} className="px-3 py-2 rounded-lg bg-white/3 border border-white/5">
                <p className="text-sm text-white font-medium">{r.title}</p>
                <p className="text-xs text-slate-500 truncate">{r.excerpt || r.snippet}</p>
              </div>
            ))}</div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-white/5 pb-2 mb-6">
          {(["competitors", "personas", "reports"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === tab ? "bg-indigo-500/10 text-indigo-400" : "text-slate-400 hover:text-white"}`}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)} ({tab === "competitors" ? competitors.length : tab === "personas" ? personas.length : reports.length})
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            {loading && [1,2,3].map(i => <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />)}

            {!loading && activeTab === "competitors" && (
              competitors.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No competitive data yet. Run the Market Analysis mission or add competitors manually.</p> :
              competitors.map((c: any) => (
                <div key={c.id} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-white">{c.name || c.competitor_id}</span>
                    {c.market_share && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/20 text-indigo-400">{c.market_share}% share</span>}
                  </div>
                  <p className="text-xs text-slate-400 mb-2">{c.positioning}</p>
                  {c.strengths && <div className="flex flex-wrap gap-1">{(Array.isArray(c.strengths) ? c.strengths : []).map((s: string, i: number) => <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/10 text-emerald-400">{s}</span>)}</div>}
                  {c.weaknesses && <div className="flex flex-wrap gap-1 mt-1">{(Array.isArray(c.weaknesses) ? c.weaknesses : []).map((w: string, i: number) => <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-rose-500/10 text-rose-400">{w}</span>)}</div>}
                </div>
              ))
            )}

            {!loading && activeTab === "personas" && (
              personas.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No personas defined yet. Run the Market Analysis mission to validate personas.</p> :
              personas.map((p: any) => (
                <div key={p.id} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">👤</span>
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                    <span className="text-xs text-slate-500">{p.role}</span>
                  </div>
                  {p.pain_points && <div className="mb-2"><span className="text-[10px] text-slate-500 uppercase">Pain Points:</span><div className="flex flex-wrap gap-1 mt-1">{(Array.isArray(p.pain_points) ? p.pain_points : []).map((pp: string, i: number) => <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400">{pp}</span>)}</div></div>}
                  {p.buying_triggers && <div><span className="text-[10px] text-slate-500 uppercase">Buying Triggers:</span><div className="flex flex-wrap gap-1 mt-1">{(Array.isArray(p.buying_triggers) ? p.buying_triggers : []).map((bt: string, i: number) => <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-blue-500/10 text-blue-400">{bt}</span>)}</div></div>}
                </div>
              ))
            )}

            {!loading && activeTab === "reports" && (
              reports.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No analysis reports yet. Click "Generate Analysis" to start.</p> :
              reports.map((r: any) => (
                <div key={r.id} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-sm font-medium text-white">{r.title || r.name}</p>
                  <p className="text-xs text-slate-500 mt-1">{r.summary || r.type} · {new Date(r._createdAt).toLocaleDateString()}</p>
                </div>
              ))
            )}
          </div>

          <div>
            <AgentChat agentName="Market Research Analyst" agentRole="Competitive Intelligence" defaultGreeting="Hello! I'm your Market Research Analyst. I can help with competitive analysis, persona validation, market sizing, or timing assessment. What would you like to research?" />
          </div>
        </div>
      </div>
    </div>
  );
}
