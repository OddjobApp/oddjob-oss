/**
 * Scrum Master Workbench: Sprint Planning Console (WOW Enhanced)
 *
 * Full platform integration: Agent Chat, Fleet Availability, Sprint Board,
 * Blocker Prediction, Velocity Forecast, Dependency Radar, Standup Reports,
 * Jira Sprint Creation, and Smart Escalation.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/router";
import {
  Calendar, Trello, BarChart3, AlertOctagon, Bot,
} from "lucide-react";
import { useWorkbenchContext, isEmbedded } from "../sdk/workbench-sdk";
import { records, telemetry } from "../lib/platform-client";
import { useMissionLogs } from "../lib/hooks";
import { COLLECTIONS } from "../lib/collections";
import type {
  CapacityPlanRecord, BacklogRecord, BlockerRecord,
  RetroActionRecord, HandoffRecord, PmHandoffRecord,
} from "../lib/collections";
import type { JiraIssue } from "../lib/platform-client";

import { CapacityPanel } from "../components/CapacityPanel";
import { BacklogPanel } from "../components/BacklogPanel";
import { BlockersPanel } from "../components/BlockersPanel";
import { RetroPanel } from "../components/RetroPanel";
import { CommitButton } from "../components/CommitButton";
import { MissionStatusDrawer } from "../components/MissionStatusDrawer";
import { AgentChatPanel } from "../components/AgentChatPanel";
import { FleetAvailabilityBadge } from "../components/FleetAvailabilityBadge";
import { VelocityForecastChart } from "../components/VelocityForecastChart";
import { SprintBoardView } from "../components/SprintBoardView";
import { DependencyRadar } from "../components/DependencyRadar";
import { StandupReportGenerator } from "../components/StandupReportGenerator";
import { SprintBurndownPredictor } from "../components/SprintBurndownPredictor";
import { BottleneckAnalysisWidget } from "../components/BottleneckAnalysisWidget";

const SPRINT_LENGTH_DAYS = Number(process.env.NEXT_PUBLIC_SPRINT_LENGTH_DAYS ?? 14);
const VELOCITY_ANOMALY_THRESHOLD = Number(process.env.NEXT_PUBLIC_VELOCITY_ANOMALY_THRESHOLD ?? 0.20);
const BLOCKER_SLA_HOURS = Number(process.env.NEXT_PUBLIC_BLOCKER_SLA_HOURS ?? 24);
const QUARTERLY_GOAL_SP = Number(process.env.NEXT_PUBLIC_QUARTERLY_GOAL_SP ?? 0) || null;
const CONFLUENCE_SPACE = process.env.NEXT_PUBLIC_CONFLUENCE_SPACE ?? "";

type Tab = "capacity" | "backlog" | "blockers" | "retro";
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "capacity", label: "Capacity & Planning", icon: Calendar },
  { id: "backlog", label: "Sprint Backlog", icon: Trello },
  { id: "blockers", label: "Blockers", icon: AlertOctagon },
  { id: "retro", label: "Retrospective", icon: BarChart3 },
];

export default function ScrumMasterWorkbench() {
  const router = useRouter();
  const workbenchCtx = useWorkbenchContext();
  const embedded = isEmbedded();
  const isModal = router.query.mode === "modal";
  const urlSprint = router.query.sprintNumber ? Number(router.query.sprintNumber) : null;

  const [activeTab, setActiveTab] = useState<Tab>("capacity");
  const [chatOpen, setChatOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "warn" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string, type: "success" | "error" | "warn" = "success") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 5_000);
  }

  // ── State ───────────────────────────────────────────────────────────────────
  const [capacityPlan, setCapacityPlan] = useState<CapacityPlanRecord | null>(null);
  const [allCapacityPlans, setAllCapacityPlans] = useState<CapacityPlanRecord[]>([]);
  const [capacityRecordId, setCapacityRecordId] = useState<string | null>(null);
  const [backlogRecords, setBacklogRecords] = useState<BacklogRecord[]>([]);
  const [blockers, setBlockers] = useState<BlockerRecord[]>([]);
  const [retroActions, setRetroActions] = useState<RetroActionRecord[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffRecord[]>([]);
  const [pmHandoffs, setPmHandoffs] = useState<PmHandoffRecord[]>([]);
  const [pmHandoffsLoading, setPmHandoffsLoading] = useState(true);
  const [pmHandoffsError, setPmHandoffsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Agent job ID for chat (resolved from /api/jobs on first load)
  const [agentJobId, setAgentJobId] = useState<number | null>(null);

  // Mission-1 logs
  const mission1RunId = capacityPlan?.mission1RunId ?? null;
  const missionStatus = useMissionLogs(mission1RunId, !!mission1RunId);

  // Derived
  const sprintNumber = urlSprint ?? capacityPlan?.sprintNumber ?? 1;
  const committedRecords = backlogRecords.filter((r) => r.sprintNumber === sprintNumber);
  const committedPoints = committedRecords.reduce((s, r) => s + (r.storyPoints ?? 0), 0);
  const sprintHandoffs = handoffs.filter((h) => h.sprintNumber === sprintNumber);
  const alreadyCommitted = sprintHandoffs.length > 0 && sprintHandoffs.length >= committedRecords.length && committedRecords.length > 0;
  const commitTimestamp = sprintHandoffs[0]?.triggeredAt ?? null;
  const openBlockers = blockers.filter((b) => !b.resolvedAt && b.sprintNumber === sprintNumber);

  // ── Load all data ───────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [caps, bl, bk, ra, ho, pm] = await Promise.all([
        records.list(COLLECTIONS.CAPACITY_PLANS),
        records.list(COLLECTIONS.SPRINT_BACKLOG),
        records.list(COLLECTIONS.BLOCKERS),
        records.list(COLLECTIONS.RETRO_ACTIONS),
        records.list(COLLECTIONS.CYCLE_HANDOFFS),
        records.list(COLLECTIONS.PM_HANDOFFS).catch(() => []),
      ]);
      const typedCaps = caps as unknown as CapacityPlanRecord[];
      setAllCapacityPlans(typedCaps);
      const sorted = [...typedCaps].sort((a, b) => (b.sprintNumber ?? 0) - (a.sprintNumber ?? 0));
      const target = urlSprint ? sorted.find((r) => r.sprintNumber === urlSprint) : sorted[0];
      if (target) { setCapacityPlan(target); setCapacityRecordId((target as any).id ?? null); }
      setBacklogRecords(bl as unknown as BacklogRecord[]);
      setBlockers(bk as unknown as BlockerRecord[]);
      setRetroActions(ra as unknown as RetroActionRecord[]);
      setHandoffs(ho as unknown as HandoffRecord[]);
      setPmHandoffs(pm as unknown as PmHandoffRecord[]);
      setPmHandoffsLoading(false);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [urlSprint]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Resolve agent job ID for chat
  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then((data) => {
      const jobs = data.items ?? [];
      const match = jobs.find((j: any) => j.type === "ai_agent" && j.name.toLowerCase().includes("scrum master"));
      if (match) setAgentJobId(match.id);
    }).catch(() => {});
  }, []);

  // URL sync
  useEffect(() => {
    if (!router.isReady) return;
    const query: Record<string, string> = { ...router.query as Record<string, string> };
    if (sprintNumber) query.sprintNumber = String(sprintNumber);
    router.replace({ query }, undefined, { shallow: true });
  }, [sprintNumber, router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ────────────────────────────────────────────────────────────────
  async function handlePlanSaved(plan: CapacityPlanRecord) {
    try {
      if (capacityRecordId) {
        const updated = await records.update(COLLECTIONS.CAPACITY_PLANS, capacityRecordId, plan as any);
        setCapacityPlan(updated as unknown as CapacityPlanRecord);
      } else {
        const created = await records.create(COLLECTIONS.CAPACITY_PLANS, plan as any);
        setCapacityPlan(created as unknown as CapacityPlanRecord);
        setCapacityRecordId(created.id ?? null);
      }
    } catch { showToast("Warning: capacity plan could not be saved.", "warn"); }
  }

  function handleMission1Started(runId: number) {
    setCapacityPlan((prev) => prev ? { ...prev, mission1RunId: runId } : prev);
  }

  async function handleCommit(ticket: JiraIssue, source: "pm_approved" | "active_sprint") {
    const record = { jiraKey: ticket.key, summary: ticket.summary, storyPoints: ticket.storyPoints ?? 0, source, sprintNumber, committedAt: new Date().toISOString() };
    const created = await records.create(COLLECTIONS.SPRINT_BACKLOG, record as any);
    setBacklogRecords((prev) => [...prev, created as unknown as BacklogRecord]);
  }

  async function handleDecommit(jiraKey: string) {
    const existing = backlogRecords.find((r) => r.jiraKey === jiraKey && r.sprintNumber === sprintNumber);
    if (!existing?.id) return;
    await records.delete(COLLECTIONS.SPRINT_BACKLOG, existing.id);
    setBacklogRecords((prev) => prev.filter((r) => r.id !== existing.id));
  }

  async function handleAddBlocker(blocker: Omit<BlockerRecord, "id">) {
    const created = await records.create(COLLECTIONS.BLOCKERS, blocker as any);
    setBlockers((prev) => [...prev, created as unknown as BlockerRecord]);
  }

  async function handleResolveBlocker(_blockerId: string, recordId: string) {
    const updated = await records.update(COLLECTIONS.BLOCKERS, recordId, { resolvedAt: new Date().toISOString() });
    setBlockers((prev) => prev.map((b) => b.id === recordId ? (updated as unknown as BlockerRecord) : b));
  }

  async function handleAddRetro(action: Omit<RetroActionRecord, "id">) {
    const created = await records.create(COLLECTIONS.RETRO_ACTIONS, action as any);
    setRetroActions((prev) => [...prev, created as unknown as RetroActionRecord]);
  }

  async function handleCompleteRetro(_actionId: string, recordId: string) {
    const updated = await records.update(COLLECTIONS.RETRO_ACTIONS, recordId, { completedAt: new Date().toISOString() });
    setRetroActions((prev) => prev.map((a) => a.id === recordId ? (updated as unknown as RetroActionRecord) : a));
  }

  async function handleHandoffCreated(handoff: HandoffRecord) {
    const created = await records.create(COLLECTIONS.CYCLE_HANDOFFS, handoff as any);
    setHandoffs((prev) => [...prev, created as unknown as HandoffRecord]);
  }

  async function handleBacklogUpdated(jiraKey: string, runId: number) {
    const existing = backlogRecords.find((r) => r.jiraKey === jiraKey && r.sprintNumber === sprintNumber);
    if (!existing?.id) return;
    const updated = await records.update(COLLECTIONS.SPRINT_BACKLOG, existing.id, { mission3RunId: runId, mission3TriggeredAt: new Date().toISOString() });
    setBacklogRecords((prev) => prev.map((r) => r.id === existing.id ? (updated as unknown as BacklogRecord) : r));
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={`min-w-0 max-w-full overflow-x-hidden bg-[#08070b] text-[#e2e8f0] font-sans selection:bg-amber-500/30 ${isModal ? "max-h-[90vh] overflow-y-auto" : "min-h-screen"}`}>
      <div className="p-4 md:p-6 pb-24">

        {/* Embedded context */}
        {embedded && workbenchCtx && (
          <div className="max-w-6xl mx-auto mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs flex items-center gap-2">
            <span className="text-amber-400 font-mono uppercase tracking-wider">Bound</span>
            <span className="text-slate-300">Mission: <span className="text-white font-medium">{workbenchCtx.mission?.name ?? `#${workbenchCtx.missionId}`}</span></span>
          </div>
        )}

        {/* Header */}
        {!isModal && (
          <header className="max-w-6xl mx-auto mb-6">
            <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">SDLC Agile Hub</span>
                <h1 className="mt-2 text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-300 to-slate-500 bg-clip-text text-transparent">Scrum Master Workbench</h1>
                <p className="text-slate-400 text-sm mt-1">
                  Sprint Planning Console
                  {sprintNumber ? <span className="ml-2 text-amber-400 font-mono">· Sprint {sprintNumber}</span> : <span className="ml-2 text-slate-600">· No sprint selected</span>}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {openBlockers.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
                    <AlertOctagon className="w-4 h-4" />
                    <span className="font-semibold">{openBlockers.length} blocker{openBlockers.length !== 1 ? "s" : ""}</span>
                  </div>
                )}
                <button
                  onClick={() => setChatOpen((v) => !v)}
                  aria-label="Toggle AI Sprint Planner chat"
                  className={`p-2.5 rounded-xl border transition-colors ${chatOpen ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-white/5 border-white/10 text-slate-400 hover:text-white"}`}
                >
                  <Bot className="w-5 h-5" />
                </button>
              </div>
            </div>
          </header>
        )}

        {/* Toast */}
        <AnimatePresence>
          {toast && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className={`max-w-6xl mx-auto mb-4 px-4 py-2.5 rounded-lg text-sm font-medium ${
                toast.type === "success" ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" :
                toast.type === "warn" ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" :
                "bg-rose-500/10 border border-rose-500/20 text-rose-400"
              }`}>{toast.msg}</motion.div>
          )}
        </AnimatePresence>

        {/* Main layout: content + optional chat sidebar */}
        <div className="max-w-6xl mx-auto">
          <div className={`grid gap-6 ${chatOpen ? "grid-cols-1 lg:grid-cols-[1fr_360px]" : "grid-cols-1"}`}>
            {/* Main content */}
            <div className="min-w-0">
              {/* Tabs */}
              <div role="tablist" className="flex border-b border-white/5 mb-6 gap-1 overflow-x-auto">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setActiveTab(id)} role="tab" {...{ "aria-selected": activeTab === id }}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-all ${
                      activeTab === id ? "border-amber-500 text-amber-400" : "border-transparent text-slate-400 hover:text-white"
                    }`}>
                    <Icon className="w-4 h-4" />{label}
                    {id === "blockers" && openBlockers.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400">{openBlockers.length}</span>
                    )}
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                <motion.div key={activeTab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.15 }}>

                  {activeTab === "capacity" && (
                    <div className="space-y-6">
                      <CapacityPanel sprintNumber={sprintNumber} existingPlan={capacityPlan} onPlanSaved={handlePlanSaved} onMission1Started={handleMission1Started} />
                      <VelocityForecastChart capacityPlans={allCapacityPlans} currentSprintNumber={sprintNumber} quarterlyGoalSp={QUARTERLY_GOAL_SP} />
                      <FleetAvailabilityBadge sprintNumber={sprintNumber} />
                      <CommitButton
                        sprintNumber={sprintNumber} committedRecords={committedRecords}
                        targetVelocity={capacityPlan?.targetVelocity ?? null} anomalyThreshold={VELOCITY_ANOMALY_THRESHOLD}
                        capacityPlanComplete={!!capacityPlan?.hilCompletedAt} alreadyCommitted={alreadyCommitted}
                        commitTimestamp={commitTimestamp} onHandoffCreated={handleHandoffCreated} onBacklogUpdated={handleBacklogUpdated}
                      />
                    </div>
                  )}

                  {activeTab === "backlog" && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <SprintBurndownPredictor totalPoints={committedPoints > 0 ? committedPoints : 100} />
                        <BottleneckAnalysisWidget sprintNumber={sprintNumber} blockers={blockers.filter(b => b.sprintNumber === sprintNumber)} committedRecords={committedRecords} />
                      </div>
                      <DependencyRadar committedRecords={committedRecords} />
                      <div className="flex items-center justify-between">
                        <StandupReportGenerator
                          sprintNumber={sprintNumber} committedRecords={committedRecords}
                          blockers={blockers.filter((b) => b.sprintNumber === sprintNumber)}
                          totalCommittedPoints={committedPoints} confluenceSpace={CONFLUENCE_SPACE}
                        />
                      </div>
                      <SprintBoardView sprintNumber={sprintNumber} committedKeys={committedRecords.map((r) => r.jiraKey)} totalCommittedPoints={committedPoints} />
                      <BacklogPanel
                        sprintNumber={sprintNumber} targetVelocity={capacityPlan?.targetVelocity ?? null}
                        anomalyThreshold={VELOCITY_ANOMALY_THRESHOLD} committedRecords={committedRecords}
                        pmHandoffs={pmHandoffs} pmHandoffsLoading={pmHandoffsLoading} pmHandoffsError={pmHandoffsError}
                        onCommit={handleCommit} onDecommit={handleDecommit}
                        onReloadPmHandoffs={() => { setPmHandoffsLoading(true); records.list(COLLECTIONS.PM_HANDOFFS).then((r) => setPmHandoffs(r as unknown as PmHandoffRecord[])).catch((e) => setPmHandoffsError(e.message)).finally(() => setPmHandoffsLoading(false)); }}
                      />
                    </div>
                  )}

                  {activeTab === "blockers" && (
                    <BlockersPanel
                      sprintNumber={sprintNumber}
                      blockers={blockers.filter((b) => b.sprintNumber === sprintNumber)}
                      loading={loading} error={null}
                      onAdd={handleAddBlocker} onResolve={handleResolveBlocker}
                      onReload={() => { records.list(COLLECTIONS.BLOCKERS).then((r) => setBlockers(r as unknown as BlockerRecord[])).catch(() => {}); }}
                      blockerSlaHours={BLOCKER_SLA_HOURS}
                    />
                  )}

                  {activeTab === "retro" && (
                    <RetroPanel
                      sprintNumber={sprintNumber}
                      actions={retroActions.filter((a) => a.sprintNumber === sprintNumber)}
                      loading={loading} error={null}
                      onAdd={handleAddRetro} onComplete={handleCompleteRetro}
                      onReload={() => { records.list(COLLECTIONS.RETRO_ACTIONS).then((r) => setRetroActions(r as unknown as RetroActionRecord[])).catch(() => {}); }}
                    />
                  )}

                </motion.div>
              </AnimatePresence>
            </div>

            {/* Agent Chat Sidebar */}
            {chatOpen && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <AgentChatPanel
                  agentId={agentJobId}
                  sprintNumber={sprintNumber}
                  sprintContext={{
                    availableEngineerDays: capacityPlan?.availableEngineerDays ?? 0,
                    targetVelocity: capacityPlan?.targetVelocity ?? 0,
                    committedTickets: committedRecords.length,
                    committedPoints,
                  }}
                />
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Mission status drawer */}
      <MissionStatusDrawer missionStatus={missionStatus} onRetry={missionStatus.retry} />
    </div>
  );
}
export async function getServerSideProps() { return { props: {} }; }
