"use client";

import { useState, useEffect, useCallback } from "react";
import { outbound, telemetry, type OutboundDraft, type DispatchResult } from "../../lib/platform-client";

type Phase = "drafting" | "breakpoint" | "dispatching" | "done" | "error";

interface Props {
  opportunityId: string;
  dealName: string;
  onClose: () => void;
  onDispatched?: (result: DispatchResult) => void;
}

/**
 * Act III — the live human breakpoint. Loads an agent-drafted followup, PAUSES
 * so the rep can edit the prompt context and the email draft, then on Resume
 * fires the dispatch (which logs the email and re-arms the deal's window).
 */
export function OutboundBreakpoint({ opportunityId, dealName, onClose, onDispatched }: Props) {
  const [phase, setPhase] = useState<Phase>("drafting");
  const [draft, setDraft] = useState<OutboundDraft | null>(null);
  const [prompt, setPrompt] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDraft = useCallback(async () => {
    setPhase("drafting");
    setError(null);
    try {
      const d = await outbound.draft(opportunityId);
      setDraft(d);
      setPrompt(d.prompt);
      setSubject(d.subject);
      setBody(d.body);
      setPhase("breakpoint");
      telemetry.emit("outbound_breakpoint_opened", "info", { opportunity_id: opportunityId, source: d.source });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to draft followup");
      setPhase("error");
    }
  }, [opportunityId]);

  useEffect(() => { loadDraft(); }, [loadDraft]);

  const resume = async () => {
    if (!subject.trim() || !body.trim()) return;
    setPhase("dispatching");
    setError(null);
    try {
      const r = await outbound.dispatch({ opportunity_id: opportunityId, subject, body, prompt });
      setResult(r);
      setPhase("done");
      telemetry.emit("outbound_dispatched", "info", { opportunity_id: opportunityId, rearmed: r.rearmed });
      onDispatched?.(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Dispatch failed");
      setPhase("breakpoint");
    }
  };

  const fmtDeadline = (iso?: string) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#0c1120] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/10 bg-gradient-to-r from-amber-500/10 to-rose-500/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                Outbound Rescue
              </span>
              {draft && (
                <span className="text-[10px] text-slate-500">{draft.source === "ai" ? "Gemini draft" : "heuristic draft"}</span>
              )}
            </div>
            <h2 className="text-base font-bold text-slate-100 mt-1.5 leading-tight">{dealName}</h2>
            {draft?.recipient_name && (
              <p className="text-[11px] text-slate-500">
                To {draft.recipient_name}{draft.to ? ` · ${draft.to}` : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200 text-lg leading-none px-1">
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto">
          {phase === "drafting" && (
            <div className="py-10 text-center">
              <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Agent composing the followup context…
              </div>
              <div className="mt-4 space-y-2 max-w-md mx-auto">
                {[0, 1, 2].map((i) => <div key={i} className="h-4 bg-white/5 rounded animate-pulse" />)}
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="py-10 text-center">
              <p className="text-sm text-rose-400">{error}</p>
              <button onClick={loadDraft} className="mt-3 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg">
                Retry
              </button>
            </div>
          )}

          {(phase === "breakpoint" || phase === "dispatching") && draft && (
            <div className="space-y-4">
              {/* Breakpoint banner */}
              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/5 border border-amber-500/30 rounded-lg px-3 py-2">
                <span aria-hidden>⏸</span>
                <span><b>Execution paused at a human breakpoint.</b> Edit the prompt and draft, then resume to send &amp; re-arm.</span>
              </div>

              {error && <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</div>}

              {/* Prompt context (collapsible) */}
              <div>
                <button
                  onClick={() => setShowPrompt((s) => !s)}
                  className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200"
                >
                  <span className="text-slate-500">{showPrompt ? "▾" : "▸"}</span> Agent prompt context {showPrompt ? "" : "(editable)"}
                </button>
                {showPrompt && (
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={7}
                    disabled={phase === "dispatching"}
                    className="mt-2 w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-400 leading-relaxed focus:outline-none focus:border-sky-500 disabled:opacity-60"
                  />
                )}
              </div>

              {/* Email draft */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={phase === "dispatching"}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Email draft</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={9}
                  disabled={phase === "dispatching"}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 leading-relaxed focus:outline-none focus:border-sky-500 disabled:opacity-60"
                />
              </div>
            </div>
          )}

          {phase === "done" && result && (
            <div className="py-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 text-xl">✓</div>
              <p className="text-sm font-semibold text-slate-100">Followup dispatched</p>
              {result.rearm ? (
                <p className="text-xs text-slate-400">
                  Window re-armed &mdash; ceiling held at <span className="text-emerald-300 font-mono">{result.rearm.ceiling}%</span>
                  {fmtDeadline(result.rearm.next_gate_deadline) ? <> · next step-down {fmtDeadline(result.rearm.next_gate_deadline)}</> : null}
                </p>
              ) : (
                <p className="text-xs text-slate-500">Email logged. No live window to re-arm on this deal.</p>
              )}
              <p className="text-[11px] text-slate-500">
                {result.slack_notified ? "Slack notified (out-of-band)." : "Logged in-app · Slack not configured."}
              </p>
              <button onClick={onClose} className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg">
                Done
              </button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {(phase === "breakpoint" || phase === "dispatching") && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/10 bg-slate-950/40">
            <button
              onClick={onClose}
              disabled={phase === "dispatching"}
              className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-semibold rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={resume}
              disabled={phase === "dispatching" || !subject.trim() || !body.trim()}
              className="px-4 py-1.5 bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {phase === "dispatching" ? "Dispatching…" : <>▶ Resume &amp; send</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
