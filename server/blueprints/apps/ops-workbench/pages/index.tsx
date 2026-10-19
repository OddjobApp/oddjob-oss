import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity,
  AlertTriangle,
  ServerCrash,
  Globe,
  BellRing,
  CheckCircle2,
  AlertOctagon,
  ShieldAlert,
  Plus,
  X,
  RefreshCw,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AgentChat } from "../components/AgentChat";

import {
  records,
  missions,
  events,
  integrations,
  knowledge,
  telemetry,
  type IncidentRecord,
  type SloMetricRecord,
  type PlatformEvent,
} from "../lib/platform-client";

// ── Inline sub-components (no extra files needed) ─────────────────────────────

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
    <header className="border-b border-white/5 bg-[#050d18]/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-8 py-4 flex items-center gap-4">
        <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20">{icon}</div>
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">{title}</h1>
          <p className="text-xs text-slate-500">{subtitle}</p>
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
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
}) {
  return (
    <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">{title}</span>
        <span className="w-8 h-8 flex items-center justify-center">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {trend && <p className="text-xs text-slate-500 mt-1">{trend}</p>}
    </div>
  );
}

function Table({
  headers,
  data,
}: {
  headers: string[];
  data: (string | React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left py-2 px-3 text-xs text-slate-500 font-semibold uppercase tracking-wider"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="py-3 px-3 text-slate-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Severity badge helper ──────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const cls =
    severity === "SEV-1"
      ? "bg-red-500/20 text-red-400 border-red-500/30"
      : severity === "SEV-2"
      ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
      : "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold border ${cls}`}>
      {severity}
    </span>
  );
}

// ── Status badge helper ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const normalized = status?.toLowerCase() ?? "";
  const cls =
    normalized === "resolved"
      ? "bg-emerald-500/10 text-emerald-400"
      : normalized === "mitigated"
      ? "bg-blue-500/10 text-blue-400"
      : normalized === "hotfix_triggered"
      ? "bg-purple-500/10 text-purple-400"
      : "bg-red-500/10 text-red-400";
  const label =
    normalized === "hotfix_triggered"
      ? "Hotfix Triggered"
      : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
  );
}

// ── Log Incident Form ─────────────────────────────────────────────────────────

interface LogIncidentFormProps {
  onClose: () => void;
  onCreated: (incident: IncidentRecord) => void;
}

