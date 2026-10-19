"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { hil, fleet, HilRequest, FleetWorkload } from '../lib/platform-client';
import { handoffs } from '../lib/platform-client';
import { isEmbedded, triggerCycle } from '../lib/workbench-bridge';
import { BulkApproval } from './components/BulkApproval';
import { ActivityFeed } from './components/ActivityFeed';
import { CycleStepBanner } from './components/CycleStepBanner';

const WORKBENCHES = [
  {
    href: "/sprint-zero",
    label: "Sprint Zero",
    description: "Onboarding wizard — codebase context, architecture brief, threat model, and initial backlog",
    accent: "border-blue-500/30 hover:bg-blue-500/5",
    badge: "Setup",
    badgeColor: "bg-blue-500/10 text-blue-400",
    agentKeywords: ["architect", "onboarding"],
  },
  {
    href: "/pm-workbench",
    label: "PM Workbench",
    description: "Requirements intake, PRD sign-off, and mission trigger for design-ready tickets",
    accent: "border-white/10 hover:bg-white/5",
    badge: "Stage 1",
    badgeColor: "bg-slate-700 text-slate-400",
    agentKeywords: ["systems analyst", "product manager", "analyst"],
  },
  {
    href: "/scrum-master-workbench",
    label: "Scrum Master",
    description: "Sprint capacity planning, backlog coordination, and blocker management",
    accent: "border-white/10 hover:bg-white/5",
    badge: "Stage 2",
    badgeColor: "bg-slate-700 text-slate-400",
    agentKeywords: ["scrum master", "scrum", "agile"],
  },
  {
    href: "/qa-workbench",
    label: "QA Workbench",
    description: "Test suite tracking, defect triage, and quality gate evaluation",
    accent: "border-white/10 hover:bg-white/5",
    badge: "Stage 3",
    badgeColor: "bg-slate-700 text-slate-400",
    agentKeywords: ["qa", "quality", "test"],
  },
  {
    href: "/stakeholder-workbench",
    label: "Stakeholder",
    description: "Release readiness, UAT sign-off, CAB approval, and Confluence publishing",
    accent: "border-white/10 hover:bg-white/5",
    badge: "Stage 4",
    badgeColor: "bg-slate-700 text-slate-400",
    agentKeywords: ["stakeholder", "release", "uat"],
  },
  {
    href: "/ai-workforce-dashboard",
    label: "Fleet Command",
    description: "Live agent roster, attention queue, autonomy budget controls, and SLA monitoring",
    accent: "border-teal-500/20 hover:bg-teal-500/5",
    badge: "Intelligence",
    badgeColor: "bg-teal-500/10 text-teal-400",
    agentKeywords: [],
  },
  {
    href: "/vsm-dashboard",
    label: "VSM Dashboard",
    description: "DORA four keys, stage cycle times, deployment history, and incident feed",
    accent: "border-violet-500/20 hover:bg-violet-500/5",
    badge: "Analytics",
    badgeColor: "bg-violet-500/10 text-violet-400",
    agentKeywords: [],
  },
  {
    href: "/devops-workbench",
    label: "DevOps Workbench",
    description: "Deployments, incidents, reliability signals, and runbook automation",
    accent: "border-white/10 hover:bg-white/5",
    badge: "Engineering",
    badgeColor: "bg-slate-700 text-slate-400",
    agentKeywords: ["devops", "release manager", "sre"],
  },
  {
    href: "/ops-workbench",
    label: "Ops Workbench",
    description: "Operational dashboards, runbooks, and cross-team coordination",
    accent: "border-white/10 hover:bg-white/5",
    badge: "Operations",
    badgeColor: "bg-slate-700 text-slate-400",
    agentKeywords: ["operations", "coordinator"],
  },
  {
    href: "/sales-workbench",
    label: "Sales Workbench",
    description: "Pipeline stages, deal tracking, and forecast with an AI sales co-pilot",
    accent: "border-emerald-500/20 hover:bg-emerald-500/5",
    badge: "Revenue",
    badgeColor: "bg-emerald-500/10 text-emerald-400",
    agentKeywords: ["sales", "account executive"],
  },
  {
    href: "/marketing-workbench",
    label: "Marketing Workbench",
    description: "Campaign management, content pipeline, and demand-gen analytics",
    accent: "border-pink-500/20 hover:bg-pink-500/5",
    badge: "Growth",
    badgeColor: "bg-pink-500/10 text-pink-400",
    agentKeywords: ["marketing", "content"],
  },
  {
    href: "/customer-success-workbench",
    label: "Customer Success",
    description: "Onboarding progress, account health, and retention playbooks",
    accent: "border-cyan-500/20 hover:bg-cyan-500/5",
    badge: "Retention",
    badgeColor: "bg-cyan-500/10 text-cyan-400",
    agentKeywords: ["customer success", "csm"],
  },
  {
    href: "/finance-workbench",
    label: "Finance Workbench",
    description: "Budgets, revenue recognition, and spend governance",
    accent: "border-amber-500/20 hover:bg-amber-500/5",
    badge: "Finance",
    badgeColor: "bg-amber-500/10 text-amber-400",
    agentKeywords: ["finance", "controller"],
  },
  {
    href: "/hr-workbench",
    label: "HR Workbench",
    description: "Hiring pipeline, onboarding, and people operations",
    accent: "border-indigo-500/20 hover:bg-indigo-500/5",
    badge: "People",
    badgeColor: "bg-indigo-500/10 text-indigo-400",
    agentKeywords: ["hr", "recruiter", "people ops"],
  },
  {
    href: "/legal-workbench",
    label: "Legal Workbench",
    description: "Contract management, compliance review, and clause analysis",
    accent: "border-rose-500/20 hover:bg-rose-500/5",
    badge: "Compliance",
    badgeColor: "bg-rose-500/10 text-rose-400",
    agentKeywords: ["legal", "counsel", "compliance"],
  },
  {
    href: "/security",
    label: "Security Auditor",
    description: "Autonomous commit monitoring, data flow tracing, and automated patch PRs",
    accent: "border-red-500/30 hover:bg-red-500/5",
    badge: "Security",
    badgeColor: "bg-red-500/10 text-red-400",
    agentKeywords: ["security", "auditor"],
  },
];

