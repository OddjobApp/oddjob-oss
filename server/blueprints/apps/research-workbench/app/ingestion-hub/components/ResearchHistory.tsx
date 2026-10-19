"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types (mirrored from server types for client-side use) ─────────────────

type IngestionStage =
  | "planning"
  | "collecting"
  | "extracting"
  | "synthesizing"
  | "completed"
  | "failed";

type SourceCollectorType =
  | "web_scraper"
  | "academic_search"
  | "api_documentation_parser"
  | "code_repository_scanner"
  | "document_parser";

interface ClassifiedInput {
  type: "topic" | "url";
  value: string;
  normalizedValue: string;
}

interface CollectorInvocation {
  id: string;
  collectorType: SourceCollectorType;
  query: string;
  priority: number;
  estimatedYield: number;
  timeout: number;
  metadata?: Record<string, unknown>;
}

interface GatheringStrategy {
  id: string;
  researchSubject: ClassifiedInput;
  collectors: CollectorInvocation[];
  maxSources: number;
  tokenBudget: number;
  existingEntityCount: number;
  createdAt: string;
}

interface CollectorResult {
  collectorId: string;
  status: "completed" | "failed" | "timeout";
  startTime: string;
  endTime: string;
  contentSize: number;
  error?: string;
}

interface IngestionRunSummary {
  pipelineExecutionId: number;
  subject: string;
  subjectType: "topic" | "url";
  status: IngestionStage;
  date: string;
  metrics: {
    sourcesCollected: number;
    entitiesCreated: number;
    datasetItemsStored: number;
  };
}

