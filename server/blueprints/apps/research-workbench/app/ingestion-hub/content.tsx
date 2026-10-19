"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { records, events, telemetry } from "../../lib/platform-client";
import type {
  AppRecord,
  ResearchClaim,
  ResearchSource,
  SynthesisMatrix,
  SourceType,
} from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";
import AutonomousResearchInput from "./components/AutonomousResearchInput";
import StrategyConfirmationDialog from "./components/StrategyConfirmationDialog";
import ProgressDashboard from "./components/ProgressDashboard";
import ResearchHistory from "./components/ResearchHistory";
import EvidenceLedger from "./components/EvidenceLedger";
import { researchSteeringModes } from "../../lib/steering-modes";

// ── Autonomous Research Workflow Types ───────────────────────────────────────
interface ClassifiedInput {
  type: "topic" | "url";
  value: string;
  normalizedValue: string;
}

interface CollectorInvocation {
  id: string;
  collectorType: string;
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

type WorkflowState = "input" | "strategy" | "progress" | "completed";

// ── Collections ──────────────────────────────────────────────────────────────
const COL_SOURCES = "research_sources";
const COL_MATRIX = "synthesis_matrix";

// ── Constants ────────────────────────────────────────────────────────────────
const SOURCE_TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: "paper", label: "Academic Paper" },
  { value: "api", label: "API Spec" },
  { value: "doc", label: "Documentation" },
  { value: "video", label: "Video / Tutorial" },
  { value: "report", label: "Market Report" },
  { value: "legal", label: "Legal Doc" },
  { value: "financial", label: "Financial Statement" },
  { value: "clinical", label: "Clinical Trial" },
  { value: "other", label: "Other" },
];

const DEFAULT_DIMENSIONS = [
  { key: "cost", label: "Cost" },
  { key: "risk", label: "Risk" },
  { key: "speed", label: "Speed" },
  { key: "complexity", label: "Complexity" },
  { key: "coverage", label: "Coverage" },
  { key: "quality", label: "Quality" },
];

type Tab = "resources" | "evidence" | "matrix" | "raw";

