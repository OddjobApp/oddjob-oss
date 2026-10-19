"use client";

import { useState, useEffect, useCallback } from "react";
import { records, missions, events } from "../../lib/platform-client";
import type { AppRecord } from "../../lib/platform-client";

const COL_PAIRS    = "training_pairs";
const COL_VERSIONS = "prompt_versions";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TrainingPair extends AppRecord {
  input: string;
  idealOutput: string;
  source: string;
  category: string;
  approved: boolean;
  qualityScore: number;
  createdAt: string;
}

interface PromptVersion extends AppRecord {
  agentName: string;
  version: string;
  promptText: string;
  benchmark: number;
  createdAt: string;
  notes: string;
  status: "draft" | "active" | "archived";
}

type Tab = "pairs" | "versions" | "generate";
type PairFilter = "all" | "approved" | "unapproved";

const CATEGORY_OPTIONS = ["reasoning", "tool-use", "summarisation", "classification", "extraction", "planning", "other"];

// ── Quality bar ───────────────────────────────────────────────────────────────
function QualityBar({ score }: { score: number }) {
  const pct = Math.min(Math.max(score / 10, 0), 1) * 100;
  const color = score >= 8 ? "bg-emerald-500" : score >= 5 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-slate-400 w-6 text-right">{score}</span>
    </div>
  );
}

// ── Benchmark colour ──────────────────────────────────────────────────────────
function benchmarkColor(score: number) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-rose-400";
}

