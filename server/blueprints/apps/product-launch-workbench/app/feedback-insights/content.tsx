"use client";
import { useState, useEffect } from "react";
import { records, telemetry, launch, predictions, slack, jira, knowledge } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";

export default function FeedbackInsightsContent() {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [priorities, setPriorities] = useState<any[]>([]);
  const [npsData, setNpsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"feedback" | "themes" | "priorities" | "nps">("feedback");
  const [sentimentFilter, setSentimentFilter] = useState<"all" | "positive" | "negative">("all");
  const [synthesizing, setSynthesizing] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      records.list("beta_feedback").catch(() => []),
      records.list("iteration_priorities").catch(() => []),
      records.list("customer_nps").catch(() => []),
    ]).then(([f, p, n]) => { setFeedback(f); setPriorities(p); setNpsData(n); }).finally(() => setLoading(false));
  }, []);

  async function handleSynthesize() {
    setSynthesizing(true);
    try {
      const result = await launch.synthesizeFeedback();
      if (result.success) {
        telemetry.emit("feedback_synthesized", "info", { themes: result.themesIdentified, priorities: result.prioritiesGenerated });
        slack.post("launch-channel", `📊 Feedback synthesis complete: ${result.themesIdentified} themes identified, ${result.prioritiesGenerated} priorities generated.`);
        // Refresh data
        const [f, p] = await Promise.all([records.list("beta_feedback").catch(() => []), records.list("iteration_priorities").catch(() => [])]);
        setFeedback(f); setPriorities(p);
      }
    } catch {} finally { setSynthesizing(false); }
  }

  async function handleCreateTicket(priority: any) {
    setCreatingTicket(priority.id);
    try {
      const result = await jira.createBug({ summary: priority.title || priority.name, description: priority.rationale || priority.description, priority: priority.impact === "high" ? "High" : "Medium" });
      if (result.success) {
        telemetry.emit("iteration_ticket_created", "info", { jiraKey: result.key, theme: priority.feedbackTheme });
        slack.post("launch-channel", `🎫 Iteration ticket created: ${result.key} — "${priority.title}"`);
      }
    } catch {} finally { setCreatingTicket(null); }
  }

  const filteredFeedback = sentimentFilter === "all" ? feedback :
    sentimentFilter === "positive" ? feedback.filter((f: any) => (f.sentiment ?? 0) >= 0.5) :
    feedback.filter((f: any) => (f.sentiment ?? 0) < 0);

  const avgSentiment = feedback.length > 0 ? feedback.reduce((sum, f: any) => sum + (f.sentiment ?? 0), 0) / feedback.length : 0;
  const themes = Array.from(new Set(feedback.map((f: any) => f.category || f.theme).filter(Boolean)));
  const themeCounts = themes.map(t => ({ theme: t, count: feedback.filter((f: any) => (f.category || f.theme) === t).length, sentiment: feedback.filter((f: any) => (f.category || f.theme) === t).reduce((s, f: any) => s + (f.sentiment ?? 0), 0) / Math.max(1, feedback.filter((f: any) => (f.category || f.theme) === t).length) })).sort((a, b) => b.count - a.count);

  const latestNps = npsData.length > 0 ? (npsData[npsData.length - 1] as any).score : null;

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Insights</span>
          <h1 className="text-2xl font-bold">Feedback & Insights</h1>
          <button onClick={handleSynthesize} disabled={synthesizing} className="ml-auto px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white rounded-lg text-xs font-semibold">{synthesizing ? "Synthesizing..." : "🔬 AI Synthesize"}</button>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-cyan-400">{feedback.length}</div>
            <div className="text-[10px] text-slate-500">Total Feedback</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className={`text-xl font-bold ${avgSentiment >= 0.5 ? "text-emerald-400" : avgSentiment >= 0 ? "text-amber-400" : "text-rose-400"}`}>{avgSentiment.toFixed(2)}</div>
            <div className="text-[10px] text-slate-500">Avg Sentiment</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-violet-400">{themes.length}</div>
            <div className="text-[10px] text-slate-500">Themes</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-amber-400">{priorities.length}</div>
            <div className="text-[10px] text-slate-500">Priorities</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className={`text-xl font-bold ${latestNps !== null ? (latestNps >= 50 ? "text-emerald-400" : latestNps >= 0 ? "text-amber-400" : "text-rose-400") : "text-slate-500"}`}>{latestNps ?? "—"}</div>
            <div className="text-[10px] text-slate-500">NPS Score</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-white/5 pb-2 mb-6">
          {(["feedback", "themes", "priorities", "nps"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === tab ? "bg-cyan-500/10 text-cyan-400" : "text-slate-400 hover:text-white"}`}>
              {tab === "nps" ? "NPS" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            {loading && [1,2,3,4].map(i => <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />)}

            {!loading && activeTab === "feedback" && (
              <>
                <div className="flex gap-2 mb-3">
                  {(["all", "positive", "negative"] as const).map(f => (
                    <button key={f} onClick={() => setSentimentFilter(f)} className={`px-3 py-1 rounded-lg text-xs ${sentimentFilter === f ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "text-slate-400 border border-white/5"}`}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
                  ))}
                </div>
                {filteredFeedback.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No feedback collected yet. Run the Beta Program mission to start collecting.</p> :
                  filteredFeedback.map((f: any) => (
                    <div key={f.id} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${(f.sentiment ?? 0) >= 0.5 ? "bg-emerald-500/20 text-emerald-400" : (f.sentiment ?? 0) >= 0 ? "bg-amber-500/20 text-amber-400" : "bg-rose-500/20 text-rose-400"}`}>{((f.sentiment ?? 0) >= 0 ? "+" : "")}{(f.sentiment ?? 0).toFixed(1)}</span>
                        {f.category && <span className="px-1.5 py-0.5 rounded text-[9px] bg-cyan-500/10 text-cyan-400">{f.category}</span>}
                        <span className="text-[10px] text-slate-500 ml-auto">{f.source || "beta"} · {f.persona || "unknown"}</span>
                      </div>
                      <p className="text-sm text-white">{f.content || f.summary}</p>
                    </div>
                  ))
                }
              </>
            )}

            {!loading && activeTab === "themes" && (
              themeCounts.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No themes identified yet. Feedback needs to be categorized first.</p> :
              themeCounts.map((t, i) => (
                <div key={t.theme} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-lg font-bold text-cyan-400 w-8">#{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{t.theme}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500">{t.count} mentions</span>
                      <span className={`text-xs ${t.sentiment >= 0.5 ? "text-emerald-400" : t.sentiment >= 0 ? "text-amber-400" : "text-rose-400"}`}>sentiment: {t.sentiment.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 rounded-full" style={{ width: `${Math.min(100, (t.count / Math.max(1, feedback.length)) * 100 * 3)}%` }} /></div>
                </div>
              ))
            )}

            {!loading && activeTab === "priorities" && (
              priorities.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No iteration priorities yet. Run the Post-Launch Analysis mission to generate.</p> :
              priorities.map((p: any, i) => (
                <div key={p.id || i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-lg font-bold text-cyan-400 w-8">#{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{p.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{p.rationale || p.description}</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${p.impact === "high" ? "bg-rose-500/20 text-rose-400" : p.impact === "medium" ? "bg-amber-500/20 text-amber-400" : "bg-slate-700 text-slate-400"}`}>{p.impact || "medium"}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-500/10 text-blue-400">{p.effort || "M"}</span>
                    <button onClick={() => handleCreateTicket(p)} disabled={creatingTicket === p.id} className="px-2 py-1 rounded text-[10px] font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white">{creatingTicket === p.id ? "..." : "→ Jira"}</button>
                  </div>
                </div>
              ))
            )}

            {!loading && activeTab === "nps" && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <h2 className="text-sm font-semibold text-slate-300 mb-4">Net Promoter Score</h2>
                {npsData.length === 0 ? <p className="text-sm text-slate-500 text-center py-4">NPS data will populate after launch when customer surveys are collected.</p> :
                  <div className="space-y-3">
                    <div className="text-center"><span className={`text-5xl font-bold ${latestNps! >= 50 ? "text-emerald-400" : latestNps! >= 0 ? "text-amber-400" : "text-rose-400"}`}>{latestNps}</span><p className="text-xs text-slate-500 mt-1">Current NPS</p></div>
                    {npsData.map((n: any, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/3 border border-white/5">
                        <span className="text-xs text-slate-500 w-20">{n.date || n._createdAt?.split("T")[0]}</span>
                        <span className={`text-sm font-bold ${n.score >= 50 ? "text-emerald-400" : n.score >= 0 ? "text-amber-400" : "text-rose-400"}`}>{n.score}</span>
                        <span className="text-xs text-slate-500">{n.responses} responses</span>
                      </div>
                    ))}
                  </div>
                }
              </div>
            )}
          </div>

          <div>
            <AgentChat agentName="Customer Feedback Analyst" agentRole="Voice of the Customer" defaultGreeting="Hello! I'm your Feedback Analyst. I can synthesize customer feedback, identify themes, track NPS trends, and recommend iteration priorities. What insights do you need?" />
          </div>
        </div>
      </div>
    </div>
  );
}
