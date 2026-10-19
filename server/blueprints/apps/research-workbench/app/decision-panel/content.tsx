"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { hil, records, events, telemetry } from "../../lib/platform-client";
import type { HilRequest, HilField, DecisionHistoryEntry } from "../../lib/platform-client";

const COL_HISTORY = "decision_history";

// ── SLA countdown hook ────────────────────────────────────────────────────────
function useSlaCountdown(createdAt: string, slaHours = 24): { label: string; breached: boolean; urgent: boolean } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deadlineMs  = new Date(createdAt).getTime() + slaHours * 3600 * 1000;
  const remainingMs = deadlineMs - now;
  const breached    = remainingMs <= 0;
  const urgent      = !breached && remainingMs < 30 * 60 * 1000; // < 30 min

  if (breached) return { label: "OVERDUE", breached: true, urgent: false };

  const totalSec = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const label = h > 0
    ? `${h}h ${String(m).padStart(2, "0")}m`
    : `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;

  return { label, breached: false, urgent };
}

// ── Dynamic field renderer ────────────────────────────────────────────────────
function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: HilField;
  value: string | string[];
  onChange: (val: string | string[]) => void;
}) {
  const baseInput = "w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  switch (field.type) {
    case "select":
      return (
        <select
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
        >
          <option value="">— select —</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );

    case "textarea":
      return (
        <textarea
          rows={4}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${field.label.toLowerCase()}…`}
          className={`${baseInput} resize-none`}
        />
      );

    case "text":
      return (
        <input
          type="text"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${field.label.toLowerCase()}…`}
          className={baseInput}
        />
      );

    case "slider": {
      const min  = field.min  ?? 0;
      const max  = field.max  ?? 100;
      const step = field.step ?? 1;
      const num  = value === "" ? min : Number(value);
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={num}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 accent-blue-500"
          />
          <span className="w-10 text-center text-sm font-mono text-white bg-slate-800 border border-white/10 rounded px-2 py-1">
            {num}
          </span>
        </div>
      );
    }

    case "multiselect": {
      const selected = Array.isArray(value) ? value : value ? [value as string] : [];
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((o) => {
            const isOn = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => {
                  const next = isOn ? selected.filter((x) => x !== o) : [...selected, o];
                  onChange(next);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  isOn
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/20"
                }`}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }

    case "radio": {
      const current = value as string;
      return (
        <div className="flex flex-wrap gap-3">
          {(field.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-2 cursor-pointer group">
              <div
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                  current === o
                    ? "border-blue-500 bg-blue-500"
                    : "border-slate-600 group-hover:border-slate-400"
                }`}
                onClick={() => onChange(o)}
              >
                {current === o && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <span
                className={`text-sm transition-colors ${current === o ? "text-white" : "text-slate-400 group-hover:text-slate-300"}`}
                onClick={() => onChange(o)}
              >
                {o}
              </span>
            </label>
          ))}
        </div>
      );
    }

    default:
      return (
        <input
          type="text"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
        />
      );
  }
}

// ── Context key-value chips ───────────────────────────────────────────────────
function ContextChips({ ctx }: { ctx: Record<string, unknown> }) {
  const entries = Object.entries(ctx).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.slice(0, 12).map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/8 text-[11px]"
        >
          <span className="text-slate-500 font-medium">{k}</span>
          <span className="text-slate-300 max-w-[140px] truncate">{String(v)}</span>
        </span>
      ))}
    </div>
  );
}

// ── SLA badge ─────────────────────────────────────────────────────────────────
function SlaBadge({ createdAt, slaHours }: { createdAt: string; slaHours?: number }) {
  const { label, breached, urgent } = useSlaCountdown(createdAt, slaHours ?? 24);

  if (breached) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-bold animate-pulse">
        OVERDUE
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${
      urgent
        ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
        : "bg-slate-700/50 border-slate-600 text-slate-300"
    }`}>
      {urgent && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
      SLA {label}
    </span>
  );
}

// ── Stage badge ───────────────────────────────────────────────────────────────
function StageBadge({ stage }: { stage: string }) {
  return (
    <span className="px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/20 text-violet-300 text-[10px] font-semibold uppercase tracking-wide">
      {stage}
    </span>
  );
}

// ── Approval card ─────────────────────────────────────────────────────────────
function ApprovalCard({
  req,
  onResolved,
}: {
  req: HilRequest;
  onResolved: (id: string) => void;
}) {
  const { breached } = useSlaCountdown(req.createdAt, req.slaHours ?? 24);

  // Build initial form values
  const initialValues = () => {
    const v: Record<string, string | string[]> = {};
    req.fields.forEach((f) => {
      v[f.name] = f.type === "multiselect" ? [] : "";
    });
    return v;
  };

  const [values, setValues]       = useState<Record<string, string | string[]>>(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await hil.submit(req.id, values);
      await records.create(COL_HISTORY, {
        formName:  req.formName,
        stage:     req.stage,
        decision:  values,
        actor:     "operator",
        timestamp: new Date().toISOString(),
        context:   req.context,
      });
      telemetry.emit("hil_submitted", "info", { formName: req.formName, stage: req.stage });
      onResolved(req.id);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Submission failed.");
      setSubmitting(false);
    }
  };

  return (
    <div className={`border rounded-xl p-5 space-y-4 transition-colors ${
      breached
        ? "bg-rose-950/30 border-rose-500/30"
        : "bg-white/5 border-white/10"
    }`}>
      {/* Card header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white">{req.formName}</h3>
          <div className="flex items-center gap-2 mt-1.5">
            <StageBadge stage={req.stage} />
            <SlaBadge createdAt={req.createdAt} slaHours={req.slaHours} />
          </div>
        </div>
        <span className="text-[10px] text-slate-600 shrink-0 mt-0.5">
          {new Date(req.createdAt).toLocaleString()}
        </span>
      </div>

      {/* Context */}
      {Object.keys(req.context).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Context</p>
          <ContextChips ctx={req.context} />
        </div>
      )}

      {/* Dynamic form fields */}
      {req.fields.length > 0 && (
        <div className="space-y-3">
          {req.fields.map((f) => (
            <div key={f.name}>
              <label className="block text-xs text-slate-400 mb-1.5">
                {f.label}
                {f.required && <span className="text-rose-400 ml-1">*</span>}
              </label>
              <FieldRenderer
                field={f}
                value={values[f.name] ?? (f.type === "multiselect" ? [] : "")}
                onChange={(val) => setValues((prev) => ({ ...prev, [f.name]: val }))}
              />
            </div>
          ))}
        </div>
      )}

      {submitError && (
        <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          {submitError}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {submitting ? "Submitting decision…" : "Submit Decision"}
      </button>
    </div>
  );
}

// ── Decision history entry ────────────────────────────────────────────────────
function HistoryEntry({ entry }: { entry: DecisionHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);

  const ts     = new Date(entry.timestamp);
  const now    = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const diffH  = diffMs / (1000 * 3600);

  let timeClass = "text-blue-400";
  if (diffH > 168)     timeClass = "text-slate-600";
  else if (diffH > 24) timeClass = "text-slate-500";

  return (
    <div className="flex gap-4">
      {/* Timeline dot */}
      <div className="flex flex-col items-center shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-slate-600 border-2 border-slate-500 mt-1" />
        <div className="w-px flex-1 bg-slate-700/50 mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div>
            <span className="text-sm font-semibold text-white">{entry.formName}</span>
            <span className="mx-2 text-slate-600">·</span>
            <StageBadge stage={entry.stage} />
          </div>
          <span className={`text-[10px] shrink-0 font-mono ${timeClass}`}>
            {ts.toLocaleString()}
          </span>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-slate-500">by</span>
          <span className="text-[10px] font-semibold text-slate-400">{entry.actor}</span>
        </div>

        {/* Decision preview */}
        <button
          onClick={() => setExpanded((x) => !x)}
          className="text-xs text-slate-400 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <span>{expanded ? "▼" : "▶"}</span>
          {expanded ? "Hide decision" : "Show decision"}
        </button>

        {expanded && (
          <div className="mt-2 bg-slate-950/60 border border-white/5 rounded-lg p-3 overflow-x-auto">
            <pre className="text-xs text-slate-300 whitespace-pre-wrap">
              {JSON.stringify(entry.decision, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DecisionPanelContent() {
  const [pending, setPending]       = useState<HilRequest[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError]     = useState<string | null>(null);

  const [history, setHistory]       = useState<DecisionHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const fetchPending = useCallback(async () => {
    try {
      const data = await hil.pending();
      setPending(data);
    } catch (e: unknown) {
      setPendingError(e instanceof Error ? e.message : "Failed to load pending approvals");
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await records.list(COL_HISTORY);
      const sorted = (data as DecisionHistoryEntry[]).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      setHistory(sorted);
    } catch {
      // history load failing is non-fatal
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
    fetchHistory();

    const unsub = events.subscribe((ev) => {
      if (["hil.raised", "hil.resolved", "mission.completed", "mission.status_changed"].includes(ev.type)) {
        fetchPending();
        fetchHistory();
      }
    });
    return unsub;
  }, [fetchPending, fetchHistory]);

  const handleResolved = (id: string) => {
    setPending((q) => q.filter((r) => r.id !== id));
    fetchHistory();
  };

  const handleClearHistory = async () => {
    if (!window.confirm("Clear all decision history? This cannot be undone.")) return;
    // Optimistic clear — individual deletes would need a batch API; we just clear display
    setHistory([]);
    telemetry.emit("decision_history_cleared", "info");
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-4xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚖️</span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">Decision Control Panel</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Dynamic HIL approval forms and decision audit trail for any cycle stage.
            </p>
          </div>
        </div>

        {/* ── Pending Approvals ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Pending Approvals
            </h2>
            <div className="flex items-center gap-2">
              {pending.length > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/20 text-rose-400 text-xs font-bold">
                  {pending.length} awaiting
                </span>
              )}
              <button
                onClick={fetchPending}
                className="px-3 py-1 text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>

          {pendingLoading && (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-32 bg-white/5 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {pendingError && (
            <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">
              {pendingError}
            </div>
          )}

          {!pendingLoading && !pendingError && pending.length === 0 && (
            <div className="text-center py-12 bg-white/3 border border-white/8 rounded-xl">
              <div className="text-3xl mb-2">✅</div>
              <p className="text-sm text-slate-400 font-medium">No pending approvals</p>
              <p className="text-xs text-slate-600 mt-1">All HIL gates are clear. New requests will appear here in real time.</p>
            </div>
          )}

          <div className="space-y-4">
            {pending.map((req) => (
              <ApprovalCard key={req.id} req={req} onResolved={handleResolved} />
            ))}
          </div>
        </section>

        {/* ── Decision History ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Decision History
            </h2>
            {history.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="px-3 py-1 text-xs text-rose-400 hover:text-rose-300 border border-rose-500/20 hover:border-rose-500/40 rounded-lg transition-colors"
              >
                Clear History
              </button>
            )}
          </div>

          {historyLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />)}
            </div>
          )}

          {!historyLoading && history.length === 0 && (
            <div className="text-center py-10 bg-white/3 border border-white/8 rounded-xl">
              <p className="text-sm text-slate-500">No decisions recorded yet.</p>
              <p className="text-xs text-slate-600 mt-1">Submitted decisions will appear here as an audit trail.</p>
            </div>
          )}

          {history.length > 0 && (
            <div className="bg-white/3 border border-white/8 rounded-xl p-5">
              {history.map((entry) => (
                <HistoryEntry key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
