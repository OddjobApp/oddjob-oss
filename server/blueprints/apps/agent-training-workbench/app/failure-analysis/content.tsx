"use client";

import { useState, useEffect, useCallback } from "react";
import { records, missions, events } from "../../lib/platform-client";
import type { AppRecord } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";

// ── Collections ───────────────────────────────────────────────────────────────
const COL_PATTERNS    = "failure_patterns";
const COL_ANNOTATIONS = "failure_annotations";
const COL_RESULTS     = "eval_results";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FailurePattern extends AppRecord {
  evalRunId: string;
  category: string;
  count: number;
  severity: "critical" | "major" | "minor";
  rootCause: string;
  examples: string[];
  suggestedFix: string;
}

interface FailureAnnotation extends AppRecord {
  patternId: string;
  rootCause: string;
  severity: string;
  actionTaken: string;
  annotatedBy: string;
  timestamp: string;
}

interface EvalCaseResult extends AppRecord {
  datasetId: string;
  datasetName: string;
  agentVersion: string;
  runId: string;
  passed: boolean;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  category: string;
  failureCategory: string;
  score: number;
  timestamp: string;
}

type LeftTab = "patterns" | "cases" | "annotations";

// ── Helpers ───────────────────────────────────────────────────────────────────
function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-rose-500/20 text-rose-400 border-rose-500/30 animate-pulse",
    major:    "bg-amber-500/20 text-amber-400 border-amber-500/30",
    minor:    "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${map[severity] ?? map.minor}`}>
      {severity}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    "Fix Prompt":          "bg-blue-500/15 text-blue-400 border-blue-500/20",
    "Add Training Data":   "bg-violet-500/15 text-violet-400 border-violet-500/20",
    "Escalate":            "bg-rose-500/15 text-rose-400 border-rose-500/20",
    "Skip":                "bg-slate-500/15 text-slate-400 border-slate-500/20",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[action] ?? "bg-white/5 text-slate-400 border-white/10"}`}>
      {action}
    </span>
  );
}

function SkeletonRow() {
  return <div className="h-12 bg-white/5 rounded-lg animate-pulse mb-2" />;
}

// ── Word-level diff ───────────────────────────────────────────────────────────
function computeWordDiff(expected: string, actual: string): {
  expectedTokens: { word: string; missing: boolean }[];
  actualTokens:   { word: string; extra: boolean }[];
} {
  const expWords = expected.split(/\s+/).filter(Boolean);
  const actWords = actual.split(/\s+/).filter(Boolean);
  const expSet = new Set(expWords);
  const actSet = new Set(actWords);
  return {
    expectedTokens: expWords.map((w) => ({ word: w, missing: !actSet.has(w) })),
    actualTokens:   actWords.map((w) => ({ word: w, extra:   !expSet.has(w) })),
  };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FailureAnalysisContent() {
  const [activeTab, setActiveTab] = useState<LeftTab>("patterns");

  // Patterns
  const [patterns, setPatterns]           = useState<FailurePattern[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(true);

  // Annotations
  const [annotations, setAnnotations]     = useState<FailureAnnotation[]>([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(true);

  // Case-level failures from eval_results
  const [failedCases, setFailedCases]     = useState<EvalCaseResult[]>([]);
  const [casesLoading, setCasesLoading]   = useState(true);

  // Inline editing of root cause
  const [editingRootCause, setEditingRootCause] = useState<string | null>(null);
  const [rootCauseDraft, setRootCauseDraft]     = useState("");

  // Annotation form per pattern
  const [annotatingPatternId, setAnnotatingPatternId] = useState<string | null>(null);
  const [annotRootCause, setAnnotRootCause]     = useState("");
  const [annotSeverity, setAnnotSeverity]       = useState("major");
  const [annotAction, setAnnotAction]           = useState("Fix Prompt");
  const [submittingAnnot, setSubmittingAnnot]   = useState(false);
  const [annotError, setAnnotError]             = useState<string | null>(null);

  // Generating training pairs
  const [generatingPatternId, setGeneratingPatternId] = useState<string | null>(null);
  const [genError, setGenError]                 = useState<string | null>(null);
  const [genSuccess, setGenSuccess]             = useState<string | null>(null);

  // Diff viewer selection
  const [selectedCase, setSelectedCase]         = useState<EvalCaseResult | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchPatterns = useCallback(async () => {
    setPatternsLoading(true);
    try {
      const data = await records.list(COL_PATTERNS);
      const sorted = (data as FailurePattern[]).sort((a, b) => b.count - a.count);
      setPatterns(sorted);
    } catch {
      // silent
    } finally {
      setPatternsLoading(false);
    }
  }, []);

  const fetchAnnotations = useCallback(async () => {
    setAnnotationsLoading(true);
    try {
      const data = await records.list(COL_ANNOTATIONS);
      const sorted = (data as FailureAnnotation[]).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      setAnnotations(sorted);
    } catch {
      // silent
    } finally {
      setAnnotationsLoading(false);
    }
  }, []);

  const fetchFailedCases = useCallback(async () => {
    setCasesLoading(true);
    try {
      const data = await records.list(COL_RESULTS);
      // Filter individual case results that have passed=false
      const failed = (data as EvalCaseResult[]).filter((r) => r.passed === false);
      setFailedCases(failed);
    } catch {
      // silent
    } finally {
      setCasesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPatterns();
    fetchAnnotations();
    fetchFailedCases();
  }, [fetchPatterns, fetchAnnotations, fetchFailedCases]);

  useEffect(() => {
    const unsub = events.subscribe((ev) => {
      if (ev.type === "mission.completed") {
        fetchPatterns();
        fetchFailedCases();
      }
    });
    return unsub;
  }, [fetchPatterns, fetchFailedCases]);

  // ── Inline root cause edit ─────────────────────────────────────────────────
  const handleSaveRootCause = async (pattern: FailurePattern) => {
    try {
      const updated = await records.update(COL_PATTERNS, pattern.id, {
        ...pattern,
        rootCause: rootCauseDraft,
      });
      setPatterns((prev) => prev.map((p) => (p.id === pattern.id ? updated as FailurePattern : p)));
    } catch {
      // silent
    }
    setEditingRootCause(null);
  };

  // ── Submit annotation ──────────────────────────────────────────────────────
  const handleSubmitAnnotation = async (pattern: FailurePattern) => {
    setSubmittingAnnot(true);
    setAnnotError(null);
    try {
      const created = await records.create(COL_ANNOTATIONS, {
        patternId:    pattern.id,
        rootCause:    annotRootCause || pattern.rootCause,
        severity:     annotSeverity,
        actionTaken:  annotAction,
        annotatedBy:  "user",
        timestamp:    new Date().toISOString(),
      });
      setAnnotations((prev) => [created as FailureAnnotation, ...prev]);
      setAnnotatingPatternId(null);
      setAnnotRootCause("");
      setAnnotSeverity("major");
      setAnnotAction("Fix Prompt");
    } catch (e: unknown) {
      setAnnotError(e instanceof Error ? e.message : "Failed to save annotation.");
    } finally {
      setSubmittingAnnot(false);
    }
  };

  // ── Generate training pairs ────────────────────────────────────────────────
  const handleGenerateTrainingPairs = async (pattern: FailurePattern) => {
    setGeneratingPatternId(pattern.id);
    setGenError(null);
    setGenSuccess(null);
    try {
      const result = await missions.trigger("Synthetic Data Generation", {
        patternId:   pattern.id,
        category:    pattern.category,
        rootCause:   pattern.rootCause,
        count:       5,
        triggeredBy: "failure-analysis",
      });
      setGenSuccess(`Training data generation queued — run #${result.runId}`);
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : "Failed to trigger data generation.");
    } finally {
      setGeneratingPatternId(null);
    }
  };

  // ── Diff viewer ────────────────────────────────────────────────────────────
  const diffData = selectedCase
    ? computeWordDiff(
        selectedCase.expectedOutput ?? "",
        selectedCase.actualOutput   ?? ""
      )
    : null;

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-2xl">🔍</span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">Failure Analysis</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Identify systematic failure patterns, annotate root causes, and generate targeted training data.
            </p>
          </div>
        </div>

        {/* Success / error banners for generation */}
        {genSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
            {genSuccess}
          </div>
        )}
        {genError && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
            {genError}
          </div>
        )}

        {/* 2-panel layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ── Left panel (3/5 = 60%) ─────────────────────────────────────── */}
          <div className="lg:col-span-3 space-y-4">

            {/* Tabs */}
            <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
              {(["patterns", "cases", "annotations"] as LeftTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    activeTab === tab
                      ? "bg-rose-600 text-white shadow"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab === "patterns" ? "Pattern Clusters" : tab === "cases" ? "Case-Level Failures" : "Annotation History"}
                </button>
              ))}
            </div>

            {/* ── Tab: Pattern Clusters ── */}
            {activeTab === "patterns" && (
              <div className="space-y-3">
                {patternsLoading && [1, 2, 3].map((i) => <SkeletonRow key={i} />)}
                {!patternsLoading && patterns.length === 0 && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-10 text-center">
                    <p className="text-slate-400 text-sm">No failure patterns yet.</p>
                    <p className="text-slate-600 text-xs mt-1">Run an evaluation to see results.</p>
                  </div>
                )}
                {patterns.map((pattern) => (
                  <div
                    key={pattern.id}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3"
                  >
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20">
                          {pattern.category}
                        </span>
                        <SeverityBadge severity={pattern.severity} />
                        <span className="text-xs font-bold bg-white/8 text-slate-300 px-2 py-0.5 rounded border border-white/10">
                          {pattern.count} cases
                        </span>
                      </div>
                    </div>

                    {/* Root cause — inline editable */}
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Root Cause</p>
                      {editingRootCause === pattern.id ? (
                        <div className="flex gap-2">
                          <textarea
                            value={rootCauseDraft}
                            onChange={(e) => setRootCauseDraft(e.target.value)}
                            rows={2}
                            className="flex-1 bg-slate-900 border border-rose-500/40 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none resize-none"
                          />
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => handleSaveRootCause(pattern)}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold rounded transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingRootCause(null)}
                              className="px-2 py-1 bg-white/10 hover:bg-white/15 text-slate-400 text-[10px] font-semibold rounded transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p
                          className="text-xs text-slate-300 cursor-pointer hover:text-white transition-colors rounded px-1 -mx-1 py-0.5"
                          onClick={() => {
                            setEditingRootCause(pattern.id);
                            setRootCauseDraft(pattern.rootCause ?? "");
                          }}
                          title="Click to edit"
                        >
                          {pattern.rootCause || <span className="text-slate-600 italic">Click to add root cause…</span>}
                        </p>
                      )}
                    </div>

                    {/* Example inputs */}
                    {pattern.examples && pattern.examples.length > 0 && (
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Example Inputs</p>
                        <div className="space-y-1">
                          {pattern.examples.slice(0, 2).map((ex, i) => (
                            <p
                              key={i}
                              className="text-xs text-slate-400 bg-white/3 border border-white/8 rounded px-2 py-1 truncate"
                              title={ex}
                            >
                              {ex}
                            </p>
                          ))}
                          {pattern.examples.length > 2 && (
                            <p className="text-[10px] text-slate-600">+{pattern.examples.length - 2} more</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Suggested fix */}
                    {pattern.suggestedFix && (
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Suggested Fix</p>
                        <p className="text-xs text-slate-400 leading-relaxed">{pattern.suggestedFix}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1 flex-wrap">
                      <button
                        onClick={() => {
                          if (annotatingPatternId === pattern.id) {
                            setAnnotatingPatternId(null);
                          } else {
                            setAnnotatingPatternId(pattern.id);
                            setAnnotRootCause(pattern.rootCause ?? "");
                          }
                        }}
                        className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/20 text-blue-400 text-xs font-semibold rounded-lg transition-colors"
                      >
                        {annotatingPatternId === pattern.id ? "Cancel" : "Annotate"}
                      </button>
                      <button
                        onClick={() => handleGenerateTrainingPairs(pattern)}
                        disabled={generatingPatternId === pattern.id}
                        className="px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/20 text-violet-400 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                      >
                        {generatingPatternId === pattern.id ? "Queuing…" : "Generate Training Pairs"}
                      </button>
                    </div>

                    {/* Inline annotation form */}
                    {annotatingPatternId === pattern.id && (
                      <div className="mt-2 p-3 bg-white/5 rounded-lg border border-blue-500/20 space-y-2">
                        <p className="text-xs font-semibold text-blue-300 mb-1">Annotate Pattern</p>
                        <textarea
                          value={annotRootCause}
                          onChange={(e) => setAnnotRootCause(e.target.value)}
                          placeholder="Root cause description"
                          rows={2}
                          className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder:text-slate-600 focus:outline-none focus:border-blue-500 resize-none"
                        />
                        <div className="flex gap-2">
                          <select
                            value={annotSeverity}
                            onChange={(e) => setAnnotSeverity(e.target.value)}
                            className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          >
                            <option value="critical">Critical</option>
                            <option value="major">Major</option>
                            <option value="minor">Minor</option>
                          </select>
                          <select
                            value={annotAction}
                            onChange={(e) => setAnnotAction(e.target.value)}
                            className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          >
                            <option>Fix Prompt</option>
                            <option>Add Training Data</option>
                            <option>Escalate</option>
                            <option>Skip</option>
                          </select>
                        </div>
                        {annotError && <p className="text-xs text-rose-400">{annotError}</p>}
                        <button
                          onClick={() => handleSubmitAnnotation(pattern)}
                          disabled={submittingAnnot}
                          className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                        >
                          {submittingAnnot ? "Saving…" : "Save Annotation"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Tab: Case-Level Failures ── */}
            {activeTab === "cases" && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-3">
                  Failed Cases
                  <span className="ml-2 text-xs font-normal text-slate-500">({failedCases.length})</span>
                </h2>
                {casesLoading && [1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
                {!casesLoading && failedCases.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-8">No failed cases found. Run an evaluation first.</p>
                )}
                {failedCases.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-white/10">
                          <th className="text-left pb-2 font-semibold">Input</th>
                          <th className="text-left pb-2 font-semibold">Expected</th>
                          <th className="text-left pb-2 font-semibold">Actual</th>
                          <th className="text-left pb-2 font-semibold w-24">Category</th>
                          <th className="text-left pb-2 font-semibold w-24">Failure</th>
                        </tr>
                      </thead>
                      <tbody>
                        {failedCases.map((c) => (
                          <tr
                            key={c.id}
                            className={`border-b border-white/5 cursor-pointer transition-colors ${
                              selectedCase?.id === c.id
                                ? "bg-rose-500/10"
                                : "hover:bg-white/3"
                            }`}
                            onClick={() => setSelectedCase(c)}
                          >
                            <td className="py-2 pr-3 text-slate-300 max-w-[140px]">
                              <span title={c.input ?? ""} className="block truncate">{c.input ?? "—"}</span>
                            </td>
                            <td className="py-2 pr-3 max-w-[120px]">
                              <span title={c.expectedOutput ?? ""} className="block truncate text-emerald-400">{c.expectedOutput ?? "—"}</span>
                            </td>
                            <td className="py-2 pr-3 max-w-[120px]">
                              <span title={c.actualOutput ?? ""} className="block truncate text-rose-400">{c.actualOutput ?? "—"}</span>
                            </td>
                            <td className="py-2 pr-3 text-slate-500 capitalize">{c.category ?? "—"}</td>
                            <td className="py-2 text-slate-500">{c.failureCategory ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Annotation History ── */}
            {activeTab === "annotations" && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-3">
                  Annotation History
                  <span className="ml-2 text-xs font-normal text-slate-500">({annotations.length})</span>
                </h2>
                {annotationsLoading && [1, 2, 3].map((i) => <SkeletonRow key={i} />)}
                {!annotationsLoading && annotations.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-8">No annotations yet. Annotate a pattern to get started.</p>
                )}
                <div className="space-y-2">
                  {annotations.map((ann) => {
                    const relatedPattern = patterns.find((p) => p.id === ann.patternId);
                    return (
                      <div
                        key={ann.id}
                        className="p-3 bg-white/3 border border-white/8 rounded-lg"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {relatedPattern && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20">
                                {relatedPattern.category}
                              </span>
                            )}
                            <ActionBadge action={ann.actionTaken} />
                            <SeverityBadge severity={ann.severity} />
                          </div>
                          <span className="text-[10px] text-slate-600 shrink-0">
                            {new Date(ann.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{ann.rootCause}</p>
                        <p className="text-[10px] text-slate-600 mt-1">by {ann.annotatedBy}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Right panel (2/5 = 40%) ─────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Diff Viewer */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 bg-white/3">
                <h2 className="text-sm font-semibold text-slate-300">Output Diff Viewer</h2>
                {selectedCase && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {selectedCase.agentVersion} · {selectedCase.category}
                  </p>
                )}
              </div>

              {!selectedCase ? (
                <div className="p-8 text-center">
                  <p className="text-slate-500 text-sm">Click a failure case to compare outputs</p>
                  <p className="text-slate-600 text-xs mt-1">Select a row from the Case-Level Failures tab</p>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Expected */}
                    <div className="border border-emerald-500/30 rounded-lg overflow-hidden">
                      <div className="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Expected</span>
                      </div>
                      <div className="p-3 text-xs leading-relaxed text-slate-300 min-h-[100px] max-h-[180px] overflow-y-auto">
                        {diffData?.expectedTokens.map((token, i) => (
                          <span key={i}>
                            {token.missing ? (
                              <span className="bg-rose-500/25 text-rose-300 rounded px-0.5">{token.word}</span>
                            ) : (
                              <span>{token.word}</span>
                            )}
                            {i < diffData.expectedTokens.length - 1 ? " " : ""}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Actual */}
                    <div className="border border-rose-500/30 rounded-lg overflow-hidden">
                      <div className="px-3 py-1.5 bg-rose-500/10 border-b border-rose-500/20">
                        <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Actual</span>
                      </div>
                      <div className="p-3 text-xs leading-relaxed text-slate-300 min-h-[100px] max-h-[180px] overflow-y-auto">
                        {diffData?.actualTokens.map((token, i) => (
                          <span key={i}>
                            {token.extra ? (
                              <span className="bg-amber-500/25 text-amber-300 rounded px-0.5">{token.word}</span>
                            ) : (
                              <span>{token.word}</span>
                            )}
                            {i < diffData.actualTokens.length - 1 ? " " : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Diff legend */}
                  <div className="flex gap-4 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded bg-rose-500/25" />
                      In expected, missing from actual
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded bg-amber-500/25" />
                      Extra words in actual
                    </span>
                  </div>

                  {/* Input context */}
                  {selectedCase.input && (
                    <div className="border border-white/10 rounded-lg p-3">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Input</p>
                      <p className="text-xs text-slate-400 leading-relaxed">{selectedCase.input}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* AgentChat */}
            <AgentChat
              agentName="AI Trainer"
              agentRole="Failure Analysis & Training Specialist"
              defaultGreeting="Hello! I'm your AI Trainer. I specialize in identifying and fixing systematic agent failure patterns. I can help you analyze root causes, prioritize what to fix, design targeted training data, and suggest prompt improvements. What failure patterns would you like to investigate?"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
