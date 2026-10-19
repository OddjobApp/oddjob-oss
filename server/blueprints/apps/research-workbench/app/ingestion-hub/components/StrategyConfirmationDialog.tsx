"use client";

import { useState, useCallback } from "react";

// ─── Types (mirrored from server types for client-side use) ─────────────────

interface ClassifiedInput {
  type: "topic" | "url";
  value: string;
  normalizedValue: string;
}

interface CollectorInvocation {
  id: string;
  collectorType: SourceCollectorType | string;
  query: string;
  priority: number;
  estimatedYield: number;
  timeout: number;
  metadata?: Record<string, unknown>;
}

type SourceCollectorType =
  | "web_scraper"
  | "academic_search"
  | "api_documentation_parser"
  | "code_repository_scanner"
  | "document_parser";

interface GatheringStrategy {
  id: string;
  researchSubject: ClassifiedInput;
  collectors: CollectorInvocation[];
  maxSources: number;
  tokenBudget: number;
  existingEntityCount: number;
  createdAt: string;
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface StrategyConfirmationDialogProps {
  strategy: GatheringStrategy;
  onConfirm: (adjustedStrategy: GatheringStrategy) => void;
  onCancel: () => void;
}

// ─── Collector Display Info ─────────────────────────────────────────────────────

const COLLECTOR_META: Record<SourceCollectorType, { label: string; icon: string }> = {
  web_scraper: { label: "Web Scraper", icon: "🌐" },
  academic_search: { label: "Academic Search", icon: "📚" },
  api_documentation_parser: { label: "API Doc Parser", icon: "📄" },
  code_repository_scanner: { label: "Code Repo Scanner", icon: "💻" },
  document_parser: { label: "Document Parser", icon: "📑" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getUniqueCollectorTypes(collectors: CollectorInvocation[]): SourceCollectorType[] {
  const seen = new Set<SourceCollectorType>();
  for (const c of collectors) {
    seen.add(c.collectorType as SourceCollectorType);
  }
  return Array.from(seen);
}

function averageYieldForType(collectors: CollectorInvocation[], type: SourceCollectorType): number {
  const matching = collectors.filter((c) => c.collectorType === type);
  if (matching.length === 0) return 0;
  return matching.reduce((sum, c) => sum + c.estimatedYield, 0) / matching.length;
}

function countForType(collectors: CollectorInvocation[], type: SourceCollectorType): number {
  return collectors.filter((c) => c.collectorType === type).length;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function StrategyConfirmationDialog({
  strategy,
  onConfirm,
  onCancel,
}: StrategyConfirmationDialogProps) {
  const [maxSources, setMaxSources] = useState(strategy.maxSources);
  const uniqueTypes = getUniqueCollectorTypes(strategy.collectors);
  const [enabledTypes, setEnabledTypes] = useState<Set<SourceCollectorType>>(
    () => new Set(uniqueTypes)
  );

  // ── Toggle a collector type ─────────────────────────────────────────────────
  const handleToggleType = useCallback((type: SourceCollectorType) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        // Don't allow disabling all collectors
        if (next.size > 1) {
          next.delete(type);
        }
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // ── Build adjusted strategy on confirm ──────────────────────────────────────
  const handleConfirm = () => {
    const adjustedCollectors = strategy.collectors.filter((c) =>
      enabledTypes.has(c.collectorType as SourceCollectorType)
    );

    const adjustedStrategy: GatheringStrategy = {
      ...strategy,
      maxSources,
      collectors: adjustedCollectors,
    };

    onConfirm(adjustedStrategy);
  };

  // ── Derived values ──────────────────────────────────────────────────────────
  const activeCollectorCount = strategy.collectors.filter((c) =>
    enabledTypes.has(c.collectorType as SourceCollectorType)
  ).length;

  const subjectDisplay =
    strategy.researchSubject.type === "url"
      ? strategy.researchSubject.value
      : strategy.researchSubject.normalizedValue || strategy.researchSubject.value;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden
      />

      {/* Dialog */}
      <div className="relative bg-[#0f1420] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">📋</span>
            <div>
              <h2 className="text-base font-bold text-white">Confirm Research Strategy</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Review and adjust the gathering plan before execution begins.
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Subject summary */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Research Subject
            </label>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border bg-blue-500/15 border-blue-500/25 text-blue-400">
                {strategy.researchSubject.type}
              </span>
              <span className="text-sm text-white truncate" title={subjectDisplay}>
                {subjectDisplay}
              </span>
            </div>
            {strategy.existingEntityCount > 0 && (
              <p className="text-[11px] text-slate-500">
                {strategy.existingEntityCount} existing entities found in the Knowledge Graph for this subject.
              </p>
            )}
          </div>

          {/* Strategy metrics */}
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="Collectors" value={activeCollectorCount} />
            <MetricCard label="Source Types" value={enabledTypes.size} />
            <MetricCard
              label="Avg Yield"
              value={`${Math.round(
                strategy.collectors
                  .filter((c) => enabledTypes.has(c.collectorType as SourceCollectorType))
                  .reduce((sum, c) => sum + c.estimatedYield, 0) /
                  (activeCollectorCount || 1) *
                  100
              )}%`}
            />
          </div>

          {/* Max sources adjustment */}
          <div className="space-y-2">
            <label
              htmlFor="max-sources-input"
              className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
            >
              Maximum Sources
            </label>
            <div className="flex items-center gap-3">
              <input
                id="max-sources-input"
                type="number"
                min={1}
                max={100}
                value={maxSources}
                onChange={(e) => setMaxSources(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                className="w-24 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-500">
                sources (default: {strategy.maxSources})
              </span>
            </div>
          </div>

          {/* Collector type toggles */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Source Collectors
            </label>
            <div className="space-y-2">
              {uniqueTypes.map((type) => {
                const meta = COLLECTOR_META[type];
                const enabled = enabledTypes.has(type);
                const count = countForType(strategy.collectors, type);
                const avgYield = averageYieldForType(strategy.collectors, type);

                return (
                  <div
                    key={type}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      enabled
                        ? "bg-white/5 border-white/10"
                        : "bg-white/2 border-white/5 opacity-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`Toggle ${meta.label}`}
                        onClick={() => handleToggleType(type)}
                        className={`relative w-9 h-5 rounded-full transition-colors ${
                          enabled ? "bg-blue-600" : "bg-slate-700"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                            enabled ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                      <span className="text-base">{meta.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-white">{meta.label}</p>
                        <p className="text-[10px] text-slate-500">
                          {count} invocation{count !== 1 ? "s" : ""} planned
                        </p>
                      </div>
                    </div>
                    <YieldBadge yield={avgYield} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-white/5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white rounded-lg border border-white/10 hover:border-white/20 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={enabledTypes.size === 0}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            <span>⚡</span>
            Start Execution
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

function YieldBadge({ yield: yieldScore }: { yield: number }) {
  const pct = Math.round(yieldScore * 100);
  let color = "bg-slate-500/20 text-slate-400 border-slate-500/20";
  if (pct >= 70) color = "bg-emerald-500/15 text-emerald-400 border-emerald-500/20";
  else if (pct >= 40) color = "bg-amber-500/15 text-amber-400 border-amber-500/20";

  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${color}`}>
      {pct}% yield
    </span>
  );
}
