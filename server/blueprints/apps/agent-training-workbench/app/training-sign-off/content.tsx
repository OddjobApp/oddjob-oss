"use client";

import { useState, useEffect, useCallback } from "react";
import { hil, records, events } from "../../lib/platform-client";
import type { HilRequest, HilField, AppRecord } from "../../lib/platform-client";

const COL_DECISIONS  = "training_decisions";
const COL_DIFFS      = "prompt_diffs";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PromptDiff extends AppRecord {
  fromVersion: string;
  toVersion: string;
  diff: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
}

interface TrainingDecision extends AppRecord {
  formName: string;
  stage: string;
  decision: Record<string, unknown>;
  proposedChanges: string;
  actor: string;
  timestamp: string;
}

// ── SLA countdown ─────────────────────────────────────────────────────────────
function useSlaCountdown(
  createdAt: string,
  slaHours = 24
): { label: string; breached: boolean; urgent: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const deadlineMs  = new Date(createdAt).getTime() + slaHours * 3600 * 1000;
  const remainingMs = deadlineMs - now;
  const breached    = remainingMs <= 0;
  const urgent      = !breached && remainingMs < 30 * 60 * 1000;
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

// ── Field renderer ────────────────────────────────────────────────────────────
function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: HilField;
  value: string | string[];
  onChange: (val: string | string[]) => void;
}) {
  const baseInput =
    "w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500";

  switch (field.type) {
    case "select":
      return (
        <select value={value as string} onChange={(e) => onChange(e.target.value)} className={baseInput}>
          <option value="">— select —</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
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
            type="range" min={min} max={max} step={step} value={num}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 accent-teal-500"
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
                key={o} type="button"
                onClick={() => onChange(isOn ? selected.filter((x) => x !== o) : [...selected, o])}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  isOn
                    ? "bg-teal-600 border-teal-500 text-white"
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
                  current === o ? "border-teal-500 bg-teal-500" : "border-slate-600 group-hover:border-slate-400"
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
        <input type="text" value={value as string} onChange={(e) => onChange(e.target.value)} className={baseInput} />
      );
  }
}

// ── Context chips ─────────────────────────────────────────────────────────────
function ContextChips({ ctx }: { ctx: Record<string, unknown> }) {
  const entries = Object.entries(ctx).filter(
    ([k, v]) => v !== null && v !== undefined && v !== "" && k !== "proposedChanges" && k !== "promptDiff"
  );
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.slice(0, 12).map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px]">
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

// ── Diff view ─────────────────────────────────────────────────────────────────
function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <div className="font-mono text-xs rounded-lg overflow-hidden border border-white/10">
      {lines.map((line, i) => {
        let cls = "px-3 py-0.5 block text-slate-400 bg-transparent";
        if (line.startsWith("+")) cls = "px-3 py-0.5 block text-emerald-300 bg-emerald-500/10";
        else if (line.startsWith("-")) cls = "px-3 py-0.5 block text-rose-300 bg-rose-500/10";
        return <span key={i} className={cls}>{line || " "}</span>;
      })}
    </div>
  );
}

