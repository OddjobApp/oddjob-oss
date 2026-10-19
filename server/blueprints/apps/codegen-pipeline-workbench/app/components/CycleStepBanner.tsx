"use client";

import { triggerCycle } from "../../lib/workbench-bridge";

export function CycleStepBanner() {
  return (
    <section className="mb-6 rounded-xl border border-blue-400/20 bg-blue-500/[0.06] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-300">Cycle step surface</p>
          <h2 className="mt-1 text-sm font-semibold text-white">Autonomous Codegen / Context to PR</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Use this screen to start a codegen run, inspect phase evidence, and route quality-gate findings back to the Assistant.
          </p>
        </div>
        <button
          type="button"
          onClick={() => triggerCycle("Codegen operator requested the next pipeline step", { source: "codegen-step-banner", step: "context-load" })}
          className="rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-100 hover:bg-blue-500/20"
        >
          Run next step
        </button>
      </div>
      <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-3">
        <div className="rounded-lg bg-black/20 px-3 py-2"><span className="text-slate-500">Status</span><br /><span className="text-blue-200">Ready for operator input</span></div>
        <div className="rounded-lg bg-black/20 px-3 py-2"><span className="text-slate-500">Evidence</span><br /><span className="text-slate-200">Session phases, diffs, tests</span></div>
        <div className="rounded-lg bg-black/20 px-3 py-2"><span className="text-slate-500">Decisions</span><br /><span className="text-slate-200">Quality gates route to Assistant</span></div>
      </div>
    </section>
  );
}
