/**
 * QA Workbench: Defect Triage Center (WOW Enhanced)
 *
 * 6-tab layout: Test Suites, Defects, Fixtures, Quality Gate, Investigate, Mission Status.
 * Plus: AI QA Agent chat drawer, Fleet Status badge, Similar Defects, Evidence linking.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/router";
import {
  FlaskConical, Bug, Database, ShieldCheck, Activity, Search,
  CheckCircle2, XCircle, AlertTriangle, Loader2, ExternalLink,
  Rocket, AlertOctagon, Bot,
} from "lucide-react";
import { useWorkbenchContext, isEmbedded } from "../sdk/workbench-sdk";
import { records, bugs, missions, telemetry, confluence } from "../lib/platform-client";
import { useMissionLogs } from "../lib/hooks";
import { COLLECTIONS } from "../lib/collections";
import { evaluateGate } from "../lib/quality-gate";
import type { TestSuiteRecord, DefectRecord, FixtureRecord, QualityGateRecord, UATPackageRecord } from "../lib/collections";

import { InvestigateTab } from "../components/InvestigateTab";
import { QaAgentChatPanel } from "../components/QaAgentChatPanel";
import { SimilarDefectsPanel } from "../components/SimilarDefectsPanel";
import { EvidenceSection } from "../components/EvidenceSection";
import { TestReportPublisher } from "../components/TestReportPublisher";
import { FleetStatusBadge } from "../components/FleetStatusBadge";
import { JiraStatusControls } from "../components/JiraStatusControls";
import { WorkbenchLayout } from "../components/WorkbenchLayout";
import { SkeletonLoader } from "../components/SkeletonLoader";
import { SelfHealingEngineWidget } from "../components/SelfHealingEngineWidget";

const COVERAGE_THRESHOLD = Number(process.env.NEXT_PUBLIC_COVERAGE_THRESHOLD ?? 80);

type Tab = "suites" | "defects" | "fixtures" | "gate" | "investigate" | "mission";

const navItems = [
  { id: "suites", label: "Test Suites", icon: FlaskConical },
  { id: "defects", label: "Defects", icon: Bug },
  { id: "fixtures", label: "Fixtures", icon: Database },
  { id: "gate", label: "Quality Gate", icon: ShieldCheck },
  { id: "investigate", label: "Investigate", icon: Search },
  { id: "mission", label: "Mission Status", icon: Activity },
] as const;

export default function QAWorkbench() {
  const router = useRouter();
  const workbenchCtx = useWorkbenchContext();
  const embedded = isEmbedded();
  const isModal = router.query.mode === "modal";

  const [activeTab, setActiveTab] = useState<Tab>("suites");
  const [chatOpen, setChatOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "warn" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string, type: "success" | "error" | "warn" = "success") { if (toastTimer.current) clearTimeout(toastTimer.current); setToast({ msg, type }); toastTimer.current = setTimeout(() => setToast(null), 5000); }

  const [suites, setSuites] = useState<TestSuiteRecord[]>([]);
  const [defects, setDefects] = useState<DefectRecord[]>([]);
  const [fixtures, setFixtures] = useState<FixtureRecord[]>([]);
  const [gates, setGates] = useState<QualityGateRecord[]>([]);
  const [uatPackages, setUatPackages] = useState<UATPackageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDefect, setSelectedDefect] = useState<DefectRecord | null>(null);
  const [agentJobId, setAgentJobId] = useState<number | null>(null);

  const missionStatus = useMissionLogs(null, false);
  const openDefects = defects.filter((d) => d.status === "open");
  const criticalOpen = openDefects.filter((d) => d.severity === "Critical");
  const latestGate = gates.length > 0 ? [...gates].sort((a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime())[0] : null;

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d, f, g, up] = await Promise.all([
        records.list(COLLECTIONS.TEST_SUITES), records.list(COLLECTIONS.DEFECTS),
        records.list(COLLECTIONS.FIXTURES), records.list(COLLECTIONS.QUALITY_GATES),
        records.list(COLLECTIONS.UAT_PACKAGES),
      ]);
      setSuites(s as unknown as TestSuiteRecord[]); setDefects(d as unknown as DefectRecord[]);
      setFixtures(f as unknown as FixtureRecord[]); setGates(g as unknown as QualityGateRecord[]);
      setUatPackages(up as unknown as UATPackageRecord[]);
    } catch (e: any) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { fetch("/api/jobs").then((r) => r.json()).then((data) => { const m = (data.items ?? []).find((j: any) => j.type === "ai_agent" && j.name.toLowerCase().includes("qa")); if (m) setAgentJobId(m.id); }).catch(() => {}); }, []);

  async function handleCreateJiraBug(defect: DefectRecord) {
    const result = await bugs.create({ provider: "jira", title: defect.title, severity: defect.severity, reproSteps: defect.reproSteps, expectedResult: defect.expectedResult, actualResult: defect.actualResult, suiteName: defect.suiteName, evidenceUrl: defect.evidenceUrl, labels: ["oddjob-qa", "sdlc-cycle"] });
    if (defect.id) { await records.update(COLLECTIONS.DEFECTS, defect.id, { externalIssueProvider: result.provider, externalIssueKey: result.key, externalIssueUrl: result.url, externalIssueCreatedAt: new Date().toISOString() }); setDefects((p) => p.map((d) => d.id === defect.id ? { ...d, externalIssueProvider: result.provider, externalIssueKey: result.key, externalIssueUrl: result.url } : d)); }
    telemetry.emit("jira_bug_created", "info", { defectId: defect.defectId, externalIssueKey: result.key });
    showToast(result.provider === "oddjob" ? "Tracked as Oddjob reference" : `Jira bug: ${result.key}`);
  }

  async function handleRouteToDev(defect: DefectRecord) {
    const result = await missions.trigger("Core Application Development", { defectId: defect.defectId, title: defect.title, severity: defect.severity });
    if (defect.id) { await records.update(COLLECTIONS.DEFECTS, defect.id, { status: "routed_to_dev" }); setDefects((p) => p.map((d) => d.id === defect.id ? { ...d, status: "routed_to_dev" as const } : d)); }
    showToast(`Routed to Dev — Run #${result.runId}`);
  }

  async function handleEvaluateGate() {
    const result = evaluateGate(suites, defects, fixtures, COVERAGE_THRESHOLD);
    const gateId = crypto.randomUUID();
    const record: any = { gateId, overallStatus: result.overallStatus, rules: result.rules, evaluatedAt: new Date().toISOString() };
    await records.create(COLLECTIONS.QUALITY_GATES, record);
    setGates((p) => [record, ...p]);
    telemetry.emit("quality_gate_evaluated", "info", { gateId, overallStatus: result.overallStatus });
    showToast(result.overallStatus === "passed" ? "Gate PASSED" : "Gate FAILED", result.overallStatus === "passed" ? "success" : "error");
  }

  return (
    <WorkbenchLayout
      title="Defect Triage Center"
      section="SDLC QA"
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab)}
      navItems={navItems}
      embedded={embedded}
      missionName={workbenchCtx?.mission?.name ?? (workbenchCtx?.missionId ? `#${workbenchCtx.missionId}` : undefined)}
      rightHeaderActions={
        <div className="flex items-center gap-3">
          <FleetStatusBadge />
          <button title="Toggle Chat" onClick={() => setChatOpen((v) => !v)} className={`p-2 rounded-xl border transition-colors ${chatOpen ? "bg-rose-500/10 border-rose-500/30 text-rose-400" : "bg-white/5 border-white/10 text-slate-400"}`}><Bot className="w-5 h-5" /></button>
        </div>
      }
    >
      <div className={`selection:bg-rose-500/30 ${isModal ? "max-h-[90vh] overflow-y-auto" : ""}`}>
        <AnimatePresence>{toast && (<motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mb-4"><div className={`px-4 py-2.5 rounded-lg text-sm font-medium ${toast.type === "success" ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : toast.type === "warn" ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" : "bg-rose-500/10 border border-rose-500/20 text-rose-400"}`}>{toast.msg}</div></motion.div>)}</AnimatePresence>

        <div className={`grid gap-6 ${chatOpen ? "grid-cols-1 lg:grid-cols-[1fr_320px]" : "grid-cols-1"}`}>
          <div>
            {loading ? <SkeletonLoader count={4} heightClass="h-16" /> : (
              <AnimatePresence mode="wait"><motion.div key={activeTab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.15 }}>
                {activeTab === "suites" && (<div className="space-y-4">
                  
                  {/* Flaky Test Auto-Healer Widget */}
                  <SelfHealingEngineWidget />


                  {suites.map((s) => (<div key={s.suiteId} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/3 border border-white/5">{s.status === "passed" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}<span className="flex-1 text-sm text-white">{s.suiteName}</span><span className="text-xs text-slate-400">{s.passCount}✓ {s.failCount}✗</span><span className="text-xs font-mono text-blue-400">{s.coveragePercent}%</span></div>))}{suites.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No test suites logged.</p>}</div>)}
                {activeTab === "defects" && (<div className="space-y-4">{defects.map((d) => (<div key={d.defectId} className={`px-4 py-3 rounded-lg border ${d.severity === "Critical" ? "bg-rose-500/5 border-rose-500/20" : "bg-white/3 border-white/5"}`}><div className="flex items-center gap-2 mb-1"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.severity === "Critical" ? "bg-rose-500/20 text-rose-400" : d.severity === "High" ? "bg-orange-500/20 text-orange-400" : "bg-amber-500/20 text-amber-400"}`}>{d.severity}</span><span className="text-sm font-medium text-white flex-1">{d.title}</span><span className="text-[10px] text-slate-500">{d.status}</span></div><div className="text-xs text-slate-500 mb-2">Suite: {d.suiteName}</div>{d.externalIssueKey ? <a href={d.externalIssueUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">{d.externalIssueKey}</a> : d.status === "open" && <div className="flex gap-2"><button onClick={() => handleCreateJiraBug(d)} className="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg">Create Jira Bug</button>{(d.severity === "Critical" || d.severity === "High") && <button onClick={() => handleRouteToDev(d)} className="px-2.5 py-1 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg">Route to Dev</button>}</div>}{d.externalIssueKey && <JiraStatusControls issueKey={d.externalIssueKey} currentStatus={d.externalIssueStatus ?? "Open"} />}<SimilarDefectsPanel defectTitle={d.title} defectDescription={d.reproSteps} defectId={d.defectId} visible={true} /><EvidenceSection defectId={d.defectId} /></div>))}{defects.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No defects logged.</p>}</div>)}
                {activeTab === "fixtures" && (<div className="space-y-2">{fixtures.map((f) => (<div key={f.fixtureId} className="px-4 py-3 rounded-lg bg-white/3 border border-white/5"><span className="font-mono text-xs text-purple-400">{f.fixtureId}</span><span className="text-xs text-slate-500 ml-2">Suite: {f.associatedSuite}</span><p className="text-sm text-slate-300 mt-1 truncate">{f.description}</p></div>))}{fixtures.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No fixtures registered.</p>}</div>)}
                {activeTab === "gate" && (<div className="space-y-6"><div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6">{latestGate && <div className={`px-4 py-2.5 rounded-lg text-sm font-semibold mb-4 ${latestGate.overallStatus === "passed" ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border border-rose-500/20 text-rose-400"}`}>{latestGate.overallStatus === "passed" ? "✓ Gate Passed" : "✗ Gate Failed"}</div>}{latestGate?.rules.map((r) => (<div key={r.name} className="flex items-center gap-3 text-sm mb-2">{r.status === "passed" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}<span className="text-slate-300 flex-1">{r.name}</span></div>))}<button onClick={handleEvaluateGate} className="mt-4 w-full py-2.5 bg-rose-700 hover:bg-rose-600 text-white rounded-lg text-sm font-semibold">Evaluate Gate</button></div><TestReportPublisher sprintNumber={1} suites={suites} defects={defects} fixtures={fixtures} latestGate={latestGate} /></div>)}
                {activeTab === "investigate" && <InvestigateTab defectId={selectedDefect?.defectId} jiraKey={selectedDefect?.externalIssueKey ?? undefined} onSuiteLogged={loadAll} />}
                {activeTab === "mission" && (<div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6"><h3 className="text-sm font-semibold text-slate-200 mb-3">Mission-4: QA & Regression Testing</h3><p className="text-xs text-slate-500">Mission status will appear here when active.</p></div>)}
              </motion.div></AnimatePresence>
            )}
          </div>
          {chatOpen && <QaAgentChatPanel agentId={agentJobId} defectContext={selectedDefect ? { title: selectedDefect.title, severity: selectedDefect.severity, reproSteps: selectedDefect.reproSteps, suiteName: selectedDefect.suiteName } : null} visible={chatOpen} />}
        </div>
      </div>
    </WorkbenchLayout>
  );
}
export async function getServerSideProps() { return { props: {} }; }
