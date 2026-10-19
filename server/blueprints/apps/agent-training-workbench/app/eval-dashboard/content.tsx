"use client";

import { useState, useEffect, useCallback } from "react";
import { records, missions, events } from "../../lib/platform-client";
import type { AppRecord } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";

// ── Collections ───────────────────────────────────────────────────────────────
const COL_DATASETS = "eval_datasets";
const COL_RESULTS  = "eval_results";
const COL_CASES    = "eval_cases";

// ── Types ─────────────────────────────────────────────────────────────────────
interface EvalDataset extends AppRecord {
  name: string;
  description: string;
  caseCount: number;
  categories: string[];
  createdAt: string;
}

interface EvalRunResult extends AppRecord {
  datasetId: string;
  datasetName: string;
  agentVersion: string;
  runId: string;
  passed: number;
  failed: number;
  score: number;
  timestamp: string;
  breakdown: { category: string; passed: number; failed: number }[];
}

interface EvalCase extends AppRecord {
  datasetId: string;
  input: string;
  expectedOutput: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
}

type Tab = "scoreboard" | "breakdown" | "cases";

// ── Helpers ───────────────────────────────────────────────────────────────────
function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-rose-400";
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-emerald-500/20 border-emerald-500/30";
  if (score >= 60) return "bg-amber-500/20 border-amber-500/30";
  return "bg-rose-500/20 border-rose-500/30";
}

