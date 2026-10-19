/**
 * BacklogPanel — PM-approved tickets + active Jira sprint backlog + commit selection.
 */
import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, AlertCircle, CheckSquare, Square, Loader2 } from "lucide-react";
import { jira, telemetry } from "../lib/platform-client";
import type { JiraIssue } from "../lib/platform-client";
import type { BacklogRecord, PmHandoffRecord } from "../lib/collections";
import { VelocityGauge } from "./VelocityGauge";

interface Props {
  sprintNumber: number;
  targetVelocity: number | null;
  anomalyThreshold: number;
  committedRecords: BacklogRecord[];
  pmHandoffs: PmHandoffRecord[];
  pmHandoffsLoading: boolean;
  pmHandoffsError: string | null;
  onCommit: (ticket: JiraIssue, source: "pm_approved" | "active_sprint") => Promise<void>;
  onDecommit: (jiraKey: string) => Promise<void>;
  onReloadPmHandoffs: () => void;
}

const SKELETON_ROWS = 5;

export function BacklogPanel({
  sprintNumber,
  targetVelocity,
  anomalyThreshold,
  committedRecords,
  pmHandoffs,
  pmHandoffsLoading,
  pmHandoffsError,
  onCommit,
  onDecommit,
  onReloadPmHandoffs,
}: Props) {
  const [sprintTickets, setSprintTickets]       = useState<JiraIssue[]>([]);
  const [sprintLoading, setSprintLoading]       = useState(true);
  const [sprintError, setSprintError]           = useState<string | null>(null);
  const [pmTickets, setPmTickets]               = useState<JiraIssue[]>([]);
  const [pmTicketsLoading, setPmTicketsLoading] = useState(false);
  const [togglingKey, setTogglingKey]           = useState<string | null>(null);

  const committedKeys = new Set(committedRecords.map((r) => r.jiraKey));
  const committedPoints = committedRecords.reduce((sum, r) => sum + (r.storyPoints ?? 0), 0);

  // Fetch active sprint backlog
  const loadSprintBacklog = useCallback(async () => {
    setSprintLoading(true);
    setSprintError(null);
    try {
      const result = await jira.search(
        `project = currentProject() AND sprint in openSprints() ORDER BY priority DESC`,
        ["summary", "status", "priority", "assignee", "issuetype", "story_points", "customfield_10016"],
        50
      );
      if (!result.success) throw new Error(result.error ?? "Jira search failed");
      setSprintTickets(result.issues);
    } catch (e: any) {
      setSprintError(e.message ?? "Failed to load sprint backlog");
    } finally {
      setSprintLoading(false);
    }
  }, []);

  // Fetch PM-approved ticket details from Jira (summaries for PM handoff keys)
  const loadPmTicketDetails = useCallback(async () => {
    if (pmHandoffs.length === 0) { setPmTickets([]); return; }
    setPmTicketsLoading(true);
    try {
      const keys = pmHandoffs.map((h) => h.jiraKey).join(", ");
      const result = await jira.search(
        `issueKey in (${keys})`,
        ["summary", "status", "priority", "assignee", "issuetype", "customfield_10016"],
        pmHandoffs.length
      );
      if (result.success) setPmTickets(result.issues);
    } catch {
      // Non-fatal — PM section will show keys without full details
    } finally {
      setPmTicketsLoading(false);
    }
  }, [pmHandoffs]);

  useEffect(() => { loadSprintBacklog(); }, [loadSprintBacklog]);
  useEffect(() => { loadPmTicketDetails(); }, [loadPmTicketDetails]);

  async function handleToggle(ticket: JiraIssue, source: "pm_approved" | "active_sprint") {
    setTogglingKey(ticket.key);
    try {
      if (committedKeys.has(ticket.key)) {
        await onDecommit(ticket.key);
        telemetry.emit("ticket_decommitted", "info", { jiraKey: ticket.key, sprintNumber });
      } else {
        await onCommit(ticket, source);
        telemetry.emit("ticket_committed", "info", { jiraKey: ticket.key, sprintNumber, source });
      }
    } finally {
      setTogglingKey(null);
    }
  }

  function handleRefresh() {
    loadSprintBacklog();
    onReloadPmHandoffs();
  }

  const priorityBadge = (p: string) => {
    const map: Record<string, string> = {
      Highest: "bg-rose-500/20 text-rose-400",
      High:    "bg-rose-500/10 text-rose-400",
      Medium:  "bg-amber-500/10 text-amber-400",
      Low:     "bg-slate-700 text-slate-400",
      Lowest:  "bg-slate-700 text-slate-500",
    };
    return map[p] ?? "bg-slate-700 text-slate-400";
  };

  return (
    <div className="space-y-6">
      {/* Velocity Gauge */}
      <VelocityGauge
        committedPoints={committedPoints}
        targetVelocity={targetVelocity}
        anomalyThreshold={anomalyThreshold}
        sprintNumber={sprintNumber}
      />

      {/* Controls */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {committedRecords.length} ticket{committedRecords.length !== 1 ? "s" : ""} committed · {committedPoints} SP
        </p>
        <button
          onClick={handleRefresh}
          aria-label="Refresh backlog"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* PM Approved Section */}
      <section aria-label="PM Approved tickets">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
          PM Approved
        </h4>

        {pmHandoffsError && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs mb-3">
            <span>{pmHandoffsError}</span>
            <button onClick={onReloadPmHandoffs} className="flex items-center gap-1 ml-2 underline">
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        )}

        {pmHandoffsLoading || pmTicketsLoading ? (
          <SkeletonRows count={3} />
        ) : pmHandoffs.length === 0 ? (
          <EmptyState message="No PM-approved tickets available." />
        ) : (
          <TicketList
            tickets={pmHandoffs.map((h) => {
              const detail = pmTickets.find((t) => t.key === h.jiraKey);
              return detail ?? {
                key: h.jiraKey,
                summary: "(Loading…)",
                status: "",
                priority: "",
                assignee: null,
                issueType: "",
                updated: h.triggeredAt,
              };
            })}
            committedKeys={committedKeys}
            togglingKey={togglingKey}
            source="pm_approved"
            onToggle={handleToggle}
            priorityBadge={priorityBadge}
          />
        )}
      </section>

      {/* Active Sprint Section */}
      <section aria-label="Active sprint backlog">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
          Active Sprint
        </h4>

        {sprintError && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs mb-3">
            <span>{sprintError}</span>
            <button onClick={loadSprintBacklog} className="flex items-center gap-1 ml-2 underline">
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        )}

        {sprintLoading ? (
          <SkeletonRows count={SKELETON_ROWS} />
        ) : sprintTickets.length === 0 && !sprintError ? (
          <EmptyState message="No tickets currently in the active sprint." />
        ) : (
          <TicketList
            tickets={sprintTickets}
            committedKeys={committedKeys}
            togglingKey={togglingKey}
            source="active_sprint"
            onToggle={handleToggle}
            priorityBadge={priorityBadge}
          />
        )}
      </section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 rounded-lg border border-dashed border-white/10 text-slate-500 text-sm justify-center">
      <AlertCircle className="w-4 h-4" />
      {message}
    </div>
  );
}

