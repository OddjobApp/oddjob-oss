"use client";
import { useState, useEffect, useCallback } from "react";
import { records, missions, events, telemetry } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";
import { draftSteeringModes } from "../../lib/steering-modes";

type ArtifactType = "code" | "markdown" | "json" | "csv" | "legal" | "prose";
type ArtifactStatus = "draft" | "approved" | "rework";
type ReviewTab = "gate" | "history" | "new";

interface DraftArtifact {
  id: string;
  title: string;
  type: ArtifactType;
  content: string;
  agentExplanation?: string;
  status: ArtifactStatus;
  version: number;
  timestamp: string;
  instructions?: string;
}

interface ArtifactFeedback {
  id: string;
  artifactId: string;
  artifactTitle: string;
  action: "approved" | "rework";
  instructions?: string;
  timestamp: string;
}

// ── Renderer helpers ──────────────────────────────────────────────────────────

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
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 text-slate-300 list-decimal">$2</li>')
    .replace(/\n\n/g, '<br class="my-2" />')
    .replace(/\n/g, '<br />');
}

function formatJson(content: string): string {
  try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; }
}

function renderCsvTable(csv: string): string {
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return "";
  const [header, ...rows] = lines;
  const cols = header.split(",");
  const th = cols.map(c => `<th class="px-3 py-1.5 text-left text-[10px] font-bold text-slate-400 uppercase border-b border-white/10">${c.trim()}</th>`).join("");
  const trs = rows.map(row =>
    `<tr class="border-b border-white/5">${row.split(",").map(cell => `<td class="px-3 py-1.5 text-xs text-slate-300">${cell.trim()}</td>`).join("")}</tr>`
  ).join("");
  return `<table class="w-full text-left"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

function addLineNumbers(code: string): string {
  return code.split("\n").map((line, i) =>
    `<span class="select-none text-slate-600 text-[10px] mr-3 inline-block w-6 text-right">${i + 1}</span>${line}`
  ).join("\n");
}

const STATUS_STYLES: Record<ArtifactStatus, string> = {
  draft:    "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  rework:   "bg-rose-500/15 text-rose-400 border border-rose-500/30",
};

const TYPE_LABELS: Record<ArtifactType, string> = {
  code: "Code", markdown: "Markdown", json: "JSON", csv: "CSV", legal: "Legal", prose: "Prose",
};

export default function DraftSandboxContent() {
  const [artifacts, setArtifacts] = useState<DraftArtifact[]>([]);
  const [feedback, setFeedback] = useState<ArtifactFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
  const [editedContent, setEditedContent] = useState("");
  const [savingContent, setSavingContent] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [reviewTab, setReviewTab] = useState<ReviewTab>("gate");
  const [reworkInstructions, setReworkInstructions] = useState("");
  const [showReworkInput, setShowReworkInput] = useState(false);
  const [decisionBanner, setDecisionBanner] = useState<string | null>(null);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  // New artifact form
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<ArtifactType>("markdown");
  const [newContent, setNewContent] = useState("");
  const [newExplanation, setNewExplanation] = useState("");
  const [creatingArtifact, setCreatingArtifact] = useState(false);
  const [createBanner, setCreateBanner] = useState(false);

  const fetchAll = useCallback(async () => {
    const [arts, fb] = await Promise.all([
      records.list("draft_artifacts").catch(() => []),
      records.list("artifact_feedback").catch(() => []),
    ]);
    setArtifacts(arts as DraftArtifact[]);
    setFeedback((fb as ArtifactFeedback[]).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const unsub = events.subscribe((event) => {
      if (event.type === "mission.completed") fetchAll();
    });
    return unsub;
  }, [fetchAll]);

  const selected = artifacts.find(a => a.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) setEditedContent(selected.content ?? "");
  }, [selectedId, selected]);

  async function handleSaveContent() {
    if (!selected) return;
    setSavingContent(true);
    try {
      await records.update("draft_artifacts", selected.id, { content: editedContent, version: (selected.version ?? 1) + 1 });
      telemetry.emit("artifact_content_saved", "info", { artifactId: selected.id });
      await fetchAll();
    } finally { setSavingContent(false); }
  }

  async function handleApprove() {
    if (!selected) return;
    setSubmittingDecision(true);
    try {
      await records.update("draft_artifacts", selected.id, { status: "approved" });
      await records.create("artifact_feedback", {
        artifactId: selected.id,
        artifactTitle: selected.title,
        action: "approved",
        timestamp: new Date().toISOString(),
      });
      telemetry.emit("artifact_approved", "info", { artifactId: selected.id });
      setDecisionBanner("Artifact approved.");
      setShowReworkInput(false);
      await fetchAll();
    } finally { setSubmittingDecision(false); }
  }

  async function handleRework() {
    if (!selected || !reworkInstructions.trim()) return;
    setSubmittingDecision(true);
    try {
      await records.update("draft_artifacts", selected.id, { status: "rework", instructions: reworkInstructions });
      await records.create("artifact_feedback", {
        artifactId: selected.id,
        artifactTitle: selected.title,
        action: "rework",
        instructions: reworkInstructions,
        timestamp: new Date().toISOString(),
      });
      await missions.trigger("Draft Refinement", {
        artifactId: selected.id,
        artifactTitle: selected.title,
        instructions: reworkInstructions,
        triggeredBy: "draft-sandbox",
      });
      telemetry.emit("artifact_rework_requested", "info", { artifactId: selected.id });
      setDecisionBanner("Rework requested — Draft Refinement mission triggered.");
      setShowReworkInput(false);
      setReworkInstructions("");
      await fetchAll();
    } finally { setSubmittingDecision(false); }
  }

  async function handleCreateArtifact(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setCreatingArtifact(true);
    try {
      await records.create("draft_artifacts", {
        title: newTitle,
        type: newType,
        content: newContent,
        agentExplanation: newExplanation,
        status: "draft",
        version: 1,
        timestamp: new Date().toISOString(),
      });
      telemetry.emit("artifact_created", "info", { title: newTitle, type: newType });
      setNewTitle(""); setNewContent(""); setNewExplanation(""); setNewType("markdown");
      setCreateBanner(true);
      setTimeout(() => setCreateBanner(false), 4000);
      await fetchAll();
      setReviewTab("gate");
    } finally { setCreatingArtifact(false); }
  }

  function renderContent(artifact: DraftArtifact): string {
    switch (artifact.type) {
      case "markdown": case "legal": case "prose": return renderMarkdown(artifact.content ?? "");
      case "json": return `<pre class="font-mono text-xs text-emerald-300 whitespace-pre overflow-x-auto">${formatJson(artifact.content ?? "")}</pre>`;
      case "csv": return renderCsvTable(artifact.content ?? "");
      case "code": return `<pre class="font-mono text-xs text-emerald-300 whitespace-pre overflow-x-auto leading-relaxed">${addLineNumbers(artifact.content ?? "")}</pre>`;
      default: return `<p class="text-sm text-slate-300 whitespace-pre-wrap">${artifact.content ?? ""}</p>`;
    }
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Research</span>
          <h1 className="text-2xl font-bold">Draft & Review Sandbox</h1>
          {decisionBanner && (
            <span className="ml-auto text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
              {decisionBanner}
            </span>
          )}
        </div>

        <div className="flex gap-6 h-[calc(100vh-10rem)]">

          {/* ── Left: Artifact Panel (60%) ─────────────────────────────── */}
          <div className="flex-[3] flex flex-col min-w-0 gap-4">

            {/* Selector row */}
            <div className="flex items-center gap-3">
              <select
                value={selectedId ?? ""}
                onChange={e => { setSelectedId(e.target.value || null); setDecisionBanner(null); setShowReworkInput(false); setViewMode("rendered"); }}
                className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-0"
              >
                <option value="">— Select an artifact —</option>
                {artifacts.map(a => (
                  <option key={a.id} value={a.id}>{a.title} (v{a.version}) [{TYPE_LABELS[a.type]}]</option>
                ))}
              </select>
              {loading && <div className="w-5 h-5 border-2 border-white/20 border-t-cyan-400 rounded-full animate-spin flex-shrink-0" />}
            </div>

            {/* Content area */}
            {selected ? (
              <div className="flex-1 flex flex-col bg-white/5 border border-white/10 rounded-xl overflow-hidden min-h-0">
                {/* Toolbar */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 flex-shrink-0">
                  <span className="text-sm font-semibold text-white truncate flex-1">{selected.title}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_STYLES[selected.status]}`}>
                    {selected.status}
                  </span>
                  <span className="text-[10px] text-slate-500">v{selected.version}</span>
                  <div className="flex gap-1 ml-2">
                    <button
                      onClick={() => setViewMode("rendered")}
                      className={`px-2.5 py-1 rounded text-xs font-medium ${viewMode === "rendered" ? "bg-cyan-500/10 text-cyan-400" : "text-slate-400 hover:text-white"}`}
                    >Rendered</button>
                    <button
                      onClick={() => setViewMode("raw")}
                      className={`px-2.5 py-1 rounded text-xs font-medium ${viewMode === "raw" ? "bg-cyan-500/10 text-cyan-400" : "text-slate-400 hover:text-white"}`}
                    >Raw</button>
                  </div>
                </div>

                {/* Content body */}
                <div className="flex-1 overflow-y-auto p-4 min-h-0">
                  {viewMode === "rendered" ? (
                    <div
                      className="prose-sm text-slate-300 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderContent(selected) }}
                    />
                  ) : (
                    <textarea
                      className="w-full h-full bg-transparent font-mono text-xs text-slate-300 resize-none focus:outline-none leading-relaxed"
                      value={editedContent}
                      onChange={e => setEditedContent(e.target.value)}
                    />
                  )}
                </div>

                {/* Save button in raw mode */}
                {viewMode === "raw" && (
                  <div className="px-4 py-3 border-t border-white/10 flex-shrink-0">
                    <button
                      onClick={handleSaveContent}
                      disabled={savingContent || editedContent === selected.content}
                      className="px-4 py-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white rounded-lg text-xs font-semibold"
                    >
                      {savingContent ? "Saving…" : "Save Changes"}
                    </button>
                  </div>
                )}

                {/* Agent explanation */}
                {selected.agentExplanation && (
                  <div className="border-t border-white/10 flex-shrink-0">
                    <button
                      onClick={() => setExplanationOpen(v => !v)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-[10px] text-slate-500 hover:text-slate-300 text-left"
                    >
                      <span className={`transition-transform ${explanationOpen ? "rotate-90" : ""}`}>▶</span>
                      Agent Explanation
                    </button>
                    {explanationOpen && (
                      <div className="px-4 pb-3">
                        <div className="bg-white/3 border border-white/10 rounded-lg p-3 text-xs text-slate-400 leading-relaxed italic">
                          {selected.agentExplanation}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-white/3 border border-white/10 rounded-xl">
                <div className="text-center">
                  <p className="text-slate-500 text-sm">Select an artifact to review, or create one using the panel on the right.</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Review Panel (40%) ─────────────────────────────── */}
          <div className="flex-[2] flex flex-col min-w-0 gap-4">

            {/* Tab bar */}
            <div className="flex gap-1 border-b border-white/5 pb-2 flex-shrink-0">
              {(["gate", "history", "new"] as ReviewTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setReviewTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg ${reviewTab === tab ? "bg-cyan-500/10 text-cyan-400" : "text-slate-400 hover:text-white"}`}
                >
                  {tab === "gate" ? "Review Gate" : tab === "history" ? "Feedback History" : "New Artifact"}
                </button>
              ))}
            </div>

            {/* Review Gate */}
            {reviewTab === "gate" && (
              <div className="flex-1 overflow-y-auto space-y-4">
                {!selected ? (
                  <p className="text-sm text-slate-500">Select an artifact on the left to review it here.</p>
                ) : (
                  <>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Artifact Details</h2>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-white">{selected.title}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{TYPE_LABELS[selected.type]}</span>
                          <span className="text-[10px] text-slate-500">Version {selected.version}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLES[selected.status]}`}>{selected.status}</span>
                        </div>
                        {selected.timestamp && (
                          <p className="text-[10px] text-slate-500">{new Date(selected.timestamp).toLocaleString()}</p>
                        )}
                      </div>
                    </div>

                    {selected.status !== "approved" && (
                      <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Decision</h2>
                        <button
                          onClick={handleApprove}
                          disabled={submittingDecision}
                          className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
                        >
                          {submittingDecision ? "Submitting…" : "✓ Approve"}
                        </button>
                        {!showReworkInput ? (
                          <button
                            onClick={() => setShowReworkInput(true)}
                            className="w-full py-2.5 bg-rose-900/60 hover:bg-rose-800/60 text-rose-300 border border-rose-500/30 rounded-lg text-sm font-semibold transition-colors"
                          >
                            ↩ Request Rework
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <textarea
                              rows={4}
                              placeholder="Describe what needs to change…"
                              value={reworkInstructions}
                              onChange={e => setReworkInstructions(e.target.value)}
                              className="w-full bg-slate-900 border border-white/10 rounded-lg p-2 text-sm resize-none focus:outline-none focus:border-rose-500/50"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={handleRework}
                                disabled={submittingDecision || !reworkInstructions.trim()}
                                className="flex-1 py-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
                              >
                                {submittingDecision ? "Submitting…" : "Submit Rework Request"}
                              </button>
                              <button
                                onClick={() => { setShowReworkInput(false); setReworkInstructions(""); }}
                                className="px-3 py-2 text-slate-400 hover:text-white rounded-lg text-xs"
                              >Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {selected.status === "approved" && (
                      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                        <p className="text-emerald-400 text-sm font-semibold">✓ Artifact approved</p>
                        <p className="text-xs text-slate-400 mt-1">No further action required for this version.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Feedback History */}
            {reviewTab === "history" && (
              <div className="flex-1 overflow-y-auto space-y-2">
                {feedback.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">No feedback recorded yet.</p>
                ) : feedback.map(fb => (
                  <div key={fb.id} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${fb.action === "approved" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
                        {fb.action}
                      </span>
                      <span className="text-xs text-white flex-1 truncate">{fb.artifactTitle}</span>
                      <span className="text-[10px] text-slate-500">{new Date(fb.timestamp).toLocaleString()}</span>
                    </div>
                    {fb.instructions && (
                      <p className="text-xs text-slate-400 italic truncate ml-1">{fb.instructions}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* New Artifact */}
            {reviewTab === "new" && (
              <div className="flex-1 overflow-y-auto">
                <form onSubmit={handleCreateArtifact} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  <h2 className="text-sm font-semibold text-slate-300">New Draft Artifact</h2>
                  {createBanner && (
                    <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                      Artifact created successfully.
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Title</label>
                    <input
                      type="text" required value={newTitle} onChange={e => setNewTitle(e.target.value)}
                      placeholder="e.g. Q3 Press Release Draft"
                      className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-cyan-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Type</label>
                    <select
                      value={newType} onChange={e => setNewType(e.target.value as ArtifactType)}
                      className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm"
                    >
                      <option value="code">Code</option>
                      <option value="markdown">Markdown</option>
                      <option value="json">JSON</option>
                      <option value="csv">CSV</option>
                      <option value="legal">Legal</option>
                      <option value="prose">Prose</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Content</label>
                    <textarea
                      required rows={6} value={newContent} onChange={e => setNewContent(e.target.value)}
                      placeholder="Paste or type the artifact content…"
                      className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm font-mono resize-none focus:outline-none focus:border-cyan-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Agent Explanation (optional)</label>
                    <textarea
                      rows={2} value={newExplanation} onChange={e => setNewExplanation(e.target.value)}
                      placeholder="Why did the agent produce this? What assumptions were made?"
                      className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm resize-none focus:outline-none focus:border-cyan-500/50"
                    />
                  </div>
                  <button
                    type="submit" disabled={creatingArtifact}
                    className="w-full py-2.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
                  >
                    {creatingArtifact ? "Creating…" : "Create Artifact"}
                  </button>
                </form>
              </div>
            )}

            {/* Agent Chat */}
            <div className="flex-shrink-0">
              <AgentChat
                agentName="Technical Documentation Writer"
                agentRole="Draft & Review"
                steeringModes={draftSteeringModes}
                defaultGreeting="Hello! I can help you review draft artifacts, suggest improvements, check consistency, or refine content. Select an artifact and let me know what to focus on."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
