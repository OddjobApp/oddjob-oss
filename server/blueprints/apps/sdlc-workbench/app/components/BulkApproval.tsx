"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { hil } from "../../lib/platform-client";
import type { HilRequest, BulkHilSubmitResponse } from "../../lib/platform-client";
import { CheckSquare, Square, AlertTriangle, Clock, Shield, X } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface BulkApprovalProps {
  onResolved?: (ids: string[]) => void;
}

type RiskLevel = "low" | "medium" | "high";

interface EnrichedHilRequest extends HilRequest {
  elapsedHours: number;
  slaRemaining: number | null;
  slaBreached: boolean;
  riskLevel: RiskLevel;
  schemaKey: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeElapsedHours(createdAt: string): number {
  return Math.round((Date.now() - new Date(createdAt).getTime()) / 3600000);
}

function computeRiskLevel(req: HilRequest): RiskLevel {
  const ctx = req.context;
  if (ctx.risk === "high" || ctx.severity === "critical") return "high";
  if (ctx.risk === "medium" || ctx.severity === "major") return "medium";
  return "low";
}

/** Generates a stable schema key from a request's fields to group same-schema items */
function computeSchemaKey(req: HilRequest): string {
  return req.fields
    .map((f) => `${f.name}:${f.type}`)
    .sort()
    .join("|");
}

function enrichRequest(req: HilRequest): EnrichedHilRequest {
  const elapsedHours = computeElapsedHours(req.createdAt);
  const slaRemaining = req.slaHours != null ? req.slaHours - elapsedHours : null;
  const slaBreached = req.slaHours != null && elapsedHours >= req.slaHours;
  return {
    ...req,
    elapsedHours,
    slaRemaining,
    slaBreached,
    riskLevel: computeRiskLevel(req),
    schemaKey: computeSchemaKey(req),
  };
}

/** Sort: breached SLA first (pinned to top), then by urgency (lowest slaRemaining first) */
function sortByUrgency(a: EnrichedHilRequest, b: EnrichedHilRequest): number {
  // Breached items pinned to top
  if (a.slaBreached && !b.slaBreached) return -1;
  if (!a.slaBreached && b.slaBreached) return 1;
  // Then by SLA remaining ascending (most urgent first)
  const aRemain = a.slaRemaining ?? Infinity;
  const bRemain = b.slaRemaining ?? Infinity;
  return aRemain - bRemain;
}

// ── Component ────────────────────────────────────────────────────────────────

export function BulkApproval({ onResolved }: BulkApprovalProps) {
  const [requests, setRequests] = useState<EnrichedHilRequest[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [bulkAction, setBulkAction] = useState<"approve" | "reject" | null>(null);

  // Fetch pending HIL requests
  useEffect(() => {
    let cancelled = false;
    async function fetchPending() {
      setLoading(true);
      setError(null);
      try {
        const pending = await hil.pending();
        if (!cancelled) {
          setRequests(pending.map(enrichRequest).sort(sortByUrgency));
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load pending decisions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchPending();
    return () => { cancelled = true; };
  }, []);

  // Sorted requests (already sorted on fetch, re-sort if needed)
  const sortedRequests = useMemo(() => [...requests].sort(sortByUrgency), [requests]);

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(sortedRequests.map((r) => r.id)));
  }, [sortedRequests]);

  const selectAllLowRisk = useCallback(() => {
    setSelected(new Set(sortedRequests.filter((r) => r.riskLevel === "low").map((r) => r.id)));
  }, [sortedRequests]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  // Group selected items by schema
  const selectedBySchema = useMemo(() => {
    const groups = new Map<string, EnrichedHilRequest[]>();
    for (const req of sortedRequests) {
      if (!selected.has(req.id)) continue;
      const existing = groups.get(req.schemaKey) ?? [];
      existing.push(req);
      groups.set(req.schemaKey, existing);
    }
    return groups;
  }, [sortedRequests, selected]);

  const hasMixedSchemas = selectedBySchema.size > 1;

  // Handle bulk approve action
  const handleBulkApprove = useCallback(() => {
    if (selected.size === 0) return;
    setBulkAction("approve");
    setShowSchemaModal(true);
  }, [selected]);

  // Handle bulk reject action
  const handleBulkReject = useCallback(async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const decisions = Array.from(selected).map((hilId) => ({
        hilId,
        values: { decision: "rejected" },
      }));
      const response: BulkHilSubmitResponse = await hil.bulkSubmit(decisions);
      const resolvedIds = response.results.filter((r) => r.success).map((r) => r.hilId);
      setRequests((prev) => prev.filter((r) => !resolvedIds.includes(r.id)));
      setSelected(new Set());
      onResolved?.(resolvedIds);
    } catch (err: any) {
      setError(err.message ?? "Bulk reject failed");
    } finally {
      setSubmitting(false);
    }
  }, [selected, onResolved]);

  // Handle schema modal submission
  const handleSchemaSubmit = useCallback(
    async (valuesBySchema: Map<string, Record<string, string>>) => {
      setSubmitting(true);
      setShowSchemaModal(false);
      try {
        const decisions: Array<{ hilId: string; values: Record<string, string> }> = [];
        for (const [schemaKey, items] of selectedBySchema) {
          const values = valuesBySchema.get(schemaKey) ?? {};
          for (const item of items) {
            decisions.push({ hilId: item.id, values });
          }
        }
        const response: BulkHilSubmitResponse = await hil.bulkSubmit(decisions);
        const resolvedIds = response.results.filter((r) => r.success).map((r) => r.hilId);
        setRequests((prev) => prev.filter((r) => !resolvedIds.includes(r.id)));
        setSelected(new Set());
        onResolved?.(resolvedIds);
      } catch (err: any) {
        setError(err.message ?? "Bulk approval failed");
      } finally {
        setSubmitting(false);
      }
    },
    [selectedBySchema, onResolved]
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
        <Clock className="w-4 h-4 mr-2 animate-spin" />
        Loading pending decisions…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
        <AlertTriangle className="w-4 h-4 inline mr-2" />
        {error}
      </div>
    );
  }