function difficultyBadge(difficulty: string) {
  const map: Record<string, string> = {
    easy:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    medium: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    hard:   "bg-rose-500/15 text-rose-400 border-rose-500/20",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[difficulty] ?? map.medium}`}>
      {difficulty}
    </span>
  );
}

function SkeletonRow() {
  return <div className="h-12 bg-white/5 rounded-lg animate-pulse mb-2" />;
}

const CATEGORY_OPTIONS = ["reasoning", "factual", "instruction-following", "safety", "coding", "math", "other"];

// ── Main component ────────────────────────────────────────────────────────────
export default function EvalDashboardContent() {
  const [activeTab, setActiveTab] = useState<Tab>("scoreboard");

  // Datasets
  const [datasets, setDatasets]           = useState<EvalDataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);

  // Results
  const [results, setResults]             = useState<EvalRunResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(true);

  // Cases
  const [cases, setCases]                 = useState<EvalCase[]>([]);
  const [casesLoading, setCasesLoading]   = useState(false);

  // New dataset form
  const [showNewDataset, setShowNewDataset] = useState(false);
  const [newDsName, setNewDsName]           = useState("");
  const [newDsDesc, setNewDsDesc]           = useState("");
  const [newDsCategories, setNewDsCategories] = useState<string[]>([]);
  const [creatingDs, setCreatingDs]         = useState(false);
  const [newDsError, setNewDsError]         = useState<string | null>(null);

  // Run eval
  const [running, setRunning]             = useState(false);
  const [runError, setRunError]           = useState<string | null>(null);
  const [runSuccess, setRunSuccess]       = useState<string | null>(null);

  // Add test case form
  const [showAddCase, setShowAddCase]     = useState(false);
  const [newCaseInput, setNewCaseInput]   = useState("");
  const [newCaseExpected, setNewCaseExpected] = useState("");
  const [newCaseCategory, setNewCaseCategory] = useState("reasoning");
  const [newCaseDifficulty, setNewCaseDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [addingCase, setAddingCase]       = useState(false);
  const [addCaseError, setAddCaseError]   = useState<string | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchDatasets = useCallback(async () => {
    setDatasetsLoading(true);
    try {
      const data = await records.list(COL_DATASETS);
      setDatasets(data as EvalDataset[]);
      if (data.length > 0 && !selectedDatasetId) {
        setSelectedDatasetId(data[0].id);
      }
    } catch {
      // silent
    } finally {
      setDatasetsLoading(false);
    }
  }, [selectedDatasetId]);

  const fetchResults = useCallback(async () => {
    setResultsLoading(true);
    try {
      const data = await records.list(COL_RESULTS);
      const sorted = (data as EvalRunResult[]).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      setResults(sorted);
    } catch {
      // silent
    } finally {
      setResultsLoading(false);
    }
  }, []);

  const fetchCases = useCallback(async () => {
    if (!selectedDatasetId) return;
    setCasesLoading(true);
    try {
      const data = await records.list(COL_CASES);
      setCases((data as EvalCase[]).filter((c) => c.datasetId === selectedDatasetId));
    } catch {
      // silent
    } finally {
      setCasesLoading(false);
    }
  }, [selectedDatasetId]);

  useEffect(() => {
    fetchDatasets();
    fetchResults();
  }, [fetchDatasets, fetchResults]);

  useEffect(() => {
    if (selectedDatasetId) fetchCases();
  }, [selectedDatasetId, fetchCases]);

  useEffect(() => {
    const unsub = events.subscribe((ev) => {
      if (ev.type === "mission.completed") {
        fetchResults();
        fetchDatasets();
      }
    });
    return unsub;
  }, [fetchResults, fetchDatasets]);

  // ── Create dataset ─────────────────────────────────────────────────────────
  const handleCreateDataset = async () => {
    if (!newDsName.trim()) { setNewDsError("Name is required."); return; }
    setCreatingDs(true);
    setNewDsError(null);
    try {
      const created = await records.create(COL_DATASETS, {
        name:        newDsName.trim(),
        description: newDsDesc.trim(),
        caseCount:   0,
        categories:  newDsCategories,
        createdAt:   new Date().toISOString(),
      });
      setDatasets((prev) => [...prev, created as EvalDataset]);
      setSelectedDatasetId(created.id);
      setNewDsName("");
      setNewDsDesc("");
      setNewDsCategories([]);
      setShowNewDataset(false);
    } catch (e: unknown) {
      setNewDsError(e instanceof Error ? e.message : "Failed to create dataset.");
    } finally {
      setCreatingDs(false);
    }
  };

  // ── Run evaluation ─────────────────────────────────────────────────────────
  const handleRunEval = async () => {
    if (!selectedDatasetId) return;
    const ds = datasets.find((d) => d.id === selectedDatasetId);
    setRunning(true);
    setRunError(null);
    setRunSuccess(null);
    try {
      const result = await missions.trigger("Evaluation Run", {
        datasetId:    selectedDatasetId,
        datasetName:  ds?.name ?? "Unknown Dataset",
        agentVersion: "v" + Date.now(),
        triggeredBy:  "eval-dashboard",
      });
      setRunSuccess(`Evaluation queued — run #${result.runId}`);
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : "Failed to trigger evaluation.");
    } finally {
      setRunning(false);
    }
  };

  // ── Add test case ──────────────────────────────────────────────────────────
  const handleAddCase = async () => {
    if (!newCaseInput.trim() || !newCaseExpected.trim()) {
      setAddCaseError("Input and expected output are required.");
      return;
    }
    if (!selectedDatasetId) { setAddCaseError("Select a dataset first."); return; }
    setAddingCase(true);
    setAddCaseError(null);
    try {
      const created = await records.create(COL_CASES, {
        datasetId:      selectedDatasetId,
        input:          newCaseInput.trim(),
        expectedOutput: newCaseExpected.trim(),
        category:       newCaseCategory,
        difficulty:     newCaseDifficulty,
      });
      setCases((prev) => [...prev, created as EvalCase]);
      setNewCaseInput("");
      setNewCaseExpected("");
      setNewCaseCategory("reasoning");
      setNewCaseDifficulty("medium");
      setShowAddCase(false);
    } catch (e: unknown) {
      setAddCaseError(e instanceof Error ? e.message : "Failed to add test case.");
    } finally {
      setAddingCase(false);
    }
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  const selectedDataset = datasets.find((d) => d.id === selectedDatasetId);
  const datasetResults  = results.filter((r) => r.datasetId === selectedDatasetId);
  const latestRun       = datasetResults[0] ?? null;
  const last5Runs       = datasetResults.slice(0, 5);

  // Category breakdown aggregated across the latest run
  const breakdownCategories: { category: string; passed: number; failed: number; total: number; rate: number }[] =
    latestRun?.breakdown?.map((b) => ({
      ...b,
      total: b.passed + b.failed,
      rate:  b.passed + b.failed > 0 ? Math.round((b.passed / (b.passed + b.failed)) * 100) : 0,
    })) ?? [];

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-2xl">🎯</span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">Eval Dashboard</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Load evaluation datasets, run benchmarks, and visualize agent performance across versions.
            </p>
          </div>
        </div>

        {/* 3-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* ── Left sidebar (1/4) ─────────────────────────────────────────── */}
          <div className="lg:col-span-1 space-y-4">

            {/* Dataset list */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-300">Datasets</h2>
                <button
                  onClick={() => setShowNewDataset((v) => !v)}
                  className="text-xs text-orange-400 hover:text-orange-300 font-semibold"
                >
                  {showNewDataset ? "Cancel" : "+ New"}
                </button>
              </div>

              {/* New dataset form */}
              {showNewDataset && (
                <div className="mb-3 p-3 bg-white/5 rounded-lg border border-white/10 space-y-2">
                  <input
                    type="text"
                    value={newDsName}
                    onChange={(e) => setNewDsName(e.target.value)}
                    placeholder="Dataset name"
                    className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
                  />
                  <input
                    type="text"
                    value={newDsDesc}
                    onChange={(e) => setNewDsDesc(e.target.value)}
                    placeholder="Description"
                    className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
                  />
                  <div className="flex flex-wrap gap-1">
                    {CATEGORY_OPTIONS.map((cat) => (
                      <button
                        key={cat}
                        onClick={() =>
                          setNewDsCategories((prev) =>
                            prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
                          )
                        }
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                          newDsCategories.includes(cat)
                            ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                            : "bg-white/5 text-slate-500 border-white/10 hover:border-white/20"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  {newDsError && <p className="text-xs text-rose-400">{newDsError}</p>}
                  <button
                    onClick={handleCreateDataset}
                    disabled={creatingDs}
                    className="w-full py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    {creatingDs ? "Creating…" : "Create Dataset"}
                  </button>
                </div>
              )}

              {datasetsLoading && [1, 2, 3].map((i) => <SkeletonRow key={i} />)}
              {!datasetsLoading && datasets.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-6">No datasets yet.</p>
              )}
              {datasets.map((ds) => (
                <button
                  key={ds.id}
                  onClick={() => setSelectedDatasetId(ds.id)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors mb-1.5 ${
                    selectedDatasetId === ds.id
                      ? "bg-orange-500/10 border-orange-500/30 text-orange-300"
                      : "bg-white/3 border-white/5 hover:border-white/15 text-slate-300"
                  }`}
                >
                  <p className="text-xs font-semibold truncate">{ds.name}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 truncate">{ds.description || "No description"}</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">{ds.caseCount ?? 0} cases</p>
                </button>
              ))}
            </div>

            {/* Run evaluation */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-300">Run Evaluation</h2>
              {selectedDataset ? (
                <p className="text-xs text-slate-400">
                  Dataset: <span className="text-orange-300 font-semibold">{selectedDataset.name}</span>
                </p>
              ) : (
                <p className="text-xs text-slate-500">Select a dataset to run.</p>
              )}
              {runError && <p className="text-xs text-rose-400">{runError}</p>}
              {runSuccess && <p className="text-xs text-emerald-400">{runSuccess}</p>}
              <button
                onClick={handleRunEval}
                disabled={running || !selectedDatasetId}
                className="w-full py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
              >
                {running ? "Queuing…" : "Run Evaluation"}
              </button>
            </div>
          </div>

          {/* ── Center (2/4) ───────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Tabs */}
            <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
              {(["scoreboard", "breakdown", "cases"] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                    activeTab === tab
                      ? "bg-orange-600 text-white shadow"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab === "scoreboard" ? "Scoreboard" : tab === "breakdown" ? "Per-Category" : "Test Cases"}
                </button>
              ))}
            </div>

            {/* ── Tab: Scoreboard ── */}
            {activeTab === "scoreboard" && (
              <div className="space-y-4">
                {/* Latest run stats */}
                {resultsLoading && <SkeletonRow />}
                {!resultsLoading && !latestRun && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center">
                    <p className="text-slate-400 text-sm">No evaluation runs yet.</p>
                    <p className="text-slate-600 text-xs mt-1">Trigger an evaluation to see results here.</p>
                  </div>
                )}
                {latestRun && (
                  <div className={`border rounded-xl p-5 ${scoreBg(latestRun.score)}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Latest Run</p>
                        <p className="text-xs text-slate-500">{latestRun.agentVersion} · {new Date(latestRun.timestamp).toLocaleString()}</p>
                      </div>
                      <span className={`text-4xl font-black tabular-nums ${scoreColor(latestRun.score)}`}>
                        {latestRun.score}%
                      </span>
                    </div>
                    <div className="flex gap-4 mt-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-sm font-bold text-emerald-300">{latestRun.passed}</span>
                        <span className="text-xs text-slate-500">passed</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-rose-400" />
                        <span className="text-sm font-bold text-rose-300">{latestRun.failed}</span>
                        <span className="text-xs text-slate-500">failed</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Historical runs table */}
                {datasetResults.length > 0 && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-slate-300 mb-3">Historical Runs</h2>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-white/10">
                          <th className="text-left pb-2 font-semibold">Version</th>
                          <th className="text-left pb-2 font-semibold">Date</th>
                          <th className="text-center pb-2 font-semibold">Score</th>
                          <th className="text-center pb-2 font-semibold">Pass</th>
                          <th className="text-center pb-2 font-semibold">Fail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {datasetResults.map((r) => (
                          <tr key={r.id} className="border-b border-white/5 hover:bg-white/3">
                            <td className="py-2 text-slate-300 font-mono">{r.agentVersion}</td>
                            <td className="py-2 text-slate-500">{new Date(r.timestamp).toLocaleDateString()}</td>
                            <td className={`py-2 text-center font-bold tabular-nums ${scoreColor(r.score)}`}>{r.score}%</td>
                            <td className="py-2 text-center text-emerald-400 font-semibold">{r.passed}</td>
                            <td className="py-2 text-center text-rose-400 font-semibold">{r.failed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Score trend bars */}
                {last5Runs.length > 1 && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-slate-300 mb-3">Score Trend (Last {last5Runs.length} Runs)</h2>
                    <div className="space-y-2">
                      {[...last5Runs].reverse().map((r) => (
                        <div key={r.id} className="flex items-center gap-3">
                          <span className="text-[10px] text-slate-500 font-mono w-24 shrink-0 truncate">{r.agentVersion}</span>
                          <div className="flex-1 bg-white/5 rounded-full h-4 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                r.score >= 80 ? "bg-emerald-500/60" : r.score >= 60 ? "bg-amber-500/60" : "bg-rose-500/60"
                              }`}
                              style={{ width: `${r.score}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold tabular-nums w-10 text-right shrink-0 ${scoreColor(r.score)}`}>
                            {r.score}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Per-Category Breakdown ── */}
            {activeTab === "breakdown" && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-4">
                  Category Breakdown
                  {latestRun && (
                    <span className="ml-2 text-xs font-normal text-slate-500">({latestRun.agentVersion})</span>
                  )}
                </h2>
                {!latestRun && (
                  <p className="text-sm text-slate-500 text-center py-8">No run data available. Run an evaluation first.</p>
                )}
                {breakdownCategories.length === 0 && latestRun && (
                  <p className="text-sm text-slate-500 text-center py-8">No category breakdown data in this run.</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {breakdownCategories.map((cat) => (
                    <div
                      key={cat.category}
                      className={`p-3 rounded-xl border ${
                        cat.rate < 60
                          ? "bg-rose-500/5 border-rose-500/20"
                          : "bg-white/3 border-white/10"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-300 capitalize">{cat.category}</span>
                        <span className={`text-xs font-bold tabular-nums ${scoreColor(cat.rate)}`}>{cat.rate}%</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-2 mb-1.5">
                        <div
                          className={`h-2 rounded-full ${cat.rate >= 80 ? "bg-emerald-500" : cat.rate >= 60 ? "bg-amber-500" : "bg-rose-500"}`}
                          style={{ width: `${cat.rate}%` }}
                        />
                      </div>
                      <div className="flex gap-3 text-[10px] text-slate-500">
                        <span className="text-emerald-500">{cat.passed} pass</span>
                        <span className="text-rose-500">{cat.failed} fail</span>
                        <span>{cat.total} total</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Tab: Test Cases ── */}
            {activeTab === "cases" && (
              <div className="space-y-4">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-300">
                      Test Cases
                      {selectedDataset && (
                        <span className="ml-2 text-xs font-normal text-slate-500">({selectedDataset.name})</span>
                      )}
                    </h2>
                    <button
                      onClick={() => setShowAddCase((v) => !v)}
                      className="text-xs text-orange-400 hover:text-orange-300 font-semibold"
                    >
                      {showAddCase ? "Cancel" : "+ Add Case"}
                    </button>
                  </div>

                  {/* Add case form */}
                  {showAddCase && (
                    <div className="mb-4 p-3 bg-white/5 rounded-lg border border-white/10 space-y-2">
                      <textarea
                        value={newCaseInput}
                        onChange={(e) => setNewCaseInput(e.target.value)}
                        placeholder="Input prompt / question"
                        rows={3}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
                      />
                      <textarea
                        value={newCaseExpected}
                        onChange={(e) => setNewCaseExpected(e.target.value)}
                        placeholder="Expected output / answer"
                        rows={3}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
                      />
                      <div className="flex gap-2">
                        <select
                          value={newCaseCategory}
                          onChange={(e) => setNewCaseCategory(e.target.value)}
                          className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-orange-500"
                        >
                          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select
                          value={newCaseDifficulty}
                          onChange={(e) => setNewCaseDifficulty(e.target.value as "easy" | "medium" | "hard")}
                          className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-orange-500"
                        >
                          <option value="easy">Easy</option>
                          <option value="medium">Medium</option>
                          <option value="hard">Hard</option>
                        </select>
                      </div>
                      {addCaseError && <p className="text-xs text-rose-400">{addCaseError}</p>}
                      <button
                        onClick={handleAddCase}
                        disabled={addingCase}
                        className="w-full py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                      >
                        {addingCase ? "Adding…" : "Add Test Case"}
                      </button>
                    </div>
                  )}

                  {casesLoading && [1, 2, 3].map((i) => <SkeletonRow key={i} />)}
                  {!casesLoading && cases.length === 0 && (
                    <p className="text-xs text-slate-500 text-center py-8">No test cases yet. Add one above.</p>
                  )}
                  {cases.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 border-b border-white/10">
                            <th className="text-left pb-2 font-semibold w-16">Difficulty</th>
                            <th className="text-left pb-2 font-semibold">Input</th>
                            <th className="text-left pb-2 font-semibold">Expected</th>
                            <th className="text-left pb-2 font-semibold w-24">Category</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cases.map((c) => (
                            <tr key={c.id} className="border-b border-white/5 hover:bg-white/3">
                              <td className="py-2 pr-3">{difficultyBadge(c.difficulty)}</td>
                              <td className="py-2 pr-3 text-slate-300 max-w-[180px]">
                                <span title={c.input} className="block truncate">{c.input}</span>
                              </td>
                              <td className="py-2 pr-3 text-slate-400 max-w-[180px]">
                                <span title={c.expectedOutput} className="block truncate">{c.expectedOutput}</span>
                              </td>
                              <td className="py-2 text-slate-500 capitalize">{c.category}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Right panel (1/4) ──────────────────────────────────────────── */}
          <div className="lg:col-span-1">
            <AgentChat
              agentName="AI Evaluator"
              agentRole="Evaluation & Benchmarking Specialist"
              defaultGreeting="Hello! I'm your AI Evaluator. I can help you analyze agent performance, design evaluation criteria, interpret benchmark scores, and identify areas for improvement. What would you like to explore about your evaluation results?"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