interface TicketListProps {
  tickets: JiraIssue[];
  committedKeys: Set<string>;
  togglingKey: string | null;
  source: "pm_approved" | "active_sprint";
  onToggle: (ticket: JiraIssue, source: "pm_approved" | "active_sprint") => Promise<void>;
  priorityBadge: (p: string) => string;
}

function TicketList({ tickets, committedKeys, togglingKey, source, onToggle, priorityBadge }: TicketListProps) {
  return (
    <div className="space-y-2">
      {tickets.map((ticket) => {
        const committed = committedKeys.has(ticket.key);
        const toggling  = togglingKey === ticket.key;
        return (
          <div
            key={ticket.key}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
              committed
                ? "bg-amber-500/5 border-amber-500/30"
                : "bg-white/3 border-white/5 hover:border-white/10"
            }`}
          >
            <button
              onClick={() => onToggle(ticket, source)}
              disabled={toggling}
              aria-label={committed ? `Decommit ${ticket.key}` : `Commit ${ticket.key}`}
              className="shrink-0 text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
            >
              {toggling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : committed ? (
                <CheckSquare className="w-4 h-4" />
              ) : (
                <Square className="w-4 h-4 text-slate-500" />
              )}
            </button>

            <span className="font-mono text-xs font-bold text-amber-400 shrink-0 w-20">{ticket.key}</span>

            <span className="flex-1 text-sm text-white truncate" title={ticket.summary}>
              {ticket.summary}
            </span>

            <div className="flex items-center gap-2 shrink-0">
              {ticket.priority && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${priorityBadge(ticket.priority)}`}>
                  {ticket.priority}
                </span>
              )}
              {ticket.storyPoints !== undefined && (
                <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-1.5 py-0.5 rounded">
                  {ticket.storyPoints} SP
                </span>
              )}
              {ticket.assignee && (
                <span className="text-[10px] text-slate-500 hidden md:block max-w-[80px] truncate">
                  {ticket.assignee}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
