/**
 * BlockersPanel — log, view, and resolve sprint blockers with SLA monitoring.
 */
import React, { useState, useEffect } from "react";
import { AlertOctagon, CheckCircle2, Clock, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { formatDistanceToNow, differenceInHours, parseISO } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import type { BlockerRecord } from "../lib/collections";

interface Props {
  sprintNumber: number;
  blockers: BlockerRecord[];
  loading: boolean;
  error: string | null;
  onAdd: (blocker: Omit<BlockerRecord, "id">) => Promise<void>;
  onResolve: (blockerId: string, recordId: string) => Promise<void>;
  onReload: () => void;
  blockerSlaHours: number;
}

interface FieldError {
  jiraKey?: string;
  severity?: string;
  description?: string;
  owner?: string;
}

const SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;

export function BlockersPanel({
  sprintNumber, blockers, loading, error,
  onAdd, onResolve, onReload, blockerSlaHours,
}: Props) {
  const [jiraKey, setJiraKey]       = useState("");
  const [severity, setSeverity]     = useState<typeof SEVERITIES[number] | "">("");
  const [description, setDescription] = useState("");
  const [owner, setOwner]           = useState("");
  const [errors, setErrors]         = useState<FieldError>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Tick every minute to refresh SLA badges
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const open     = blockers.filter((b) => !b.resolvedAt);
  const resolved = blockers.filter((b) => !!b.resolvedAt);
  const slaBreach = open.filter((b) => differenceInHours(new Date(), parseISO(b.loggedAt)) >= blockerSlaHours);

  function validate(): boolean {
    const e: FieldError = {};
    if (!jiraKey.trim())   e.jiraKey     = "Jira key is required";
    if (!severity)         e.severity    = "Severity is required";
    if (!description.trim()) e.description = "Description is required";
    if (!owner.trim())     e.owner       = "Owner is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onAdd({
        blockerId: uuidv4(),
        jiraKey: jiraKey.trim().toUpperCase(),
        severity: severity as typeof SEVERITIES[number],
        description: description.trim(),
        owner: owner.trim(),
        sprintNumber,
        loggedAt: new Date().toISOString(),
        resolvedAt: null,
      });
      setJiraKey(""); setSeverity(""); setDescription(""); setOwner("");
    } catch (err: any) {
      setSubmitError(err.message ?? "Failed to log blocker");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolve(blocker: BlockerRecord) {
    if (!blocker.id) return;
    setResolvingId(blocker.blockerId);
    try {
      await onResolve(blocker.blockerId, blocker.id);
    } finally {
      setResolvingId(null);
    }
  }

  function slaBadge(blocker: BlockerRecord) {
    const hours = differenceInHours(new Date(), parseISO(blocker.loggedAt));
    if (hours >= blockerSlaHours) {
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400">
          <AlertOctagon className="w-3 h-3" />
          SLA Breached · {hours - blockerSlaHours}h overdue
        </span>
      );
    }
    if (hours >= blockerSlaHours - 2) {
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">
          <AlertTriangle className="w-3 h-3" />
          SLA Warning
        </span>
      );
    }
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Summary counts */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Open", value: open.length, color: "text-white" },
          { label: "SLA Breached", value: slaBreach.length, color: slaBreach.length > 0 ? "text-rose-400" : "text-white" },
          { label: "Resolved", value: resolved.length, color: "text-emerald-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-[#15121e]/40 border border-white/5 rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Log form */}
      <div className="bg-[#15121e]/40 border border-white/5 rounded-xl p-5">
        <h4 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-rose-400" />
          Log New Blocker
        </h4>

        {submitError && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="blocker-jira-key" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Jira Key <span className="text-rose-400">*</span>
              </label>
              <input
                id="blocker-jira-key"
                type="text"
                placeholder="e.g. DEV-123"
                value={jiraKey}
                onChange={(e) => setJiraKey(e.target.value)}
                aria-describedby={errors.jiraKey ? "blocker-jira-key-error" : undefined}
                aria-invalid={!!errors.jiraKey}
                className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white transition-colors ${errors.jiraKey ? "border-rose-500" : "border-white/10"}`}
              />
              {errors.jiraKey && <p id="blocker-jira-key-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.jiraKey}</p>}
            </div>

            <div>
              <label htmlFor="blocker-severity" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Severity <span className="text-rose-400">*</span>
              </label>
              <select
                id="blocker-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as any)}
                aria-describedby={errors.severity ? "blocker-severity-error" : undefined}
                aria-invalid={!!errors.severity}
                className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white transition-colors ${errors.severity ? "border-rose-500" : "border-white/10"}`}
              >
                <option value="">Select severity…</option>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {errors.severity && <p id="blocker-severity-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.severity}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="blocker-description" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Description <span className="text-rose-400">*</span>
            </label>
            <textarea
              id="blocker-description"
              rows={3}
              placeholder="Describe the blocker…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby={errors.description ? "blocker-description-error" : undefined}
              aria-invalid={!!errors.description}
              className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white resize-none transition-colors ${errors.description ? "border-rose-500" : "border-white/10"}`}
            />
            {errors.description && <p id="blocker-description-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.description}</p>}
          </div>

          <div>
            <label htmlFor="blocker-owner" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Owner <span className="text-rose-400">*</span>
            </label>
            <input
              id="blocker-owner"
              type="text"
              placeholder="Name or team"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              aria-describedby={errors.owner ? "blocker-owner-error" : undefined}
              aria-invalid={!!errors.owner}
              className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white transition-colors ${errors.owner ? "border-rose-500" : "border-white/10"}`}
            />
            {errors.owner && <p id="blocker-owner-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.owner}</p>}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-rose-700 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Logging…</> : "Log Blocker"}
          </button>
        </form>
      </div>

      {/* Blocker list */}
      <div>
        {error && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs mb-3">
            <span>{error}</span>
            <button onClick={onReload} className="flex items-center gap-1 ml-2 underline"><RefreshCw className="w-3 h-3" /> Retry</button>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />)}</div>
        ) : blockers.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 rounded-lg border border-dashed border-white/10 text-slate-500 text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            No blockers logged for this sprint.
          </div>
        ) : (
          <div className="space-y-2">
            {[...open, ...resolved].map((blocker) => (
              <div
                key={blocker.blockerId}
                className={`flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors ${
                  blocker.resolvedAt
                    ? "bg-white/3 border-white/5 opacity-60"
                    : differenceInHours(new Date(), parseISO(blocker.loggedAt)) >= blockerSlaHours
                    ? "bg-rose-500/5 border-rose-500/20"
                    : "bg-white/3 border-white/5"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-bold text-amber-400">{blocker.jiraKey}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      blocker.severity === "Critical" ? "bg-rose-500/20 text-rose-400" :
                      blocker.severity === "High"     ? "bg-orange-500/20 text-orange-400" :
                      blocker.severity === "Medium"   ? "bg-amber-500/20 text-amber-400" :
                      "bg-slate-700 text-slate-400"
                    }`}>
                      {blocker.severity}
                    </span>
                    {!blocker.resolvedAt && slaBadge(blocker)}
                    {blocker.resolvedAt && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" /> Resolved
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white">{blocker.description}</p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                    <span>Owner: {blocker.owner}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(parseISO(blocker.loggedAt), { addSuffix: true })}
                    </span>
                  </div>
                </div>

                {!blocker.resolvedAt && (
                  <button
                    onClick={() => handleResolve(blocker)}
                    disabled={resolvingId === blocker.blockerId}
                    aria-label={`Mark ${blocker.jiraKey} blocker as resolved`}
                    className="shrink-0 px-2.5 py-1.5 text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {resolvingId === blocker.blockerId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Resolve"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
