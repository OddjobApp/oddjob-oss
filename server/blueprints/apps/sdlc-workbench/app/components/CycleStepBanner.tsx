"use client";

import { triggerCycle, isEmbedded } from "../../lib/workbench-bridge";
import { useEffect, useState } from "react";

export function CycleStepBanner() {
  const [status, setStatus] = useState("Execution prerequisites have not been verified");
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    setEmbedded(isEmbedded());
    const receive = (event: Event) => setStatus(String((event as CustomEvent).detail));
    window.addEventListener("workbench-request-status", receive);
    return () => window.removeEventListener("workbench-request-status", receive);
  }, []);
  return (
    <section className="mb-8 rounded-xl border border-teal-400/20 bg-teal-500/[0.06] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-teal-300">Cycle step surface</p>
          <h2 className="mt-1 text-sm font-semibold text-white">Hybrid SDLC / Active Workbench Routing</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Open the workbench for the active mission, review evidence, and route approvals or blockers to the Assistant.
          </p>
        </div>
        {embedded && <button
          type="button"
          onClick={() => triggerCycle("SDLC operator requested the next lifecycle step", { source: "sdlc-step-banner", step: "active-mission" })}
          className="rounded-lg border border-teal-400/30 bg-teal-500/10 px-3 py-2 text-xs font-semibold text-teal-100 hover:bg-teal-500/20"
        >
          Prepare next step in CREW
        </button>}
      </div>
      <div className="mt-3 grid gap-2 text-[11px] text-slate-400 md:grid-cols-3">
        <div role="status" className="rounded-lg bg-black/20 px-3 py-2"><span className="text-slate-500">Status</span><br /><span className="text-teal-200">{status}</span></div>
        <div className="rounded-lg bg-black/20 px-3 py-2"><span className="text-slate-500">Evidence</span><br /><span className="text-slate-200">Backlog, gates, QA, release trail</span></div>
        <div className="rounded-lg bg-black/20 px-3 py-2"><span className="text-slate-500">Decisions</span><br /><span className="text-slate-200">HIL approvals route to Assistant</span></div>
      </div>
    </section>
  );
}
