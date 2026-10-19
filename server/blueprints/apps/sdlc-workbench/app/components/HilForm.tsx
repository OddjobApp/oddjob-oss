"use client";
import { useState } from "react";
import { hil } from "../../lib/platform-client";
import type { HilRequest } from "../../lib/platform-client";

interface Props {
  requests: HilRequest[];
  onResolved: (id: string) => void;
}

export function HilForm({ requests, onResolved }: Props) {
  if (requests.length === 0) return null;

  return (
    <div className="space-y-3 mb-6">
      {requests.map((req) => (
        <HilFormCard key={req.id} req={req} onResolved={onResolved} />
      ))}
    </div>
  );
}

function HilFormCard({ req, onResolved }: { req: HilRequest; onResolved: (id: string) => void }) {
  const [values, setValues]   = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const elapsed = Math.round((Date.now() - new Date(req.createdAt).getTime()) / 3600000);
  const slaBreached = req.slaHours != null && elapsed >= req.slaHours;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await hil.submit(req.id, values);
      onResolved(req.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`rounded-xl border p-4 ${slaBreached ? "bg-rose-500/5 border-rose-500/30" : "bg-amber-500/5 border-amber-500/30"}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">🔔</span>
        <span className="text-sm font-semibold text-white">{req.formName}</span>
        {slaBreached
          ? <span className="ml-auto text-[10px] font-bold text-rose-400 bg-rose-500/20 px-2 py-0.5 rounded-full">SLA BREACHED</span>
          : req.slaHours != null && <span className="ml-auto text-[10px] text-amber-400">{req.slaHours - elapsed}h remaining</span>
        }
      </div>

      {Object.keys(req.context).length > 0 && (
        <div className="mb-3 p-2 rounded bg-white/5 border border-white/5 text-xs text-slate-400">
          {Object.entries(req.context).map(([k, v]) => (
            <span key={k} className="mr-3"><span className="text-slate-500">{k}:</span> {String(v)}</span>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {req.fields.map((f) => (
          <div key={f.name}>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider">{f.label}{f.required && " *"}</label>
            {f.type === "select" ? (
              <select
                required={f.required}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues(v => ({ ...v, [f.name]: e.target.value }))}
                className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm text-white"
              >
                <option value="">Select…</option>
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                required={f.required}
                rows={3}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues(v => ({ ...v, [f.name]: e.target.value }))}
                className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm text-white resize-none"
              />
            ) : (
              <input
                type="text"
                required={f.required}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues(v => ({ ...v, [f.name]: e.target.value }))}
                className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm text-white"
              />
            )}
          </div>
        ))}
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
        >
          {submitting ? "Submitting…" : "Submit Decision"}
        </button>
      </form>
    </div>
  );
}
