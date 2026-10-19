import React, { useState, useEffect, useCallback } from "react";
import {
  Rocket,
  ShieldAlert,
  Server,
  PlayCircle,
  RefreshCw,
  CheckCircle2,
  Activity,
  Database,
  Cloud,
  Lock,
  AlertTriangle,
  XCircle,
  Clock,
  Users,
  Zap,
  Bot,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AgentChat } from "../components/AgentChat";
import { IncidentTriagerWidget } from "../components/IncidentTriagerWidget";
import {
  records,
  fleet,
  missions,
  integrations,
  knowledge,
  telemetry,
  events,
  type DeploymentRecord,
  type CabApprovalRecord,
  type IacChangeRecord,
  type FleetWorkload,
  type PlatformEvent,
} from "../lib/platform-client";

// ── Inline sub-components ─────────────────────────────────────────────────────

function Header({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <header className="border-b border-white/5 bg-[#0d1117]/80 backdrop-blur-md sticky top-0 z-20">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-8 py-4 flex items-center gap-3">
        <div className="p-2 bg-orange-500/10 rounded-lg">{icon}</div>
        <div>
          <h1 className="text-lg font-bold text-white leading-tight">{title}</h1>
          <p className="text-xs text-slate-500 leading-tight">{subtitle}</p>
        </div>
      </div>
    </header>
  );
}

function StatCard({
  title,
  value,
  icon,
  trend,
  loading = false,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</span>
        <span className="p-1.5 bg-white/5 rounded-lg">{icon}</span>
      </div>
      {loading ? (
        <div className="h-8 w-16 bg-slate-700/50 rounded animate-pulse" />
      ) : (
        <div className="text-2xl font-bold text-white">{value}</div>
      )}
      {trend && <div className="text-xs text-slate-500 mt-1">{trend}</div>}
    </div>
  );
}

