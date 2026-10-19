"use client";
import { useState, useEffect, useCallback } from "react";
import { records, knowledge, confluence, events, telemetry } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";

type MainTab = "reader" | "graph" | "add";

interface KnowledgeDocument {
  id: string;
  title: string;
  category: string;
  content: string;
  tags: string;
  createdAt: string;
  source?: string;
}

interface SearchResult {
  content: string;
  score: number;
  source: string;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; node: string }> = {
  technical:  { bg: "bg-blue-500/15", text: "text-blue-400", node: "#3b82f6" },
  legal:      { bg: "bg-amber-500/15", text: "text-amber-400", node: "#f59e0b" },
  medical:    { bg: "bg-rose-500/15", text: "text-rose-400", node: "#f43f5e" },
  business:   { bg: "bg-emerald-500/15", text: "text-emerald-400", node: "#10b981" },
  scientific: { bg: "bg-violet-500/15", text: "text-violet-400", node: "#8b5cf6" },
  other:      { bg: "bg-slate-500/15", text: "text-slate-400", node: "#64748b" },
};

function getCategoryStyle(cat: string) {
  return CATEGORY_COLORS[cat?.toLowerCase()] ?? CATEGORY_COLORS.other;
}

// Simple markdown renderer (same transforms as Draft Sandbox)
function renderMarkdown(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold text-white mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-white mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-white mt-6 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="italic text-slate-300">$1</em>')
    .replace(/`([^`]+)`/g, '<code class="font-mono bg-slate-800 px-1 rounded text-amber-300 text-xs">$1</code>')
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre class="bg-slate-900 rounded-lg p-3 my-2 overflow-x-auto font-mono text-xs text-emerald-300 whitespace-pre">$1</pre>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-slate-300 list-disc">$1</li>')
    .replace(/\n\n/g, '<br class="my-2" />')
    .replace(/\n/g, '<br />');
}

function groupByCategory(docs: KnowledgeDocument[]): Record<string, KnowledgeDocument[]> {
  return docs.reduce((acc, doc) => {
    const key = doc.category?.toLowerCase() ?? "other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(doc);
    return acc;
  }, {} as Record<string, KnowledgeDocument[]>);
}

export default function MemoryLibraryContent() {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocument | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>("reader");

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);

  // Add document form
  const [addTitle, setAddTitle] = useState("");
  const [addCategory, setAddCategory] = useState("Technical");
  const [addContent, setAddContent] = useState("");
  const [addTags, setAddTags] = useState("");
  const [addSource, setAddSource] = useState("");
  const [adding, setAdding] = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);

  // Confluence export
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    const data = await records.list("knowledge_documents").catch(() => []);
    setDocs(data as KnowledgeDocument[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDocs();
    const unsub = events.subscribe((event) => {
      if (["mission.completed", "hil.raised"].includes(event.type)) fetchDocs();
    });
    return unsub;
  }, [fetchDocs]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const res = await knowledge.query(searchQuery, 10);
      const results = (res as any).results ?? [];
      setSearchResults(results.map((r: any) => ({
        content: r.content ?? r.text ?? "",
        score: r.score ?? r.relevance ?? 0,
        source: r.source ?? "",
      })));
      telemetry.emit("knowledge_searched", "info", { query: searchQuery, count: results.length });
    } finally { setSearching(false); }
  }

  function openResult(result: SearchResult) {
    // Find matching doc by source
    const match = docs.find(d => d.source === result.source || d.title === result.source);
    if (match) { setSelectedDoc(match); setActiveTab("reader"); }
  }

  async function handleExportConfluence() {
    if (!selectedDoc) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await confluence.publish({ title: selectedDoc.title, content: selectedDoc.content });
      setExportMsg((res as any).success ? "Exported to Confluence." : "Export failed — check configuration.");
      telemetry.emit("confluence_export", "info", { docId: selectedDoc.id });
    } catch { setExportMsg("Export failed."); } finally { setExporting(false); }
  }

  async function handleAddDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!addTitle.trim() || !addContent.trim()) return;
    setAdding(true);
    try {
      await records.create("knowledge_documents", {
        title: addTitle,
        category: addCategory,
        content: addContent,
        tags: addTags,
        source: addSource,
        createdAt: new Date().toISOString(),
      });
      telemetry.emit("knowledge_document_added", "info", { title: addTitle });
      setAddTitle(""); setAddContent(""); setAddTags(""); setAddSource(""); setAddCategory("Technical");
      setAddSuccess(true);
      setTimeout(() => setAddSuccess(false), 4000);
      await fetchDocs();
    } finally { setAdding(false); }
  }

  const grouped = groupByCategory(docs);

  // ── Knowledge Graph data ──────────────────────────────────────────────────
  function buildGraphNodes() {
    const n = docs.length;
    if (n === 0) return { nodes: [], edges: [] };
    const cx = 400, cy = 300, r = 200;

    const nodes = docs.map((doc, i) => {
      const angle = (i * 2 * Math.PI) / n;
      return {
        id: doc.id,
        title: doc.title.length > 18 ? doc.title.slice(0, 16) + "…" : doc.title,
        fullTitle: doc.title,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        color: getCategoryStyle(doc.category).node,
        tags: (doc.tags ?? "").split(",").map((t: string) => t.trim()).filter(Boolean),
        doc,
      };
    });

    const edges: Array<{ x1: number; y1: number; x2: number; y2: number; key: string }> = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const sharedTags = nodes[i].tags.filter(t => nodes[j].tags.includes(t));
        if (sharedTags.length > 0) {
          edges.push({ x1: nodes[i].x, y1: nodes[i].y, x2: nodes[j].x, y2: nodes[j].y, key: `${i}-${j}` });
        }
      }
    }
    return { nodes, edges };
  }

  const { nodes: graphNodes, edges: graphEdges } = buildGraphNodes();

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/20">Research</span>
          <h1 className="text-2xl font-bold">Shared Memory Library</h1>
          <span className="text-xs text-slate-500 ml-auto">{docs.length} documents</span>
        </div>

        <div className="flex gap-6" style={{ minHeight: "calc(100vh - 10rem)" }}>

          {/* ── Left Sidebar (1/4) ──────────────────────────────────────── */}
          <div className="w-72 flex-shrink-0 flex flex-col gap-4">

            {/* Semantic Search */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Semantic Search</h2>
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search knowledge…"
                  className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-violet-500/50 min-w-0"
                />
                <button
                  type="submit" disabled={searching || !searchQuery.trim()}
                  className="px-2.5 py-1.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex-shrink-0"
                >
                  {searching ? <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin inline-block" /> : "Go"}
                </button>
              </form>

              {searching && (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-3 h-3 border border-white/20 border-t-violet-400 rounded-full animate-spin" />
                  Searching…
                </div>
              )}

              {searchResults !== null && !searching && (
                <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
                  {searchResults.length === 0 && <p className="text-xs text-slate-500">No results found.</p>}
                  {searchResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => openResult(r)}
                      className="w-full text-left px-2 py-2 rounded-lg bg-white/3 hover:bg-white/8 border border-white/5 space-y-1"
                    >
                      <p className="text-[10px] font-semibold text-violet-400 truncate">{r.source}</p>
                      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(100, Math.round(r.score * 100))}%` }} />
                      </div>
                      <p className="text-[10px] text-slate-400 line-clamp-2">{r.content?.slice(0, 120)}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Document Browser */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Documents</h2>
                <button
                  onClick={() => setActiveTab("add")}
                  className="text-[10px] text-violet-400 hover:text-violet-300 border border-violet-500/30 px-2 py-0.5 rounded"
                >+ Add</button>
              </div>
              {loading && <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-white/5 rounded animate-pulse" />)}</div>}
              {!loading && docs.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">No documents yet. Add one using the button above.</p>
              )}
              {Object.entries(grouped).map(([cat, catDocs]) => (
                <div key={cat} className="mb-3">
                  <p className={`text-[9px] font-bold uppercase tracking-widest mb-1 ${getCategoryStyle(cat).text}`}>{cat}</p>
                  {catDocs.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => { setSelectedDoc(doc); setActiveTab("reader"); }}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs mb-0.5 truncate transition-colors ${selectedDoc?.id === doc.id ? "bg-violet-500/15 text-violet-300" : "text-slate-400 hover:text-white hover:bg-white/5"}`}
                    >
                      {doc.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* ── Right Main Area (3/4) ────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0">

            {/* Tab bar */}
            <div className="flex gap-2 border-b border-white/5 pb-2 mb-4 flex-shrink-0">
              {(["reader", "graph", "add"] as MainTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === tab ? "bg-violet-500/10 text-violet-400" : "text-slate-400 hover:text-white"}`}
                >
                  {tab === "reader" ? "Document Reader" : tab === "graph" ? "Knowledge Graph" : "Add Document"}
                </button>
              ))}
            </div>

            {/* Document Reader */}
            {activeTab === "reader" && (
              <div className="flex-1 overflow-y-auto">
                {!selectedDoc ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center space-y-2">
                      <p className="text-2xl text-slate-700">&#x1f4da;</p>
                      <p className="text-slate-500 text-sm">Select a document from the sidebar or use semantic search to find relevant knowledge.</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2 flex-1 min-w-0">
                        <h1 className="text-xl font-bold text-white">{selectedDoc.title}</h1>
                        <div className="flex items-center flex-wrap gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getCategoryStyle(selectedDoc.category).bg} ${getCategoryStyle(selectedDoc.category).text}`}>
                            {selectedDoc.category}
                          </span>
                          {selectedDoc.tags && selectedDoc.tags.split(",").filter(Boolean).map(tag => (
                            <span key={tag.trim()} className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400">{tag.trim()}</span>
                          ))}
                        </div>
                        {selectedDoc.source && (
                          <p className="text-[10px] text-slate-500">Source: {selectedDoc.source}</p>
                        )}
                        {selectedDoc.createdAt && (
                          <p className="text-[10px] text-slate-500">{new Date(selectedDoc.createdAt).toLocaleString()}</p>
                        )}
                      </div>
                      <div className="flex-shrink-0 space-y-2">
                        <button
                          onClick={handleExportConfluence}
                          disabled={exporting}
                          className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
                        >
                          {exporting ? "Exporting…" : "Export to Confluence"}
                        </button>
                        {exportMsg && <p className={`text-[10px] ${exportMsg.includes("fail") ? "text-rose-400" : "text-emerald-400"}`}>{exportMsg}</p>}
                      </div>
                    </div>
                    <hr className="border-white/10" />
                    <div
                      className="prose-sm text-slate-300 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedDoc.content ?? "") }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Knowledge Graph */}
            {activeTab === "graph" && (
              <div className="flex-1">
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10">
                    <h2 className="text-sm font-semibold text-slate-300">Knowledge Graph</h2>
                    <p className="text-[10px] text-slate-500 mt-0.5">Nodes colored by category. Edges connect documents sharing tags. Click a node to open the document.</p>
                  </div>
                  {docs.length === 0 ? (
                    <div className="flex items-center justify-center h-64">
                      <p className="text-sm text-slate-500">No documents to display. Add documents to see the knowledge graph.</p>
                    </div>
                  ) : (
                    <svg viewBox="0 0 800 600" className="w-full" style={{ maxHeight: "560px" }}>
                      {/* Background grid */}
                      <rect width="800" height="600" fill="transparent" />
                      {/* Edges */}
                      {graphEdges.map(edge => (
                        <line
                          key={edge.key}
                          x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
                          stroke="rgba(255,255,255,0.08)" strokeWidth="1"
                        />
                      ))}
                      {/* Nodes */}
                      {graphNodes.map(node => (
                        <g
                          key={node.id}
                          style={{ cursor: "pointer" }}
                          onClick={() => { setSelectedDoc(node.doc); setActiveTab("reader"); }}
                        >
                          <circle
                            cx={node.x} cy={node.y} r={22}
                            fill={node.color} fillOpacity={0.2}
                            stroke={node.color} strokeWidth="1.5" strokeOpacity={0.6}
                          />
                          <text
                            x={node.x} y={node.y + 1}
                            textAnchor="middle" dominantBaseline="middle"
                            fill="white" fontSize="8" fontFamily="sans-serif"
                            style={{ pointerEvents: "none" }}
                          >
                            {node.title}
                          </text>
                        </g>
                      ))}
                      {/* Legend */}
                      {Object.entries(CATEGORY_COLORS).map(([cat, style], i) => (
                        <g key={cat} transform={`translate(12, ${12 + i * 16})`}>
                          <circle cx={5} cy={5} r={4} fill={style.node} fillOpacity={0.6} />
                          <text x={13} y={9} fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="sans-serif">{cat}</text>
                        </g>
                      ))}
                    </svg>
                  )}
                </div>
              </div>
            )}

            {/* Add Document */}
            {activeTab === "add" && (
              <div className="flex-1 overflow-y-auto">
                <form onSubmit={handleAddDocument} className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4 max-w-2xl">
                  <h2 className="text-sm font-semibold text-slate-300">Add Knowledge Document</h2>
                  {addSuccess && (
                    <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                      Document added successfully.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">Title</label>
                      <input
                        required type="text" value={addTitle} onChange={e => setAddTitle(e.target.value)}
                        placeholder="Document title"
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">Category</label>
                      <select
                        value={addCategory} onChange={e => setAddCategory(e.target.value)}
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm"
                      >
                        <option>Technical</option>
                        <option>Legal</option>
                        <option>Medical</option>
                        <option>Business</option>
                        <option>Scientific</option>
                        <option>Other</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Content</label>
                    <textarea
                      required rows={8} value={addContent} onChange={e => setAddContent(e.target.value)}
                      placeholder="Paste document content here. Markdown is supported."
                      className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm resize-none focus:outline-none focus:border-violet-500/50"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">Tags (comma-separated)</label>
                      <input
                        type="text" value={addTags} onChange={e => setAddTags(e.target.value)}
                        placeholder="e.g. api, v2, internal"
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">Source URL</label>
                      <input
                        type="text" value={addSource} onChange={e => setAddSource(e.target.value)}
                        placeholder="https://..."
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                  </div>
                  <button
                    type="submit" disabled={adding}
                    className="w-full py-2.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
                  >
                    {adding ? "Adding…" : "Add Document"}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
