"use client";
import React, { useState, useEffect } from "react";
import { records, telemetry, launch, knowledge } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";
import { AdvancedFilterBar, type FilterState } from "../components/AdvancedFilterBar";
import { CollateralDiffView } from "../components/CollateralDiffView";

const SAMPLE_COPY_ORIGINAL =
  "# Product Launch Announcement: Oddjob 5.0\n" +
  "Oddjob 5.0 introduces automated cycle management, allowing teams to coordinate multi-agent workflows.\n\n" +
  "Key Features:\n" +
  "- Multi-agent dispatch\n" +
  "- Basic pipeline status\n" +
  "- Simple webhooks";

const SAMPLE_COPY_REVISED =
  "# Press Release: Oddjob 5.0 — The Governed AI Control Plane & Telemetry Engine\n" +
  "Oddjob 5.0 is the first enterprise-grade, 5-layer governed AI control plane designed for high-velocity software engineering and tactical dispatch.\n\n" +
  "Key Capabilities:\n" +
  "- Eulerian Uber H3 Hexagonal Spatial Analytics\n" +
  "- W3C Distributed Tracing & Cryptographic Forensic Verification\n" +
  "- Multi-Agent Deliberation Rooms with Live In-Canvas App Surfaces\n" +
  "- Real-Time DORA Value Stream Metrics and Hard FinOps Quota Guards";

export default function ContentStudioContent() {
  const [assets, setAssets] = useState<any[]>([]);
  const [calendar, setCalendar] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"pipeline" | "diff-review" | "calendar" | "generate">("pipeline");
  const [generateType, setGenerateType] = useState("blog_post");
  const [generateTopic, setGenerateTopic] = useState("");
  const [filters, setFilters] = useState<FilterState>({});
  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("embedded") === "true" || window.parent !== window) {
        setIsEmbedded(true);
      }
    }

    Promise.all([
      records.list("content_assets").catch(() => []),
      records.list("content_calendar").catch(() => []),
    ]).then(([a, c]) => {
      setAssets(a);
      setCalendar(c);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  const filtered = assets.filter((a: any) => {
    if (filters.search && !a.title?.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.statuses && filters.statuses.length > 0 && !filters.statuses.includes(a.status)) return false;
    if (filters.types && filters.types.length > 0 && !filters.types.includes(a.type)) return false;
    return true;
  });

  const byStatus = {
    draft: filtered.filter((a: any) => a.status === "draft"),
    in_review: filtered.filter((a: any) => a.status === "in_review"),
    approved: filtered.filter((a: any) => a.status === "approved"),
    published: filtered.filter((a: any) => a.status === "published"),
  };

  async function handleGenerate() {
    if (!generateTopic.trim()) return;
    await launch.generateContent({ contentType: generateType, title: generateTopic, persona: "general", funnelStage: "awareness" });
    telemetry.emit("content_generated", "info", { type: generateType, topic: generateTopic });
    const kgContext = await knowledge.query(`${generateType} best practices for ${generateTopic}`).catch(() => null);
    if (kgContext && kgContext.results.length > 0) {
      telemetry.emit("knowledge_context_used", "info", { results: kgContext.results.length });
    }
    setGenerateTopic("");
    const refreshed = await records.list("content_assets").catch(() => []);
    setAssets(refreshed);
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-pink-500/10 text-pink-400 border border-pink-500/20">Content</span>
          <h1 className="text-2xl font-bold">Content Studio</h1>
          {isEmbedded && (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              CREW Room Canvas
            </span>
          )}
          <span className="text-xs text-slate-500 ml-auto">{assets.length} assets total</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-white/5 pb-2 mb-6">
          {(["pipeline", "diff-review", "calendar", "generate"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab ? "bg-pink-500/10 text-pink-400 font-bold" : "text-slate-400 hover:text-white"
              }`}
            >
              {tab === "diff-review" ? "Copy Diff Review" : tab === "generate" ? "AI Generate" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className={isEmbedded ? "w-full" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>
          <div className={isEmbedded ? "space-y-4" : "lg:col-span-2 space-y-4"}>
            {activeTab === "pipeline" && (
              <div className="space-y-4">
                <AdvancedFilterBar
                  filters={filters}
                  onFiltersChange={setFilters}
                  placeholder="Filter marketing collateral, press releases, blog posts…"
                />

                {loading && [1, 2, 3].map((i) => <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />)}

                {!loading && filtered.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-8">
                    No matching content assets. Adjust filters or use "AI Generate" to create new launch collateral.
                  </p>
                )}

                {!loading && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(["draft", "in_review", "approved", "published"] as const).map((status) => (
                      <div key={status} className="bg-white/3 border border-white/5 rounded-xl p-3">
                        <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">
                          {status.replace("_", " ")} ({byStatus[status].length})
                        </h3>
                        <div className="space-y-2 max-h-56 overflow-y-auto">
                          {byStatus[status].map((a: any) => (
                            <div key={a.id} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                              <p className="text-xs text-white truncate font-medium">{a.title}</p>
                              <span className="text-[9px] text-slate-500">{a.type}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "diff-review" && (
              <div className="space-y-4">
                <CollateralDiffView
                  originalContent={SAMPLE_COPY_ORIGINAL}
                  modifiedContent={SAMPLE_COPY_REVISED}
                  assetTitle="Press Release: Oddjob 5.0 Launch"
                  assetType="Press Release"
                  originalLabel="AI Draft Copy"
                  modifiedLabel="GTM Strategist Revisions"
                  onApprove={() => telemetry.emit("collateral_approved", "info", { asset: "Press Release: Oddjob 5.0 Launch" })}
                />
              </div>
            )}

            {activeTab === "calendar" && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-3">Content Calendar</h2>
                {calendar.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">No calendar entries. The GTM Strategist will populate this during campaign planning.</p>
                ) : (
                  calendar.map((entry: any, i) => (
                    <div key={entry.id || i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/3 border border-white/5 mb-2">
                      <span className="text-xs text-slate-500 w-20">{entry.date || entry.scheduledDate}</span>
                      <span className="text-sm text-white flex-1">{entry.title}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-pink-500/20 text-pink-400">{entry.channel || entry.type}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "generate" && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-pink-400 mb-4">AI Content Generator</h2>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Content Type</label>
                    <select value={generateType} onChange={(e) => setGenerateType(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded p-2 text-sm mt-1">
                      <option value="blog_post">Blog Post</option>
                      <option value="landing_page">Landing Page Copy</option>
                      <option value="email_sequence">Email Sequence</option>
                      <option value="social_post">Social Post</option>
                      <option value="press_release">Press Release</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Topic / Title</label>
                    <input value={generateTopic} onChange={(e) => setGenerateTopic(e.target.value)} placeholder="Enter topic or title..." className="w-full bg-slate-900 border border-white/10 rounded p-2 text-sm mt-1" />
                  </div>
                </div>
                <button onClick={handleGenerate} disabled={!generateTopic.trim()} className="w-full py-2 bg-pink-600 hover:bg-pink-500 disabled:bg-slate-700 text-white rounded-lg text-sm font-semibold">Generate with AI</button>
              </div>
            )}
          </div>

          {!isEmbedded && (
            <div>
              <AgentChat
                agentName="Content & Copy Specialist"
                agentRole="Content Creation"
                defaultGreeting="Hello! I'm your Content Specialist. I can write landing page copy, blog posts, email sequences, social content, or press releases. What would you like me to create?"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