export default function Home() {
  const [hilRequests, setHilRequests] = useState<HilRequest[]>([]);
  const [fleetWorkload, setFleetWorkload] = useState<FleetWorkload | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [embedded, setEmbedded] = useState(false);

  async function loadData() {
    try {
      const [hilResult, fleetResult] = await Promise.allSettled([hil.pending(), fleet.workload()]);
      if (hilResult.status === "fulfilled") setHilRequests(hilResult.value || []);
      if (fleetResult.status === "fulfilled") {
        setFleetWorkload(fleetResult.value);
        setFleetError(null);
      } else {
        setFleetError(fleetResult.reason instanceof Error ? fleetResult.reason.message : "Fleet workload is unavailable");
      }
      // Counts reflect durable offers for this room, not organization-wide browser notifications.
      try {
        const pending = (await handoffs.list()).items;
        const counts: Record<string, number> = {};
        for (const item of pending) if (item.handoff.status === 'offered') counts[`/${item.handoff.target}`] = (counts[`/${item.handoff.target}`] ?? 0) + 1;
        setUnreadCounts(counts);
      } catch { setUnreadCounts({}); }
    } catch (err) {
      console.error("Error loading SDLC Hub data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setEmbedded(isEmbedded());
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  function handleHilResolved(ids: string[]) {
    setHilRequests(prev => prev.filter(r => !ids.includes(r.id)));
  }

  // Helper to determine agent status for a given workbench card
  function getAgentStatus(keywords: string[]) {
    if (!fleetWorkload || keywords.length === 0) return null;
    const matchingAgents = fleetWorkload.agents.filter(a =>
      keywords.some(kw => a.agent.toLowerCase().includes(kw) || a.mission.toLowerCase().includes(kw))
    );

    if (matchingAgents.some(a => a.status === "active")) {
      return { status: "active", text: "Agent Thinking..." };
    }
    if (matchingAgents.some(a => a.status === "waiting" || a.status === "blocked")) {
      return { status: "waiting", text: "Awaiting Action" };
    }
    if (matchingAgents.length > 0) {
      return { status: "idle", text: "Agent Idle" };
    }
    return null;
  }

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden h-screen">
      <div className="min-h-screen min-w-0 bg-[#090d16] text-white p-4 sm:p-8 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-blue-400 via-teal-400 to-indigo-400 bg-clip-text text-transparent">
              Enterprise Hybrid AI SDLC
            </h1>
            <p className="text-sm text-slate-400">
              End-to-end development lifecycle — human operators and AI agents working in concert.
            </p>
          </div>
          {fleetWorkload?.summary && (
            <div className="flex flex-wrap items-center gap-4 bg-white/5 border border-white/5 rounded-xl p-4 text-xs">
              <div>
                <span className="text-slate-500 block">Active mission runs</span>
                <span className="text-base font-bold text-teal-400">{fleetWorkload.summary.active}</span>
              </div>
              <div className="border-l border-white/10 pl-4">
                <span className="text-slate-500 block">Blocked/HIL</span>
                <span className="text-base font-bold text-amber-400">{fleetWorkload.summary.blocked}</span>
              </div>
              <div className="border-l border-white/10 pl-4">
                <span className="text-slate-500 block">Completed</span>
                <span className="text-base font-bold text-green-400">{fleetWorkload.summary.completed}</span>
              </div>
              {embedded && (
                <button
                  type="button"
                  onClick={() => triggerCycle("SDLC Workbench requested a fresh cycle run", { source: "sdlc-hub" })}
                  className="rounded-lg border border-teal-400/30 bg-teal-500/10 px-3 py-2 text-xs font-semibold text-teal-100 hover:bg-teal-500/20"
                >
                  Prepare cycle request
                </button>
              )}
            </div>
          )}
          {!fleetWorkload?.summary && embedded && (
            <button
              type="button"
              onClick={() => triggerCycle("SDLC Workbench requested a fresh cycle run", { source: "sdlc-hub" })}
              className="rounded-lg border border-teal-400/30 bg-teal-500/10 px-3 py-2 text-xs font-semibold text-teal-100 hover:bg-teal-500/20"
            >
              Prepare cycle request
            </button>
          )}
        </div>

        <CycleStepBanner />

        <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${fleetError ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : "border-emerald-500/20 bg-emerald-500/5 text-emerald-100"}`} role="status">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold">{fleetError ? "Human workflows available · agent telemetry degraded" : "Hybrid-team telemetry connected"}</div>
              <div className="mt-1 text-xs opacity-75">
                {fleetError ? `${fleetError}. Workbench records and approvals remain available.` : `Fleet workload updated ${fleetWorkload?.generatedAt ? new Date(fleetWorkload.generatedAt).toLocaleTimeString() : "just now"}.`}
              </div>
            </div>
            {fleetError && <button type="button" onClick={loadData} className="self-start rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-semibold hover:bg-amber-400/10">Retry telemetry</button>}
          </div>
        </div>

        {/* Decision Queue */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
            <span>📥</span> App Requests
            {hilRequests.length > 0 && (
              <span className="bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full text-[10px] font-bold">
                {hilRequests.length} Pending
              </span>
            )}
          </h2>
          <BulkApproval onResolved={handleHilResolved} />
        </div>

        {/* Workbench Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {WORKBENCHES.map(({ href, label, description, accent, badge, badgeColor, agentKeywords }) => {
            const agentStatus = getAgentStatus(agentKeywords);
            const unreadCount = unreadCounts[href] || 0;
            return (
              <Link
                key={href}
                href={href}
                className={`group p-5 border rounded-xl transition-all duration-150 bg-white/3 flex flex-col justify-between ${accent}`}
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-white group-hover:text-white">{label}</h2>
                      {unreadCount > 0 && (
                        <span title="Offers in the latest handoff page. Open Stage handoffs for older history." className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-500 text-white text-[10px] font-bold leading-none">
                          {unreadCount}
                        </span>
                      )}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>{badge}</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed mb-4">{description}</p>
                </div>
                {agentStatus && (
                  <div className="flex items-center gap-2 pt-3 border-t border-white/5 text-[10px]">
                    <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                      agentStatus.status === "active" ? "bg-teal-400" :
                      agentStatus.status === "waiting" ? "bg-amber-400" : "bg-slate-500"
                    }`} />
                    <span className="text-slate-400 font-medium">{agentStatus.text}</span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>

        <div className="mt-8 pt-6 border-t border-white/5">
          <p className="text-[11px] text-slate-600 text-center font-mono">
            Oddjob Enterprise Hybrid AI SDLC · Verify sources and prerequisites before execution
          </p>
        </div>
      </div>
    </div>
      <ActivityFeed position="sidebar" />
    </div>
  );
}
