"use client";
import { useState, useEffect, useCallback } from "react";
import { records, events, telemetry } from "../../lib/platform-client";
import type { AppRecord } from "../../lib/platform-client";

// ── Collection names ──────────────────────────────────────────────────────────
const COL = {
  SIGNOFFS:     "pm_workbench_signoffs",
  CAPACITY:     "scrum_workbench_capacity_plans",
  QUALITY_GATES:"qa_workbench_quality_gates",
  CAB_APPROVALS:"stakeholder_workbench_cab_approvals",
  DEPLOYMENTS:  "deployments",
  INCIDENTS:    "incidents",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────
interface Signoff    extends AppRecord { jiraKey: string; timestamp: string; prdStatus: string; }
interface Capacity   extends AppRecord { sprintNum: number; timestamp: string; }
interface QualityGate extends AppRecord { result: "pass" | "fail"; timestamp: string; }
interface CabApproval extends AppRecord { decision: string; timestamp: string; }
interface Deployment  extends AppRecord { env: string; version: string; status: string; timestamp: string; }
interface Incident    extends AppRecord { severity: string; status: string; timestamp: string; component: string; }

interface AllData {
  signoffs:     Signoff[];
  capacity:     Capacity[];
  qualityGates: QualityGate[];
  cabApprovals: CabApproval[];
  deployments:  Deployment[];
  incidents:    Incident[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function relativeTime(ts: string): string {
  const diffMs = Date.now() - new Date(ts).getTime();
  if (isNaN(diffMs) || diffMs < 0) return "just now";
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function hoursApart(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
}

function thirtyDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d;
}

/** Find the next deployment after a given timestamp. Returns undefined if none. */
function nextDeploymentAfter(ts: string, deployments: Deployment[]): Deployment | undefined {
  const t = new Date(ts).getTime();
  return deployments
    .filter(d => new Date(d.timestamp).getTime() > t)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
}

/** Average of a number array, or null if empty. */
function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ── DORA computation ──────────────────────────────────────────────────────────
interface DoraMetrics {
  deployFreq:       number;   // per day, last 30d
  changeFailRate:   number | null;   // percentage, last 30d
  mttr:             number | null; // hours
  leadTime:         number | null; // hours
}

export function computeDora(data: AllData): DoraMetrics {
  const cutoff = thirtyDaysAgo();
  const recentDeploys = data.deployments.filter(d => new Date(d.timestamp) >= cutoff && d.env === "production" && d.status === "success");
  const recentIncidents = data.incidents.filter(i => new Date(i.timestamp) >= cutoff);

  const deployFreq     = +(recentDeploys.length / 30).toFixed(1);
  const linkedFailures = new Set(recentIncidents.map(i => i.deploymentId).filter(id => typeof id === "string"));
  const changeFailRate = recentDeploys.length > 0 && recentIncidents.every(i => typeof i.deploymentId === "string")
    ? +(recentDeploys.filter(d => linkedFailures.has(d.id)).length / recentDeploys.length * 100).toFixed(1)
    : null;

  // Recovery requires incident resolution evidence, not an unrelated next deployment.
  const mttr = avg(recentIncidents.filter(i => i.status === "resolved" && typeof i.resolvedAt === "string")
    .map(i => hoursApart(i.timestamp, String(i.resolvedAt))).filter(Number.isFinite));
  const leadTime = avg(data.signoffs.flatMap(so => {
    if (typeof so.changeId !== "string") return [];
    const deployment = data.deployments.find(d => d.changeId === so.changeId && d.status === "success");
    const start = so.timestamp || String(so.submittedAt ?? "");
    return deployment && Date.parse(deployment.timestamp) >= Date.parse(start) ? [hoursApart(start, deployment.timestamp)] : [];
  }).filter(Number.isFinite));
  return { deployFreq, changeFailRate, mttr, leadTime };
}

// ── Stage cycle time computation ──────────────────────────────────────────────
interface StageTime { label: string; hours: number | null; }

export function computeStageTimes(data: AllData): StageTime[] {
  // Stage timing requires explicit, correlated handoff timestamps. Never pair neighboring unrelated records.
  const stages = [
    ["PM → Dev", "requirementsAcceptedAt", "developmentStartedAt"],
    ["Dev → QA", "developmentCompletedAt", "qaStartedAt"],
    ["QA → CAB", "qaPassedAt", "cabApprovedAt"],
    ["CAB → Deploy", "cabApprovedAt", "deployedAt"],
  ];
  return stages.map(([label, start, end]) => ({ label, hours: avg(data.deployments.flatMap(d => {
    if (typeof d.changeId !== "string" || typeof d[start] !== "string" || typeof d[end] !== "string") return [];
    return Date.parse(String(d[end])) >= Date.parse(String(d[start])) ? [hoursApart(String(d[start]), String(d[end]))] : [];
  }).filter(Number.isFinite)) }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
      {children}
    </h2>
  );
}

function SkeletonBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 bg-white/5 rounded animate-pulse" />
      ))}
    </div>
  );
}

function DoraCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: "emerald" | "amber" | "rose" | "blue";
}) {
  const colorMap = {
    emerald: "text-emerald-400",
    amber:   "text-amber-400",
    rose:    "text-rose-400",
    blue:    "text-blue-400",
  } as const;
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{label}</div>
      <div className={`text-2xl font-bold ${colorMap[color]} mb-1`}>{value}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}

function HeatmapBar({ stages, loading }: { stages: StageTime[]; loading: boolean }) {
  if (loading) return <SkeletonBlock rows={4} />;

  const maxHours = Math.max(
    1,
    ...stages.filter(s => s.hours !== null).map(s => s.hours as number)
  );

  function barColor(h: number): string {
    if (h < 24)  return "bg-emerald-500";
    if (h <= 72) return "bg-amber-500";
    return "bg-rose-500";
  }

  function formatHours(h: number): string {
    if (h < 1)  return `${Math.round(h * 60)}m`;
    if (h < 24) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
  }

  return (
    <div className="space-y-3">
      {stages.map(stage => (
        <div key={stage.label}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-300">{stage.label}</span>
            <span className="text-xs font-mono text-slate-400">
              {stage.hours === null ? "No data" : formatHours(stage.hours)}
            </span>
          </div>
          {stage.hours === null ? (
            <div className="h-2 rounded-full bg-white/5 flex items-center">
              <span className="text-[10px] text-slate-600 ml-2">—</span>
            </div>
          ) : (
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor(stage.hours)}`}
                style={{ width: `${Math.max(2, (stage.hours / maxHours) * 100)}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === "success" || s === "deployed" || s === "completed"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
      : s === "failed" || s === "error"
      ? "bg-rose-500/15 text-rose-400 border-rose-500/20"
      : s === "in_progress" || s === "rolling"
      ? "bg-blue-500/15 text-blue-400 border-blue-500/20"
      : "bg-slate-700/50 text-slate-400 border-white/10";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cls}`}>
      {status}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls =
    severity === "SEV-1"
      ? "bg-rose-500/20 text-rose-400 border-rose-500/30"
      : severity === "SEV-2"
      ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
      : "bg-slate-700/50 text-slate-400 border-white/10";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${cls}`}>
      {severity}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VsmDashboardContent() {
  const [data,    setData]    = useState<AllData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [signoffs, capacity, qualityGates, cabApprovals, deployments, incidents] =
        await Promise.all([
          records.list(COL.SIGNOFFS),
          records.list(COL.CAPACITY),
          records.list(COL.QUALITY_GATES),
          records.list(COL.CAB_APPROVALS),
          records.list(COL.DEPLOYMENTS),
          records.list(COL.INCIDENTS),
        ]);
      setError(null);
      setData({
        signoffs:     signoffs     as Signoff[],
        capacity:     capacity     as Capacity[],
        qualityGates: qualityGates as QualityGate[],
        cabApprovals: cabApprovals as CabApproval[],
        deployments:  deployments  as Deployment[],
        incidents:    incidents    as Incident[],
      });
      telemetry.emit("vsm_dashboard_loaded", "info", {
        signoffs:     signoffs.length,
        deployments:  deployments.length,
        incidents:    incidents.length,
      });
    } catch (e: any) {
      setData(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const unsub = events.subscribe((event) => {
      if (event.type === "mission.completed" || event.type === "cycle.status_changed") {
        fetchAll();
      }
    });
    return unsub;
  }, [fetchAll]);

  // ── Derived metrics ─────────────────────────────────────────────────────────
  const dora   = data ? computeDora(data)           : null;
  const stages = data ? computeStageTimes(data)      : [];

  const recentDeployments = data
    ? [...data.deployments]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10)
    : [];

  const recentGates = data
    ? [...data.qualityGates]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10)
    : [];

  const recentIncidents = data
    ? [...data.incidents]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10)
    : [];

  const failRate = recentGates.length > 0
    ? Math.round((recentGates.filter(g => g.result === "fail").length / recentGates.length) * 100)
    : 0;

  // ── DORA card helpers ────────────────────────────────────────────────────────
  function doraFreqColor(): "emerald" | "amber" | "rose" {
    if (!dora) return "amber";
    if (dora.deployFreq >= 1)   return "emerald";
    if (dora.deployFreq >= 0.1) return "amber";
    return "rose";
  }

  function doraCfrColor(): "emerald" | "amber" | "rose" {
    if (!dora || dora.changeFailRate === null) return "amber";
    if (dora.changeFailRate <= 15) return "emerald";
    if (dora.changeFailRate <= 30) return "amber";
    return "rose";
  }

  function doraMttrColor(): "emerald" | "amber" | "rose" {
    if (!dora || dora.mttr === null) return "amber";
    if (dora.mttr <= 1)  return "emerald";
    if (dora.mttr <= 24) return "amber";
    return "rose";
  }

  function doraLeadColor(): "emerald" | "amber" | "rose" {
    if (!dora || dora.leadTime === null) return "amber";
    if (dora.leadTime <= 24)  return "emerald";
    if (dora.leadTime <= 168) return "amber";
    return "rose";
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/20">
            SDLC
          </span>
          <h1 className="text-2xl font-bold">VSM Dashboard: Value Stream Metrics</h1>
          {!loading && data && (
            <span className="ml-auto text-[10px] text-slate-600">
              {data.deployments.length} deployments · {data.incidents.length} incidents
            </span>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-6 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* DORA Four Keys ─────────────────────────────────────────────────── */}
        <div className="mb-6">
          <SectionHeader>DORA Four Keys — last 30 days</SectionHeader>
          {loading ? (
            <div className="grid grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-24 bg-white/5 border border-white/10 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              <DoraCard
                label="Deployment Frequency"
                value={dora ? `${dora.deployFreq}/d` : "—"}
                sub="successful production deployments per day"
                color={doraFreqColor()}
              />
              <DoraCard
                label="Change Failure Rate"
                value={dora && dora.changeFailRate !== null ? `${dora.changeFailRate}%` : "—"}
                sub="production deployments linked to incidents"
                color={doraCfrColor()}
              />
              <DoraCard
                label="MTTR"
                value={dora && dora.mttr !== null ? `${dora.mttr.toFixed(1)}h` : "—"}
                sub="mean time to restore"
                color={doraMttrColor()}
              />
              <DoraCard
                label="Lead Time for Changes"
                value={dora && dora.leadTime !== null ? `${dora.leadTime.toFixed(1)}h` : "—"}
                sub="PM sign-off → deploy"
                color={doraLeadColor()}
              />
            </div>
          )}
        </div>

        {/* Main 3-column grid ───────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-4">

          {/* LEFT — Stage Cycle Time Heatmap */}
          <div className="col-span-1 bg-white/5 border border-white/10 rounded-xl p-4">
            <SectionHeader>Stage Cycle Time</SectionHeader>
            <p className="text-[10px] text-slate-600 mb-4">Avg time between SDLC stage transitions</p>
            <HeatmapBar stages={stages} loading={loading} />
            {!loading && (
              <div className="mt-4 pt-3 border-t border-white/5 flex gap-3 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />{"< 24h"}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500  inline-block" />24–72h</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500   inline-block" />{"> 72h"}</span>
              </div>
            )}
          </div>

          {/* CENTRE — Deployment History */}
          <div className="col-span-1 bg-white/5 border border-white/10 rounded-xl p-4">
            <SectionHeader>Deployment History</SectionHeader>
            {loading ? (
              <SkeletonBlock rows={5} />
            ) : recentDeployments.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No deployments recorded yet.</p>
            ) : (
              <div className="space-y-1.5">
                {recentDeployments.map(d => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/3 border border-white/5"
                  >
                    <StatusBadge status={d.status} />
                    <span className="text-xs font-mono text-slate-300 flex-1 truncate" title={d.version}>
                      {d.version}
                    </span>
                    <span className="text-[10px] text-slate-500 flex-shrink-0">{d.env}</span>
                    <span className="text-[10px] text-slate-600 flex-shrink-0">{relativeTime(d.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT column — QA History + Incident Feed stacked */}
          <div className="col-span-1 space-y-4">

            {/* QA Quality Gate History */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <SectionHeader>Quality Gate History</SectionHeader>
                {!loading && recentGates.length > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    failRate === 0
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : failRate <= 25
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  }`}>
                    {failRate}% fail
                  </span>
                )}
              </div>
              {loading ? (
                <SkeletonBlock rows={4} />
              ) : recentGates.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No quality gates recorded.</p>
              ) : (
                <div className="space-y-1.5">
                  {recentGates.map(g => (
                    <div
                      key={g.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/3 border border-white/5"
                    >
                      <span className={`text-xs font-bold flex-shrink-0 ${
                        g.result === "pass" ? "text-emerald-400" : "text-rose-400"
                      }`}>
                        {g.result === "pass" ? "✓ Pass" : "✗ Fail"}
                      </span>
                      <span className="text-[10px] text-slate-600 ml-auto flex-shrink-0">
                        {relativeTime(g.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Incident Feed */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <SectionHeader>Incident Feed</SectionHeader>
              {loading ? (
                <SkeletonBlock rows={4} />
              ) : recentIncidents.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No incidents recorded.</p>
              ) : (
                <div className="space-y-1.5">
                  {recentIncidents.map(inc => (
                    <div
                      key={inc.id}
                      className="px-2.5 py-2 rounded-lg bg-white/3 border border-white/5"
                    >
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={inc.severity} />
                        <span className="text-xs text-slate-300 flex-1 truncate" title={inc.component}>
                          {inc.component}
                        </span>
                        <span className={`text-[10px] flex-shrink-0 ${
                          inc.status === "resolved" ? "text-emerald-400" : "text-rose-400"
                        }`}>
                          {inc.status}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-600 mt-0.5 ml-px">
                        {relativeTime(inc.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