interface IngestionRunStatus {
  pipelineExecutionId: number;
  stage: IngestionStage;
  researchSubject: ClassifiedInput;
  strategy: GatheringStrategy;
  metrics: {
    sourcesCollected: number;
    sourcesFailed: number;
    entitiesCreated: number;
    relationshipsCreated: number;
    datasetItemsStored: number;
    datasetId: number | null;
    documentTemplateId: number | null;
    tokenBudgetUsed: number;
    durationMs: number;
  };
  startedAt: string;
  completedAt: string | null;
  error?: string;
  collectorResults?: CollectorResult[];
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface ResearchHistoryProps {
  onRerun: (executionId: number) => void;
  onNavigate: (target: "dataset" | "memory" | "report", id: number) => void;
}

// ─── API Helpers ────────────────────────────────────────────────────────────────

const BASE = "/api/oddjob";

async function fetchRuns(limit = 20): Promise<IngestionRunSummary[]> {
  const res = await fetch(`${BASE}/research/runs?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchRunDetail(
  executionId: number,
): Promise<IngestionRunStatus> {
  const res = await fetch(`${BASE}/research/runs/${executionId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function deleteRun(executionId: number): Promise<void> {
  const res = await fetch(`${BASE}/research/runs/${executionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ─── Collector Display Info ─────────────────────────────────────────────────────

const COLLECTOR_META: Record<
  SourceCollectorType,
  { label: string; icon: string }
> = {
  web_scraper: { label: "Web Scraper", icon: "🌐" },
  academic_search: { label: "Academic Search", icon: "📚" },
  api_documentation_parser: { label: "API Doc Parser", icon: "📄" },
  code_repository_scanner: { label: "Code Repo Scanner", icon: "💻" },
  document_parser: { label: "Document Parser", icon: "📑" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function downloadRunManifest(detail: IngestionRunStatus) {
  const manifest = {
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    reproducibility: {
      mode: "frozen-run-configuration",
      note: "Re-run uses the preserved strategy; external sources may have changed since retrieval.",
    },
    run: {
      pipelineExecutionId: detail.pipelineExecutionId,
      stage: detail.stage,
      researchSubject: detail.researchSubject,
      startedAt: detail.startedAt,
      completedAt: detail.completedAt,
      error: detail.error ?? null,
    },
    strategy: detail.strategy,
    collectors: detail.collectorResults ?? [],
    metrics: detail.metrics,
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `research-run-${detail.pipelineExecutionId}-manifest.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function ResearchHistory({
  onRerun,
  onNavigate,
}: ResearchHistoryProps) {
  const [runs, setRuns] = useState<IngestionRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded run detail state
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedDetail, setExpandedDetail] =
    useState<IngestionRunStatus | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Delete confirmation state
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Fetch runs ──────────────────────────────────────────────────────────────
  const loadRuns = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchRuns();
      setRuns(data);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to load research history",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // ── Expand/collapse run detail ──────────────────────────────────────────────
  const handleToggleExpand = async (executionId: number) => {
    if (expandedId === executionId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }

    setExpandedId(executionId);
    setExpandedDetail(null);
    setDetailLoading(true);

    try {
      const detail = await fetchRunDetail(executionId);
      setExpandedDetail(detail);
    } catch {
      // Keep expanded but show empty detail
      setExpandedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Delete run ──────────────────────────────────────────────────────────────
  const handleDelete = async (executionId: number) => {
    setDeleting(true);
    try {
      await deleteRun(executionId);
      setRuns((prev) =>
        prev.filter((r) => r.pipelineExecutionId !== executionId),
      );
      if (expandedId === executionId) {
        setExpandedId(null);
        setExpandedDetail(null);
      }
      setDeleteConfirmId(null);
    } catch {
      // Silently fail — user can retry
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📜</span>
          <h2 className="text-sm font-bold text-white">Research History</h2>
        </div>
        <span className="text-[10px] text-slate-500">
          {runs.length} run{runs.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          <p className="text-xs text-rose-400">{error}</p>
          <button
            onClick={loadRuns}
            className="text-[10px] text-rose-400 underline mt-1"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && runs.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          <p className="text-sm">No research runs yet.</p>
          <p className="text-xs mt-1">
            Start an autonomous research session above to see history here.
          </p>
        </div>
      )}

      {/* Run list */}
      {!loading && !error && runs.length > 0 && (
        <div className="space-y-2">
          {runs.map((run) => (
            <div key={run.pipelineExecutionId}>
              {/* Run summary row */}
              <button
                type="button"
                onClick={() => handleToggleExpand(run.pipelineExecutionId)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  expandedId === run.pipelineExecutionId
                    ? "bg-white/8 border-blue-500/30"
                    : "bg-white/3 border-white/5 hover:border-white/10"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">
                        {run.subject}
                      </span>
                      <SubjectTypeBadge type={run.subjectType} />
                      <StageBadge stage={run.status} />
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <MetricPill
                        label="Sources"
                        value={run.metrics.sourcesCollected}
                      />
                      <MetricPill
                        label="Entities"
                        value={run.metrics.entitiesCreated}
                      />
                      <MetricPill
                        label="Items"
                        value={run.metrics.datasetItemsStored}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-500">
                      {formatDate(run.date)}
                    </span>
                    <span
                      className={`text-xs text-slate-500 transition-transform ${
                        expandedId === run.pipelineExecutionId
                          ? "rotate-180"
                          : ""
                      }`}
                    >
                      ▾
                    </span>
                  </div>
                </div>
              </button>

              {/* Expanded detail */}
              {expandedId === run.pipelineExecutionId && (
                <div className="mt-1 ml-3 border-l-2 border-blue-500/20 pl-4 py-3 space-y-4">
                  {detailLoading && (
                    <div className="h-24 bg-white/5 rounded-lg animate-pulse" />
                  )}

                  {!detailLoading && expandedDetail && (
                    <>
                      {/* Strategy overview */}
                      <div className="space-y-2">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Gathering Strategy
                        </h3>
                        <div className="grid grid-cols-3 gap-2">
                          <MiniMetric
                            label="Max Sources"
                            value={expandedDetail.strategy.maxSources}
                          />
                          <MiniMetric
                            label="Token Budget"
                            value={`${Math.round(expandedDetail.strategy.tokenBudget / 1000)}k`}
                          />
                          <MiniMetric
                            label="Existing Entities"
                            value={expandedDetail.strategy.existingEntityCount}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {expandedDetail.strategy.collectors.map((c) => {
                            const meta = COLLECTOR_META[c.collectorType];
                            return (
                              <span
                                key={c.id}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-slate-400"
                                title={c.query}
                              >
                                <span>{meta?.icon ?? "🔍"}</span>
                                <span className="truncate max-w-[120px]">
                                  {c.query}
                                </span>
                                <span className="text-slate-600">
                                  ({Math.round(c.estimatedYield * 100)}%)
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Per-collector results */}
                      {expandedDetail.collectorResults &&
                        expandedDetail.collectorResults.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              Collector Results
                            </h3>
                            <div className="space-y-1">
                              {expandedDetail.collectorResults.map((result) => {
                                const invocation =
                                  expandedDetail.strategy.collectors.find(
                                    (c) => c.id === result.collectorId,
                                  );
                                const meta = invocation
                                  ? COLLECTOR_META[invocation.collectorType]
                                  : null;
                                return (
                                  <div
                                    key={result.collectorId}
                                    className="flex items-center justify-between p-2 rounded bg-white/3 border border-white/5"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs">
                                        {meta?.icon ?? "🔍"}
                                      </span>
                                      <span className="text-xs text-slate-300 truncate max-w-[180px]">
                                        {invocation?.query ??
                                          result.collectorId}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-slate-500">
                                        {(result.contentSize / 1024).toFixed(1)}
                                        KB
                                      </span>
                                      <CollectorStatusBadge
                                        status={result.status}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                      {/* Full metrics */}
                      <div className="space-y-2">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Run Metrics
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <MiniMetric
                            label="Sources"
                            value={expandedDetail.metrics.sourcesCollected}
                          />
                          <MiniMetric
                            label="Failed"
                            value={expandedDetail.metrics.sourcesFailed}
                          />
                          <MiniMetric
                            label="Entities"
                            value={expandedDetail.metrics.entitiesCreated}
                          />
                          <MiniMetric
                            label="Relationships"
                            value={expandedDetail.metrics.relationshipsCreated}
                          />
                          <MiniMetric
                            label="Dataset Items"
                            value={expandedDetail.metrics.datasetItemsStored}
                          />
                          <MiniMetric
                            label="Tokens Used"
                            value={`${Math.round(expandedDetail.metrics.tokenBudgetUsed / 1000)}k`}
                          />
                          <MiniMetric
                            label="Duration"
                            value={formatDuration(
                              expandedDetail.metrics.durationMs,
                            )}
                          />
                        </div>
                      </div>

                      {/* Error display */}
                      {expandedDetail.error && (
                        <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                          <p className="text-xs text-rose-400">
                            {expandedDetail.error}
                          </p>
                        </div>
                      )}

                      {/* Navigation links */}
                      {expandedDetail.stage === "completed" && (
                        <div className="space-y-2">
                          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            View Results
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {expandedDetail.metrics.datasetId && (
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigate(
                                    "dataset",
                                    expandedDetail.metrics.datasetId!,
                                  )
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/20 text-emerald-400 rounded-lg transition-colors"
                              >
                                <span>📊</span>
                                Dataset
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate(
                                  "memory",
                                  expandedDetail.pipelineExecutionId,
                                )
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600/15 hover:bg-violet-600/25 border border-violet-500/20 text-violet-400 rounded-lg transition-colors"
                            >
                              <span>🧠</span>
                              Memory Library
                            </button>
                            {expandedDetail.metrics.documentTemplateId && (
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigate(
                                    "report",
                                    expandedDetail.metrics.documentTemplateId!,
                                  )
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/20 text-blue-400 rounded-lg transition-colors"
                              >
                                <span>📝</span>
                                Synthesis Report
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                        <button
                          type="button"
                          onClick={() => onRerun(run.pipelineExecutionId)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/20 text-blue-400 rounded-lg transition-colors"
                        >
                          <span>🔄</span>
                          Re-run
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadRunManifest(expandedDetail)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-lg transition-colors"
                        >
                          <span>⬇</span>
                          Export manifest
                        </button>

                        {deleteConfirmId === run.pipelineExecutionId ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500">
                              Delete run? KG entities &amp; items are preserved.
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleDelete(run.pipelineExecutionId)
                              }
                              disabled={deleting}
                              className="px-2 py-1 text-[10px] font-semibold bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/20 text-rose-400 rounded transition-colors disabled:opacity-50"
                            >
                              {deleting ? "Deleting…" : "Confirm"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-2 py-1 text-[10px] font-semibold text-slate-500 hover:text-slate-300 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteConfirmId(run.pipelineExecutionId)
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white/5 hover:bg-rose-600/15 border border-white/10 hover:border-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
                          >
                            <span>🗑️</span>
                            Delete
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {!detailLoading && !expandedDetail && (
                    <div className="text-xs text-slate-500">
                      Failed to load run details.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function SubjectTypeBadge({ type }: { type: "topic" | "url" }) {
  if (type === "url") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-[9px] font-bold uppercase tracking-wide">
        URL
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/25 text-blue-400 text-[9px] font-bold uppercase tracking-wide">
      Topic
    </span>
  );
}

function StageBadge({ stage }: { stage: IngestionStage }) {
  const styles: Record<IngestionStage, string> = {
    planning: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    collecting: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    extracting: "bg-violet-500/15 text-violet-400 border-violet-500/20",
    synthesizing: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    failed: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  };
  return (
    <span
      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${styles[stage]}`}
    >
      {stage}
    </span>
  );
}

function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-[10px] text-slate-500">
      <span className="text-slate-300 font-medium">{value}</span> {label}
    </span>
  );
}

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-white/5 border border-white/5 rounded px-2 py-1.5 text-center">
      <p className="text-xs font-semibold text-white">{value}</p>
      <p className="text-[9px] text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function CollectorStatusBadge({
  status,
}: {
  status: "completed" | "failed" | "timeout";
}) {
  const styles: Record<string, string> = {
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    failed: "bg-rose-500/15 text-rose-400 border-rose-500/20",
    timeout: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  };
  return (
    <span
      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${styles[status]}`}
    >
      {status}
    </span>
  );
}