// ── Training gate card ────────────────────────────────────────────────────────
function TrainingGateCard({
  req,
  onResolved,
}: {
  req: HilRequest;
  onResolved: (id: string) => void;
}) {
  const { breached } = useSlaCountdown(req.createdAt, req.slaHours ?? 24);
  const [values, setValues] = useState<Record<string, string | string[]>>(() => {
    const v: Record<string, string | string[]> = {};
    req.fields.forEach((f) => { v[f.name] = f.type === "multiselect" ? [] : ""; });
    return v;
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const proposedChanges =
    (req.context.proposedChanges as string | undefined) ||
    (req.context.promptDiff as string | undefined) ||
    "";

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await hil.submit(req.id, values);
      await records.create(COL_DECISIONS, {
        formName:        req.formName,
        stage:           req.stage,
        decision:        values,
        actor:           "operator",
        timestamp:       new Date().toISOString(),
        proposedChanges,
      });
      onResolved(req.id);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Submission failed.");
      setSubmitting(false);
    }
  };

  return (
    <div className={`border rounded-xl p-5 space-y-4 transition-colors ${
      breached ? "bg-rose-950/30 border-rose-500/30" : "bg-white/5 border-white/10"
    }`}>
      {/* Header */}
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

      {/* Context chips */}
      {Object.keys(req.context).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Context</p>
          <ContextChips ctx={req.context} />
        </div>
      )}

      {/* Proposed changes diff */}
      {proposedChanges && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Proposed Changes</p>
          <DiffView diff={proposedChanges} />
        </div>
      )}

      {/* Dynamic form fields */}
      {req.fields.length > 0 && (
        <div className="space-y-3">
          {req.fields.map((f) => (
            <div key={f.name}>
              <label className="block text-xs text-slate-400 mb-1.5">
                {f.label}{f.required && <span className="text-rose-400 ml-1">*</span>}
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
        className="w-full py-2.5 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {submitting ? "Submitting decision…" : "Submit Decision"}
      </button>
    </div>
  );
}

// ── Prompt diff review card ───────────────────────────────────────────────────
function PromptDiffCard({
  diff,
  onUpdate,
}: {
  diff: PromptDiff;
  onUpdate: (id: string, status: "approved" | "rejected") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);

  const statusMap: Record<string, string> = {
    pending:  "bg-amber-500/15 border-amber-500/20 text-amber-400",
    approved: "bg-emerald-500/15 border-emerald-500/20 text-emerald-400",
    rejected: "bg-rose-500/15 border-rose-500/20 text-rose-400",
  };

  const handleAction = async (status: "approved" | "rejected") => {
    setUpdating(true);
    try {
      await records.update(COL_DIFFS, diff.id, { status });
      onUpdate(diff.id, status);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">
            v{diff.fromVersion} &rarr; v{diff.toVersion}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusMap[diff.status] ?? statusMap.pending}`}>
            {diff.status}
          </span>
        </div>
        <span className="text-[10px] text-slate-600 shrink-0">
          {new Date(diff.requestedAt).toLocaleDateString()}
        </span>
      </div>

      <button
        onClick={() => setExpanded((x) => !x)}
        className="text-xs text-slate-400 hover:text-white transition-colors flex items-center gap-1.5"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        {expanded ? "Hide diff" : "View diff"}
      </button>

      {expanded && <DiffView diff={diff.diff} />}

      {diff.status === "pending" && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => handleAction("approved")}
            disabled={updating}
            className="flex-1 py-1.5 bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => handleAction("rejected")}
            disabled={updating}
            className="flex-1 py-1.5 bg-rose-700/30 hover:bg-rose-700/50 border border-rose-500/30 text-rose-400 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

// ── Decision timeline entry ───────────────────────────────────────────────────
function DecisionTimelineEntry({ entry }: { entry: TrainingDecision }) {
  const [expanded, setExpanded] = useState(false);
  const ts     = new Date(entry.timestamp);
  const now    = new Date();
  const diffH  = (now.getTime() - ts.getTime()) / (1000 * 3600);
  const timeClass = diffH > 168 ? "text-slate-600" : diffH > 24 ? "text-slate-500" : "text-blue-400";

  const decisionSummary = Object.entries(entry.decision ?? {}).slice(0, 1).map(
    ([k, v]) => `${k}: ${String(v)}`
  ).join(", ");

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-slate-600 border-2 border-slate-500 mt-1" />
        <div className="w-px flex-1 bg-slate-700/50 mt-1" />
      </div>
      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{entry.formName}</span>
            <StageBadge stage={entry.stage} />
          </div>
          <span className={`text-[10px] shrink-0 font-mono ${timeClass}`}>
            {ts.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] text-slate-500">by</span>
          <span className="text-[10px] font-semibold text-slate-400">{entry.actor}</span>
          {decisionSummary && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-[10px] text-slate-500 truncate max-w-[200px]">{decisionSummary}</span>
            </>
          )}
        </div>
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
            {entry.proposedChanges && (
              <div className="mt-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Proposed Changes</p>
                <DiffView diff={entry.proposedChanges} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TrainingSignOffContent() {
  const [pending, setPending]         = useState<HilRequest[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError]     = useState<string | null>(null);

  const [diffs, setDiffs]             = useState<PromptDiff[]>([]);
  const [diffsLoading, setDiffsLoading] = useState(true);

  const [decisions, setDecisions]     = useState<TrainingDecision[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(true);

  const fetchPending = useCallback(async () => {
    try {
      const data = await hil.pending("training");
      setPending(data);
    } catch (e: unknown) {
      setPendingError(e instanceof Error ? e.message : "Failed to load pending gates");
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const fetchDiffs = useCallback(async () => {
    try {
      const data = await records.list(COL_DIFFS);
      setDiffs(
        (data as PromptDiff[]).sort(
          (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
        )
      );
    } catch {
      // non-fatal
    } finally {
      setDiffsLoading(false);
    }
  }, []);

  const fetchDecisions = useCallback(async () => {
    try {
      const data = await records.list(COL_DECISIONS);
      setDecisions(
        (data as TrainingDecision[]).sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
      );
    } catch {
      // non-fatal
    } finally {
      setDecisionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
    fetchDiffs();
    fetchDecisions();
    const unsub = events.subscribe((ev) => {
      if (["hil.raised", "hil.resolved", "mission.completed"].includes(ev.type)) {
        fetchPending();
        fetchDecisions();
      }
    });
    return unsub;
  }, [fetchPending, fetchDiffs, fetchDecisions]);

  const handleGateResolved = (id: string) => {
    setPending((q) => q.filter((r) => r.id !== id));
    fetchDecisions();
  };

  const handleDiffUpdate = (id: string, status: "approved" | "rejected") => {
    setDiffs((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-4xl mx-auto space-y-10">

        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎓</span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">Training Sign-off</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              HIL gateway for approving training direction, reviewing prompt changes, and signing off on promotions.
            </p>
          </div>
        </div>

        {/* ── Pending Training Gates ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Pending Training Gates
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
              {[1, 2].map((i) => <div key={i} className="h-32 bg-white/5 rounded-xl animate-pulse" />)}
            </div>
          )}
          {pendingError && (
            <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">
              {pendingError}
            </div>
          )}
          {!pendingLoading && !pendingError && pending.length === 0 && (
            <div className="text-center py-12 bg-white/3 border border-white/8 rounded-xl">
              <div className="text-3xl mb-2">✓</div>
              <p className="text-sm text-slate-400 font-medium">No pending training gates</p>
              <p className="text-xs text-slate-600 mt-1">All HIL training gates are clear. New requests appear here in real time.</p>
            </div>
          )}
          <div className="space-y-4">
            {pending.map((req) => (
              <TrainingGateCard key={req.id} req={req} onResolved={handleGateResolved} />
            ))}
          </div>
        </section>

        {/* ── Prompt Diff Review ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Prompt Diff Review
            </h2>
            <button
              onClick={fetchDiffs}
              className="px-3 py-1 text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
            >
              Refresh
            </button>
          </div>

          {diffsLoading && (
            <div className="space-y-3">
              {[1, 2].map((i) => <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />)}
            </div>
          )}
          {!diffsLoading && diffs.length === 0 && (
            <div className="text-center py-10 bg-white/3 border border-white/8 rounded-xl">
              <p className="text-sm text-slate-500">No prompt diffs to review.</p>
            </div>
          )}
          <div className="space-y-3">
            {diffs.map((d) => (
              <PromptDiffCard key={d.id} diff={d} onUpdate={handleDiffUpdate} />
            ))}
          </div>
        </section>

        {/* ── Decision History Timeline ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Decision History
            </h2>
            {decisions.length > 0 && (
              <span className="text-xs text-slate-500">{decisions.length} recorded</span>
            )}
          </div>

          {decisionsLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />)}
            </div>
          )}
          {!decisionsLoading && decisions.length === 0 && (
            <div className="text-center py-10 bg-white/3 border border-white/8 rounded-xl">
              <p className="text-sm text-slate-500">No decisions recorded yet.</p>
            </div>
          )}
          {decisions.length > 0 && (
            <div className="bg-white/3 border border-white/8 rounded-xl p-5">
              {decisions.map((entry) => (
                <DecisionTimelineEntry key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