  if (sortedRequests.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 text-sm">
        No pending decisions. All clear! ✓
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Selection toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={selectAll}
          className="px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
        >
          Select All
        </button>
        <button
          onClick={selectAllLowRisk}
          className="px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
        >
          Select All Low-Risk
        </button>
        {selected.size > 0 && (
          <button
            onClick={clearSelection}
            className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            Clear ({selected.size})
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-600/10 border border-blue-500/30">
          <span className="text-sm font-medium text-blue-300">
            {selected.size} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleBulkApprove}
              disabled={submitting}
              className="px-4 py-1.5 text-xs font-semibold bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              Approve Selected
            </button>
            <button
              onClick={handleBulkReject}
              disabled={submitting}
              className="px-4 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              Reject Selected
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-700/50">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/50">
              <th className="px-3 py-3 w-10">
                <button
                  onClick={selected.size === sortedRequests.length ? clearSelection : selectAll}
                  className="text-slate-400 hover:text-white transition-colors"
                  aria-label={selected.size === sortedRequests.length ? "Deselect all" : "Select all"}
                >
                  {selected.size === sortedRequests.length && sortedRequests.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-blue-400" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
              </th>
              <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Agent</th>
              <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Mission</th>
              <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Form Name</th>
              <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">SLA Remaining</th>
              <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Risk</th>
            </tr>
          </thead>
          <tbody>
            {sortedRequests.map((req) => (
              <tr
                key={req.id}
                className={`border-b border-slate-700/50 transition-colors ${
                  req.slaBreached
                    ? "bg-red-500/5 border-l-2 border-l-red-500"
                    : "hover:bg-slate-700/30"
                } ${selected.has(req.id) ? "bg-blue-500/5" : ""}`}
              >
                <td className="px-3 py-3">
                  <button
                    onClick={() => toggleSelect(req.id)}
                    className="text-slate-400 hover:text-white transition-colors"
                    aria-label={`Select ${req.formName}`}
                  >
                    {selected.has(req.id) ? (
                      <CheckSquare className="w-4 h-4 text-blue-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {(req.context.agent as string) ?? req.stage ?? "—"}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {(req.context.mission as string) ?? (req.context.missionName as string) ?? "—"}
                </td>
                <td className="px-4 py-3 text-sm text-white font-medium">
                  {req.formName}
                </td>
                <td className="px-4 py-3 text-sm">
                  <SlaCell slaRemaining={req.slaRemaining} breached={req.slaBreached} />
                </td>
                <td className="px-4 py-3">
                  <RiskBadge level={req.riskLevel} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Schema modal for approval */}
      {showSchemaModal && bulkAction === "approve" && (
        <SchemaFormModal
          schemaGroups={selectedBySchema}
          onSubmit={handleSchemaSubmit}
          onClose={() => { setShowSchemaModal(false); setBulkAction(null); }}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SlaCell({ slaRemaining, breached }: { slaRemaining: number | null; breached: boolean }) {
  if (slaRemaining === null) {
    return <span className="text-slate-500">No SLA</span>;
  }
  if (breached) {
    return (
      <span className="text-xs font-bold text-red-400 bg-red-500/20 px-2 py-0.5 rounded-full">
        BREACHED
      </span>
    );
  }
  const urgencyColor =
    slaRemaining <= 2 ? "text-amber-400" : slaRemaining <= 8 ? "text-yellow-400" : "text-slate-300";
  return <span className={`text-sm ${urgencyColor}`}>{slaRemaining}h remaining</span>;
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const styles = {
    low: "bg-green-600/20 text-green-400 border border-green-600/30",
    medium: "bg-yellow-600/20 text-yellow-400 border border-yellow-600/30",
    high: "bg-red-600/20 text-red-400 border border-red-600/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[level]}`}>
      <Shield className="w-3 h-3 inline mr-1" />
      {level}
    </span>
  );
}

// ── Schema Form Modal ────────────────────────────────────────────────────────

function SchemaFormModal({
  schemaGroups,
  onSubmit,
  onClose,
}: {
  schemaGroups: Map<string, EnrichedHilRequest[]>;
  onSubmit: (valuesBySchema: Map<string, Record<string, string>>) => void;
  onClose: () => void;
}) {
  const [valuesBySchema, setValuesBySchema] = useState<Map<string, Record<string, string>>>(
    () => new Map(Array.from(schemaGroups.keys()).map((key) => [key, {}]))
  );

  const updateSchemaValues = (schemaKey: string, fieldName: string, value: string) => {
    setValuesBySchema((prev) => {
      const next = new Map(prev);
      const current = next.get(schemaKey) ?? {};
      next.set(schemaKey, { ...current, [fieldName]: value });
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(valuesBySchema);
  };

  const groups = Array.from(schemaGroups.entries());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[80vh] overflow-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            Approve {Array.from(schemaGroups.values()).reduce((sum, g) => sum + g.length, 0)} items
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {groups.length > 1 && (
          <p className="text-xs text-slate-400 mb-4">
            Items have different form schemas. Fill out one form per schema group — values will apply to all items in each group.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {groups.map(([schemaKey, items]) => (
            <SchemaGroup
              key={schemaKey}
              items={items}
              values={valuesBySchema.get(schemaKey) ?? {}}
              onChange={(field, value) => updateSchemaValues(schemaKey, field, value)}
            />
          ))}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors"
            >
              Confirm Approval
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SchemaGroup({
  items,
  values,
  onChange,
}: {
  items: EnrichedHilRequest[];
  values: Record<string, string>;
  onChange: (field: string, value: string) => void;
}) {
  // Use the first item's fields as the schema representative
  const fields = items[0].fields;
  const formName = items[0].formName;

  return (
    <div className="rounded-lg border border-slate-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">{formName}</h3>
        <span className="text-xs text-slate-400">
          Applies to {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="space-y-3">
        {fields.map((f) => (
          <div key={f.name}>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider">
              {f.label}
              {f.required && " *"}
            </label>
            {f.type === "select" ? (
              <select
                required={f.required}
                value={values[f.name] ?? ""}
                onChange={(e) => onChange(f.name, e.target.value)}
                className="w-full mt-1 bg-slate-800 border border-white/10 rounded p-2 text-sm text-white"
              >
                <option value="">Select…</option>
                {f.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                required={f.required}
                rows={3}
                value={values[f.name] ?? ""}
                onChange={(e) => onChange(f.name, e.target.value)}
                className="w-full mt-1 bg-slate-800 border border-white/10 rounded p-2 text-sm text-white resize-none"
              />
            ) : (
              <input
                type="text"
                required={f.required}
                value={values[f.name] ?? ""}
                onChange={(e) => onChange(f.name, e.target.value)}
                className="w-full mt-1 bg-slate-800 border border-white/10 rounded p-2 text-sm text-white"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
