"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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

type CollectorStatus = "pending" | "started" | "completed" | "failed";

interface CollectorCardState {
  id: string;
  collectorType: SourceCollectorType;
  query?: string;
  sourceUrl?: string;
  status: CollectorStatus;
  startTime?: string;
  contentSize?: number;
}

interface ProgressMetrics {
  sourcesCollected: number;
  sourcesFailed: number;
  entitiesCreated: number;
  relationshipsCreated: number;
  datasetItemsStored: number;
  totalSources: number;
  estimatedTimeRemainingMs: number | null;
}

interface CompletionSummary {
  sourcesCollected: number;
  sourcesFailed: number;
  entitiesCreated: number;
  relationshipsCreated: number;
  datasetItemsStored: number;
  datasetId: number;
  documentTemplateId: number;
  durationMs: number;
}

interface FailureInfo {
  error: string;
  partialResults?: Partial<CompletionSummary>;
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface ProgressDashboardProps {
  pipelineExecutionId: number;
  onComplete?: (summary: CompletionSummary | null) => void;
}

// ─── Collector Display Info ─────────────────────────────────────────────────────

const COLLECTOR_META: Record<SourceCollectorType, { label: string; icon: string }> = {
  web_scraper: { label: "Web Scraper", icon: "🌐" },
  academic_search: { label: "Academic Search", icon: "📚" },
  api_documentation_parser: { label: "API Doc Parser", icon: "📄" },
  code_repository_scanner: { label: "Code Repo Scanner", icon: "💻" },
  document_parser: { label: "Document Parser", icon: "📑" },
};

// ─── Stage Pipeline ─────────────────────────────────────────────────────────────

const STAGES: IngestionStage[] = [
  "planning",
  "collecting",
  "extracting",
  "synthesizing",
  "completed",
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatElapsed(startTime: string): string {
  const elapsed = Date.now() - new Date(startTime).getTime();
  if (elapsed < 1000) return "<1s";
  if (elapsed < 60000) return `${Math.round(elapsed / 1000)}s`;
  return `${Math.floor(elapsed / 60000)}m ${Math.round((elapsed % 60000) / 1000)}s`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatEstimatedRemaining(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  if (ms < 60000) return `~${Math.round(ms / 1000)}s remaining`;
  return `~${Math.ceil(ms / 60000)}m remaining`;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function ProgressDashboard({ pipelineExecutionId, onComplete }: ProgressDashboardProps) {
  const [stage, setStage] = useState<IngestionStage>("planning");
  const [collectors, setCollectors] = useState<CollectorCardState[]>([]);
  const [metrics, setMetrics] = useState<ProgressMetrics>({
    sourcesCollected: 0,
    sourcesFailed: 0,
    entitiesCreated: 0,
    relationshipsCreated: 0,
    datasetItemsStored: 0,
    totalSources: 0,
    estimatedTimeRemainingMs: null,
  });
  const [synthesisProgress, setSynthesisProgress] = useState(0);
  const [completion, setCompletion] = useState<CompletionSummary | null>(null);
  const [failure, setFailure] = useState<FailureInfo | null>(null);
  const [connected, setConnected] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  // ── SSE Connection ──────────────────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    const url = `/api/oddjob/research/runs/${pipelineExecutionId}/progress`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleProgressEvent(data);
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource will auto-reconnect
    };

    return es;
  }, [pipelineExecutionId]);

  // ── Event Handler ─────────────────────────────────────────────────────────
  const handleProgressEvent = useCallback((event: Record<string, unknown>) => {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    const eventStage = payload.stage as IngestionStage | undefined;
    if (eventStage) {
      setStage(eventStage);
    }

    switch (eventStage) {
      case "planning": {
        // Strategy received — extract collectors to show as pending
        const strategy = payload.strategy as { collectors?: Array<{
          id: string;
          collectorType: SourceCollectorType;
          query: string;
        }> } | undefined;
        if (strategy?.collectors) {
          setCollectors(
            strategy.collectors.map((c) => ({
              id: c.id,
              collectorType: c.collectorType,
              query: c.query,
              status: "pending" as CollectorStatus,
            }))
          );
          setMetrics((prev) => ({
            ...prev,
            totalSources: strategy.collectors!.length,
          }));
        }
        break;
      }

      case "collecting": {
        const collectorType = payload.collectorType as SourceCollectorType | undefined;
        const status = payload.status as "started" | "completed" | "failed" | undefined;
        const sourceUrl = payload.sourceUrl as string | undefined;
        const query = payload.query as string | undefined;
        const contentSize = payload.contentSize as number | undefined;
        const sourcesCollected = payload.sourcesCollected as number | undefined;
        const totalSources = payload.totalSources as number | undefined;

        if (collectorType && status) {
          setCollectors((prev) => {
            // Find existing collector card or create one
            const existing = prev.find(
              (c) => c.collectorType === collectorType && c.status !== "completed" && c.status !== "failed"
            );
            if (existing) {
              return prev.map((c) =>
                c.id === existing.id
                  ? {
                      ...c,
                      status,
                      sourceUrl: sourceUrl ?? c.sourceUrl,
                      query: query ?? c.query,
                      contentSize: contentSize ?? c.contentSize,
                      startTime: status === "started" ? new Date().toISOString() : c.startTime,
                    }
                  : c
              );
            }
            return prev;
          });
        }

        // Update metrics
        if (sourcesCollected !== undefined || totalSources !== undefined) {
          setMetrics((prev) => ({
            ...prev,
            sourcesCollected: sourcesCollected ?? prev.sourcesCollected,
            totalSources: totalSources ?? prev.totalSources,
          }));
        }

        // Estimate time remaining based on progress
        if (sourcesCollected !== undefined && totalSources && sourcesCollected > 0) {
          const elapsed = Date.now() - new Date(startTimeRef.current).getTime();
          const rate = elapsed / sourcesCollected;
          const remaining = (totalSources - sourcesCollected) * rate;
          setMetrics((prev) => ({
            ...prev,
            estimatedTimeRemainingMs: Math.max(0, remaining),
          }));
        }
        break;
      }

      case "extracting": {
        const entitiesCreated = payload.entitiesCreated as number | undefined;
        const relationshipsCreated = payload.relationshipsCreated as number | undefined;
        const datasetItemsStored = payload.datasetItemsStored as number | undefined;
        setMetrics((prev) => ({
          ...prev,
          entitiesCreated: entitiesCreated ?? prev.entitiesCreated,
          relationshipsCreated: relationshipsCreated ?? prev.relationshipsCreated,
          datasetItemsStored: datasetItemsStored ?? prev.datasetItemsStored,
          estimatedTimeRemainingMs: null,
        }));
        break;
      }

      case "synthesizing": {
        const progress = payload.progress as number | undefined;
        if (progress !== undefined) {
          setSynthesisProgress(progress);
        }
        break;
      }

      case "completed": {
        const summary = payload.summary as CompletionSummary | undefined;
        if (summary) {
          setCompletion(summary);
          onComplete?.(summary);
        }
        // Close SSE connection on completion
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
        break;
      }

      case "failed": {
        const error = payload.error as string | undefined;
        const partialResults = payload.partialResults as Partial<CompletionSummary> | undefined;
        setFailure({
          error: error ?? "An unknown error occurred",
          partialResults,
        });
        // Close SSE connection on failure
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
        break;
      }
    }
  }, []);

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    startTimeRef.current = new Date().toISOString();
    const es = connectSSE();
    return () => {
      es.close();
    };
  }, [connectSSE]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Connection indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">📡</span>
          <h2 className="text-sm font-bold text-white">Research Progress</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-emerald-400 animate-pulse" : "bg-slate-600"
            }`}
          />
          <span className="text-[10px] text-slate-500">
            {connected ? "Live" : "Connecting…"}
          </span>
        </div>
      </div>

      {/* Stage indicator bar */}
      <StageIndicator currentStage={stage} />

      {/* Error state */}
      {failure && <FailureCard failure={failure} />}

      {/* Completion state */}
      {completion && <CompletionCard completion={completion} />}

      {/* Active progress content */}
      {!completion && !failure && (
        <>
          {/* Metrics counters */}
          <MetricsBar metrics={metrics} stage={stage} synthesisProgress={synthesisProgress} />

          {/* Collector cards */}
          {collectors.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Source Collectors
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {collectors.map((collector) => (
                  <CollectorCard key={collector.id} collector={collector} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Stage Indicator ────────────────────────────────────────────────────────────

function StageIndicator({ currentStage }: { currentStage: IngestionStage }) {
  const currentIdx = STAGES.indexOf(currentStage === "failed" ? "completed" : currentStage);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between relative">
        {/* Connecting line */}
        <div className="absolute top-3 left-6 right-6 h-0.5 bg-white/10" />
        <div
          className="absolute top-3 left-6 h-0.5 bg-blue-500 transition-all duration-700 ease-out"
          style={{
            width: currentStage === "failed"
              ? `${(Math.max(0, currentIdx) / (STAGES.length - 1)) * 100}%`
              : `${(currentIdx / (STAGES.length - 1)) * 100}%`,
          }}
        />

        {STAGES.map((s, idx) => {
          const isActive = s === currentStage;
          const isPast = idx < currentIdx;
          const isFailed = currentStage === "failed" && idx === currentIdx;

          let dotColor = "bg-slate-700 border-slate-600";
          if (isPast) dotColor = "bg-blue-600 border-blue-500";
          if (isActive) dotColor = "bg-blue-500 border-blue-400 ring-4 ring-blue-500/20";
          if (isFailed) dotColor = "bg-rose-500 border-rose-400 ring-4 ring-rose-500/20";

          return (
            <div key={s} className="flex flex-col items-center relative z-10">
              <div className={`w-6 h-6 rounded-full border-2 ${dotColor} transition-all duration-500`}>
                {isPast && (
                  <span className="flex items-center justify-center h-full text-[10px] text-white">✓</span>
                )}
                {isActive && !isFailed && (
                  <span className="flex items-center justify-center h-full">
                    <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  </span>
                )}
                {isFailed && (
                  <span className="flex items-center justify-center h-full text-[10px] text-white">✕</span>
                )}
              </div>
              <span
                className={`text-[9px] mt-1.5 font-medium capitalize ${
                  isActive ? "text-blue-400" : isPast ? "text-slate-400" : "text-slate-600"
                }`}
              >
                {s}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Metrics Bar ────────────────────────────────────────────────────────────────

function MetricsBar({
  metrics,
  stage,
  synthesisProgress,
}: {
  metrics: ProgressMetrics;
  stage: IngestionStage;
  synthesisProgress: number;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCounter
          label="Sources Collected"
          value={metrics.sourcesCollected}
          total={metrics.totalSources > 0 ? metrics.totalSources : undefined}
          active={stage === "collecting"}
        />
        <MetricCounter
          label="KG Entities"
          value={metrics.entitiesCreated}
          active={stage === "extracting"}
        />
        <MetricCounter
          label="Dataset Items"
          value={metrics.datasetItemsStored}
          active={stage === "extracting"}
        />
        <MetricCounter
          label="Time Remaining"
          value={formatEstimatedRemaining(metrics.estimatedTimeRemainingMs)}
          isText
        />
      </div>

      {/* Synthesis progress bar */}
      {stage === "synthesizing" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 font-medium">Synthesizing report…</span>
            <span className="text-[10px] text-blue-400 font-semibold">{synthesisProgress}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-600 to-violet-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${synthesisProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCounter({
  label,
  value,
  total,
  active,
  isText,
}: {
  label: string;
  value: string | number;
  total?: number;
  active?: boolean;
  isText?: boolean;
}) {
  return (
    <div className={`rounded-lg p-2.5 text-center border transition-colors ${
      active ? "bg-blue-500/10 border-blue-500/20" : "bg-white/3 border-white/5"
    }`}>
      <p className={`font-bold ${isText ? "text-xs" : "text-lg"} text-white`}>
        {total !== undefined ? `${value}/${total}` : value}
      </p>
      <p className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

// ─── Collector Card ─────────────────────────────────────────────────────────────

function CollectorCard({ collector }: { collector: CollectorCardState }) {
  const meta = COLLECTOR_META[collector.collectorType];
  const [elapsedDisplay, setElapsedDisplay] = useState("—");

  // Update elapsed time every second for active collectors
  useEffect(() => {
    if (collector.status !== "started" || !collector.startTime) return;

    const update = () => setElapsedDisplay(formatElapsed(collector.startTime!));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [collector.status, collector.startTime]);

  const statusStyles: Record<CollectorStatus, string> = {
    pending: "border-white/5 bg-white/3",
    started: "border-blue-500/30 bg-blue-500/5 shadow-lg shadow-blue-500/5",
    completed: "border-emerald-500/30 bg-emerald-500/5 animate-card-complete",
    failed: "border-rose-500/30 bg-rose-500/5",
  };

  const statusBadgeStyles: Record<CollectorStatus, string> = {
    pending: "bg-slate-500/20 text-slate-400 border-slate-500/20",
    started: "bg-blue-500/20 text-blue-400 border-blue-500/20",
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    failed: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  };

  return (
    <div
      className={`rounded-lg border p-3 transition-all duration-500 ${statusStyles[collector.status]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">{meta?.icon ?? "🔍"}</span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-white truncate">
              {meta?.label ?? collector.collectorType}
            </p>
            <p className="text-[10px] text-slate-500 truncate" title={collector.sourceUrl ?? collector.query}>
              {collector.sourceUrl ?? collector.query ?? "—"}
            </p>
          </div>
        </div>
        <span
          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${
            statusBadgeStyles[collector.status]
          }`}
        >
          {collector.status}
        </span>
      </div>

      {/* Footer row: elapsed time and content size */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
        <span className="text-[10px] text-slate-500">
          {collector.status === "started" && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              {elapsedDisplay}
            </span>
          )}
          {collector.status === "completed" && collector.startTime && formatElapsed(collector.startTime)}
          {collector.status === "pending" && "Waiting…"}
          {collector.status === "failed" && "Failed"}
        </span>
        {collector.contentSize !== undefined && collector.contentSize > 0 && (
          <span className="text-[10px] text-slate-500">
            {(collector.contentSize / 1024).toFixed(1)}KB
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Completion Card ────────────────────────────────────────────────────────────

function CompletionCard({ completion }: { completion: CompletionSummary }) {
  return (
    <div className="bg-gradient-to-br from-emerald-600/10 via-white/5 to-blue-600/10 border border-emerald-500/20 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="text-lg">✅</span>
        <div>
          <h3 className="text-sm font-bold text-white">Research Complete</h3>
          <p className="text-[11px] text-slate-500">
            Finished in {formatDuration(completion.durationMs)}
          </p>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryMetric label="Sources" value={completion.sourcesCollected} />
        <SummaryMetric label="Failed" value={completion.sourcesFailed} warn={completion.sourcesFailed > 0} />
        <SummaryMetric label="Entities" value={completion.entitiesCreated} />
        <SummaryMetric label="Relationships" value={completion.relationshipsCreated} />
      </div>

      {/* Navigation links */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
        {completion.datasetId && (
          <a
            href={`/datasets/${completion.datasetId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/20 text-emerald-400 rounded-lg transition-colors"
          >
            <span>📊</span>
            View Dataset
          </a>
        )}
        <a
          href="/memory-library"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600/15 hover:bg-violet-600/25 border border-violet-500/20 text-violet-400 rounded-lg transition-colors"
        >
          <span>🧠</span>
          KG Entities ({completion.entitiesCreated})
        </a>
        {completion.documentTemplateId && (
          <a
            href={`/draft-sandbox/${completion.documentTemplateId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/20 text-blue-400 rounded-lg transition-colors"
          >
            <span>📝</span>
            Synthesis Report
          </a>
        )}
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="bg-white/5 border border-white/5 rounded-lg p-2 text-center">
      <p className={`text-sm font-bold ${warn ? "text-amber-400" : "text-white"}`}>{value}</p>
      <p className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

// ─── Failure Card ───────────────────────────────────────────────────────────────

function FailureCard({ failure }: { failure: FailureInfo }) {
  return (
    <div className="bg-gradient-to-br from-rose-600/10 via-white/5 to-amber-600/10 border border-rose-500/20 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="text-lg">❌</span>
        <div>
          <h3 className="text-sm font-bold text-white">Research Failed</h3>
          <p className="text-[11px] text-rose-400">{failure.error}</p>
        </div>
      </div>

      {/* Partial results if available */}
      {failure.partialResults && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Partial Results
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {failure.partialResults.sourcesCollected !== undefined && (
              <SummaryMetric label="Sources" value={failure.partialResults.sourcesCollected} />
            )}
            {failure.partialResults.entitiesCreated !== undefined && (
              <SummaryMetric label="Entities" value={failure.partialResults.entitiesCreated} />
            )}
            {failure.partialResults.datasetItemsStored !== undefined && (
              <SummaryMetric label="Items" value={failure.partialResults.datasetItemsStored} />
            )}
          </div>

          {/* Links to partial results if IDs available */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
            {failure.partialResults.datasetId && (
              <a
                href={`/datasets/${failure.partialResults.datasetId}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/20 text-emerald-400 rounded-lg transition-colors"
              >
                <span>📊</span>
                Partial Dataset
              </a>
            )}
            {failure.partialResults.documentTemplateId && (
              <a
                href={`/draft-sandbox/${failure.partialResults.documentTemplateId}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/20 text-blue-400 rounded-lg transition-colors"
              >
                <span>📝</span>
                Partial Report
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
