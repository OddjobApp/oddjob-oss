/**
 * PM Workbench: Requirements & Intake Studio (WOW Enhanced)
 *
 * Confluence-first intake (search/URL/drag-drop), AI agent chat,
 * Knowledge Graph context, fleet availability, in-app approval with
 * Confluence packet publishing, Jira transition, and approval timeline.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/router";
import { Bot, Rocket } from "lucide-react";
import { useWorkbenchContext, isEmbedded } from "../sdk/workbench-sdk";
import { records, jira, confluence, hil, missions, telemetry } from "../lib/platform-client";
import { useMissionLogs } from "../lib/hooks";
import { COLLECTIONS } from "../lib/collections";
import { buildApprovalPacketHtml } from "../lib/confluence-utils";
import type { IntakeRecord, SignoffRecord, HandoffRecord } from "../lib/collections";
import type { JiraIssue } from "../lib/platform-client";

import { BacklogList } from "../components/BacklogList";
import { PRDEditor } from "../components/PRDEditor";
import { SignoffPanel } from "../components/SignoffPanel";
import type { SignoffData } from "../components/SignoffPanel";
import { MissionStatusPanel } from "../components/MissionStatusPanel";
import { TriggerButton } from "../components/TriggerButton";
import { ConfluenceSourcePanel } from "../components/ConfluenceSourcePanel";
import { SourceLinkBar } from "../components/SourceLinkBar";
import { ApprovalTimeline } from "../components/ApprovalTimeline";
import { KnowledgeContextPanel } from "../components/KnowledgeContextPanel";
import { FleetAvailabilityBadge } from "../components/FleetAvailabilityBadge";
import { AgentChat } from "../components/AgentChat";

const DESIGN_READY_JQL = 'status = "Design Ready" ORDER BY updated DESC';
const CONFLUENCE_BASE_URL = process.env.NEXT_PUBLIC_CONFLUENCE_BASE_URL ?? "";
const CONFLUENCE_SPACE = process.env.NEXT_PUBLIC_CONFLUENCE_SPACE ?? "";
const APPROVAL_PACKET_SPACE = process.env.NEXT_PUBLIC_APPROVAL_PACKET_SPACE ?? CONFLUENCE_SPACE;

export default function PMWorkbench() {
  const router = useRouter();
  const workbenchCtx = useWorkbenchContext();
  const embedded = isEmbedded();
  const isModal = router.query.mode === "modal";
  const urlTicketKey = (router.query.ticketKey as string) ?? null;
  const urlConfluencePageId = (router.query.confluencePageId as string) ?? null;

  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "warn" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string, type: "success" | "error" | "warn" = "success") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type }); toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  // State
  const [tickets, setTickets] = useState<JiraIssue[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [intakeRecords, setIntakeRecords] = useState<IntakeRecord[]>([]);
  const [signoffRecords, setSignoffRecords] = useState<SignoffRecord[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(urlTicketKey);
  const [prdContent, setPrdContent] = useState<string | null>(null);
  const [prdDirty, setPrdDirty] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(true);

  const selectedRecord = intakeRecords.find((r) => r.jiraKey === selectedKey) ?? null;
  const signoffStatus = selectedRecord?.signoffStatus ?? null;
  const mission2RunId = selectedRecord?.mission2RunId ?? null;
  const missionStatus = useMissionLogs(mission2RunId, !!mission2RunId);
  const isApproved = signoffStatus === "approved";
  const alreadyTriggered = !!selectedRecord?.mission3RunId;
  const signoffRef = useRef<HTMLDivElement>(null);

  // Load data
  const loadBacklog = useCallback(async () => {
    setTicketsLoading(true); setTicketsError(null);
    try { const r = await jira.search(DESIGN_READY_JQL, undefined, 50); if (r.success) setTickets(r.issues); else throw new Error(r.error); }
    catch (e: any) { setTicketsError(e.message); }
    finally { setTicketsLoading(false); }
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const [bl, sf] = await Promise.all([records.list(COLLECTIONS.BACKLOG), records.list(COLLECTIONS.SIGNOFFS)]);
      const typed = bl as unknown as IntakeRecord[];
      setIntakeRecords(typed);
      setSignoffRecords(sf as unknown as SignoffRecord[]);
      if (!urlTicketKey && typed.length > 0) {
        const sorted = [...typed].sort((a, b) => new Date(b.selectedAt).getTime() - new Date(a.selectedAt).getTime());
        setSelectedKey(sorted[0].jiraKey);
      }
    } catch {}
  }, [urlTicketKey]);

  useEffect(() => { loadBacklog(); loadRecords(); }, [loadBacklog, loadRecords]);

  // Deep-link: auto-load Confluence page
  useEffect(() => {
    if (urlConfluencePageId && selectedRecord && !selectedRecord.sourceConfluencePageId) {
      handleSourceLoaded(urlConfluencePageId, "Deep-linked page", "", "deep_link");
    }
  }, [urlConfluencePageId, selectedRecord]); // eslint-disable-line

  // URL sync
  useEffect(() => {
    if (!router.isReady || !selectedKey) return;
    const q: Record<string, string> = { ...router.query as Record<string, string> };
    q.ticketKey = selectedKey;
    router.replace({ query: q }, undefined, { shallow: true });
  }, [selectedKey, router.isReady]); // eslint-disable-line

  // Handlers
  async function handleSelectTicket(key: string) {
    setSelectedKey(key); setPrdDirty(false);
    telemetry.emit("ticket_selected", "info", { jiraKey: key });
    const existing = intakeRecords.find((r) => r.jiraKey === key);
    const ticket = tickets.find((t) => t.key === key);
    if (!ticket) return;
    const data: any = { jiraKey: key, summary: ticket.summary, status: ticket.status, priority: ticket.priority, assignee: ticket.assignee, issueType: ticket.issueType, selectedAt: new Date().toISOString() };
    try {
      if (existing?.id) { await records.update(COLLECTIONS.BACKLOG, existing.id, data); setIntakeRecords((p) => p.map((r) => r.id === existing.id ? { ...r, ...data } : r)); }
      else { const c = await records.create(COLLECTIONS.BACKLOG, data); setIntakeRecords((p) => [...p, { ...data, id: c.id }]); }
    } catch { showToast("Warning: could not save intake record.", "warn"); }
  }

  function handleSourceLoaded(pageId: string, title: string, spaceKey: string, sourceType: string) {
    if (selectedRecord?.id) {
      records.update(COLLECTIONS.BACKLOG, selectedRecord.id, { sourceConfluencePageId: pageId }).catch(() => {});
      setIntakeRecords((p) => p.map((r) => r.id === selectedRecord.id ? { ...r, sourceConfluencePageId: pageId } : r));
    }
    telemetry.emit("confluence_source_loaded", "info", { pageId, sourceType, jiraKey: selectedKey });
  }

  async function handlePublish() {
    if (!prdContent || !selectedRecord?.prdConfluencePageId) return;
    setPublishLoading(true);
    try {
      await confluence.publish({ title: `PRD: ${selectedRecord.summary}`, content: prdContent, pageId: selectedRecord.prdConfluencePageId });
      setPrdDirty(false); showToast("Published to Confluence");
      telemetry.emit("prd_published", "info", { jiraKey: selectedKey, confluencePageId: selectedRecord.prdConfluencePageId });
      if (selectedRecord.id) records.update(COLLECTIONS.BACKLOG, selectedRecord.id, { prdLastPublishedAt: new Date().toISOString() }).catch(() => {});
    } finally { setPublishLoading(false); }
  }

  async function handleSignoffSubmit(data: SignoffData) {
    if (!selectedKey) return;
    // Immediate local evaluation (WOW: no HIL poll wait)
    const approved = data.prdStatus === "Approved" && data.uxMockupStatus === "Approved";
    const newStatus = approved ? "approved" : "changes_requested";

    // Fire-and-forget HIL for audit trail
    hil.create(`PRD Sign-off for ${selectedKey}`, { jiraKey: selectedKey, ...data }).catch(() => {});
    telemetry.emit("signoff_submitted", "info", { jiraKey: selectedKey });

    // Emit stage_handoff event when approved (Requirements → Development)
    if (approved) {
      telemetry.emit("stage_handoff", "info", {
        sourceStage: "Requirements",
        targetStage: "Development",
        sourceMission: "Requirements & Design Analysis",
        targetMission: "Core Application Development",
        ticketKeys: [selectedKey],
        triggeredBy: "pm-workbench",
        runId: selectedRecord?.mission2RunId ?? 0,
      });
    }

    // Save signoff record
    const signoff: any = { jiraKey: selectedKey, hilFormId: 0, prdStatus: data.prdStatus, uxMockupStatus: data.uxMockupStatus, designSystemCompliance: data.designSystemCompliance, scopingComments: data.scopingComments, reviewedStoryPoints: data.reviewedStoryPoints, submittedAt: new Date().toISOString() };

    // Publish approval packet if approved (WOW)
    if (approved && selectedRecord) {
      try {
        const packetHtml = buildApprovalPacketHtml({
          jiraKey: selectedKey, ticketSummary: selectedRecord.summary, prdContent: prdContent ?? "",
          prdPageId: selectedRecord.prdConfluencePageId ?? null, sourcePageId: selectedRecord.sourceConfluencePageId ?? null,
          confluenceBaseUrl: CONFLUENCE_BASE_URL, signoffData: data, approvedAt: new Date().toISOString(),
        });
        const packetResult = await confluence.publish({ title: `Requirements Approved: ${selectedKey} — ${selectedRecord.summary}`, content: packetHtml, space: APPROVAL_PACKET_SPACE });
        if (packetResult.success) {
          signoff.approvalPacketPageId = packetResult.pageId;
          signoff.approvalPacketUrl = packetResult.url;
          telemetry.emit("approval_packet_published", "info", { jiraKey: selectedKey, approvalPacketPageId: packetResult.pageId });
        }
      } catch { showToast("Approval packet could not be published.", "warn"); }

      // Jira transition (non-blocking)
      jira.transition(selectedKey, "In Progress").then(() => {
        telemetry.emit("jira_transition_executed", "info", { jiraKey: selectedKey, transitionName: "In Progress", success: true });
      }).catch(() => {});
    }

    records.create(COLLECTIONS.SIGNOFFS, signoff).catch(() => {});
    setSignoffRecords((p) => [...p, signoff]);

    // Update intake record
    if (selectedRecord?.id) {
      records.update(COLLECTIONS.BACKLOG, selectedRecord.id, { signoffStatus: newStatus }).catch(() => {});
      setIntakeRecords((p) => p.map((r) => r.id === selectedRecord.id ? { ...r, signoffStatus: newStatus as any } : r));
    }
  }

  async function handleTriggerMission3(): Promise<{ runId: number }> {
    if (!selectedKey) throw new Error("No ticket selected");
    const result = await missions.trigger("Core Application Development", { jiraKey: selectedKey });
    telemetry.emit("mission3_triggered", "info", { jiraKey: selectedKey, runId: result.runId });
    records.create(COLLECTIONS.HANDOFFS, { jiraKey: selectedKey, mission3RunId: result.runId, triggeredAt: new Date().toISOString(), triggeredBy: "pm-workbench" } as any).catch(() => {});
    if (selectedRecord?.id) { records.update(COLLECTIONS.BACKLOG, selectedRecord.id, { mission3RunId: result.runId }).catch(() => {}); setIntakeRecords((p) => p.map((r) => r.id === selectedRecord.id ? { ...r, mission3RunId: result.runId } : r)); }
    showToast(`Core Development launched — Run #${result.runId}`);
    return result;
  }

  return (
    <div className={`bg-[#090d16] text-[#e2e8f0] font-sans selection:bg-blue-500/30 ${isModal ? "max-h-[90vh] overflow-y-auto" : "min-h-screen"}`}>
      {embedded && workbenchCtx && (
        <div className="max-w-7xl mx-auto px-4 pt-4"><div className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs flex items-center gap-2"><span className="text-blue-400 font-mono uppercase tracking-wider">Bound</span><span className="text-slate-300">Mission: <span className="text-white font-medium">{workbenchCtx.mission?.name ?? `#${workbenchCtx.missionId}`}</span></span></div></div>
      )}
      {!isModal && (
        <header className="max-w-7xl mx-auto px-4 pt-6 pb-4 flex items-start justify-between">
          <div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">SDLC Workbench</span>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-300 to-slate-500 bg-clip-text text-transparent">PM Workbench</h1>
            <p className="text-slate-400 text-sm mt-1">{selectedKey ? <span>Ticket: <span className="text-blue-400 font-mono">{selectedKey}</span></span> : "No ticket selected"}</p>
          </div>
          <FleetAvailabilityBadge />
        </header>
      )}
      <AnimatePresence>{toast && (<motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className={`max-w-7xl mx-auto px-4 mb-4`}><div className={`px-4 py-2.5 rounded-lg text-sm font-medium ${toast.type === "success" ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : toast.type === "warn" ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" : "bg-rose-500/10 border border-rose-500/20 text-rose-400"}`}>{toast.msg}</div></motion.div>)}</AnimatePresence>

      <main className="max-w-7xl mx-auto px-4 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,1fr)_2fr] gap-6">
          {/* Left: Backlog & Golden Path Studio */}
          <div className="flex flex-col gap-6 lg:max-h-[calc(100vh-180px)] overflow-y-auto pr-2">
            
            {/* Golden Path Studio (Mocked) */}
            <div className="bg-[#111827]/40 border border-amber-500/20 rounded-xl overflow-hidden p-4 shadow-lg relative">
              <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
                <Rocket className="w-24 h-24 text-amber-500" />
              </div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400 mb-2 relative z-10">
                <span>✨</span> Golden Path Studio
              </div>
              <p className="text-xs text-slate-300 mb-4 leading-relaxed relative z-10">
                Generate reusable OKF standard operating procedures based on past successful epics.
              </p>
              
              <div className="relative z-10 space-y-3">
                <select className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-amber-500/50">
                  <option>Epic: EP-402 (Launch Stripe Integration)</option>
                  <option>Epic: EP-399 (User Profile V2)</option>
                </select>
                
                <button className="w-full bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold py-2 rounded-lg transition-colors flex items-center justify-center gap-2">
                  <Bot className="w-4 h-4" /> Generate SOP Template
                </button>
              </div>
            </div>

            <div className="bg-[#111827]/40 border border-white/5 rounded-xl overflow-hidden flex-1 min-h-[400px]">
              <BacklogList tickets={tickets} loading={ticketsLoading} error={ticketsError} selectedKey={selectedKey} onSelect={handleSelectTicket} onRefresh={loadBacklog} />
            </div>
          </div>

          {/* Right: Detail panels */}
          <div className="space-y-5">
            {!selectedKey ? (
              <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-12 text-center"><p className="text-slate-500 text-sm">Select a ticket to begin.</p></div>
            ) : (
              <>
                {/* Confluence Source (WOW) */}
                {!selectedRecord?.sourceConfluencePageId && (
                  <ConfluenceSourcePanel onSourceLoaded={handleSourceLoaded} existingSourcePageId={selectedRecord?.sourceConfluencePageId ?? null} loading={false} />
                )}

                {/* Source Link Bar (WOW) */}
                <SourceLinkBar sourcePageId={selectedRecord?.sourceConfluencePageId ?? null} sourceTitle="Source Document" prdPageId={selectedRecord?.prdConfluencePageId ?? null} prdTitle="Generated PRD" approvalPacketPageId={selectedRecord?.approvalPacketPageId ?? null} confluenceBaseUrl={CONFLUENCE_BASE_URL} />

                {/* PRD Editor & Agent Chat */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
                  <PRDEditor confluencePageId={selectedRecord?.prdConfluencePageId ?? selectedRecord?.confluencePageId ?? null} prdContent={prdContent} prdDirty={prdDirty} pageTitle={selectedRecord ? `PRD: ${selectedRecord.summary}` : null} spaceKey={CONFLUENCE_SPACE || null} lastPublishedAt={selectedRecord?.prdLastPublishedAt ?? null} mission2Status={missionStatus} onContentChange={(c) => { setPrdContent(c); setPrdDirty(true); }} onPublish={handlePublish} publishLoading={publishLoading} />
                  <AgentChat
                    agentName="Systems Analyst"
                    agentRole="Product Manager & Systems Analyst"
                    defaultGreeting="Hello! I am your Systems Analyst agent. I can help you draft PRDs, refine sprint backlogs, analyze design specifications, or verify that your business requirements align with company guidelines. What would you like to build today?"
                  />
                </div>

                {/* Knowledge Context (WOW) */}
                <KnowledgeContextPanel sourcePageTitle={selectedRecord?.summary ?? null} ticketSummary={selectedRecord?.summary ?? null} visible={showKnowledge && !!selectedKey} />

                {/* Mission-2 Status */}
                <MissionStatusPanel missionStatus={missionStatus} onRetry={missionStatus.retry} onScrollToSignoff={() => signoffRef.current?.scrollIntoView({ behavior: "smooth" })} />

                {/* Sign-off (WOW: immediate local evaluation) */}
                <div ref={signoffRef}>
                  <SignoffPanel onSubmit={handleSignoffSubmit} hilPollState={{ status: "idle", data: null }} signoffStatus={signoffStatus} scopingComments={null} disabled={signoffStatus === "pending"} />
                </div>

                {/* Trigger Button */}
                <div className="flex items-center gap-3">
                  <div className="flex-1"><TriggerButton approved={isApproved} alreadyTriggered={alreadyTriggered} existingRunId={selectedRecord?.mission3RunId ?? null} onTrigger={handleTriggerMission3} /></div>
                  <FleetAvailabilityBadge />
                </div>

                {/* Approval Timeline (WOW) */}
                <ApprovalTimeline signoffs={signoffRecords.filter((s) => s.jiraKey === selectedKey)} confluenceBaseUrl={CONFLUENCE_BASE_URL} />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
export async function getServerSideProps() { return { props: {} }; }