// ── Version status badge ──────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:   "bg-teal-500/15 border-teal-500/20 text-teal-400",
    draft:    "bg-amber-500/15 border-amber-500/20 text-amber-400",
    archived: "bg-slate-700/30 border-slate-600 text-slate-500",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[status] ?? map.draft}`}>
      {status}
    </span>
  );
}

// ── Horizontal benchmark bar chart ────────────────────────────────────────────
function BenchmarkTrajectory({ versions }: { versions: PromptVersion[] }) {
  const last8 = [...versions]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-8);
  if (last8.length === 0) return null;
  const max = Math.max(...last8.map((v) => v.benchmark), 100);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Performance Trajectory</p>
      <div className="space-y-2">
        {last8.map((v) => {
          const pct = (v.benchmark / max) * 100;
          const color = v.benchmark >= 80 ? "bg-emerald-500" : v.benchmark >= 60 ? "bg-amber-500" : "bg-rose-500";
          return (
            <div key={v.id} className="flex items-center gap-3">
              <span className="text-[11px] text-slate-500 w-8 shrink-0 font-mono">v{v.version}</span>
              <div className="flex-1 h-4 bg-white/5 rounded overflow-hidden">
                <div
                  className={`h-full rounded ${color} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`text-[11px] font-mono w-8 text-right ${benchmarkColor(v.benchmark)}`}>
                {v.benchmark}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TrainingCorpusContent() {
  const [activeTab, setActiveTab] = useState<Tab>("pairs");

  // Agent selector
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  const [statusFilter, setStatusFilter]   = useState<"all" | "draft" | "active" | "archived">("all");

  // Training pairs
  const [pairs, setPairs]                   = useState<TrainingPair[]>([]);
  const [pairsLoading, setPairsLoading]     = useState(true);
  const [pairFilter, setPairFilter]         = useState<PairFilter>("all");
  const [selectedPairs, setSelectedPairs]   = useState<Set<string>>(new Set());

  // Add pair form
  const [showAddPair, setShowAddPair]       = useState(false);
  const [pairInput, setPairInput]           = useState("");
  const [pairOutput, setPairOutput]         = useState("");
  const [pairSource, setPairSource]         = useState("");
  const [pairCategory, setPairCategory]     = useState(CATEGORY_OPTIONS[0]);
  const [pairQuality, setPairQuality]       = useState(7);
  const [addingPair, setAddingPair]         = useState(false);

  // Prompt versions
  const [versions, setVersions]             = useState<PromptVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);

  // New version form
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [nvAgent, setNvAgent]               = useState("");
  const [nvVersion, setNvVersion]           = useState("");
  const [nvPrompt, setNvPrompt]             = useState("");
  const [nvBenchmark, setNvBenchmark]       = useState(70);
  const [nvNotes, setNvNotes]               = useState("");
  const [creatingVersion, setCreatingVersion] = useState(false);

  // Generate form
  const [genIntent, setGenIntent]           = useState("");
  const [genCategory, setGenCategory]       = useState(CATEGORY_OPTIONS[0]);
  const [genCount, setGenCount]             = useState(10);
  const [genQuality, setGenQuality]         = useState(7);
  const [generating, setGenerating]         = useState(false);
  const [genDone, setGenDone]               = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchPairs = useCallback(async () => {
    try {
      const data = await records.list(COL_PAIRS);
      setPairs(
        (data as TrainingPair[]).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      );
    } catch { /* non-fatal */ }
    finally { setPairsLoading(false); }
  }, []);

  const fetchVersions = useCallback(async () => {
    try {
      const data = await records.list(COL_VERSIONS);
      setVersions(
        (data as PromptVersion[]).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      );
    } catch { /* non-fatal */ }
    finally { setVersionsLoading(false); }
  }, []);

  useEffect(() => {
    fetchPairs();
    fetchVersions();
    const unsub = events.subscribe((ev) => {
      if (["mission.completed"].includes(ev.type)) {
        fetchPairs();
        fetchVersions();
      }
    });
    return unsub;
  }, [fetchPairs, fetchVersions]);

  // ── Derived data ───────────────────────────────────────────────────────────
  const agentNames = ["all", ...Array.from(new Set(versions.map((v) => v.agentName))).filter(Boolean)];

  const filteredVersions = versions.filter((v) => {
    if (selectedAgent !== "all" && v.agentName !== selectedAgent) return false;
    if (statusFilter !== "all" && v.status !== statusFilter) return false;
    return true;
  });

  const filteredPairs = pairs.filter((p) => {
    if (pairFilter === "approved") return p.approved;
    if (pairFilter === "unapproved") return !p.approved;
    return true;
  });

  const approvedCount = pairs.filter((p) => p.approved).length;
  const activeVersionCount = versions.filter((v) => v.status === "active").length;

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleToggleApproved = async (pair: TrainingPair) => {
    try {
      const updated = await records.update(COL_PAIRS, pair.id, { approved: !pair.approved });
      setPairs((prev) => prev.map((p) => (p.id === pair.id ? { ...p, ...(updated as TrainingPair) } : p)));
    } catch { /* ignore */ }
  };

  const handleAddPair = async () => {
    if (!pairInput.trim() || !pairOutput.trim()) return;
    setAddingPair(true);
    try {
      await records.create(COL_PAIRS, {
        input: pairInput.trim(),
        idealOutput: pairOutput.trim(),
        source: pairSource.trim() || "manual",
        category: pairCategory,
        approved: false,
        qualityScore: pairQuality,
        createdAt: new Date().toISOString(),
      });
      setPairInput(""); setPairOutput(""); setPairSource("");
      setPairCategory(CATEGORY_OPTIONS[0]); setPairQuality(7);
      setShowAddPair(false);
      fetchPairs();
    } finally {
      setAddingPair(false);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedPairs.size === 0) return;
    await Promise.allSettled(
      Array.from(selectedPairs).map((id) => {
        const pair = pairs.find((p) => p.id === id);
        if (pair) return records.update(COL_PAIRS, id, { approved: true });
      })
    );
    setSelectedPairs(new Set());
    fetchPairs();
  };

  const handleExportJSONL = () => {
    const approved = pairs.filter((p) => p.approved);
    if (approved.length === 0) return;
    const lines = approved.map((p) =>
      JSON.stringify({ input: p.input, ideal_output: p.idealOutput, category: p.category, source: p.source })
    ).join("\n");
    const blob = new Blob([lines], { type: "application/jsonlines" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "training_pairs.jsonl";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateVersion = async () => {
    if (!nvAgent.trim() || !nvVersion.trim() || !nvPrompt.trim()) return;
    setCreatingVersion(true);
    try {
      await records.create(COL_VERSIONS, {
        agentName: nvAgent.trim(),
        version:   nvVersion.trim(),
        promptText: nvPrompt.trim(),
        benchmark:  nvBenchmark,
        notes:      nvNotes.trim(),
        status:     "draft",
        createdAt:  new Date().toISOString(),
      });
      setNvAgent(""); setNvVersion(""); setNvPrompt(""); setNvBenchmark(70); setNvNotes("");
      setShowNewVersion(false);
      fetchVersions();
    } finally {
      setCreatingVersion(false);
    }
  };

  const handleSetActive = async (version: PromptVersion) => {
    // Archive all others for same agent, set this one active
    await Promise.allSettled(
      versions
        .filter((v) => v.agentName === version.agentName && v.id !== version.id && v.status === "active")
        .map((v) => records.update(COL_VERSIONS, v.id, { status: "archived" }))
    );
    await records.update(COL_VERSIONS, version.id, { status: "active" });
    fetchVersions();
  };

  const handleGenerate = async () => {
    if (!genIntent.trim()) return;
    setGenerating(true);
    setGenDone(false);
    try {
      await missions.trigger("Synthetic Data Generation", {
        intent:          genIntent.trim(),
        category:        genCategory,
        count:           genCount,
        qualityThreshold: genQuality,
        triggeredBy:     "training-corpus",
      });
      setGenDone(true);
      setGenIntent("");
    } finally {
      setGenerating(false);
    }
  };

  const inputBase =
    "w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500";

  return (
    <div className="min-h-screen bg-[#090d16] text-white flex">

      {/* ── Left sidebar ── */}
      <aside className="w-64 shrink-0 border-r border-white/10 p-4 space-y-5 h-screen sticky top-0 overflow-y-auto">
        <div>
          <h1 className="text-base font-bold text-white leading-tight">Training Corpus</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Manage pairs & prompt versions</p>
        </div>

        {/* Agent selector */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Agent</p>
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
          >
            {agentNames.map((n) => (
              <option key={n} value={n}>{n === "all" ? "All Agents" : n}</option>
            ))}
          </select>
        </div>

        {/* Status filter */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Status Filter</p>
          <div className="space-y-1">
            {(["all", "draft", "active", "archived"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                  statusFilter === s
                    ? "bg-teal-700/30 text-teal-300 border border-teal-500/20"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {s === "all" ? "All Statuses" : s}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-2 bg-white/5 border border-white/10 rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Stats</p>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Total pairs</span>
              <span className="text-xs font-mono text-white">{pairs.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Approved</span>
              <span className="text-xs font-mono text-emerald-400">{approvedCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Active versions</span>
              <span className="text-xs font-mono text-teal-400">{activeVersionCount}</span>
            </div>
          </div>
        </div>

        {/* Export */}
        <button
          onClick={handleExportJSONL}
          disabled={approvedCount === 0}
          className="w-full py-2 bg-teal-700/20 hover:bg-teal-700/40 border border-teal-500/20 text-teal-400 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Export JSONL ({approvedCount})
        </button>
      </aside>

      {/* ── Main area ── */}
      <main className="flex-1 p-6 overflow-y-auto min-h-screen">

        {/* Tabs */}
        <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit mb-6">
          {(["pairs", "versions", "generate"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                activeTab === tab
                  ? "bg-teal-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {tab === "pairs" ? "Training Pairs" : tab === "versions" ? "Prompt Versions" : "Generate & Refine"}
            </button>
          ))}
        </div>

        {/* ── Tab: Training Pairs ── */}
        {activeTab === "pairs" && (
          <div className="space-y-4">

            {/* Toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-1 bg-white/5 rounded-lg p-1">
                {(["all", "approved", "unapproved"] as PairFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setPairFilter(f)}
                    className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                      pairFilter === f ? "bg-white/10 text-white" : "text-slate-500 hover:text-white"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {selectedPairs.size > 0 && (
                  <button
                    onClick={handleBulkApprove}
                    className="px-3 py-1.5 bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg transition-colors"
                  >
                    Approve Selected ({selectedPairs.size})
                  </button>
                )}
                <button
                  onClick={() => setShowAddPair((x) => !x)}
                  className="px-3 py-1.5 bg-teal-700/20 hover:bg-teal-700/40 border border-teal-500/20 text-teal-400 text-xs font-semibold rounded-lg transition-colors"
                >
                  {showAddPair ? "Cancel" : "+ Add Pair"}
                </button>
              </div>
            </div>

            {/* Add pair form */}
            {showAddPair && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-300">New Training Pair</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Input</label>
                    <textarea
                      rows={4}
                      value={pairInput}
                      onChange={(e) => setPairInput(e.target.value)}
                      placeholder="User prompt / input…"
                      className={`${inputBase} resize-none`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Ideal Output</label>
                    <textarea
                      rows={4}
                      value={pairOutput}
                      onChange={(e) => setPairOutput(e.target.value)}
                      placeholder="Expected ideal response…"
                      className={`${inputBase} resize-none`}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Source</label>
                    <input type="text" value={pairSource} onChange={(e) => setPairSource(e.target.value)} placeholder="e.g. manual, eval-run" className={inputBase} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Category</label>
                    <select value={pairCategory} onChange={(e) => setPairCategory(e.target.value)} className={inputBase}>
                      {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Quality Score (0–10)</label>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="range" min={0} max={10} step={1} value={pairQuality}
                        onChange={(e) => setPairQuality(Number(e.target.value))}
                        className="flex-1 accent-teal-500"
                      />
                      <span className="text-sm font-mono text-white w-6 text-center">{pairQuality}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleAddPair}
                  disabled={addingPair || !pairInput.trim() || !pairOutput.trim()}
                  className="px-4 py-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {addingPair ? "Adding…" : "Add Training Pair"}
                </button>
              </div>
            )}

            {/* Pairs table */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              {pairsLoading && (
                <div className="p-4 space-y-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-white/5 rounded-lg animate-pulse" />)}
                </div>
              )}
              {!pairsLoading && filteredPairs.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                  <p className="text-sm">No training pairs found.</p>
                </div>
              )}
              {filteredPairs.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="p-3 text-left w-6">
                        <input
                          type="checkbox"
                          checked={selectedPairs.size === filteredPairs.length && filteredPairs.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedPairs(new Set(filteredPairs.map((p) => p.id)));
                            else setSelectedPairs(new Set());
                          }}
                          className="accent-teal-500"
                        />
                      </th>
                      <th className="p-3 text-left text-slate-400 font-semibold">Quality</th>
                      <th className="p-3 text-left text-slate-400 font-semibold">Input</th>
                      <th className="p-3 text-left text-slate-400 font-semibold">Ideal Output</th>
                      <th className="p-3 text-left text-slate-400 font-semibold">Category</th>
                      <th className="p-3 text-left text-slate-400 font-semibold">Source</th>
                      <th className="p-3 text-center text-slate-400 font-semibold">Approved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPairs.map((pair) => (
                      <tr key={pair.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selectedPairs.has(pair.id)}
                            onChange={(e) => {
                              const next = new Set(selectedPairs);
                              if (e.target.checked) next.add(pair.id); else next.delete(pair.id);
                              setSelectedPairs(next);
                            }}
                            className="accent-teal-500"
                          />
                        </td>
                        <td className="p-3"><QualityBar score={pair.qualityScore} /></td>
                        <td className="p-3 text-slate-300 max-w-[160px]">
                          <span className="line-clamp-2">{pair.input}</span>
                        </td>
                        <td className="p-3 text-slate-400 max-w-[160px]">
                          <span className="line-clamp-2">{pair.idealOutput}</span>
                        </td>
                        <td className="p-3">
                          <span className="px-1.5 py-0.5 rounded bg-white/8 text-slate-400 border border-white/10 text-[10px]">
                            {pair.category}
                          </span>
                        </td>
                        <td className="p-3 text-slate-500">{pair.source}</td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleToggleApproved(pair)}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-colors ${
                              pair.approved
                                ? "bg-emerald-500 border-emerald-500"
                                : "border-slate-600 hover:border-slate-400"
                            }`}
                          >
                            {pair.approved && <span className="text-white text-[10px] font-bold">✓</span>}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Prompt Versions ── */}
        {activeTab === "versions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{filteredVersions.length} versions</span>
              <button
                onClick={() => setShowNewVersion((x) => !x)}
                className="px-3 py-1.5 bg-teal-700/20 hover:bg-teal-700/40 border border-teal-500/20 text-teal-400 text-xs font-semibold rounded-lg transition-colors"
              >
                {showNewVersion ? "Cancel" : "+ New Version"}
              </button>
            </div>

            {/* New version form */}
            {showNewVersion && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-300">New Prompt Version</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Agent Name</label>
                    <input type="text" value={nvAgent} onChange={(e) => setNvAgent(e.target.value)} placeholder="e.g. research-analyst" className={inputBase} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Version</label>
                    <input type="text" value={nvVersion} onChange={(e) => setNvVersion(e.target.value)} placeholder="e.g. 3.2" className={inputBase} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Benchmark Score (0–100)</label>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="range" min={0} max={100} step={1} value={nvBenchmark}
                        onChange={(e) => setNvBenchmark(Number(e.target.value))}
                        className="flex-1 accent-teal-500"
                      />
                      <span className="text-sm font-mono text-white w-8 text-center">{nvBenchmark}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Prompt Text</label>
                  <textarea rows={5} value={nvPrompt} onChange={(e) => setNvPrompt(e.target.value)} placeholder="Full system prompt…" className={`${inputBase} resize-none font-mono`} />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Notes</label>
                  <input type="text" value={nvNotes} onChange={(e) => setNvNotes(e.target.value)} placeholder="What changed in this version…" className={inputBase} />
                </div>
                <button
                  onClick={handleCreateVersion}
                  disabled={creatingVersion || !nvAgent.trim() || !nvVersion.trim() || !nvPrompt.trim()}
                  className="px-4 py-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {creatingVersion ? "Creating…" : "Create Version"}
                </button>
              </div>
            )}

            {/* Performance trajectory */}
            {filteredVersions.length > 0 && (
              <BenchmarkTrajectory versions={filteredVersions} />
            )}

            {/* Version cards */}
            {versionsLoading && (
              <div className="space-y-3">
                {[1, 2].map((i) => <div key={i} className="h-24 bg-white/5 rounded-xl animate-pulse" />)}
              </div>
            )}
            {!versionsLoading && filteredVersions.length === 0 && (
              <div className="text-center py-12 bg-white/3 border border-white/8 rounded-xl text-slate-500">
                <p className="text-sm">No versions found.</p>
              </div>
            )}
            <div className="space-y-3">
              {filteredVersions.map((v) => (
                <div
                  key={v.id}
                  className={`bg-white/5 border rounded-xl p-4 space-y-3 transition-all ${
                    v.status === "active"
                      ? "border-teal-500/40 ring-1 ring-teal-500/40"
                      : "border-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md bg-white/10 text-white text-xs font-mono font-bold">
                        v{v.version}
                      </span>
                      <span className="text-sm font-semibold text-white">{v.agentName}</span>
                      <StatusBadge status={v.status} />
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-2xl font-bold font-mono ${benchmarkColor(v.benchmark)}`}>
                        {v.benchmark}
                      </span>
                      <span className="text-[10px] text-slate-600">
                        {new Date(v.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {v.notes && <p className="text-xs text-slate-400">{v.notes}</p>}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setExpandedVersionId(expandedVersionId === v.id ? null : v.id)}
                      className="px-3 py-1 text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
                    >
                      {expandedVersionId === v.id ? "Hide Prompt" : "View Prompt"}
                    </button>
                    {v.status !== "active" && (
                      <button
                        onClick={() => handleSetActive(v)}
                        className="px-3 py-1 text-xs text-teal-400 hover:text-teal-300 border border-teal-500/20 hover:border-teal-500/40 rounded-lg transition-colors"
                      >
                        Set as Active
                      </button>
                    )}
                  </div>

                  {expandedVersionId === v.id && (
                    <div className="bg-slate-950/60 border border-white/5 rounded-lg p-3 overflow-x-auto max-h-48">
                      <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap">{v.promptText}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tab: Generate & Refine ── */}
        {activeTab === "generate" && (
          <div className="max-w-2xl space-y-5">
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-300">Generate Synthetic Training Pairs</h2>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Intent</label>
                <textarea
                  rows={4}
                  value={genIntent}
                  onChange={(e) => setGenIntent(e.target.value)}
                  placeholder="Describe what training pairs you want generated…"
                  className={`${inputBase} resize-none`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Category</label>
                  <select value={genCategory} onChange={(e) => setGenCategory(e.target.value)} className={inputBase}>
                    {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Target Count</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={genCount}
                    onChange={(e) => setGenCount(Number(e.target.value))}
                    className={inputBase}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Quality Threshold (0–10)</label>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="range" min={0} max={10} step={1} value={genQuality}
                      onChange={(e) => setGenQuality(Number(e.target.value))}
                      className="flex-1 accent-teal-500"
                    />
                    <span className="text-sm font-mono text-white w-6 text-center">{genQuality}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating || !genIntent.trim()}
                className="w-full py-2.5 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {generating ? "Triggering mission…" : "Generate with AI"}
              </button>

              {genDone && (
                <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                  Generation mission triggered. Pairs will appear in the Training Pairs tab when the mission completes.
                </p>
              )}
            </div>

            {/* Tips panel */}
            <div className="bg-white/3 border border-white/8 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Best Practices</p>
              <ul className="space-y-1.5 text-xs text-slate-500">
                <li>— Specify the <span className="text-slate-300">exact task type</span> in your intent (classification, extraction, Q&amp;A, etc.)</li>
                <li>— Include <span className="text-slate-300">edge cases and failure modes</span> you want the model to handle</li>
                <li>— Keep quality threshold at 7+ for fine-tuning datasets; lower for exploration</li>
                <li>— Aim for <span className="text-slate-300">diverse inputs</span>: varied phrasing, length, and complexity</li>
                <li>— Review and manually approve pairs before including in a fine-tuning run</li>
                <li>— Export approved pairs as JSONL from the sidebar when ready</li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
