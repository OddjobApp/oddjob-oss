"use client";

import { triggerCycle } from "../../lib/workbench-bridge";

export function CycleStepBanner() {
  return (
    <section className="mb-6 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Cycle step surface</p>
          <h2 className="mt-1 text-sm font-semibold text-white">Sales Opportunity / Window Decisions</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Review decaying opportunities, advance qualified deals, and send approval-worthy changes to the Assistant.
          </p>
        </div>
        <button
          type="button"
          onClick={() => triggerCycle("Sales operator requested a pipeline refresh", { source: "sales-step-banner", step: "mission-window-decay-sweep" })}
          className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20"
        >
          Refresh windows
        </button>
      </div>
      <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-3">
        <div className="rounded-lg bg-black/20 px-3 py-2"><span className="text-slate-500">Status</span><br /><span className="text-emerald-200">Pipeline review ready</span></div>
        <div className="rounded-lg bg-black/20 px-3 py-2"><span className="text-slate-500">Evidence</span><br /><span className="text-slate-200">Windows, activity, stage history</span></div>
        <div className="rounded-lg bg-black/20 px-3 py-2"><span className="text-slate-500">Decisions</span><br /><span className="text-slate-200">Close/gate reviews stay human-led</span></div>
      </div>
    </section>
  );
}