function LogIncidentForm({ onClose, onCreated }: LogIncidentFormProps) {
  const [severity, setSeverity] = useState<"SEV-1" | "SEV-2" | "SEV-3">("SEV-2");
  const [component, setComponent] = useState("");
  const [description, setDescription] = useState("");
  const [triggeredBy, setTriggeredBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!component.trim() || !description.trim()) {
      setError("Component and description are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        severity,
        component: component.trim(),
        description: description.trim(),
        triggeredBy: triggeredBy.trim() || "Manual",
        status: "investigating",
        timestamp: new Date().toISOString(),
      };

      const created = await records.create("incidents", payload) as IncidentRecord;

      // Fire telemetry (non-blocking)
      telemetry.emit("incident_logged", "critical", { severity, component: payload.component });

      // SEV-1: notify Slack
      if (severity === "SEV-1") {
        integrations.slack
          .post({
            message: `🚨 SEV-1 incident: ${payload.component} — ${payload.description}`,
          })
          .catch(() => {});
      }

      onCreated(created);
    } catch (err: any) {
      setError(err?.message ?? "Failed to log incident.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-[#0d1117] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-5 h-5" />
            <h2 className="font-bold text-lg text-white">Log New Incident</h2>
          </div>
          <button
            title="Close Incident Form"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Severity */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
              Severity
            </label>
            <select
              title="Severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as "SEV-1" | "SEV-2" | "SEV-3")}
              className="w-full bg-slate-900 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
            >
              <option value="SEV-1">SEV-1 — Critical / Production Down</option>
              <option value="SEV-2">SEV-2 — Major Degradation</option>
              <option value="SEV-3">SEV-3 — Minor / Informational</option>
            </select>
          </div>

          {/* Component */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
              Affected Component
            </label>
            <input
              type="text"
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              placeholder="e.g. Auth Service, API Gateway, Redis Cache"
              className="w-full bg-slate-900 border border-white/10 text-white rounded-lg px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-red-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe the incident symptoms and immediate impact…"
              className="w-full bg-slate-900 border border-white/10 text-white rounded-lg px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-red-500 resize-none"
            />
          </div>

          {/* Triggered By */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
              Triggered By
            </label>
            <input
              type="text"
              value={triggeredBy}
              onChange={(e) => setTriggeredBy(e.target.value)}
              placeholder="e.g. High Error Rate, PagerDuty Alert, Customer Report"
              className="w-full bg-slate-900 border border-white/10 text-white rounded-lg px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-red-500"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-white/10 text-slate-400 hover:text-white hover:border-white/20 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Logging…
                </>
              ) : (
                "Log Incident"
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OpsWorkbench() {
  const [activeTab, setActiveTab] = useState("telemetry");

  // ── Data state ───────────────────────────────────────────────────────────
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [sloMetrics, setSloMetrics] = useState<SloMetricRecord[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [sloLoading, setSloLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [sloError, setSloError] = useState<string | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [showLogForm, setShowLogForm] = useState(false);
  const [hotfixLoading, setHotfixLoading] = useState<Record<string, boolean>>({});
  const [hotfixSuccess, setHotfixSuccess] = useState<Record<string, boolean>>({});

  // ── Fetch incidents ───────────────────────────────────────────────────────
  const fetchIncidents = useCallback(async () => {
    setIncidentsError(null);
    try {
      const data = (await records.list("incidents")) as IncidentRecord[];
      // Sort newest first
      const sorted = [...data].sort(
        (a, b) => new Date(b.timestamp as string || b._createdAt).getTime() - new Date(a.timestamp as string || a._createdAt).getTime()
      );
      setIncidents(sorted);
    } catch (err: any) {
      setIncidentsError(err?.message ?? "Failed to load incidents.");
    } finally {
      setIncidentsLoading(false);
    }
  }, []);

  // ── Fetch SLO metrics ─────────────────────────────────────────────────────
  const fetchSlo = useCallback(async () => {
    setSloError(null);
    try {
      const data = (await records.list("slo_metrics")) as SloMetricRecord[];
      setSloMetrics(data);
    } catch (err: any) {
      setSloError(err?.message ?? "Failed to load SLO metrics.");
    } finally {
      setSloLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIncidents();
    fetchSlo();
  }, [fetchIncidents, fetchSlo]);

  // ── SSE subscription ──────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = events.subscribe((event: PlatformEvent) => {
      if (
        event.type === "mission.completed" ||
        event.type === "mission.status_changed"
      ) {
        fetchIncidents();
      }
    });
    return unsubscribe;
  }, [fetchIncidents]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const sev1Count = incidents.filter((i) => i.severity === "SEV-1").length;
  const sev2Count = incidents.filter((i) => i.severity === "SEV-2").length;
  const sev3Count = incidents.filter((i) => i.severity === "SEV-3").length;
  const activeCount = incidents.filter(
    (i) => i.status !== "resolved" && i.status !== "mitigated"
  ).length;
  const sloBreaches = sloMetrics.filter((s) => s.status === "breached").length;

  // ── Trigger Hotfix Mission ────────────────────────────────────────────────
  const handleHotfix = async (incident: IncidentRecord) => {
    const id = incident.id;
    setHotfixLoading((prev) => ({ ...prev, [id]: true }));
    try {
      // Query knowledge base for runbook context first
      let runbookContext: string[] = [];
      try {
        const kb = await knowledge.query(
          `production hotfix runbook rollback ${incident.component}`,
          5
        );
        runbookContext = (kb.results ?? []).map((r) => r.content);
      } catch {}

      await missions.trigger("Production Incident & Hotfix Routing", {
        incidentId: id,
        severity: incident.severity,
        component: incident.component,
        description: incident.description,
        runbookContext,
      });

      // Update status to hotfix_triggered
      await records.update("incidents", id, { status: "hotfix_triggered" });

      setIncidents((prev) =>
        prev.map((inc) =>
          inc.id === id ? { ...inc, status: "hotfix_triggered" } : inc
        )
      );
      setHotfixSuccess((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setHotfixSuccess((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 4000);
    } catch (err: any) {
      console.error("Hotfix mission failed:", err);
    } finally {
      setHotfixLoading((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  // ── Handle new incident created from form ─────────────────────────────────
  const handleIncidentCreated = (incident: IncidentRecord) => {
    setIncidents((prev) => [incident, ...prev]);
    setShowLogForm(false);
  };

  // ── SLO status colour ─────────────────────────────────────────────────────
  const sloStatusClass = (status: string) => {
    if (status === "healthy") return "text-emerald-400";
    if (status === "at_risk") return "text-amber-400";
    if (status === "breached") return "text-red-400";
    return "text-slate-400";
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 font-sans selection:bg-red-500/20">
      <Header
        title="Operations & Incident Response"
        subtitle="Monitor system health, triage active incidents, and trigger emergency hotfixes."
        icon={<Activity className="w-6 h-6 text-red-400" />}
      />

      <main className="max-w-[1600px] mx-auto p-6 lg:p-8">
        {/* ── Stat row ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Active Incidents"
            value={incidentsLoading ? "—" : activeCount}
            icon={<AlertTriangle className="text-amber-400 w-5 h-5" />}
            trend={activeCount === 0 ? "All clear" : `${activeCount} open`}
          />
          <StatCard
            title="SEV-1 Count"
            value={incidentsLoading ? "—" : sev1Count}
            icon={<ServerCrash className="text-red-400 w-5 h-5" />}
            trend={sev1Count > 0 ? "Critical" : "None active"}
          />
          <StatCard
            title="Total Incidents"
            value={incidentsLoading ? "—" : incidents.length}
            icon={<Globe className="text-blue-400 w-5 h-5" />}
            trend="All time"
          />
          <StatCard
            title="SLO Breaches"
            value={sloLoading ? "—" : sloBreaches}
            icon={<ShieldAlert className="text-red-400 w-5 h-5" />}
            trend={sloBreaches > 0 ? `${sloBreaches} service(s)` : "All within budget"}
          />
        </div>

        {/* ── Main grid ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* ── Left / centre panel ─────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">
            {/* Tab bar */}
            <div className="flex border-b border-white/10">
              {(
                [
                  { key: "telemetry", label: "Live Telemetry" },
                  { key: "incidents", label: "Incident Response" },
                  { key: "slo", label: "SLO Tracking" },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-6 py-3 text-sm font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                    activeTab === key
                      ? "border-red-500 text-red-400"
                      : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {/* ── Telemetry tab ──────────────────────────────────────── */}
              {activeTab === "telemetry" && (
                <motion.div
                  key="telemetry"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className="space-y-6"
                >
                  {/* Live incident summary — replaces fake CPU/DB gauges */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      {
                        label: "SEV-1",
                        count: sev1Count,
                        colorVal: "text-red-400",
                        barColor: "bg-red-500",
                        max: Math.max(sev1Count, 1),
                      },
                      {
                        label: "SEV-2",
                        count: sev2Count,
                        colorVal: "text-orange-400",
                        barColor: "bg-orange-400",
                        max: Math.max(sev2Count, 1),
                      },
                      {
                        label: "SEV-3",
                        count: sev3Count,
                        colorVal: "text-amber-400",
                        barColor: "bg-amber-400",
                        max: Math.max(sev3Count, 1),
                      },
                    ].map(({ label, count, colorVal, barColor, max }) => (
                      <div
                        key={label}
                        className="bg-[#111827]/40 border border-white/5 rounded-xl p-5"
                      >
                        <div className="flex justify-between items-center mb-3">
                          <span className={`text-sm font-semibold ${colorVal}`}>
                            {label} Incidents
                          </span>
                          <span className={`text-2xl font-bold ${colorVal}`}>
                            {incidentsLoading ? "—" : count}
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                          <style>{`#progress-${label.toLowerCase().replace(/\s+/g, '-')} { width: ${incidentsLoading ? "0%" : `${Math.min((count / max) * 100, 100)}%`}; }`}</style>
                          <div
                            id={`progress-${label.toLowerCase().replace(/\s+/g, '-')}`}
                            className={`h-full ${barColor} transition-all`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Recent incident feed */}
                  <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2 text-slate-300">
                        <Activity className="w-5 h-5 text-red-400" />
                        <h3 className="font-semibold text-lg">Recent Incident Feed</h3>
                      </div>
                      <button
                        onClick={fetchIncidents}
                        disabled={incidentsLoading}
                        className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors"
                        title="Refresh"
                      >
                        <RefreshCw
                          className={`w-4 h-4 ${incidentsLoading ? "animate-spin" : ""}`}
                        />
                      </button>
                    </div>
                    {incidentsLoading ? (
                      <div className="flex items-center justify-center py-10 text-slate-500">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        Loading…
                      </div>
                    ) : incidents.length === 0 ? (
                      <p className="text-slate-500 text-sm italic text-center py-8">
                        No incidents recorded yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {incidents.slice(0, 8).map((inc) => (
                          <div
                            key={inc.id}
                            className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0"
                          >
                            <SeverityBadge severity={inc.severity} />
                            <span className="flex-1 text-sm text-slate-300 truncate">
                              {inc.component}
                            </span>
                            <StatusBadge status={inc.status} />
                            <span className="text-xs text-slate-600 whitespace-nowrap">
                              {inc.timestamp
                                ? new Date(inc.timestamp as string).toLocaleTimeString()
                                : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ── Incidents tab ──────────────────────────────────────── */}
              {activeTab === "incidents" && (
                <motion.div
                  key="incidents"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                >
                  <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2 text-red-400">
                        <BellRing className="w-5 h-5" />
                        <h3 className="font-semibold text-lg text-white">Active Incidents</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={fetchIncidents}
                          disabled={incidentsLoading}
                          className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors"
                          title="Refresh"
                        >
                          <RefreshCw
                            className={`w-4 h-4 ${incidentsLoading ? "animate-spin" : ""}`}
                          />
                        </button>
                        <button
                          onClick={() => setShowLogForm(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Log Incident
                        </button>
                      </div>
                    </div>

                    {incidentsError && (
                      <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {incidentsError}
                        <button
                          onClick={fetchIncidents}
                          className="ml-auto underline hover:no-underline"
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    {incidentsLoading ? (
                      <div className="flex items-center justify-center py-12 text-slate-500">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        Loading incidents…
                      </div>
                    ) : incidents.length === 0 ? (
                      <div className="text-center py-12">
                        <CheckCircle2 className="w-10 h-10 text-emerald-500/40 mx-auto mb-3" />
                        <p className="text-slate-500 text-sm">No incidents found. All systems nominal.</p>
                        <button
                          onClick={() => setShowLogForm(true)}
                          className="mt-4 text-xs text-red-400 hover:text-red-300 underline"
                        >
                          Log the first incident
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {incidents.map((inc) => (
                          <div
                            key={inc.id}
                            className="bg-slate-900 border border-white/10 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3 mb-2 flex-wrap">
                                <SeverityBadge severity={inc.severity} />
                                <h4 className="font-semibold text-white truncate">
                                  {inc.component}
                                </h4>
                                <StatusBadge status={inc.status} />
                              </div>
                              <p className="text-sm text-slate-400 line-clamp-2">
                                {inc.description}
                              </p>
                              <p className="text-xs text-slate-600 mt-1">
                                Triggered by: {inc.triggeredBy}
                                {inc.timestamp && (
                                  <>
                                    {" "}
                                    &middot;{" "}
                                    {new Date(inc.timestamp as string).toLocaleString()}
                                  </>
                                )}
                              </p>
                            </div>
                            <div className="shrink-0">
                              {inc.severity === "SEV-1" &&
                                inc.status !== "hotfix_triggered" &&
                                inc.status !== "resolved" && (
                                  <button
                                    onClick={() => handleHotfix(inc)}
                                    disabled={!!hotfixLoading[inc.id]}
                                    className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-w-[180px]"
                                  >
                                    {hotfixLoading[inc.id] ? (
                                      <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Triggering…
                                      </>
                                    ) : (
                                      <>
                                        <AlertOctagon className="w-4 h-4" />
                                        Trigger Hotfix Mission
                                      </>
                                    )}
                                  </button>
                                )}
                              {hotfixSuccess[inc.id] && (
                                <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                                  <CheckCircle2 className="w-4 h-4" />
                                  Mission triggered
                                </div>
                              )}
                              {inc.status === "hotfix_triggered" && !hotfixSuccess[inc.id] && (
                                <div className="flex items-center gap-1.5 text-purple-400 text-xs font-medium">
                                  <CheckCircle2 className="w-4 h-4" />
                                  Hotfix in progress
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ── SLO tab ────────────────────────────────────────────── */}
              {activeTab === "slo" && (
                <motion.div
                  key="slo"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                >
                  <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <CheckCircle2 className="w-5 h-5" />
                        <h3 className="font-semibold text-lg text-white">
                          Service Level Objectives (30d)
                        </h3>
                      </div>
                      <button
                        onClick={fetchSlo}
                        disabled={sloLoading}
                        className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors"
                        title="Refresh"
                      >
                        <RefreshCw
                          className={`w-4 h-4 ${sloLoading ? "animate-spin" : ""}`}
                        />
                      </button>
                    </div>

                    {sloError && (
                      <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {sloError}
                        <button
                          onClick={fetchSlo}
                          className="ml-auto underline hover:no-underline"
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    {sloLoading ? (
                      <div className="flex items-center justify-center py-12 text-slate-500">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        Loading SLO data…
                      </div>
                    ) : sloMetrics.length === 0 ? (
                      <div className="text-center py-12">
                        <ShieldAlert className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                        <p className="text-slate-500 text-sm">
                          No SLO metrics found. Create records in the{" "}
                          <span className="font-mono text-xs text-slate-400">slo_metrics</span>{" "}
                          collection to populate this view.
                        </p>
                      </div>
                    ) : (
                      <Table
                        headers={["Service", "Target SLO", "Current", "Error Budget", "Status"]}
                        data={sloMetrics.map((s) => [
                          <span key="svc" className="font-medium text-white">
                            {s.service}
                          </span>,
                          s.targetSlo ?? "—",
                          s.current ?? "—",
                          s.errorBudget ?? "—",
                          <span
                            key="status"
                            className={`text-xs font-semibold uppercase tracking-wider ${sloStatusClass(s.status)}`}
                          >
                            {s.status ?? "Unknown"}
                          </span>,
                        ])}
                      />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Right: Agent Chat ────────────────────────────────────── */}
          <div className="lg:col-span-1">
            <AgentChat
              agentName="AI Incident Responder"
              agentRole="L1 Ops & SRE Assistant"
              defaultGreeting={
                sev1Count > 0
                  ? `Alert! I see ${sev1Count} SEV-1 incident${sev1Count > 1 ? "s" : ""} currently active. I can help you investigate, draft an incident report, or trigger the Production Hotfix mission. What would you like to do?`
                  : "All systems are currently stable. I'm monitoring your incident queue. Ask me to investigate any service, query your runbooks, or help draft an incident response."
              }
            />
          </div>
        </div>
      </main>

      {/* ── Log Incident modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showLogForm && (
          <LogIncidentForm
            onClose={() => setShowLogForm(false)}
            onCreated={handleIncidentCreated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
