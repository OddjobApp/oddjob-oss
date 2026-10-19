"use client";

import type { DealSynthesis, SynthesisBullet, SynthesisSeverity } from "../../lib/platform-client";

const SEVERITY: Record<SynthesisSeverity, { dot: string; chip: string; label: string }> = {
  high: { dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-300 border-rose-500/30", label: "High" },
  medium: { dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-300 border-amber-500/30", label: "Medium" },
  low: { dot: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", label: "Low" },
};

const BULLET_ICON: Record<SynthesisBullet["key"], string> = {
  silence_gaps: "⏱", // stopwatch
  dark_social: "◑", // half-circle
  competitor_signals: "⚔", // crossed swords
};

interface Props {
  dealName: string;
  synthesis: DealSynthesis | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

export function SynthesisOverlay({ dealName, synthesis, loading, error, onClose, onRetry }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#0c1120] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/10 bg-gradient-to-r from-sky-500/10 to-indigo-500/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded px-1.5 py-0.5">
                AI Synthesis
              </span>
              {synthesis && (
                <span className="text-[10px] text-slate-500">
                  {synthesis.source === "ai" ? "Gemini · grounded" : "heuristic · grounded"}
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-slate-100 mt-1.5 leading-tight">{dealName}</h2>
            <p className="text-[11px] text-slate-500">Why this deal is slipping</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close synthesis"
            className="text-slate-500 hover:text-slate-200 text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {loading && (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />
              ))}
              <p className="text-xs text-slate-500 text-center">Synthesizing engagement, silence, and competitor signals…</p>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-6">
              <p className="text-sm text-rose-400">{error}</p>
              <button
                onClick={onRetry}
                className="mt-3 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && synthesis && (
            <>
              {synthesis.bullets.map((b) => {
                const sev = SEVERITY[b.severity];
                return (
                  <div key={b.key} className="flex gap-3 bg-white/[0.03] border border-white/10 rounded-xl p-3">
                    <span className="text-lg leading-none mt-0.5" aria-hidden>{BULLET_ICON[b.key]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-300">{b.label}</p>
                        <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${sev.chip}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                          {sev.label}
                        </span>
                      </div>
                      <p className="text-[13px] text-slate-400 leading-relaxed">{b.detail}</p>
                    </div>
                  </div>
                );
              })}

              {/* Verdict */}
              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 mb-1">Verdict</p>
                <p className="text-sm text-slate-200 leading-snug">{synthesis.verdict}</p>
              </div>

              <p className="text-[10px] text-slate-600 text-center pt-1">
                Grounded in this deal&apos;s activity feed and live window — advisory only, no figures invented.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
