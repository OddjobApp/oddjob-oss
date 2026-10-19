"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  records,
  events,
  knowledge,
  missions,
  synthesis,
  telemetry,
  SalesCollections,
  fmtCurrency,
  ceilingAccent,
  type Opportunity,
  type OpportunityWindow,
  type WindowSnapshot,
  type Activity,
  type Account,
  type DealSynthesis,
} from "../../lib/platform-client";
import { SynthesisOverlay } from "../components";

const SOURCES = ["Website", "Referral", "LinkedIn", "Cold Outreach", "Event", "Partner"];
const TIMELINES = ["Immediate", "1-3 months", "3-6 months", "6-12 months", "Unknown"];
const ACTIVITY_TYPES = ["REPLY", "MEETING", "DEMO", "PROPOSAL_OPENED", "CALL", "EMAIL_SENT"];

function fmtDate(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
}

export default function OpportunitiesContent() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [windows, setWindows] = useState<OpportunityWindow[]>([]);
  const [snapshots, setSnapshots] = useState<WindowSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stageFilter, setStageFilter] = useState("ALL");
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  // NL semantic search
  const [nlQuery, setNlQuery] = useState("");
  const [nlResults, setNlResults] = useState<string[] | null>(null);
  const [nlLoading, setNlLoading] = useState(false);

  // Lead intake
  const [showIntake, setShowIntake] = useState(false);
  const [lead, setLead] = useState({ name: "", company: "", email: "", source: SOURCES[0], estimated_value: "", timeline: TIMELINES[1] });
  const [intakeBusy, setIntakeBusy] = useState(false);

  // Log activity
  const [actType, setActType] = useState(ACTIVITY_TYPES[0]);
  const [actSummary, setActSummary] = useState("");

  // Act II — AI Synthesis Overlay
  const [synthOpen, setSynthOpen] = useState(false);
  const [synth, setSynth] = useState<DealSynthesis | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);
  const [synthError, setSynthError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [o, a, act, w, s] = await Promise.all([
        records.list(SalesCollections.opportunities),
        records.list(SalesCollections.accounts),
        records.list(SalesCollections.activities),
        records.list(SalesCollections.opportunityWindows),
        records.list(SalesCollections.windowSnapshots),
      ]);
      setOpps(o as Opportunity[]);
      setAccounts(a as Account[]);
      setActivities(act as Activity[]);
      setWindows(w as OpportunityWindow[]);
      setSnapshots(s as WindowSnapshot[]);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load opportunities");
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

  const stages = useMemo(() => Array.from(new Set(opps.map((o) => o.stage))).sort(), [opps]);

  const visible = useMemo(() => {
    return opps
      .filter((o) => (stageFilter === "ALL" ? true : o.stage === stageFilter))
      .filter((o) =>
        text.trim() === ""
          ? true
          : `${o.name} ${accountName(o.account_id)} ${o.owner_rep ?? ""}`.toLowerCase().includes(text.toLowerCase()),
      )
      .sort((a, b) => (b.amount || 0) - (a.amount || 0));
  }, [opps, stageFilter, text, accountName]);

  const selectedOpp = opps.find((o) => o.opportunity_id === selected) ?? null;
  const selectedWindow = windows.find((w) => w.opportunity_id === selected) ?? null;
  const selectedActivities = useMemo(
    () => activities.filter((a) => a.opportunity_id === selected).sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()),
    [activities, selected],
  );
  const selectedHistory = useMemo(
    () =>
      snapshots
        .filter((s) => selectedWindow && s.window_id === selectedWindow.window_id)
        .sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime()),
    [snapshots, selectedWindow],
  );

  const runSemanticSearch = async () => {
    if (!nlQuery.trim()) return;
    setNlLoading(true);
    setNlResults(null);
    try {
      const { results } = await knowledge.query(nlQuery.trim(), 8);
      setNlResults(results.map((r) => r.content));
      telemetry.emit("opportunity_semantic_search", "info", { q: nlQuery.trim() });
    } catch (e: unknown) {
      setNlResults([`Search unavailable: ${e instanceof Error ? e.message : "error"}`]);
    } finally {
      setNlLoading(false);
    }
  };

  const submitLead = async () => {
    if (!lead.name.trim() || !lead.company.trim()) return;
    setIntakeBusy(true);
    try {
      const lead_id = `lead_${Date.now()}`;
      await records.create(SalesCollections.leads, {
        lead_id,
        name: lead.name,
        company: lead.company,
        email: lead.email,
        source: lead.source,
        estimated_value: Number(lead.estimated_value) || 0,
        timeline: lead.timeline,
        status: "NEW",
        created_at: new Date().toISOString(),
      });
      await missions.trigger("Qualify Lead", { lead_id });
      telemetry.emit("lead_submitted", "info", { lead_id });
      setLead({ name: "", company: "", email: "", source: SOURCES[0], estimated_value: "", timeline: TIMELINES[1] });
      setShowIntake(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit lead");
    } finally {
      setIntakeBusy(false);
    }
  };

  const runSynthesis = useCallback(async (opportunityId: string) => {
    setSynthOpen(true);
    setSynthLoading(true);
    setSynthError(null);
    setSynth(null);
    try {
      const result = await synthesis.forOpportunity(opportunityId);
      setSynth(result);
      telemetry.emit("deal_synthesis_viewed", "info", { opportunity_id: opportunityId, source: result.source });
    } catch (e: unknown) {
      setSynthError(e instanceof Error ? e.message : "Synthesis unavailable");
    } finally {
      setSynthLoading(false);
    }
  }, []);

  const logActivity = async () => {
    if (!selected || !actSummary.trim()) return;
    try {
      await records.create(SalesCollections.activities, {
        activity_id: `act_${Date.now()}`,
        opportunity_id: selected,
        type: actType,
        occurred_at: new Date().toISOString(),
        actor: "workbench",
        summary: actSummary,
        is_rearm_signal: true,
        rearm_effect: "HOLD",
      });
      setActSummary("");
      fetchAll();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to log activity");
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold rounded bg-sky-500/10 text-sky-300 px-2 py-1">OR</span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Opportunity Register</h1>
              <p className="text-xs text-slate-500 mt-0.5">{opps.length} opportunities - click a row for its engagement feed and decay history.</p>
            </div>
          </div>
          <button
            onClick={() => setShowIntake((s) => !s)}
            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg"
          >
            {showIntake ? "Cancel" : "+ New lead"}
          </button>
        </div>

        {error && (
          <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 mb-4">{error}</div>
        )}

        {/* Lead intake */}
        {showIntake && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Lead Intake to Qualify</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} placeholder="Lead name" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600" />
              <input value={lead.company} onChange={(e) => setLead({ ...lead, company: e.target.value })} placeholder="Company" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600" />
              <input value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} placeholder="Email" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600" />
              <select value={lead.source} onChange={(e) => setLead({ ...lead, source: e.target.value })} title="Source" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm">
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={lead.estimated_value} onChange={(e) => setLead({ ...lead, estimated_value: e.target.value })} placeholder="Estimated value" type="number" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600" />
              <select value={lead.timeline} onChange={(e) => setLead({ ...lead, timeline: e.target.value })} title="Timeline" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm">
                {TIMELINES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <button onClick={submitLead} disabled={intakeBusy} className="mt-3 px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
              {intakeBusy ? "Submitting..." : "Qualify lead"}
            </button>
          </div>
        )}

        {/* NL search */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Natural-language deal search</h2>
          <div className="flex gap-2">
            <input
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSemanticSearch(); }}
              placeholder='e.g. "enterprise deals stuck in procurement"'
              className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
            <button onClick={runSemanticSearch} disabled={nlLoading} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shrink-0">
              {nlLoading ? "Searching..." : "Search"}
            </button>
          </div>
          {nlResults && (
            <ul className="mt-3 space-y-1.5 text-xs text-slate-400">
              {nlResults.map((r, i) => <li key={i} className="bg-slate-950/50 border border-white/5 rounded px-3 py-1.5">{r}</li>)}
              {nlResults.length === 0 && <li className="text-slate-600">No semantic matches.</li>}
            </ul>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} title="Filter by stage" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs">
            <option value="ALL">All stages</option>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter name / account / owner..." className="flex-1 min-w-[180px] bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder:text-slate-600 focus:outline-none focus:border-sky-500" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Register */}
          <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-xl p-4">
            {loading && [1, 2, 3, 4].map((i) => <div key={i} className="h-10 bg-white/5 rounded-lg animate-pulse mb-2" />)}
            {!loading && visible.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                <p className="text-sm">No opportunities yet.</p>
                <p className="text-xs mt-1">Submit a lead above to qualify and open one.</p>
              </div>
            )}
            {!loading && visible.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-left font-semibold p-2 border-b border-white/10">Deal</th>
                      <th className="text-left font-semibold p-2 border-b border-white/10">Account</th>
                      <th className="text-left font-semibold p-2 border-b border-white/10">Stage</th>
                      <th className="text-right font-semibold p-2 border-b border-white/10">Amount</th>
                      <th className="text-center font-semibold p-2 border-b border-white/10">Ceiling</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((o) => {
                      const w = windows.find((x) => x.opportunity_id === o.opportunity_id && (x.status === "ARMED" || x.status === "DECAYING"));
                      const accent = ceilingAccent(w?.current_ceiling ?? 0);
                      return (
                        <tr
                          key={o.opportunity_id}
                          onClick={() => setSelected(o.opportunity_id)}
                          className={`cursor-pointer transition-colors ${selected === o.opportunity_id ? "bg-white/10" : "hover:bg-white/5"}`}
                        >
                          <td className="p-2 border-b border-white/5 font-medium text-slate-100">{o.name}</td>
                          <td className="p-2 border-b border-white/5 text-slate-400">{accountName(o.account_id)}</td>
                          <td className="p-2 border-b border-white/5 text-slate-400">{o.stage}</td>
                          <td className="p-2 border-b border-white/5 text-right font-mono text-slate-300">{fmtCurrency(o.amount, o.currency)}</td>
                          <td className="p-2 border-b border-white/5 text-center">
                            {w ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${accent.bg} ${accent.text}`}>{w.current_ceiling}%</span> : <span className="text-slate-600">-</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            {!selectedOpp ? (
              <div className="text-center py-12 text-xs text-slate-600">Select a deal to see its engagement feed and decay history.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">{selectedOpp.name}</h3>
                    <p className="text-[11px] text-slate-500">{accountName(selectedOpp.account_id)} - {selectedOpp.stage}</p>
                  </div>
                </div>

                {/* AI Synthesis — replaces reading unparsed log rows */}
                <button
                  onClick={() => runSynthesis(selectedOpp.opportunity_id)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-lg"
                >
                  <span aria-hidden>✦</span> AI Synthesis — why is this slipping?
                </button>

                {/* Decay history */}
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Window decay history</h4>
                  {selectedHistory.length === 0 ? (
                    <p className="text-xs text-slate-600">No snapshots yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {selectedHistory.map((s) => {
                        const accent = ceilingAccent(s.ceiling_after);
                        return (
                          <li key={s.snapshot_id} className="flex items-center justify-between text-[11px] bg-slate-950/40 rounded px-2 py-1">
                            <span className="text-slate-500">{fmtDate(s.taken_at)} - {s.trigger}</span>
                            <span className={`font-mono ${accent.text}`}>{s.ceiling_before}% to {s.ceiling_after}%</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Log activity */}
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Log engagement (re-arms window)</h4>
                  <div className="flex gap-2 mb-2">
                    <select value={actType} onChange={(e) => setActType(e.target.value)} title="Activity type" className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs">
                      {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input value={actSummary} onChange={(e) => setActSummary(e.target.value)} placeholder="Summary..." className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs placeholder:text-slate-600" />
                  </div>
                  <button onClick={logActivity} className="w-full px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg">Log activity</button>
                </div>

                {/* Activity feed */}
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Engagement feed</h4>
                  {selectedActivities.length === 0 ? (
                    <p className="text-xs text-slate-600">No activity logged.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {selectedActivities.map((a) => (
                        <li key={a.activity_id} className="text-[11px] bg-slate-950/40 rounded px-2 py-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-slate-300">{a.type}</span>
                            <span className="text-slate-600">{fmtDate(a.occurred_at)}</span>
                          </div>
                          {a.summary && <p className="text-slate-500 mt-0.5">{a.summary}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {synthOpen && selectedOpp && (
        <SynthesisOverlay
          dealName={selectedOpp.name}
          synthesis={synth}
          loading={synthLoading}
          error={synthError}
          onClose={() => setSynthOpen(false)}
          onRetry={() => runSynthesis(selectedOpp.opportunity_id)}
        />
      )}
    </div>
  );
}
