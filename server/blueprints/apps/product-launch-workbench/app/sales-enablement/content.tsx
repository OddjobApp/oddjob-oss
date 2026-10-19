"use client";
import { useState, useEffect } from "react";
import { records, confluence, telemetry, slack, knowledge } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";

export default function SalesEnablementContent() {
  const [playbooks, setPlaybooks] = useState<any[]>([]);
  const [battleCards, setBattleCards] = useState<any[]>([]);
  const [demoScripts, setDemoScripts] = useState<any[]>([]);
  const [training, setTraining] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"playbooks" | "battlecards" | "demos" | "training">("playbooks");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      records.list("sales_playbooks").catch(() => []),
      records.list("battle_cards").catch(() => []),
      records.list("demo_scripts").catch(() => []),
      records.list("training_completions").catch(() => []),
    ]).then(([p, b, d, t]) => { setPlaybooks(p); setBattleCards(b); setDemoScripts(d); setTraining(t); }).finally(() => setLoading(false));
  }, []);

  async function publishToConfluence() {
    const content = `<h1>Sales Enablement Kit</h1><p>Playbooks: ${playbooks.length} | Battle Cards: ${battleCards.length} | Demo Scripts: ${demoScripts.length}</p>`;
    await confluence.publish({ title: `Sales Enablement Kit — ${new Date().toISOString().split("T")[0]}`, content });
    telemetry.emit("enablement_published", "info");
    // Notify sales channel via Slack
    slack.post("sales-enablement", `📦 New Sales Enablement Kit published to Confluence!\n• ${playbooks.length} playbooks\n• ${battleCards.length} battle cards\n• ${demoScripts.length} demo scripts\nReview and get certified: [Confluence Link]`);
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Sales</span>
          <h1 className="text-2xl font-bold">Sales Enablement Hub</h1>
          <button onClick={publishToConfluence} className="ml-auto px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold">Publish to Confluence</button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-amber-400">{playbooks.length}</div>
            <div className="text-[10px] text-slate-500">Playbooks</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-rose-400">{battleCards.length}</div>
            <div className="text-[10px] text-slate-500">Battle Cards</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-blue-400">{demoScripts.length}</div>
            <div className="text-[10px] text-slate-500">Demo Scripts</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-emerald-400">{training.length}</div>
            <div className="text-[10px] text-slate-500">Certified</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-white/5 pb-2 mb-6">
          {(["playbooks", "battlecards", "demos", "training"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === tab ? "bg-amber-500/10 text-amber-400" : "text-slate-400 hover:text-white"}`}>
              {tab === "battlecards" ? "Battle Cards" : tab === "demos" ? "Demo Scripts" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            {loading && [1,2,3].map(i => <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />)}

            {!loading && activeTab === "playbooks" && (
              playbooks.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No playbooks yet. Run the Sales Enablement mission to generate.</p> :
              playbooks.map((p: any) => (
                <div key={p.id} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">📖</span>
                    <span className="text-sm font-semibold text-white">{p.title || p.segment}</span>
                    <span className="text-xs text-slate-500 ml-auto">{p.persona || p.targetSegment}</span>
                  </div>
                  {p.talkTrack && <p className="text-xs text-slate-400 line-clamp-3">{p.talkTrack}</p>}
                  {p.discoveryQuestions && <div className="mt-2"><span className="text-[10px] text-slate-500 uppercase">Discovery Questions:</span><ul className="mt-1 space-y-1">{(Array.isArray(p.discoveryQuestions) ? p.discoveryQuestions.slice(0, 3) : []).map((q: string, i: number) => <li key={i} className="text-xs text-slate-400">• {q}</li>)}</ul></div>}
                </div>
              ))
            )}

            {!loading && activeTab === "battlecards" && (
              battleCards.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No battle cards yet.</p> :
              battleCards.map((b: any) => (
                <div key={b.id} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer" onClick={() => setExpandedCard(expandedCard === b.id ? null : b.id)}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">⚔️</span>
                    <span className="text-sm font-semibold text-white">vs. {b.competitor}</span>
                  </div>
                  <p className="text-xs text-slate-400"><strong className="text-slate-300">Their Pitch:</strong> {b.theirPitch}</p>
                  {expandedCard === b.id && (
                    <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
                      {b.ourAdvantages && <div><span className="text-[10px] text-emerald-400 uppercase font-bold">Our Advantages:</span>{(Array.isArray(b.ourAdvantages) ? b.ourAdvantages : []).map((a: string, i: number) => <p key={i} className="text-xs text-slate-300 mt-1">✓ {a}</p>)}</div>}
                      {b.trapQuestions && <div><span className="text-[10px] text-amber-400 uppercase font-bold">Trap Questions:</span>{(Array.isArray(b.trapQuestions) ? b.trapQuestions : []).map((q: string, i: number) => <p key={i} className="text-xs text-slate-300 mt-1">? {q}</p>)}</div>}
                      {b.winStory && <div><span className="text-[10px] text-blue-400 uppercase font-bold">Win Story:</span><p className="text-xs text-slate-300 mt-1 italic">"{b.winStory}"</p></div>}
                    </div>
                  )}
                </div>
              ))
            )}

            {!loading && activeTab === "demos" && (
              demoScripts.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No demo scripts yet.</p> :
              demoScripts.map((d: any) => (
                <div key={d.id} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">🎬</span>
                    <span className="text-sm font-semibold text-white">{d.title || d.persona}</span>
                    <span className="text-xs text-slate-500">{d.duration || "10 min"}</span>
                  </div>
                  {d.keyMoments && <div className="space-y-1">{(Array.isArray(d.keyMoments) ? d.keyMoments : []).map((m: string, i: number) => <p key={i} className="text-xs text-slate-400">{i + 1}. {m}</p>)}</div>}
                </div>
              ))
            )}

            {!loading && activeTab === "training" && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
                <h2 className="text-sm font-semibold text-slate-300 mb-2">Sales Certification Program</h2>
                <p className="text-sm text-slate-500 mb-4">Complete the training module to get certified on the new product launch. 10 questions, 80% pass rate required.</p>
                <div className="mb-4"><span className="text-2xl font-bold text-amber-400">{training.length}</span><span className="text-sm text-slate-500 ml-2">reps certified</span></div>
                <button className="px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-semibold">Start Certification Quiz</button>
              </div>
            )}
          </div>

          <div>
            <AgentChat agentName="Sales Enablement Specialist" agentRole="Revenue Enablement" defaultGreeting="Hello! I'm your Sales Enablement Specialist. I can create battle cards, write demo scripts, build objection handling guides, or design training materials. What does your sales team need?" />
          </div>
        </div>
      </div>
    </div>
  );
}