// ── Score cell colour ─────────────────────────────────────────────────────────
function scoreColor(value: string | number): string {
  const n = Number(value);
  if (isNaN(n) || value === "") return "bg-white/5 text-slate-300";
  if (n >= 8) return "bg-emerald-500/20 text-emerald-300";
  if (n >= 5) return "bg-amber-500/20 text-amber-300";
  return "bg-rose-500/20 text-rose-300";
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    indexed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    error: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  };
  return (
    <span
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[status] ?? map.pending}`}
    >
      {status}
    </span>
  );
}

// ── Type chip ─────────────────────────────────────────────────────────────────
function TypeChip({ type }: { type: string }) {
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/8 text-slate-400 border border-white/10">
      {type}
    </span>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────
function SkeletonRow() {
  return <div className="h-14 bg-white/5 rounded-lg animate-pulse mb-2" />;
}

// ── Simple JSON syntax highlighter ────────────────────────────────────────────
function JsonHighlight({ data }: { data: unknown }) {
  const lines = JSON.stringify(data, null, 2).split("\n");
  return (
    <pre className="text-xs leading-relaxed overflow-auto">
      {lines.map((line, i) => {
        const isKey = /^\s+"[^"]+":/.test(line);
        const isStr = /:\s+"/.test(line);
        const isNum = /:\s+[\d.]+,?$/.test(line);
        const isBool = /:\s+(true|false),?$/.test(line);
        let color = "text-slate-400";
        if (isKey) color = "text-blue-300";
        if (isStr) color = "text-emerald-300";
        if (isNum) color = "text-amber-300";
        if (isBool) color = "text-violet-300";
        return (
          <span key={i} className={`${color} block`}>
            {line}
          </span>
        );
      })}
    </pre>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function IngestionHubContent() {
  const [activeTab, setActiveTab] = useState<Tab>("resources");

  // ── Autonomous research workflow state ──────────────────────────────────────
  const [workflowState, setWorkflowState] = useState<WorkflowState>("input");
  const [currentStrategy, setCurrentStrategy] =
    useState<GatheringStrategy | null>(null);
  const [activePipelineId, setActivePipelineId] = useState<number | null>(null);
  const [completionSummary, setCompletionSummary] = useState<{
    sourcesCollected: number;
    sourcesFailed: number;
    entitiesCreated: number;
    relationshipsCreated: number;
    datasetItemsStored: number;
    datasetId: number;
    documentTemplateId: number;
    durationMs: number;
  } | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  // ── Workflow transition handlers ───────────────────────────────────────────
  const handleStrategyGenerated = useCallback((strategy: GatheringStrategy) => {
    setCurrentStrategy(strategy);
    setWorkflowState("strategy");
  }, []);

  const handleStrategyConfirm = useCallback(
    async (adjustedStrategy: GatheringStrategy) => {
      try {
        const res = await fetch("/api/oddjob/research/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy: adjustedStrategy,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const raw = body?.error ?? body?.message;
          const msg =
            typeof raw === "string"
              ? raw
              : raw &&
                  typeof raw === "object" &&
                  typeof raw.message === "string"
                ? raw.message
                : `HTTP ${res.status}`;
          throw new Error(msg || `HTTP ${res.status}`);
        }
        const result = await res.json();
        setActivePipelineId(result.pipelineExecutionId);
        setWorkflowState("progress");
      } catch (err: unknown) {
        // On failure, go back to input state
        console.error("Failed to start execution:", err);
        setWorkflowState("input");
        setCurrentStrategy(null);
      }
    },
    [],
  );

  const handleStrategyCancel = useCallback(() => {
    setCurrentStrategy(null);
    setWorkflowState("input");
  }, []);

  const handleProgressComplete = useCallback(
    (summary: typeof completionSummary) => {
      setCompletionSummary(summary);
      setWorkflowState("completed");
    },
    [],
  );

  const handleStartNewResearch = useCallback(() => {
    setWorkflowState("input");
    setCurrentStrategy(null);
    setActivePipelineId(null);
    setCompletionSummary(null);
  }, []);

  const handleRerun = useCallback((_executionId: number) => {
    // Re-run navigates back to input state — the ResearchHistory handles
    // pre-populating via its own internal logic
    setWorkflowState("input");
  }, []);

  const handleNavigate = useCallback(
    (target: "dataset" | "memory" | "report", id: number) => {
      // Navigate to the appropriate workbench module
      if (target === "dataset") {
        window.location.href = `/datasets/${id}`;
      } else if (target === "memory") {
        window.location.href = `/memory-library?pipeline=${id}`;
      } else if (target === "report") {
        window.location.href = `/document-templates/${id}`;
      }
    },
    [],
  );

  // Resources state
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [claims, setClaims] = useState<ResearchClaim[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [claimsError, setClaimsError] = useState<string | null>(null);

  // Add source form
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addType, setAddType] = useState<SourceType>("paper");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Synthesis matrix state
  const [matrices, setMatrices] = useState<SynthesisMatrix[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(true);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{
    matrixId: string;
    rowIdx: number;
    dimKey: string;
  } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const cellInputRef = useRef<HTMLInputElement>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchSources = useCallback(async () => {
    try {
      const data = await records.list(COL_SOURCES);
      setSources(Array.isArray(data) ? (data as ResearchSource[]) : []);
    } catch (e: unknown) {
      // Treat "not found" or empty collection as empty — not an error
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("404") ||
        msg.includes("not found") ||
        msg.includes("Not Found")
      ) {
        setSources([]);
      } else {
        setSourcesError(msg);
      }
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  const fetchMatrices = useCallback(async () => {
    try {
      const data = await records.list(COL_MATRIX);
      setMatrices(Array.isArray(data) ? (data as SynthesisMatrix[]) : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("404") ||
        msg.includes("not found") ||
        msg.includes("Not Found")
      ) {
        setMatrices([]);
      } else {
        setMatrixError(msg);
      }
    } finally {
      setMatrixLoading(false);
    }
  }, []);

  const fetchClaims = useCallback(async () => {
    try {
      setClaims((await records.list("research_claims")) as ResearchClaim[]);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (
        message.includes("404") ||
        message.toLowerCase().includes("not found")
      )
        setClaims([]);
      else setClaimsError(message);
    } finally {
      setClaimsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
    fetchMatrices();
    fetchClaims();

    const unsub = events.subscribe((ev) => {
      if (["mission.completed", "mission.status_changed"].includes(ev.type)) {
        fetchSources();
        fetchMatrices();
        fetchClaims();
      }
    });
    return unsub;
  }, [fetchSources, fetchMatrices, fetchClaims]);

  // Focus cell input when entering edit mode
  useEffect(() => {
    if (editingCell && cellInputRef.current) cellInputRef.current.focus();
  }, [editingCell]);

  // ── Add source ────────────────────────────────────────────────────────────
  const handleAddSource = async () => {
    if (!addUrl.trim() || !addTitle.trim()) {
      setAddError("URL and title are required.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await records.create(COL_SOURCES, {
        url: addUrl.trim(),
        title: addTitle.trim(),
        type: addType,
        addedAt: new Date().toISOString(),
        status: "pending",
      });
      telemetry.emit("research_source_added", "info", { type: addType });
      setAddUrl("");
      setAddTitle("");
      setAddType("paper");
      fetchSources();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Failed to add source.");
    } finally {
      setAdding(false);
    }
  };

  // ── Matrix operations ─────────────────────────────────────────────────────
  const getOrCreateDefaultMatrix = async (): Promise<SynthesisMatrix> => {
    if (matrices.length > 0) return matrices[0];
    const created = await records.create(COL_MATRIX, {
      label: "Research Comparison Matrix",
      dimensions: DEFAULT_DIMENSIONS,
      rows: [],
    });
    const newMatrix = created as SynthesisMatrix;
    setMatrices([newMatrix]);
    return newMatrix;
  };

  const handleAddRow = async () => {
    try {
      const matrix = await getOrCreateDefaultMatrix();
      const newRow = {
        subject: `Option ${(matrix.rows?.length ?? 0) + 1}`,
        scores: {},
        notes: "",
      };
      const updated = await records.update(COL_MATRIX, matrix.id, {
        ...matrix,
        rows: [...(matrix.rows ?? []), newRow],
      });
      setMatrices((prev) =>
        prev.map((m) =>
          m.id === matrix.id ? (updated as SynthesisMatrix) : m,
        ),
      );
    } catch (e: unknown) {
      console.error("Failed to add row", e);
    }
  };

  const handleAddDimension = async () => {
    try {
      const matrix = await getOrCreateDefaultMatrix();
      const key = `dim_${Date.now()}`;
      const updated = await records.update(COL_MATRIX, matrix.id, {
        ...matrix,
        dimensions: [
          ...(matrix.dimensions ?? []),
          { key, label: "New Dimension" },
        ],
      });
      setMatrices((prev) =>
        prev.map((m) =>
          m.id === matrix.id ? (updated as SynthesisMatrix) : m,
        ),
      );
    } catch (e: unknown) {
      console.error("Failed to add dimension", e);
    }
  };

  const commitCellEdit = async () => {
    if (!editingCell) return;
    const { matrixId, rowIdx, dimKey } = editingCell;
    const matrix = matrices.find((m) => m.id === matrixId);
    if (!matrix) return;
    const newRows = matrix.rows.map((row, i) => {
      if (i !== rowIdx) return row;
      return { ...row, scores: { ...row.scores, [dimKey]: cellDraft } };
    });
    try {
      const updated = await records.update(COL_MATRIX, matrixId, {
        ...matrix,
        rows: newRows,
      });
      setMatrices((prev) =>
        prev.map((m) => (m.id === matrixId ? (updated as SynthesisMatrix) : m)),
      );
    } catch (e: unknown) {
      console.error("Failed to update cell", e);
    }
    setEditingCell(null);
  };

  // ── CSV export ────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (matrices.length === 0) return;
    const matrix = matrices[0];
    const dims = matrix.dimensions ?? DEFAULT_DIMENSIONS;
    const header = ["Subject", ...dims.map((d) => d.label), "Notes"].join(",");
    const rows = (matrix.rows ?? []).map((row) => {
      const cells = [
        `"${row.subject}"`,
        ...dims.map((d) => `"${row.scores[d.key] ?? ""}"`),
        `"${row.notes ?? ""}"`,
      ];
      return cells.join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "synthesis_matrix.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render tabs ───────────────────────────────────────────────────────────
  const activeMatrix = matrices[0];

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-2xl">🔬</span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">
              Ingestion & Synthesis Hub
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Aggregate sources, build comparison matrices, and explore raw
              research data.
            </p>
          </div>
        </div>

        {/* ── Autonomous Research Workflow Section ──────────────────────────────── */}
        <div className="mb-6 space-y-4">
          {/* Input state: show AutonomousResearchInput */}
          {workflowState === "input" && (
            <AutonomousResearchInput
              onStrategyGenerated={handleStrategyGenerated}
            />
          )}

          {/* Progress state: show ProgressDashboard */}
          {workflowState === "progress" && activePipelineId && (
            <ProgressDashboard
              pipelineExecutionId={activePipelineId}
              onComplete={handleProgressComplete}
            />
          )}

          {/* Completed state: show completion summary with new research button */}
          {workflowState === "completed" && completionSummary && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">✅</span>
                  <div>
                    <h2 className="text-sm font-bold text-emerald-300">
                      Research Complete
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Collected {completionSummary.sourcesCollected} sources,
                      created {completionSummary.entitiesCreated} entities
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleStartNewResearch}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  <span>🚀</span>
                  Start New Research
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/datasets/${completionSummary.datasetId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/20 text-emerald-400 rounded-lg transition-colors"
                >
                  <span>📊</span>
                  View Dataset
                </a>
                <a
                  href={`/document-templates/${completionSummary.documentTemplateId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/20 text-blue-400 rounded-lg transition-colors"
                >
                  <span>📝</span>
                  Synthesis Report
                </a>
              </div>
            </div>
          )}

          {/* Research History (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setHistoryCollapsed(!historyCollapsed)}
              className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors mb-2"
            >
              <span
                className={`transition-transform ${historyCollapsed ? "" : "rotate-180"}`}
              >
                ▾
              </span>
              Research History
            </button>
            {!historyCollapsed && (
              <ResearchHistory
                onRerun={handleRerun}
                onNavigate={handleNavigate}
              />
            )}
          </div>
        </div>

        {/* Strategy Confirmation Dialog (overlay) */}
        {workflowState === "strategy" && currentStrategy && (
          <StrategyConfirmationDialog
            strategy={currentStrategy}
            onConfirm={handleStrategyConfirm}
            onCancel={handleStrategyCancel}
          />
        )}

        {/* 2-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel — 2/3 width */}
          <div className="lg:col-span-2 space-y-4">
            {/* Tabs */}
            <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
              {(["resources", "evidence", "matrix", "raw"] as Tab[]).map(
                (tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                      activeTab === tab
                        ? "bg-blue-600 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tab === "resources"
                      ? "Resource Deck"
                      : tab === "evidence"
                        ? "Evidence Ledger"
                        : tab === "matrix"
                          ? "Synthesis Matrix"
                          : "Raw Data"}
                  </button>
                ),
              )}
            </div>

            {/* ── Tab: Resource Deck ── */}
            {activeTab === "resources" && (
              <div className="space-y-4">
                {/* Add source card */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  <h2 className="text-sm font-semibold text-slate-300">
                    Add Research Source
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="url"
                      value={addUrl}
                      onChange={(e) => setAddUrl(e.target.value)}
                      placeholder="https://arxiv.org/abs/..."
                      aria-label="Source URL"
                      title="Source URL"
                      className="sm:col-span-2 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                    />
                    <select
                      value={addType}
                      onChange={(e) => setAddType(e.target.value as SourceType)}
                      title="Source Type"
                      className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    >
                      {SOURCE_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={addTitle}
                      onChange={(e) => setAddTitle(e.target.value)}
                      placeholder="Title / description"
                      aria-label="Source Title"
                      title="Source Title"
                      className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={handleAddSource}
                      disabled={adding}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors shrink-0"
                    >
                      {adding ? "Adding…" : "Add Source"}
                    </button>
                  </div>
                  {addError && (
                    <p className="text-xs text-rose-400">{addError}</p>
                  )}
                </div>

                {/* Source list */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-300">
                      Sources
                    </h2>
                    <span className="text-xs text-slate-500">
                      {sources.length} indexed
                    </span>
                  </div>

                  {sourcesLoading &&
                    [1, 2, 3].map((i) => <SkeletonRow key={i} />)}
                  {sourcesError && (
                    <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                      {sourcesError}
                    </div>
                  )}
                  {!sourcesLoading && !sourcesError && sources.length === 0 && (
                    <div className="text-center py-12 text-slate-500">
                      <p className="text-sm">No sources yet.</p>
                      <p className="text-xs mt-1">
                        Add a URL above to get started.
                      </p>
                    </div>
                  )}

                  {sources.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-white/5 bg-white/3 hover:border-white/10 transition-colors mb-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-sm font-medium text-white truncate">
                            {s.title}
                          </span>
                          <TypeChip type={s.type} />
                          <StatusBadge status={s.status} />
                        </div>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-400 hover:underline truncate block"
                        >
                          {s.url}
                        </a>
                        {s.summary && (
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                            {s.summary}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-600 shrink-0 mt-0.5">
                        {new Date(s.addedAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "evidence" && (
              <EvidenceLedger
                claims={claims}
                sources={sources}
                loading={claimsLoading || sourcesLoading}
                error={claimsError || sourcesError}
              />
            )}

            {/* ── Tab: Synthesis Matrix ── */}
            {activeTab === "matrix" && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-300">
                    {activeMatrix?.label ?? "Research Comparison Matrix"}
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddRow}
                      className="px-3 py-1.5 text-xs font-semibold bg-white/8 hover:bg-white/12 border border-white/10 rounded-lg text-slate-300 transition-colors"
                    >
                      + Add Row
                    </button>
                    <button
                      onClick={handleAddDimension}
                      className="px-3 py-1.5 text-xs font-semibold bg-white/8 hover:bg-white/12 border border-white/10 rounded-lg text-slate-300 transition-colors"
                    >
                      + Add Dimension
                    </button>
                    <button
                      onClick={handleExportCSV}
                      disabled={
                        !activeMatrix || (activeMatrix.rows?.length ?? 0) === 0
                      }
                      className="px-3 py-1.5 text-xs font-semibold bg-teal-600/20 hover:bg-teal-600/30 border border-teal-500/20 rounded-lg text-teal-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>

                {matrixLoading && <SkeletonRow />}
                {matrixError && (
                  <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                    {matrixError}
                  </div>
                )}

                {!matrixLoading &&
                  !matrixError &&
                  (!activeMatrix || (activeMatrix.rows?.length ?? 0) === 0) && (
                    <div className="text-center py-12 text-slate-500">
                      <p className="text-sm">No comparison data yet.</p>
                      <p className="text-xs mt-1">
                        Click "+ Add Row" to add your first option to compare.
                      </p>
                      <p className="text-xs mt-0.5">
                        Default dimensions: Cost, Risk, Speed, Complexity,
                        Coverage, Quality.
                      </p>
                    </div>
                  )}

                {activeMatrix && (activeMatrix.rows?.length ?? 0) > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left text-slate-400 font-semibold p-2 border-b border-white/10 min-w-[140px]">
                            Subject
                          </th>
                          {(activeMatrix.dimensions ?? DEFAULT_DIMENSIONS).map(
                            (d) => (
                              <th
                                key={d.key}
                                className="text-center text-slate-400 font-semibold p-2 border-b border-white/10 min-w-[80px]"
                              >
                                {d.label}
                              </th>
                            ),
                          )}
                          <th className="text-left text-slate-400 font-semibold p-2 border-b border-white/10 min-w-[140px]">
                            Notes
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeMatrix.rows.map((row, rowIdx) => (
                          <tr
                            key={rowIdx}
                            className="hover:bg-white/3 transition-colors"
                          >
                            <td className="p-2 font-medium text-slate-200 border-b border-white/5">
                              {row.subject}
                            </td>
                            {(
                              activeMatrix.dimensions ?? DEFAULT_DIMENSIONS
                            ).map((d) => {
                              const isEditing =
                                editingCell?.matrixId === activeMatrix.id &&
                                editingCell?.rowIdx === rowIdx &&
                                editingCell?.dimKey === d.key;
                              const val = row.scores[d.key] ?? "";
                              return (
                                <td
                                  key={d.key}
                                  className="p-1 text-center border-b border-white/5 cursor-pointer"
                                  onClick={() => {
                                    setEditingCell({
                                      matrixId: activeMatrix.id,
                                      rowIdx,
                                      dimKey: d.key,
                                    });
                                    setCellDraft(String(val));
                                  }}
                                >
                                  {isEditing ? (
                                    <input
                                      ref={cellInputRef}
                                      type="text"
                                      value={cellDraft}
                                      onChange={(e) =>
                                        setCellDraft(e.target.value)
                                      }
                                      onBlur={commitCellEdit}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") commitCellEdit();
                                        if (e.key === "Escape")
                                          setEditingCell(null);
                                      }}
                                      title="Edit cell value"
                                      placeholder="Value"
                                      className="w-16 text-center bg-slate-800 border border-blue-500 rounded px-1 py-0.5 text-xs focus:outline-none"
                                    />
                                  ) : (
                                    <span
                                      className={`px-2 py-0.5 rounded text-xs font-medium ${scoreColor(val)}`}
                                    >
                                      {val === "" ? "—" : String(val)}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="p-2 text-slate-500 border-b border-white/5 text-xs">
                              {row.notes ?? ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Raw Data ── */}
            {activeTab === "raw" && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-3">
                  Raw Source Records ({sources.length})
                </h2>
                {sourcesLoading && <SkeletonRow />}
                {!sourcesLoading && sources.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No records found in {COL_SOURCES}.
                  </p>
                )}
                {sources.length > 0 && (
                  <div className="bg-slate-950/60 border border-white/5 rounded-lg p-4 overflow-x-auto">
                    <JsonHighlight data={sources} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right panel — 1/3 width */}
          <div>
            <AgentChat
              agentName="Research Assistant & Tech Analyst"
              agentRole="Universal Research Specialist"
              steeringModes={researchSteeringModes}
              defaultGreeting="Hello! I'm your Technical Researcher. I can help you synthesize sources, identify patterns, evaluate evidence quality, build comparison frameworks, or surface relevant knowledge — across any research domain. What would you like to explore?"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