function Table({
  headers,
  data,
  loading = false,
  emptyMessage = "No records found.",
}: {
  headers: string[];
  data: (string | React.ReactNode)[][];
  loading?: boolean;
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="w-full text-left">
        <thead className="bg-[#0d1117]/60">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <tr key={i} className="border-t border-white/5">
                {headers.map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-slate-700/40 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-center text-sm text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, ri) => (
              <tr key={ri} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-4 py-3 text-sm text-slate-300">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Status badge helpers ──────────────────────────────────────────────────────

function StatusBadge({ value }: { value: string }) {
  const v = (value ?? "").toLowerCase();
  let cls = "bg-slate-500/20 text-slate-400";
  if (v === "deployed" || v === "success" || v === "ready") cls = "bg-emerald-500/20 text-emerald-400";
  else if (v === "deploying" || v === "running" || v === "pending") cls = "bg-blue-500/20 text-blue-400";
  else if (v === "failed" || v === "error") cls = "bg-red-500/20 text-red-400";
  else if (v === "pending window" || v === "waiting") cls = "bg-amber-500/20 text-amber-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${cls}`}>
      {value}
    </span>
  );
}

function RiskBadge({ value }: { value: string }) {
  const v = (value ?? "").toLowerCase();
  let cls = "bg-slate-500/20 text-slate-400";
  if (v === "low") cls = "bg-emerald-500/20 text-emerald-400";
  else if (v === "medium") cls = "bg-amber-500/20 text-amber-400";
  else if (v === "high") cls = "bg-red-500/20 text-red-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${cls}`}>
      {value}
    </span>
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return ts;
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DevOpsWorkbench() {
  // Tab state
  const [activeTab, setActiveTab] = useState<"deployments" | "cab" | "infrastructure" | "incidents">("deployments");

  // Data state
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [cabApprovals, setCabApprovals] = useState<CabApprovalRecord[]>([]);
  const [iacChanges, setIacChanges] = useState<IacChangeRecord[]>([]);
  const [fleetWorkload, setFleetWorkload] = useState<FleetWorkload | null>(null);

  // Loading / error state per collection
  const [loadingDeployments, setLoadingDeployments] = useState(true);
  const [loadingCab, setLoadingCab] = useState(true);
  const [loadingIac, setLoadingIac] = useState(true);
  const [loadingFleet, setLoadingFleet] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Deploy form state
  const [deployEnv, setDeployEnv] = useState("production");
  const [deployVersion, setDeployVersion] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{ runId: string | number } | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchDeployments = useCallback(async () => {
    setLoadingDeployments(true);
    try {
      const data = await records.list<DeploymentRecord>("deployments");
      // Sort descending by timestamp — most recent first.
      setDeployments(
        [...data].sort(
          (a, b) =>
            new Date(b.timestamp ?? b._createdAt).getTime() -
            new Date(a.timestamp ?? a._createdAt).getTime()
        )
      );
    } catch (err) {
      console.error("Failed to fetch deployments:", err);
      setFetchError("Failed to load deployments.");
    } finally {
      setLoadingDeployments(false);
    }
  }, []);

  const fetchCabApprovals = useCallback(async () => {
    setLoadingCab(true);
    try {
      const data = await records.list<CabApprovalRecord>("stakeholder_workbench_cab_approvals");
      // Sort descending — latest decision first.
      setCabApprovals(
        [...data].sort(
          (a, b) =>
            new Date(b._updatedAt ?? b._createdAt).getTime() -
            new Date(a._updatedAt ?? a._createdAt).getTime()
        )
      );
    } catch (err) {
      console.error("Failed to fetch CAB approvals:", err);
      setCabApprovals([]);
    } finally {
      setLoadingCab(false);
    }
  }, []);

  const fetchIacChanges = useCallback(async () => {
    setLoadingIac(true);
    try {
      const data = await records.list<IacChangeRecord>("iac_changes");
      setIacChanges(data);
    } catch {
      // Graceful empty state — IaC changes are optional.
      setIacChanges([]);
    } finally {
      setLoadingIac(false);
    }
  }, []);

  const fetchFleet = useCallback(async () => {
    setLoadingFleet(true);
    try {
      const data = await fleet.workload();
      setFleetWorkload(data);
    } catch (err) {
      console.error("Failed to fetch fleet workload:", err);
      setFleetWorkload(null);
    } finally {
      setLoadingFleet(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchDeployments();
    fetchCabApprovals();
    fetchIacChanges();
    fetchFleet();
  }, [fetchDeployments, fetchCabApprovals, fetchIacChanges, fetchFleet]);

  // Initial load
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // SSE subscription — refresh on relevant platform events
  useEffect(() => {
    const unsubscribe = events.subscribe((event: PlatformEvent) => {
      const refreshTriggers = new Set([
        "mission.completed",
        "mission.status_changed",
        "cycle.status_changed",
      ]);
      if (refreshTriggers.has(event.type)) {
        refreshAll();
      }
    });
    return unsubscribe;
  }, [refreshAll]);

  // ── Deploy handler ──────────────────────────────────────────────────────────

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deployVersion.trim()) return;

    setIsDeploying(true);
    setDeployError(null);
    setDeployResult(null);

    try {
      // 1. Ground the deployment in knowledge — fetch runbook context.
      let runbookContext: unknown[] = [];
      try {
        const kb = await knowledge.query(
          "production deployment runbook rollback procedures",
          3
        );
        runbookContext = kb.results ?? [];
      } catch {
        // Non-fatal — proceed without runbook context.
      }

      // 2. Create the deployment record.
      const record = await records.create("deployments", {
        env: deployEnv,
        version: deployVersion.trim(),
        triggeredBy: "operator",
        status: "deploying",
        timestamp: new Date().toISOString(),
      });

      // 3. Trigger the deployment mission with full context.
      const result = await missions.trigger("Production Deployment", {
        env: deployEnv,
        version: deployVersion.trim(),
        manual: true,
        recordId: record.id,
        runbookContext,
      });

      // 4. Post a Slack notification (fire-and-forget).
      integrations.slack
        .post({
          message: `🚀 Manual deployment triggered: ${deployVersion.trim()} → ${deployEnv}`,
        })
        .catch(() => {});

      // 5. Emit telemetry.
      telemetry.emit("deployment.triggered", "info", {
        env: deployEnv,
        version: deployVersion.trim(),
        runId: result.runId,
      });

      setDeployResult({ runId: result.runId });

      // Refresh deployment list so the new record appears.
      fetchDeployments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deployment failed. Please try again.";
      setDeployError(msg);
    } finally {
      setIsDeploying(false);
    }
  };

  // ── Derived stats ───────────────────────────────────────────────────────────

  const activeDeployments = deployments.filter(
    (d) => d.status === "deploying" || d.status === "running"
  ).length;

  const latestCab = cabApprovals[0] ?? null;

  const iacHighRisk = iacChanges.filter(
    (c) => (c.risk ?? "").toLowerCase() === "high"
  ).length;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 font-sans selection:bg-orange-500/30">
      <Header
        title="DevOps & Release Workbench"
        subtitle="Manage CI/CD pipelines, review Infrastructure as Code, and monitor CAB approval status."
        icon={<Rocket className="w-6 h-6 text-orange-400" />}
      />

      <main className="max-w-[1600px] mx-auto p-6 lg:p-8">
        {/* ── Stat cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Active Deployments"
            value={loadingDeployments ? "—" : activeDeployments}
            icon={<Activity className="w-4 h-4 text-blue-400" />}
            trend={loadingDeployments ? undefined : `${deployments.length} total`}
            loading={loadingDeployments}
          />
          <StatCard
            title="CAB Decision"
            value={
              loadingCab
                ? "—"
                : latestCab
                ? String(latestCab.decision ?? "—").charAt(0).toUpperCase() +
                  String(latestCab.decision ?? "—").slice(1)
                : "None"
            }
            icon={<ShieldAlert className="w-4 h-4 text-orange-400" />}
            trend={latestCab ? formatTimestamp(latestCab._updatedAt ?? latestCab._createdAt) : undefined}
            loading={loadingCab}
          />
          <StatCard
            title="IaC Changes"
            value={loadingIac ? "—" : iacChanges.length}
            icon={<Cloud className="w-4 h-4 text-purple-400" />}
            trend={
              loadingIac
                ? undefined
                : iacHighRisk > 0
                ? `${iacHighRisk} high-risk`
                : "No high-risk changes"
            }
            loading={loadingIac}
          />
          <StatCard
            title="Agents Active"
            value={
              loadingFleet ? "—" : fleetWorkload?.summary?.active ?? 0
            }
            icon={<Users className="w-4 h-4 text-emerald-400" />}
            trend={
              fleetWorkload
                ? `${fleetWorkload.summary?.blocked ?? 0} blocked`
                : undefined
            }
            loading={loadingFleet}
          />
        </div>

        {/* ── Main grid ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Tab bar */}
            <div className="flex border-b border-white/10">
              {(
                [
                  { id: "deployments", label: "Deployments" },
                  { id: "cab", label: "CAB Approvals" },
                  { id: "infrastructure", label: "Infrastructure" },
                  { id: "incidents", label: "Incident Replay" },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`px-6 py-3 text-sm font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                    activeTab === id
                      ? "border-orange-500 text-orange-400"
                      : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}

              {/* Refresh button */}
              <button
                onClick={refreshAll}
                title="Refresh all data"
                className="ml-auto px-3 py-3 text-slate-500 hover:text-slate-300 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {fetchError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {fetchError}
              </div>
            )}

            <AnimatePresence mode="wait">
              {/* ── Deployments tab ─────────────────────────────────────── */}
              {activeTab === "deployments" && (
                <motion.div
                  key="deployments"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className="space-y-6"
                >
                  {/* Deploy form */}
                  <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6">
                    <div className="flex items-center gap-2 text-orange-400 mb-4">
                      <PlayCircle className="w-5 h-5" />
                      <h3 className="font-semibold text-lg">Trigger Manual Deployment</h3>
                    </div>

                    {/* Success state */}
                    {deployResult ? (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg p-4 flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold">Deployment Triggered Successfully</div>
                          <div className="text-xs text-emerald-400/80 mt-0.5">
                            Mission run ID: <span className="font-mono">{deployResult.runId}</span>
                            {" · "}Version{" "}
                            <span className="font-mono">{deployVersion}</span> is deploying to{" "}
                            <span className="font-semibold">{deployEnv}</span>.
                          </div>
                          <button
                            className="mt-3 text-xs underline text-emerald-400/70 hover:text-emerald-400 transition-colors"
                            onClick={() => {
                              setDeployResult(null);
                              setDeployVersion("");
                            }}
                          >
                            Trigger another deployment
                          </button>
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handleDeploy} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                              Target Environment
                            </label>
                            <select
                              title="Target Environment"
                              value={deployEnv}
                              onChange={(e) => setDeployEnv(e.target.value)}
                              disabled={isDeploying}
                              className="w-full bg-slate-900 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-orange-500 disabled:opacity-50"
                            >
                              <option value="production">Production</option>
                              <option value="staging">Staging</option>
                              <option value="development">Development</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                              Version Tag
                            </label>
                            <input
                              type="text"
                              value={deployVersion}
                              onChange={(e) => setDeployVersion(e.target.value)}
                              placeholder="e.g. v1.4.2-rc.1"
                              disabled={isDeploying}
                              required
                              className="w-full bg-slate-900 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-orange-500 placeholder:text-slate-600 disabled:opacity-50"
                            />
                          </div>
                        </div>

                        {deployError && (
                          <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
                            <XCircle className="w-4 h-4 shrink-0" />
                            {deployError}
                          </div>
                        )}

                        <button
                          type="submit"
                          disabled={isDeploying || !deployVersion.trim()}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors"
                        >
                          {isDeploying ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              Preparing deployment…
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4" />
                              Initiate Deployment
                            </>
                          )}
                        </button>

                        {isDeploying && (
                          <p className="text-xs text-slate-500 text-center">
                            Querying runbook knowledge · Creating record · Triggering mission
                          </p>
                        )}
                      </form>
                    )}
                  </div>

                  {/* Deployment history */}
                  <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6">
                    <h3 className="font-semibold text-slate-300 mb-4 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-500" />
                      Deployment History
                    </h3>
                    <Table
                      headers={["Environment", "Version", "Triggered By", "Status", "Timestamp"]}
                      data={deployments.map((d) => [
                        d.env ?? "—",
                        <span key="v" className="font-mono text-orange-300 text-xs">{d.version ?? "—"}</span>,
                        d.triggeredBy ?? "—",
                        <StatusBadge key="s" value={d.status ?? "unknown"} />,
                        formatTimestamp(d.timestamp ?? d._createdAt),
                      ])}
                      loading={loadingDeployments}
                      emptyMessage="No deployments recorded yet."
                    />
                  </div>
                </motion.div>
              )}

              {/* ── CAB Approvals tab ───────────────────────────────────── */}
              {activeTab === "cab" && (
                <motion.div
                  key="cab"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                >
                  <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6">
                    <div className="flex items-center gap-2 text-orange-400 mb-6">
                      <Lock className="w-5 h-5" />
                      <h3 className="font-semibold text-lg">Change Advisory Board — Latest Decision</h3>
                    </div>

                    {loadingCab ? (
                      <div className="space-y-3">
                        {[1, 2].map((i) => (
                          <div key={i} className="h-16 bg-slate-700/30 rounded-lg animate-pulse" />
                        ))}
                      </div>
                    ) : !latestCab ? (
                      <div className="text-center py-10 text-slate-500 text-sm">
                        No CAB decisions recorded yet.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Latest decision banner */}
                        {latestCab.decision === "approve" || latestCab.decision === "approved" ? (
                          <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
                            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-bold text-emerald-300 text-base">
                                Approved — ready to deploy
                              </div>
                              {latestCab.version && (
                                <div className="text-sm text-emerald-400/80 mt-0.5">
                                  Release <span className="font-mono">{latestCab.version}</span> has been cleared by the CAB.
                                </div>
                              )}
                              {latestCab.reviewedBy && (
                                <div className="text-xs text-slate-500 mt-1">
                                  Reviewed by: {latestCab.reviewedBy}
                                </div>
                              )}
                              {latestCab.notes && (
                                <div className="text-xs text-slate-400 mt-2 bg-white/5 rounded-lg p-3">
                                  {latestCab.notes}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : latestCab.decision === "defer" || latestCab.decision === "deferred" ? (
                          <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
                            <Clock className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-bold text-amber-300 text-base">
                                Deferred — deployment on hold
                              </div>
                              {latestCab.version && (
                                <div className="text-sm text-amber-400/80 mt-0.5">
                                  Release <span className="font-mono">{latestCab.version}</span> has been deferred pending further review.
                                </div>
                              )}
                              {latestCab.reviewedBy && (
                                <div className="text-xs text-slate-500 mt-1">
                                  Reviewed by: {latestCab.reviewedBy}
                                </div>
                              )}
                              {latestCab.notes && (
                                <div className="text-xs text-slate-400 mt-2 bg-white/5 rounded-lg p-3">
                                  {latestCab.notes}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-5">
                            <XCircle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-bold text-red-300 text-base">
                                Rejected — deployment blocked
                              </div>
                              {latestCab.version && (
                                <div className="text-sm text-red-400/80 mt-0.5">
                                  Release <span className="font-mono">{latestCab.version}</span> has been rejected by the CAB.
                                </div>
                              )}
                              {latestCab.reviewedBy && (
                                <div className="text-xs text-slate-500 mt-1">
                                  Reviewed by: {latestCab.reviewedBy}
                                </div>
                              )}
                              {latestCab.notes && (
                                <div className="text-xs text-slate-400 mt-2 bg-white/5 rounded-lg p-3">
                                  {latestCab.notes}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <p className="text-xs text-slate-600 text-right">
                          Last updated: {formatTimestamp(latestCab._updatedAt ?? latestCab._createdAt)}
                          {" · "}Approvals managed in the Stakeholder Workbench.
                        </p>

                        {/* Full history table */}
                        {cabApprovals.length > 1 && (
                          <div className="mt-4">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                              Full CAB History
                            </h4>
                            <Table
                              headers={["Version", "Decision", "Reviewed By", "Notes", "Date"]}
                              data={cabApprovals.map((c) => [
                                <span key="v" className="font-mono text-orange-300 text-xs">{c.version ?? "—"}</span>,
                                <StatusBadge key="d" value={c.decision ?? "—"} />,
                                c.reviewedBy ?? "—",
                                c.notes ?? "—",
                                formatTimestamp(c._updatedAt ?? c._createdAt),
                              ])}
                              emptyMessage="No history available."
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ── Infrastructure tab ─────────────────────────────────── */}
              {activeTab === "infrastructure" && (
                <motion.div
                  key="infrastructure"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                >
                  <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2 text-purple-400">
                        <Database className="w-5 h-5" />
                        <h3 className="font-semibold text-lg">Infrastructure as Code Review (Terraform)</h3>
                      </div>
                      {iacChanges.length > 0 && (
                        <span className="text-xs text-slate-500">
                          {iacChanges.length} change{iacChanges.length !== 1 ? "s" : ""}
                          {iacHighRisk > 0 && (
                            <span className="ml-1 text-red-400 font-semibold">
                              · {iacHighRisk} high-risk
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <Table
                      headers={["Resource", "Action", "Risk", "Auto-Approved"]}
                      data={iacChanges.map((c) => [
                        <span key="r" className="font-mono text-xs text-slate-300">{c.resource ?? "—"}</span>,
                        c.action ?? "—",
                        <RiskBadge key="risk" value={String(c.risk ?? "—")} />,
                        typeof c.autoApproved === "boolean"
                          ? c.autoApproved
                            ? "Yes"
                            : "No"
                          : String(c.autoApproved ?? "—"),
                      ])}
                      loading={loadingIac}
                      emptyMessage="No pending IaC changes."
                    />
                  </div>

                  {/* Fleet agent status summary */}
                  {fleetWorkload && (
                    <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6 mt-6">
                      <div className="flex items-center gap-2 text-slate-400 mb-4">
                        <Server className="w-5 h-5" />
                        <h3 className="font-semibold">Agent Fleet Status</h3>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {(
                          [
                            { label: "Active", value: fleetWorkload.summary?.active ?? 0, color: "text-emerald-400" },
                            { label: "Blocked", value: fleetWorkload.summary?.blocked ?? 0, color: "text-red-400" },
                            { label: "Idle", value: fleetWorkload.summary?.idle ?? 0, color: "text-slate-400" },
                            { label: "Completed", value: fleetWorkload.summary?.completed ?? 0, color: "text-blue-400" },
                          ] as const
                        ).map(({ label, value, color }) => (
                          <div key={label} className="bg-slate-900/40 rounded-lg p-3 text-center">
                            <div className={`text-2xl font-bold ${color}`}>{value}</div>
                            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
                          </div>
                        ))}
                      </div>
                      {fleetWorkload.attention && fleetWorkload.attention.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            Requires Attention
                          </h4>
                          {fleetWorkload.attention.map((item, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 text-sm bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2"
                            >
                              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                              <span className="text-slate-300">
                                <span className="font-semibold text-amber-300">{item.agent}</span>
                                {" — "}
                                {item.reason}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
              {/* ── Incidents tab (Distributed Tracing Replay) ────────────────── */}
              {activeTab === "incidents" && (
                <motion.div
                  key="incidents"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                >
                  <IncidentTriagerWidget />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Agent chat ──────────────────────────────────────────────────── */}
          <div className="lg:col-span-1">
            <AgentChat
              agentName="DevOps / SRE Agent"
              agentRole="Infrastructure & Release Manager"
              defaultGreeting="Hello! I am your AI DevOps Engineer. I can help review Terraform plans, analyze deployment logs, trigger CI/CD pipelines, or assist with CAB compliance. What release do you want to manage today?"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
