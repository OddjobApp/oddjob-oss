/**
 * RetroPanel — retrospective action items grouped by category with due-date tracking.
 */
import React, { useState } from "react";
import { BarChart3, CheckCircle2, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { formatDistanceToNow, isPast, parseISO, differenceInDays } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import type { RetroActionRecord } from "../lib/collections";

interface Props {
  sprintNumber: number;
  actions: RetroActionRecord[];
  loading: boolean;
  error: string | null;
  onAdd: (action: Omit<RetroActionRecord, "id">) => Promise<void>;
  onComplete: (actionId: string, recordId: string) => Promise<void>;
  onReload: () => void;
}

const CATEGORIES = ["Process", "Tooling", "Team"] as const;

interface FieldError {
  title?: string;
  category?: string;
  owner?: string;
  dueDate?: string;
}

export function RetroPanel({ sprintNumber, actions, loading, error, onAdd, onComplete, onReload }: Props) {
  const [title, setTitle]       = useState("");
  const [category, setCategory] = useState<typeof CATEGORIES[number] | "">("");
  const [owner, setOwner]       = useState("");
  const [dueDate, setDueDate]   = useState("");
  const [errors, setErrors]     = useState<FieldError>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  function validate(): boolean {
    const e: FieldError = {};
    if (!title.trim())    e.title    = "Title is required";
    if (!category)        e.category = "Category is required";
    if (!owner.trim())    e.owner    = "Owner is required";
    if (!dueDate)         e.dueDate  = "Due date is required";
    else if (isPast(parseISO(dueDate + "T23:59:59"))) e.dueDate = "Due date cannot be in the past";
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
        actionId: uuidv4(),
        title: title.trim(),
        category: category as typeof CATEGORIES[number],
        owner: owner.trim(),
        dueDate,
        sprintNumber,
        createdAt: new Date().toISOString(),
        completedAt: null,
      });
      setTitle(""); setCategory(""); setOwner(""); setDueDate("");
    } catch (err: any) {
      setSubmitError(err.message ?? "Failed to add action");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete(action: RetroActionRecord) {
    if (!action.id) return;
    setCompletingId(action.actionId);
    try {
      await onComplete(action.actionId, action.id);
    } finally {
      setCompletingId(null);
    }
  }

  // Group by category, open before completed within each group
  const grouped = CATEGORIES.reduce<Record<string, RetroActionRecord[]>>((acc, cat) => {
    const catActions = actions.filter((a) => a.category === cat);
    acc[cat] = [
      ...catActions.filter((a) => !a.completedAt),
      ...catActions.filter((a) => !!a.completedAt),
    ];
    return acc;
  }, {} as any);

  const categoryColor: Record<string, string> = {
    Process: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    Tooling: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    Team:    "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  };

  return (
    <div className="space-y-6">
      {/* Add form */}
      <div className="bg-[#15121e]/40 border border-white/5 rounded-xl p-5">
        <h4 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-amber-400" />
          Add Retrospective Action
        </h4>

        {submitError && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="retro-title" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Action Title <span className="text-rose-400">*</span>
            </label>
            <input
              id="retro-title"
              type="text"
              placeholder="What needs to improve?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-describedby={errors.title ? "retro-title-error" : undefined}
              aria-invalid={!!errors.title}
              className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white transition-colors ${errors.title ? "border-rose-500" : "border-white/10"}`}
            />
            {errors.title && <p id="retro-title-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.title}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="retro-category" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Category <span className="text-rose-400">*</span>
              </label>
              <select
                id="retro-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                aria-describedby={errors.category ? "retro-category-error" : undefined}
                aria-invalid={!!errors.category}
                className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white transition-colors ${errors.category ? "border-rose-500" : "border-white/10"}`}
              >
                <option value="">Select…</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {errors.category && <p id="retro-category-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.category}</p>}
            </div>

            <div>
              <label htmlFor="retro-owner" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Owner <span className="text-rose-400">*</span>
              </label>
              <input
                id="retro-owner"
                type="text"
                placeholder="Name or team"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                aria-describedby={errors.owner ? "retro-owner-error" : undefined}
                aria-invalid={!!errors.owner}
                className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white transition-colors ${errors.owner ? "border-rose-500" : "border-white/10"}`}
              />
              {errors.owner && <p id="retro-owner-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.owner}</p>}
            </div>

            <div>
              <label htmlFor="retro-due-date" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Due Date <span className="text-rose-400">*</span>
              </label>
              <input
                id="retro-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-describedby={errors.dueDate ? "retro-due-date-error" : undefined}
                aria-invalid={!!errors.dueDate}
                className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white transition-colors ${errors.dueDate ? "border-rose-500" : "border-white/10"}`}
              />
              {errors.dueDate && <p id="retro-due-date-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.dueDate}</p>}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding…</> : "Add Action Item"}
          </button>
        </form>
      </div>

      {/* Action list */}
      {error && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          <span>{error}</span>
          <button onClick={onReload} className="flex items-center gap-1 ml-2 underline"><RefreshCw className="w-3 h-3" /> Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-white/5 rounded-lg animate-pulse" />)}</div>
      ) : actions.length === 0 ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 rounded-lg border border-dashed border-white/10 text-slate-500 text-sm">
          <BarChart3 className="w-4 h-4" />
          No retrospective actions recorded for this sprint.
        </div>
      ) : (
        <div className="space-y-6">
          {CATEGORIES.map((cat) => {
            const catItems = grouped[cat] ?? [];
            if (catItems.length === 0) return null;
            return (
              <div key={cat}>
                <h5 className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border mb-3 ${categoryColor[cat]}`}>
                  {cat}
                </h5>
                <div className="space-y-2">
                  {catItems.map((action) => {
                    const overdue = !action.completedAt && isPast(parseISO(action.dueDate + "T23:59:59"));
                    const daysUntil = differenceInDays(parseISO(action.dueDate), new Date());
                    return (
                      <div
                        key={action.actionId}
                        className={`flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors ${
                          action.completedAt ? "bg-white/3 border-white/5 opacity-60" :
                          overdue ? "bg-rose-500/5 border-rose-500/20" :
                          "bg-white/3 border-white/5"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-white">{action.title}</span>
                            {action.completedAt && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                                <CheckCircle2 className="w-3 h-3" /> Completed
                              </span>
                            )}
                            {overdue && !action.completedAt && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400">
                                <AlertCircle className="w-3 h-3" /> Overdue
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-slate-500">
                            <span>Owner: {action.owner}</span>
                            <span>
                              Due: {action.dueDate}
                              {!action.completedAt && (
                                <span className={overdue ? " text-rose-400" : " text-slate-400"}>
                                  {" "}({overdue ? `${Math.abs(daysUntil)}d overdue` : daysUntil === 0 ? "today" : `${daysUntil}d left`})
                                </span>
                              )}
                            </span>
                          </div>
                        </div>

                        {!action.completedAt && (
                          <button
                            onClick={() => handleComplete(action)}
                            disabled={completingId === action.actionId}
                            aria-label={`Mark "${action.title}" as complete`}
                            className="shrink-0 px-2.5 py-1.5 text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {completingId === action.actionId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Complete"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
