"use client";

import { useCallback, useEffect, useState } from "react";
import { FinanceCollections, hil, missions, records, type AppRecord, type HilRequest } from "../../lib/platform-client";

const ACTIONS = [
  { label: "Refresh estimated tax", mission: "Quarterly Estimated Tax", description: "Recalculate federal self-employment and income-tax guidance with the configured safe-harbor floor." },
  { label: "Prepare sales-tax packet", mission: "Quarterly Sales Tax Preparation", description: "Compile advisory sales-tax records for human review and filing." },
  { label: "Assemble information returns", mission: "Annual 1099 / W-2 Information Returns", description: "Prepare an advisory year-end information-return package; BudgetMaster never files it." },
] as const;

export default function TaxCenterContent() {
  const [estimates, setEstimates] = useState<AppRecord[]>([]);
  const [documents, setDocuments] = useState<AppRecord[]>([]);
  const [approvals, setApprovals] = useState<HilRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [estimateResult, documentResult, approvalResult] = await Promise.allSettled([
      records.list(FinanceCollections.taxEstimates),
      records.list(FinanceCollections.taxDocuments),
      hil.pending(),
    ]);
    if (estimateResult.status === "fulfilled") setEstimates(estimateResult.value);
    if (documentResult.status === "fulfilled") setDocuments(documentResult.value);
    if (approvalResult.status === "fulfilled") setApprovals(approvalResult.value.filter((item) => /tax|filing|1099|w-2/i.test(`${item.formName} ${item.stage}`)));
    if ([estimateResult, documentResult, approvalResult].some((result) => result.status === "rejected")) setError("Some tax services are unavailable. Existing advisory records remain visible; no payment or filing was attempted.");
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function trigger(mission: string) {
    setBusy(mission);
    setError(null);
    try {
      await missions.trigger(mission, { source: "budgetmaster-tax-center", advisoryOnly: true });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start the advisory tax mission");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-[#090d16] p-4 text-white sm:p-6">
      <main className="mx-auto max-w-6xl">
        <header className="mb-6">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400">BudgetMaster · Advisory only</div>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Tax Center</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">Prepare estimates and filing packets with explicit human authorization. BudgetMaster never remits taxes or files returns.</p>
        </header>

        {error && <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100" role="alert">{error} <button onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button></div>}

        <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="text-xs text-slate-500">Estimates</div><div className="mt-1 text-2xl font-bold">{estimates.length}</div></div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="text-xs text-slate-500">Tax documents</div><div className="mt-1 text-2xl font-bold">{documents.length}</div></div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><div className="text-xs text-amber-300">Awaiting human decision</div><div className="mt-1 text-2xl font-bold text-amber-200">{approvals.length}</div></div>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {ACTIONS.map((action) => <article key={action.mission} className="min-w-0 rounded-xl border border-white/10 bg-[#111827]/60 p-5"><h2 className="font-semibold">{action.label}</h2><p className="my-3 text-xs leading-relaxed text-slate-400">{action.description}</p><button disabled={busy !== null} onClick={() => void trigger(action.mission)} className="w-full rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-sm font-semibold text-blue-100 hover:bg-blue-500/20 disabled:opacity-50">{busy === action.mission ? "Starting…" : action.label}</button></article>)}
        </section>

        <section className="mt-6 rounded-xl border border-white/10 bg-white/5 p-5"><h2 className="font-semibold">Human authorization queue</h2>{approvals.length === 0 ? <p className="mt-3 text-sm text-slate-500">No tax decisions currently require attention.</p> : <div className="mt-3 space-y-2">{approvals.map((item) => <div key={item.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"><div className="text-sm font-medium text-amber-100">{item.formName}</div><div className="text-xs text-slate-400">{item.stage} · Created {new Date(item.createdAt).toLocaleString()}</div></div>)}</div>}</section>
      </main>
    </div>
  );
}
