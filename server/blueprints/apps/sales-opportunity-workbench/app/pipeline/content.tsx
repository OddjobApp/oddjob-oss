"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  records,
  events,
  missions,
  telemetry,
  SalesCollections,
  fmtCurrency,
  parseLadder,
  ceilingAccent,
  OPEN_STAGES,
  type Opportunity,
  type OpportunityWindow,
  type Account,
  type Stage,
} from "../../lib/platform-client";
import { OnboardingScaffold } from "../components";
import { CycleStepBanner } from "../components/CycleStepBanner";

const STAGE_ENTITLEMENT: Record<string, number> = {
  PROSPECT: 90, QUALIFIED: 90, PROPOSAL: 60, NEGOTIATION: 60, CLOSED_WON: 100, CLOSED_LOST: 0,
};

function relativeDeadline(iso?: string): string {
  if (!iso) return "-";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "-";
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return "today";
  return days > 0 ? `in ${days}d` : `${Math.abs(days)}d overdue`;
}

export default function PipelineContent() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [windows, setWindows] = useState<OpportunityWindow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [closeWonFor, setCloseWonFor] = useState<{ opportunityId: string; dealName: string } | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [o, w, a] = await Promise.all([
        records.list(SalesCollections.opportunities),
        records.list(SalesCollections.opportunityWindows),
        records.list(SalesCollections.accounts),
      ]);
      setOpps(o as Opportunity[]);
      setWindows(w as OpportunityWindow[]);
      setAccounts(a as Account[]);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const unsub = events.subscribe((ev) => {
      if (["mission.completed", "mission.status_changed", "dataset.updated"].includes(ev.type)) fetchAll();
    });
    return unsub;
  }, [fetchAll]);

  const accountName = useCallback(
    (id: string) => accounts.find((a) => a.account_id === id)?.name ?? id ?? "-",
    [accounts],
  );

  const windowByOpp = useMemo(() => {
    const m = new Map<string, OpportunityWindow>();
    for (const w of windows) {
      if (w.status === "ARMED" || w.status === "DECAYING") m.set(w.opportunity_id, w);
    }
    return m;
  }, [windows]);

  const columns = useMemo(() => {
    return OPEN_STAGES.map((stage) => ({
      stage,
      deals: opps
        .filter((o) => o.stage === stage)
        .sort((a, b) => (b.amount || 0) - (a.amount || 0)),
    }));
  }, [opps]);

  const advanceStage = async (opp: Opportunity) => {
    const idx = OPEN_STAGES.indexOf(opp.stage as Stage);
    if (idx < 0 || idx >= OPEN_STAGES.length - 1) return; // NEGOTIATION closes via a human gate
    const next = OPEN_STAGES[idx + 1];
    const entitlement = STAGE_ENTITLEMENT[next] ?? 60;
    setBusyId(opp.opportunity_id);
    // optimistic
    setOpps((prev) => prev.map((p) => (p.opportunity_id === opp.opportunity_id ? { ...p, stage: next } : p)));
    try {
      await records.update(SalesCollections.opportunities, opp.id ?? opp.opportunity_id, {
        ...opp, stage: next, stage_entitlement: entitlement,
      });
      const now = new Date().toISOString();
      await records.create(SalesCollections.activities, {
        activity_id: `act_${Date.now()}`,
        opportunity_id: opp.opportunity_id,
        type: "STAGE_ADVANCED",
        occurred_at: now,
        actor: "workbench",
        summary: `Advanced ${opp.stage} to ${next}`,
        is_rearm_signal: true,
        rearm_effect: "REBASELINE",
        rebaseline_to: entitlement,
      });
      await records.create(SalesCollections.stageHistory, {
        entry_id: `sh_${Date.now()}`,
        opportunity_id: opp.opportunity_id,
        from_stage: opp.stage,
        to_stage: next,
        changed_at: now,
        changed_by: "workbench",
      });
      telemetry.emit("stage_advanced", "info", { opportunity_id: opp.opportunity_id, to: next });
    } catch {
      fetchAll(); // revert from source of truth
    } finally {
      setBusyId(null);
    }
  };

  const runSweep = async () => {
    try {
      await missions.trigger("Opportunity Window Decay Sweep");
      telemetry.emit("decay_sweep_requested", "info");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to trigger sweep");
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <CycleStepBanner />
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold rounded bg-blue-500/10 text-blue-300 px-2 py-1">PB</span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Pipeline Board</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {opps.length} opportunities - {windowByOpp.size} live windows - advance a stage to re-baseline its window.
              </p>
            </div>
          </div>
          <button
            onClick={runSweep}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg"
          >
            Run decay sweep
          </button>
        </div>

        {error && (
          <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 mb-4">{error}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {columns.map(({ stage, deals }) => (
            <div key={stage} className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
              <div className="flex items-center justify-between mb-3 px-1">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">{stage}</h2>
                <span className="text-[10px] text-slate-600">{deals.length}</span>
              </div>

              {loading && <div className="h-24 bg-white/5 rounded-lg animate-pulse" />}
              {!loading && deals.length === 0 && (
                <div className="text-center py-8 text-xs text-slate-600">No deals.</div>
              )}

              <div className="space-y-2.5">
                {deals.map((opp) => {
                  const w = windowByOpp.get(opp.opportunity_id);
                  const ceiling = w?.current_ceiling ?? 0;
                  const top = w ? parseLadder(w)[0] : 90;
                  const accent = ceilingAccent(ceiling);
                  const canAdvance = OPEN_STAGES.indexOf(opp.stage as Stage) < OPEN_STAGES.length - 1;
                  return (
                    <div key={opp.opportunity_id} className="bg-white/[0.04] border border-white/10 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm font-semibold text-slate-100 leading-tight">{opp.name}</p>
                        {w && (
                          <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${accent.bg} ${accent.text} border ${accent.border}`}>
                            {ceiling}%
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mb-2">{accountName(opp.account_id)}</p>

                      {w && (
                        <div className="mb-2">
                          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                            <div className={`h-full ${accent.bar} transition-all`} style={{ width: `${Math.max(2, (ceiling / top) * 100)}%` }} />
                          </div>
                          <p className="text-[10px] text-slate-600 mt-1">
                            {w.status} - steps {relativeDeadline(w.next_gate_deadline)}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-slate-300">{fmtCurrency(opp.amount, opp.currency)}</span>
                        {canAdvance ? (
                          <button
                            onClick={() => advanceStage(opp)}
                            disabled={busyId === opp.opportunity_id}
                            className="text-[10px] font-semibold px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-50"
                          >
                            Advance
                          </button>
                        ) : (
                          <button
                            onClick={() => setCloseWonFor({ opportunityId: opp.opportunity_id, dealName: opp.name })}
                            className="text-[10px] font-semibold px-2 py-1 rounded bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white"
                          >
                            Close Won →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {closeWonFor && (
        <OnboardingScaffold
          opportunityId={closeWonFor.opportunityId}
          dealName={closeWonFor.dealName}
          onClose={() => setCloseWonFor(null)}
          onProvisioned={() => fetchAll()}
        />
      )}
    </div>
  );
}
