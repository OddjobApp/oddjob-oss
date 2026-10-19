"use client";

import { useState, useEffect, useCallback } from "react";
import { onboarding, telemetry, fmtCurrency, type ProvisionResult, type OnboardingStage } from "../../lib/platform-client";

type Phase = "provisioning" | "done" | "error";

interface Props {
  opportunityId: string;
  dealName: string;
  onClose: () => void;
  onProvisioned?: (result: ProvisionResult) => void;
}

const STAGE_DOT: Record<OnboardingStage["status"], string> = {
  done: "bg-emerald-500",
  provisioning: "bg-amber-400 animate-pulse",
  pending: "bg-slate-600",
};

/**
 * Act IV — moving a card to CLOSED_WON hands the deal to The Forge. Shows the
 * onboarding packet plus the provisioning stage checklist as the isolated
 * environment is scaffolded and the onboarding cycle is invoked.
 */
export function OnboardingScaffold({ opportunityId, dealName, onClose, onProvisioned }: Props) {
  const [phase, setPhase] = useState<Phase>("provisioning");
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provision = useCallback(async () => {
    setPhase("provisioning");
    setError(null);
    try {
      const r = await onboarding.provision(opportunityId);
      setResult(r);
      setPhase("done");
      telemetry.emit("onboarding_provisioned", "info", { opportunity_id: opportunityId, handoff: r.handoff_launched });
      onProvisioned?.(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Provisioning failed");
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId]);

  useEffect(() => { provision(); }, [provision]);

  const run = result?.onboarding_run ?? null;
  const packet = run?.packet ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#0c1120] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/10 bg-gradient-to-r from-emerald-500/10 to-sky-500/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
                The Forge · Onboarding
              </span>
              <span className="text-[10px] text-slate-500">CLOSED_WON</span>
            </div>
            <h2 className="text-base font-bold text-slate-100 mt-1.5 leading-tight">{dealName}</h2>
            <p className="text-[11px] text-slate-500">Scaffolding the client environment</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200 text-lg leading-none px-1">
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {phase === "error" && (
            <div className="py-8 text-center">
              <p className="text-sm text-rose-400">{error}</p>
              <button onClick={provision} className="mt-3 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg">
                Retry
              </button>
            </div>
          )}

          {phase === "provisioning" && (
            <div className="py-8 text-center">
              <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Provisioning isolated environment…
              </div>
              <div className="mt-4 space-y-2 max-w-sm mx-auto">
                {[0, 1, 2].map((i) => <div key={i} className="h-6 bg-white/5 rounded animate-pulse" />)}
              </div>
            </div>
          )}

          {phase === "done" && run && (
            <>
              {/* Provisioning stages */}
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Provisioning</h3>
                <ul className="space-y-1.5">
                  {run.stages.map((s) => (
                    <li key={s.key} className="flex items-center gap-2.5 text-sm">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_DOT[s.status]}`} />
                      <span className={s.status === "done" ? "text-slate-300" : s.status === "provisioning" ? "text-amber-300" : "text-slate-500"}>
                        {s.name}
                      </span>
                      {s.status === "done" && <span className="text-emerald-400 text-xs">✓</span>}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Onboarding packet */}
              {packet && (
                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 text-xs space-y-1.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Onboarding packet</h3>
                  <Row label="Account" value={packet.account.name + (packet.account.segment ? ` · ${packet.account.segment}` : "")} />
                  <Row label="Contact" value={packet.primary_contact.name ? `${packet.primary_contact.name}${packet.primary_contact.email ? ` · ${packet.primary_contact.email}` : ""}` : "—"} />
                  <Row label="Terms" value={`${fmtCurrency(packet.terms.amount, packet.terms.currency)} · won`} />
                  {packet.account.owner_rep && <Row label="Owner" value={packet.account.owner_rep} />}
                </div>
              )}

              {/* Handoff status */}
              <div className={`rounded-xl p-3 border ${result?.handoff_launched ? "bg-emerald-500/10 border-emerald-500/30" : "bg-amber-500/5 border-amber-500/30"}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Onboarding cycle</p>
                {result?.handoff_launched ? (
                  <p className="text-sm text-emerald-300">
                    Invoked{result.child_cycle_id ? ` (cycle #${result.child_cycle_id})` : ""} — awaiting approval to run.
                  </p>
                ) : (
                  <p className="text-sm text-slate-400">
                    Onboarding run recorded. No installed onboarding cycle found to hand off to.
                  </p>
                )}
                {result?.window_reconciled && (
                  <p className="text-[11px] text-slate-500 mt-1">Window reconciled to WON · decay curve labelled for calibration.</p>
                )}
              </div>

              <div className="text-center">
                <button onClick={onClose} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg">
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-300 text-right">{value}</span>
    </div>
  );
}
