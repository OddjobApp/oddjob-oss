import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Database,
  Filter,
  GitBranch,
  History,
  Layers3,
  Link2,
  Pause,
  Pin,
  RotateCcw,
  Search,
  Timer,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { colors } from "@oddjob/design-system";

export type ExecutionGroupStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "warning"
  | "paused"
  | "waiting"
  | "retrying"
  | "skipped"
  | "cancelled";

export interface ExecutionEvent {
  id: string;
  timestamp?: string | Date | null;
  type: string;
  title: string;
  description?: string | null;
  status?: ExecutionGroupStatus | string | null;
  actor?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ExecutionRetryPolicy {
  maxRetries?: number | null;
  backoffMs?: number | null;
  backoffMultiplier?: number | null;
  retryOnCategories?: string[] | null;
}

export interface ExecutionGroup {
  id: string;
  title: string;
  subtitle?: string | null;
  category: string;
  status: ExecutionGroupStatus;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  durationMs?: number | null;
  progress?: number | null;
  count?: number | null;
  childCount?: number | null;
  retryCount?: number | null;
  retryPolicy?: ExecutionRetryPolicy | null;
  isChild?: boolean;
  isCritical?: boolean;
  metadata?: Record<string, unknown> | null;
  events?: ExecutionEvent[];
}

export interface ExecutionRelationship {
  id: string;
  label: string;
  value: string;
  type?: "parent" | "child" | "previous" | "next" | "artifact" | "execution" | "agent" | "generic";
  href?: string;
  status?: ExecutionGroupStatus | string | null;
}

export interface ExecutionMetadataItem {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}

interface ExecutionExplorerProps {
  title: string;
  description?: string;
  status?: ExecutionGroupStatus | string;
  groups: ExecutionGroup[];
  relationships?: ExecutionRelationship[];
  metadata?: ExecutionMetadataItem[];
  lastUpdatedAt?: string | Date | null;
  isLive?: boolean;
  defaultView?: "compact" | "table" | "timeline" | "history" | "relationships" | "metadata";
  emptyMessage?: string;
  className?: string;
  isLoading?: boolean;
  onFilterChange?: (filters: { status?: string; stepCode?: string }) => void;
  renderGroupActions?: (group: ExecutionGroup) => React.ReactNode;
  renderGroupDetail?: (group: ExecutionGroup) => React.ReactNode;
}

// Status semiotics are bound to the @oddjob/design-system semantic tokens so
// this shared explorer matches the Cycle/Mission/Workstream views:
//   pending   → info     (indigo)  awaiting start
//   running   → primary  (sky)     actively executing
//   completed → success  (green)   settled OK
//   failed    → danger   (red)     settled error
//   warning   → warning  (amber)   near a budget/time limit
//   paused    → manual   (cyan)    user/gate paused
//   waiting   → manual   (cyan)    awaiting external input
//   retrying  → recovery (purple)  recovering — NOT red (distinct from failed)
//   skipped/cancelled → neutral    inert
// `cls` uses the Tailwind palette equivalents of these token hues (Tailwind's
// JIT needs static class strings); `lineColor` consumes the token hex directly
// for connectors/progress bars, keeping the design system the source of truth.
const statusStyles: Record<ExecutionGroupStatus, { icon: React.ComponentType<{ className?: string }>; cls: string; lineColor: string; pulse?: boolean; label: string }> = {
  pending: { icon: Circle, cls: "border-indigo-400/30 bg-indigo-400/10 text-indigo-700 dark:text-indigo-300", lineColor: colors.info[400], label: "Pending" },
  running: { icon: Activity, cls: "border-sky-400/30 bg-sky-400/10 text-sky-700 dark:text-sky-300", lineColor: colors.primary[400], pulse: true, label: "Running" },
  completed: { icon: CheckCircle2, cls: "border-green-400/30 bg-green-400/10 text-green-700 dark:text-green-300", lineColor: colors.success[400], label: "Completed" },
  failed: { icon: XCircle, cls: "border-red-400/30 bg-red-400/10 text-red-700 dark:text-red-300", lineColor: colors.danger[400], label: "Failed" },
  warning: { icon: AlertTriangle, cls: "border-amber-400/30 bg-amber-400/10 text-amber-700 dark:text-amber-300", lineColor: colors.warning[400], label: "Warning" },
  paused: { icon: Pause, cls: "border-cyan-400/30 bg-cyan-400/10 text-cyan-700 dark:text-cyan-300", lineColor: colors.manual[500], label: "Paused" },
  waiting: { icon: Timer, cls: "border-cyan-400/30 bg-cyan-400/10 text-cyan-700 dark:text-cyan-300", lineColor: colors.manual[500], pulse: true, label: "Waiting" },
  retrying: { icon: RotateCcw, cls: "border-purple-400/30 bg-purple-400/10 text-purple-700 dark:text-purple-300", lineColor: colors.recovery[500], pulse: true, label: "Retrying" },
  skipped: { icon: ChevronRight, cls: "border-slate-400/20 bg-slate-400/5 text-muted-foreground", lineColor: colors.neutral[400], label: "Skipped" },
  cancelled: { icon: XCircle, cls: "border-slate-400/25 bg-slate-400/10 text-foreground/70", lineColor: colors.neutral[400], label: "Cancelled" },
};

// Pending/waiting/retrying render as a dashed connector (Temporal semiotic for
// "not yet settled"). A solid bg color with a background-size does not produce
// dashes, so these statuses use a dashed left border instead — hues matched to
// the design-system tokens above (info/manual/recovery).
const dashedStatuses: ExecutionGroupStatus[] = ["pending", "waiting", "retrying"];
const dashedBorder: Partial<Record<ExecutionGroupStatus, string>> = {
  pending: "border-indigo-400/50",
  waiting: "border-cyan-400/60",
  retrying: "border-purple-400/60",
};

function normalizeStatus(status?: string | null): ExecutionGroupStatus {
  if (!status) return "pending";
  const lower = status.toLowerCase();
  if (lower === "success" || lower === "closed") return "completed";
  if (lower === "failure" || lower === "error") return "failed";
  if (lower === "active") return "running";
  if (lower === "waiting_async" || lower === "blocked") return "waiting";
  if (lower === "pending_approval" || lower === "reviewing") return "waiting";
  if (lower in statusStyles) return lower as ExecutionGroupStatus;
  return "pending";
}

function formatTime(value?: string | Date | null) {
  if (!value) return "Not started";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms?: number | null) {
  if (!ms || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

function groupDuration(group: ExecutionGroup) {
  if (group.durationMs != null) return formatDuration(group.durationMs);
  if (group.startedAt && group.completedAt) {
    return formatDuration(new Date(group.completedAt).getTime() - new Date(group.startedAt).getTime());
  }
  if (group.startedAt && ["running", "waiting", "retrying"].includes(group.status)) {
    return formatDuration(Date.now() - new Date(group.startedAt).getTime());
  }
  return null;
}

function metadataValue(value: unknown): React.ReactNode {
  if (value == null || value === "") return "None";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  return (
    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-[11px]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StatusBadge({ status }: { status: ExecutionGroupStatus | string }) {
  const normalized = normalizeStatus(status);
  const cfg = statusStyles[normalized];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("gap-1.5 text-[10px] font-bold uppercase", cfg.cls)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

// Human-readable retry policy summary, e.g. "up to 3 attempts · backoff 5s ×2 ·
// retries on rate_limit, server_error, timeout". Returns null if no policy.
function formatRetryPolicy(policy?: ExecutionRetryPolicy | null): string | null {
  if (!policy) return null;
  const parts: string[] = [];
  if (policy.maxRetries != null) parts.push(`up to ${policy.maxRetries} ${policy.maxRetries === 1 ? "retry" : "retries"}`);
  if (policy.backoffMs != null) {
    const base = policy.backoffMs >= 1000 ? `${(policy.backoffMs / 1000).toFixed(policy.backoffMs % 1000 ? 1 : 0)}s` : `${policy.backoffMs}ms`;
    parts.push(`backoff ${base}${policy.backoffMultiplier && policy.backoffMultiplier !== 1 ? ` ×${policy.backoffMultiplier}` : ""}`);
  }
  if (policy.retryOnCategories?.length) parts.push(`on ${policy.retryOnCategories.join(", ")}`);
  return parts.length ? parts.join(" · ") : null;
}

// Retry badge: shows attempts used against the configured budget ("2/3 retries")
// when a policy is known, otherwise a bare count. A failed group that used its
// whole budget is flagged "exhausted" in the warning (amber) tone. Hidden for
// clean first-try steps. NOTE: there is no live "next retry in …" countdown yet
// — that needs a persisted nextRetryAt on the step execution.
function RetryBadge({ group, compact = false }: { group: ExecutionGroup; compact?: boolean }) {
  const count = group.retryCount ?? 0;
  const max = group.retryPolicy?.maxRetries ?? null;
  const status = normalizeStatus(group.status);
  const policyRelevant = !!group.retryPolicy && (status === "failed" || status === "retrying");
  if (count <= 0 && !policyRelevant) return null;

  const exhausted = max != null && count >= max && status === "failed";
  const label = max != null
    ? `${count}/${max}${compact ? "" : " retries"}`
    : `${count}×${compact ? "" : " retried"}`;
  const policySummary = formatRetryPolicy(group.retryPolicy);

  return (
    <Badge
      variant="outline"
      title={policySummary ? `Retry policy: ${policySummary}` : undefined}
      className={cn(
        "gap-1 text-[10px]",
        exhausted ? "border-amber-400/40 text-amber-700 dark:text-amber-300" : "border-purple-400/30 text-purple-700 dark:text-purple-300"
      )}
    >
      <RotateCcw className="h-3 w-3" />
      {label}{exhausted && !compact ? " · exhausted" : ""}
    </Badge>
  );
}

function EventGroupRow({
  group,
  index,
  isLast,
  selected,
  onToggleSelected,
  renderGroupActions,
}: {
  group: ExecutionGroup;
  index: number;
  isLast: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  renderGroupActions?: (group: ExecutionGroup) => React.ReactNode;
}) {
  const normalized = normalizeStatus(group.status);
  const cfg = statusStyles[normalized];
  const Icon = cfg.icon;
  const duration = groupDuration(group);
  const isDashed = dashedStatuses.includes(normalized);

  return (
    <div className="relative flex gap-3">
      {!isLast &&
        (isDashed ? (
          <div
            className={cn(
              "absolute left-4 top-9 h-[calc(100%-1rem)] border-l-2 border-dashed",
              dashedBorder[normalized],
              cfg.pulse && "animate-pulse"
            )}
          />
        ) : (
          <div
            className={cn("absolute left-4 top-9 h-[calc(100%-1rem)] w-0.5", cfg.pulse && "animate-pulse")}
            style={{ backgroundColor: cfg.lineColor }}
          />
        ))}
      <button
        type="button"
        onClick={onToggleSelected}
        className={cn(
          "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition",
          cfg.cls,
          selected && "ring-2 ring-primary"
        )}
        title={selected ? "Unpin details" : "Pin details"}
      >
        <Icon className="h-4 w-4" />
      </button>
      <div
        className={cn(
          "mb-4 min-w-0 flex-1 rounded-lg border bg-card/60 p-4 transition",
          selected ? "border-primary/50" : "border-border/60 hover:border-primary/30"
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">#{index + 1}</span>
              <h4 className="truncate text-sm font-semibold">{group.title}</h4>
              <StatusBadge status={group.status} />
              <RetryBadge group={group} />
              {group.isCritical && <Badge variant="outline" className="text-[10px]">Critical</Badge>}
              {group.childCount ? <Badge variant="secondary" className="text-[10px]">{group.childCount} children</Badge> : null}
            </div>
            {group.subtitle && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{group.subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {duration && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {duration}
              </span>
            )}
            {renderGroupActions?.(group)}
          </div>
        </div>
        {group.progress != null && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, group.progress))}%`, backgroundColor: cfg.lineColor }} />
          </div>
        )}
      </div>
    </div>
  );
}

function CompactView({ groups, onToggleSelected, selectedIds, renderGroupActions }: {
  groups: ExecutionGroup[];
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  renderGroupActions?: (group: ExecutionGroup) => React.ReactNode;
}) {
  return (
    <div className="pb-2">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {groups.map((group, index) => {
          const cfg = statusStyles[normalizeStatus(group.status)];
          const Icon = cfg.icon;
          return (
            <React.Fragment key={group.id}>
              <button
                type="button"
                onClick={() => onToggleSelected(group.id)}
                className={cn(
                  "min-h-48 w-full rounded-lg border bg-card/60 p-4 text-left transition hover:border-primary/40",
                  selectedIds.has(group.id) && "border-primary/60 ring-1 ring-primary/40"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full border", cfg.cls)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={group.status} />
                    <RetryBadge group={group} compact />
                  </div>
                </div>
                <h4 className="mt-4 line-clamp-2 text-sm font-semibold">{group.title}</h4>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{group.subtitle || group.category}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{group.count || group.events?.length || 1} events</span>
                  <span>{groupDuration(group) || formatTime(group.startedAt)}</span>
                </div>
                {renderGroupActions?.(group)}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function TableView({ groups, onToggleSelected, selectedIds, renderGroupActions }: {
  groups: ExecutionGroup[];
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  renderGroupActions?: (group: ExecutionGroup) => React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-muted/40 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="w-10 px-3 py-3">Pin</th>
            <th className="px-3 py-3">Work item</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Type</th>
            <th className="px-3 py-3">Events</th>
            <th className="px-3 py-3">Last movement</th>
            <th className="px-3 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {groups.map(group => (
            <tr
              key={group.id}
              className={cn(
                "bg-card/30 transition hover:bg-muted/30",
                selectedIds.has(group.id) && "bg-primary/10"
              )}
            >
              <td className="px-3 py-3 align-top">
                <button
                  type="button"
                  onClick={() => onToggleSelected(group.id)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border text-muted-foreground transition hover:border-primary hover:text-primary",
                    selectedIds.has(group.id) && "border-primary text-primary"
                  )}
                  title={selectedIds.has(group.id) ? "Unpin details" : "Pin details"}
                >
                  <Pin className="h-3.5 w-3.5" />
                </button>
              </td>
              <td className="max-w-[360px] px-3 py-3 align-top">
                <div className="font-semibold text-foreground">{group.title}</div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{group.subtitle || "No description"}</div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge status={group.status} />
                  <RetryBadge group={group} compact />
                </div>
              </td>
              <td className="px-3 py-3 align-top text-xs text-muted-foreground">{group.category}</td>
              <td className="px-3 py-3 align-top text-xs tabular-nums text-muted-foreground">
                {group.count || group.events?.length || 1}
              </td>
              <td className="px-3 py-3 align-top text-xs text-muted-foreground">
                {groupDuration(group) || formatTime(group.startedAt)}
              </td>
              <td className="px-3 py-3 align-top text-right">
                {renderGroupActions?.(group)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimelineView({ groups, onToggleSelected, selectedIds, renderGroupActions }: {
  groups: ExecutionGroup[];
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  renderGroupActions?: (group: ExecutionGroup) => React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      {groups.map((group, index) => (
        <EventGroupRow
          key={group.id}
          group={group}
          index={index}
          isLast={index === groups.length - 1}
          selected={selectedIds.has(group.id)}
          onToggleSelected={() => onToggleSelected(group.id)}
          renderGroupActions={renderGroupActions}
        />
      ))}
    </div>
  );
}

function HistoryView({ groups, onToggleSelected, selectedIds }: {
  groups: ExecutionGroup[];
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
}) {
  const events = groups.flatMap(group => {
    const groupEvents = group.events?.length
      ? group.events
      : [{
          id: `${group.id}:summary`,
          timestamp: group.startedAt,
          type: group.category,
          title: group.title,
          description: group.subtitle,
          status: group.status,
          metadata: group.metadata,
        }];
    return groupEvents.map(event => ({ ...event, group }));
  }).sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <button
          key={`${event.group.id}:${event.id}`}
          type="button"
          onClick={() => onToggleSelected(event.group.id)}
          className={cn(
            "w-full rounded-lg border bg-card/60 p-4 text-left transition hover:border-primary/40",
            selectedIds.has(event.group.id) && "border-primary/50"
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="truncate text-sm font-semibold">{event.title}</span>
              <Badge variant="outline" className="text-[10px]">{event.type}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">{formatTime(event.timestamp)}</span>
          </div>
          {event.description && <p className="mt-2 text-xs text-muted-foreground line-clamp-3">{event.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={String(event.status || event.group.status)} />
            {event.actor && <Badge variant="secondary" className="text-[10px]">{event.actor}</Badge>}
            <Badge variant="outline" className="text-[10px]">{event.group.title}</Badge>
          </div>
        </button>
      ))}
    </div>
  );
}

export function ExecutionExplorer({
  title,
  description,
  status = "pending",
  groups,
  relationships = [],
  metadata = [],
  lastUpdatedAt,
  isLive,
  defaultView = "compact",
  emptyMessage = "No execution groups available yet.",
  className,
  isLoading = false,
  onFilterChange,
  renderGroupActions,
  renderGroupDetail,
}: ExecutionExplorerProps) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [hideChildren, setHideChildren] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const categories = useMemo(() => Array.from(new Set(groups.map(group => group.category))).sort(), [groups]);
  const statuses = useMemo(() => Array.from(new Set(groups.map(group => normalizeStatus(group.status)))).sort(), [groups]);

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter(group => {
      if (hideChildren && group.isChild) return false;
      if (selectedCategories.length && !selectedCategories.includes(group.category)) return false;
      if (selectedStatuses.length && !selectedStatuses.includes(normalizeStatus(group.status))) return false;
      if (!needle) return true;
      return [group.title, group.subtitle, group.category, ...((group.events || []).map(e => `${e.title} ${e.description || ""}`))]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [groups, hideChildren, query, selectedCategories, selectedStatuses]);

  const pinnedGroups = filteredGroups.filter(group => selectedIds.has(group.id));

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleListValue = (value: string, values: string[], setter: (next: string[]) => void) => {
    setter(values.includes(value) ? values.filter(v => v !== value) : [...values, value]);
  };

  if (isLoading) {
    return (
      <Card className={cn("overflow-hidden", className)}>
        <CardHeader className="border-b bg-card/60">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          Loading execution history…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="space-y-4 border-b bg-card/60">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Layers3 className="h-5 w-5 text-primary" />
                {title}
              </CardTitle>
              <StatusBadge status={status} />
              <Badge variant="outline" className={cn("gap-1 text-[10px]", isLive ? "border-emerald-400/30 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
                <Activity className={cn("h-3 w-3", isLive && "animate-pulse")} />
                {isLive ? "Live" : "Paused"}
              </Badge>
            </div>
            {description && <CardDescription className="mt-1">{description}</CardDescription>}
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>{filteredGroups.length} of {groups.length} groups</div>
            {lastUpdatedAt && <div>Updated {formatTime(lastUpdatedAt)}</div>}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="Search groups, events, actors, metadata"
            />
          </div>
          <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
            <Checkbox checked={hideChildren} onCheckedChange={(checked) => setHideChildren(Boolean(checked))} />
            Hide child runs
          </label>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
              <Filter className="h-3 w-3" />
              Type
            </span>
            {categories.map(category => (
              <button
                key={category}
                type="button"
                onClick={() => toggleListValue(category, selectedCategories, setSelectedCategories)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[10px] font-bold uppercase transition",
                  selectedCategories.includes(category) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/40"
                )}
              >
                {category}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Status</span>
            {statuses.map(item => (
              <button
                key={item}
                type="button"
                onClick={() => toggleListValue(item, selectedStatuses, setSelectedStatuses)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[10px] font-bold uppercase transition",
                  selectedStatuses.includes(item) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/40"
                )}
              >
                {statusStyles[item].label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Tabs defaultValue={defaultView} className="w-full">
          <div className="border-b px-4 pt-4">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="compact">Compact</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="history">Full History</TabsTrigger>
              <TabsTrigger value="relationships">Relationships</TabsTrigger>
              <TabsTrigger value="metadata">Metadata</TabsTrigger>
            </TabsList>
          </div>

          <div className="p-4">
            {filteredGroups.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
            ) : (
              <>
                <TabsContent value="compact" className="mt-0">
                  <CompactView groups={filteredGroups} selectedIds={selectedIds} onToggleSelected={toggleSelected} renderGroupActions={renderGroupActions} />
                </TabsContent>
                <TabsContent value="table" className="mt-0">
                  <TableView groups={filteredGroups} selectedIds={selectedIds} onToggleSelected={toggleSelected} renderGroupActions={renderGroupActions} />
                </TabsContent>
                <TabsContent value="timeline" className="mt-0">
                  <TimelineView groups={filteredGroups} selectedIds={selectedIds} onToggleSelected={toggleSelected} renderGroupActions={renderGroupActions} />
                </TabsContent>
                <TabsContent value="history" className="mt-0">
                  <HistoryView groups={filteredGroups} selectedIds={selectedIds} onToggleSelected={toggleSelected} />
                </TabsContent>
              </>
            )}

            <TabsContent value="relationships" className="mt-0">
              <div className="grid gap-3 md:grid-cols-2">
                {relationships.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground md:col-span-2">No relationships recorded yet.</div>
                ) : relationships.map(item => (
                  <a
                    key={item.id}
                    href={item.href}
                    className={cn("rounded-lg border bg-card/60 p-4 transition", item.href && "hover:border-primary/40")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          {item.type === "parent" ? <GitBranch className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                          {item.label}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{item.value}</p>
                      </div>
                      {item.status && <StatusBadge status={String(item.status)} />}
                    </div>
                  </a>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="metadata" className="mt-0">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {metadata.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">No metadata captured yet.</div>
                ) : metadata.map(item => (
                  <div key={item.label} className="rounded-lg border bg-card/60 p-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-muted-foreground">
                      <Database className="h-3 w-3" />
                      {item.label}
                    </div>
                    <div className="mt-2 break-words text-sm font-medium">{item.value}</div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {pinnedGroups.length > 0 && (
          <div className="border-t bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Pin className="h-4 w-4 text-primary" />
                Pinned Comparisons
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            </div>
            <ScrollArea className="max-h-[420px]">
              <div className="grid gap-3 lg:grid-cols-2">
                {pinnedGroups.map(group => (
                  <div key={group.id} className="rounded-lg border bg-background p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold">{group.title}</h4>
                        <p className="mt-1 text-xs text-muted-foreground">{group.subtitle || group.category}</p>
                      </div>
                      <StatusBadge status={group.status} />
                    </div>
                    <div className="mt-4 space-y-3">
                      {renderGroupDetail?.(group) || (
                        <div className="space-y-2 text-xs">
                          {Object.entries(group.metadata || {}).map(([key, value]) => (
                            <div key={key} className="grid grid-cols-[9rem_1fr] gap-3 border-b border-border/50 pb-2 last:border-0">
                              <span className="font-semibold text-muted-foreground">{key}</span>
                              <span className="min-w-0 break-words">{metadataValue(value)}</span>
                            </div>
                          ))}
                          {!group.metadata && <p className="text-muted-foreground">No additional details for this group.</p>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ExecutionExplorer;
