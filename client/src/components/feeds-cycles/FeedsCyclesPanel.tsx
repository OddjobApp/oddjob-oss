/**
 * Feeds & Cycles mode panel.
 *
 * The operational half of the hat-menu triad: what work is running (operational
 * cycles) and what is feeding it (signal feeds). Both halves are live —
 * `/api/cycles` and `/api/signal-feeds` — and the feed side is actionable,
 * because a degraded feed you cannot re-poll from here is just a report.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  GitBranch,
  RadioTower,
  RefreshCw,
  Rocket,
  Rss,
  Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';

// ---------------------------------------------------------------------------
// Contracts — mirror the API responses, not the DB rows.
// ---------------------------------------------------------------------------

interface CycleDto {
  id: number;
  name: string;
  objective: string;
  status: string;
  priority: number | null;
  /** drizzle `decimal()` serialises as a STRING, never a number. */
  budgetLimitUsd: string | null;
  currentSpendUsd: string | null;
  startDate: string | null;
  endDate: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

interface CyclesResponse {
  cycles: CycleDto[];
  total: number;
}

interface FeedDto {
  id: number;
  name: string;
  sourceType: string;
  url: string;
  pollingIntervalSeconds: number;
  enabled: boolean;
  status: string;
  consecutiveFailures: number;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
}

/**
 * `GET /api/missions` (listMissionsWithStats). Note it carries no budget
 * fields, unlike the `missions` table — do not reach for them here.
 *
 * Org scoping is the caller's: for a super admin the endpoint defaults to
 * ALL orgs, and it is `apiRequest` appending `?orgId=` from the session that
 * narrows it. That is why these go through the default queryFn rather than a
 * bare fetch.
 */
interface MissionDto {
  id: number;
  name: string;
  objective: string | null;
  status: string;
  type: string;
  /** Optional: a list endpoint may omit columns the table defines. */
  executionStrategy?: string | null;
  organizationId: number | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

/**
 * `GET /api/workstreams` — derived from the 10 most recently updated mission
 * runs, not a table. `id` is a STRING here; `nodes` is a trace excerpt capped
 * at 5 by the server and is frequently empty.
 */
interface WorkstreamDto {
  id: string;
  name: string;
  type: string;
  status: string;
  lastActivity: string | null;
  nodes: Array<{ id: string; type: string; label: string; sourceType: string; createdAt: string }>;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/**
 * Cycle statuses that mean "currently consuming budget and attention".
 *
 * Two vocabularies are in play and neither is a subset of the other: the
 * `operational_cycles` schema comment documents
 * `planning | pending_approval | active | paused | reviewing | closed | cancelled`,
 * while what the API actually serves — including `DemoSeedService.getDemoCycles()`,
 * which `GET /api/cycles` falls back to on an empty org — is **`running`**.
 * Recognising only the documented set made this panel report "0 live cycles"
 * while two were plainly listed beneath it.
 */
const LIVE_CYCLE_STATUSES = new Set([
  'active',
  'running',
  'reviewing',
  'pending_approval',
]);

const CYCLE_STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  running: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  completed: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  planning: 'bg-muted text-muted-foreground border-border',
  pending_approval: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  reviewing: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  closed: 'bg-muted text-muted-foreground border-border',
  cancelled: 'bg-destructive/15 text-destructive-foreground border-destructive/30',
  failed: 'bg-destructive/15 text-destructive-foreground border-destructive/30',
};

const FEED_STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  degraded: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  disabled: 'bg-muted text-muted-foreground border-border',
};

/**
 * Shared by missions and workstreams — both are `mission_runs`-shaped.
 * Observed live: missions are `draft` | `active`; workstreams are `active` |
 * `failed`. The rest are defensive, since neither endpoint documents a closed
 * set and `running` already caught this panel out once for cycles.
 */
const RUN_STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  running: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  completed: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  draft: 'bg-muted text-muted-foreground border-border',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  failed: 'bg-destructive/15 text-destructive-foreground border-destructive/30',
  cancelled: 'bg-destructive/15 text-destructive-foreground border-destructive/30',
  archived: 'bg-muted text-muted-foreground border-border',
};

/** Missions/workstreams currently doing work. */
const LIVE_RUN_STATUSES = new Set(['active', 'running', 'pending']);

/** How many missions to show before collapsing to a count. */
const MISSION_PREVIEW_LIMIT = 6;

/**
 * Parses a drizzle decimal. Returns null rather than NaN so callers can decide
 * what "unknown" looks like instead of rendering "NaN".
 */
function parseDecimal(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatUsd(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 100 ? 2 : 0,
  });
}

/** Compact relative time. Absolute dates are noise at a glance. */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';

  const deltaMs = Date.now() - then;
  const future = deltaMs < 0;
  const mins = Math.round(Math.abs(deltaMs) / 60000);

  const label =
    mins < 1 ? 'just now'
      : mins < 60 ? `${mins}m`
        : mins < 60 * 24 ? `${Math.round(mins / 60)}h`
          : `${Math.round(mins / (60 * 24))}d`;

  if (label === 'just now') return label;
  return future ? `in ${label}` : `${label} ago`;
}

function StatusPill({ status, styles }: { status: string; styles: Record<string, string> }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        styles[status] ?? 'bg-muted text-muted-foreground border-border'
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  count,
  action,
}: {
  icon: React.ElementType;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
        {count !== undefined && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {count}
          </span>
        )}
      </h3>
      {action}
    </div>
  );
}

function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[68px] w-full rounded-xl" />
      ))}
    </div>
  );
}

function ErrorNote({ what, error }: { what: string; error: unknown }) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive-foreground"
    >
      <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
      <span>
        Could not load {what}. {message}
      </span>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

function CycleCard({ cycle }: { cycle: CycleDto }) {
  const spend = parseDecimal(cycle.currentSpendUsd);
  const limit = parseDecimal(cycle.budgetLimitUsd);

  // Only a positive limit makes a ratio meaningful; a zero or absent limit
  // would otherwise render a full or infinite bar.
  const ratio = limit != null && limit > 0 && spend != null ? spend / limit : null;
  const overBudget = ratio != null && ratio > 1;

  return (
    <article
      className="rounded-xl border border-border bg-card/60 p-3 transition-colors hover:border-border/80"
      data-testid={`cycle-card-${cycle.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-foreground">{cycle.name}</h4>
          {cycle.objective && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{cycle.objective}</p>
          )}
        </div>
        <StatusPill status={cycle.status} styles={CYCLE_STATUS_STYLES} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {cycle.priority != null && <span>Priority {cycle.priority}</span>}
        {cycle.lastRunAt && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> ran {relativeTime(cycle.lastRunAt)}
          </span>
        )}
        {cycle.nextRunAt && <span>next {relativeTime(cycle.nextRunAt)}</span>}
      </div>

      {ratio != null && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Budget</span>
            <span className={cn('font-medium', overBudget ? 'text-destructive-foreground' : 'text-foreground')}>
              {formatUsd(spend)} / {formatUsd(limit)}
            </span>
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Budget used for ${cycle.name}`}
          >
            <div
              className={cn('h-full rounded-full', overBudget ? 'bg-destructive' : 'bg-primary')}
              // Clamped so an over-budget cycle cannot overflow its track; the
              // number beside it still tells the true story.
              style={{ width: `${Math.min(ratio, 1) * 100}%` }}
            />
          </div>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

function FeedRow({ feed }: { feed: FeedDto }) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/signal-feeds'] });
  };

  const toggleEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest('PATCH', `/api/signal-feeds/${feed.id}`, { enabled });
      return res.json();
    },
    onMutate: () => setActionError(null),
    onSuccess: invalidate,
    onError: (err: any) => setActionError(err?.message ?? 'Could not update the feed.'),
  });

  const pollNow = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/signal-feeds/${feed.id}/poll`);
      return res.json() as Promise<{ entries: number; events: number }>;
    },
    onMutate: () => setActionError(null),
    onSuccess: () => {
      invalidate();
      // A poll creates primitives, so anything reading them is now stale.
      queryClient.invalidateQueries({ queryKey: ['/api/event-primitives'] });
    },
    onError: (err: any) => setActionError(err?.message ?? 'Poll failed.'),
  });

  const busy = toggleEnabled.isPending || pollNow.isPending;

  return (
    <article
      className="rounded-xl border border-border bg-card/60 p-3"
      data-testid={`feed-row-${feed.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-foreground">{feed.name}</h4>
            <StatusPill status={feed.status} styles={FEED_STATUS_STYLES} />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={feed.url}>
            <span className="uppercase">{feed.sourceType}</span> · {feed.url}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => pollNow.mutate()}
            // The API rejects polling a disabled feed with a 409, so the button
            // should not offer it.
            disabled={busy || !feed.enabled}
            title={feed.enabled ? 'Poll this feed now' : 'Enable the feed to poll it'}
            data-testid={`feed-poll-${feed.id}`}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className={cn('h-3 w-3', pollNow.isPending && 'animate-spin')} />
            Poll
          </button>
          <Switch
            checked={feed.enabled}
            disabled={busy}
            onCheckedChange={(next) => toggleEnabled.mutate(next)}
            aria-label={`${feed.enabled ? 'Disable' : 'Enable'} ${feed.name}`}
            data-testid={`feed-toggle-${feed.id}`}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>every {Math.round(feed.pollingIntervalSeconds / 60) || 1}m</span>
        <span>polled {relativeTime(feed.lastPollAt)}</span>
        <span>ok {relativeTime(feed.lastSuccessAt)}</span>
        {feed.consecutiveFailures > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <AlertTriangle className="h-3 w-3" />
            {feed.consecutiveFailures} consecutive failure
            {feed.consecutiveFailures === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {pollNow.isSuccess && pollNow.data && (
        <p className="mt-2 text-[11px] text-emerald-300">
          Polled: {pollNow.data.entries} entr{pollNow.data.entries === 1 ? 'y' : 'ies'},{' '}
          {pollNow.data.events} event{pollNow.data.events === 1 ? '' : 's'} extracted.
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-2 text-[11px] text-destructive-foreground">
          {actionError}
        </p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Missions & workstreams
// ---------------------------------------------------------------------------

function MissionRow({ mission }: { mission: MissionDto }) {
  return (
    <article
      className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card/60 p-3"
      data-testid={`mission-row-${mission.id}`}
    >
      <div className="min-w-0">
        <h4 className="truncate text-sm font-semibold text-foreground">{mission.name}</h4>
        {mission.objective && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{mission.objective}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {/* Every field here is rendered only if present. A list endpoint is
              free to omit columns — `listMissionsWithStats` already omits the
              budget fields the `missions` table defines — and one absent string
              must not take the whole panel down with a `.replace` of undefined. */}
          {mission.executionStrategy && (
            <span>{mission.executionStrategy.replace(/_/g, ' ')}</span>
          )}
          {mission.updatedAt && <span>updated {relativeTime(mission.updatedAt)}</span>}
        </div>
      </div>
      <StatusPill status={mission.status} styles={RUN_STATUS_STYLES} />
    </article>
  );
}

function WorkstreamRow({ workstream }: { workstream: WorkstreamDto }) {
  // The server caps `nodes` at 5 and it is empty for most runs, so treat it as
  // a bonus rather than the row's substance.
  const trace = workstream.nodes?.slice(0, 3) ?? [];

  return (
    <article
      className="rounded-xl border border-border bg-card/60 p-3"
      data-testid={`workstream-row-${workstream.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-foreground">{workstream.name}</h4>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="capitalize">{workstream.type}</span>
            <span>active {relativeTime(workstream.lastActivity)}</span>
          </div>
        </div>
        <StatusPill status={workstream.status} styles={RUN_STATUS_STYLES} />
      </div>

      {trace.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {trace.map((node) => (
            <li key={node.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
              <span className="truncate">{node.label}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function FeedsCyclesPanel() {
  const queryClient = useQueryClient();

  const cyclesQuery = useQuery<CyclesResponse>({
    // Bounded: this is an at-a-glance panel, not the cycles console.
    queryKey: ['/api/cycles?limit=25'],
  });
  const feedsQuery = useQuery<FeedDto[]>({
    queryKey: ['/api/signal-feeds'],
  });
  const missionsQuery = useQuery<MissionDto[]>({
    queryKey: ['/api/missions'],
  });
  const workstreamsQuery = useQuery<WorkstreamDto[]>({
    queryKey: ['/api/workstreams'],
  });

  const cycles = cyclesQuery.data?.cycles ?? [];
  const feeds = feedsQuery.data ?? [];
  const missions = missionsQuery.data ?? [];
  const workstreams = workstreamsQuery.data ?? [];

  // The endpoint returns everything (88 in one org here) with no pagination, so
  // the panel ranks and truncates rather than rendering a wall of drafts.
  const rankedMissions = useMemo(() => {
    return [...missions].sort((a, b) => {
      const aLive = LIVE_RUN_STATUSES.has(a.status) ? 0 : 1;
      const bLive = LIVE_RUN_STATUSES.has(b.status) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      const at = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bt - at;
    });
  }, [missions]);

  const liveMissions = rankedMissions.filter((m) => LIVE_RUN_STATUSES.has(m.status)).length;
  const failedWorkstreams = workstreams.filter((w) => w.status === 'failed').length;

  // Live cycles first, then by priority (1 = highest), then most recent.
  const orderedCycles = useMemo(() => {
    return [...cycles].sort((a, b) => {
      const aLive = LIVE_CYCLE_STATUSES.has(a.status) ? 0 : 1;
      const bLive = LIVE_CYCLE_STATUSES.has(b.status) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      const ap = a.priority ?? 99;
      const bp = b.priority ?? 99;
      if (ap !== bp) return ap - bp;
      return b.id - a.id;
    });
  }, [cycles]);

  const liveCount = orderedCycles.filter((c) => LIVE_CYCLE_STATUSES.has(c.status)).length;
  const degradedFeeds = feeds.filter((f) => f.status === 'degraded').length;
  const activeFeeds = feeds.filter((f) => f.enabled && f.status !== 'disabled').length;
  // Declared after degradedFeeds: a const referenced above its declaration is a
  // temporal-dead-zone crash at render, not a lint nit.
  const attentionCount = degradedFeeds + failedWorkstreams;

  const refreshAll = () => {
    for (const key of ['/api/cycles?limit=25', '/api/signal-feeds', '/api/missions', '/api/workstreams']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const refreshing =
    cyclesQuery.isFetching ||
    feedsQuery.isFetching ||
    missionsQuery.isFetching ||
    workstreamsQuery.isFetching;

  return (
    <div className="flex h-full flex-col" data-testid="feeds-cycles-panel">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Feeds &amp; Cycles</h2>
          <p className="text-sm text-muted-foreground">
            Monitor active cycles, manage feeds, and track missions
          </p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          disabled={refreshing}
          data-testid="feeds-cycles-refresh"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 border-b border-border px-4 py-3 sm:grid-cols-4">
        <SummaryTile
          icon={Activity}
          label="Live cycles"
          value={cyclesQuery.isLoading ? null : liveCount}
          hint={`${orderedCycles.length} total`}
        />
        <SummaryTile
          icon={Rocket}
          label="Live missions"
          value={missionsQuery.isLoading ? null : liveMissions}
          hint={`${missions.length} total`}
        />
        <SummaryTile
          icon={Rss}
          label="Active feeds"
          value={feedsQuery.isLoading ? null : activeFeeds}
          hint={`${feeds.length} configured`}
        />
        <SummaryTile
          // One number for "what is wrong right now", rather than making the
          // operator add up a degraded feed and a failed run themselves.
          icon={attentionCount > 0 ? AlertTriangle : CheckCircle2}
          label="Needs attention"
          value={feedsQuery.isLoading || workstreamsQuery.isLoading ? null : attentionCount}
          hint={
            attentionCount > 0
              ? [
                  degradedFeeds > 0 ? `${degradedFeeds} feed${degradedFeeds === 1 ? '' : 's'}` : null,
                  failedWorkstreams > 0
                    ? `${failedWorkstreams} workstream${failedWorkstreams === 1 ? '' : 's'}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'all healthy'
          }
          tone={attentionCount > 0 ? 'warn' : 'ok'}
        />
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 space-y-6 overflow-y-auto p-4">
        <section aria-labelledby="cycles-heading">
          <SectionHeading icon={Workflow} title="Operational cycles" count={orderedCycles.length} />
          <span id="cycles-heading" className="sr-only">
            Operational cycles
          </span>

          {cyclesQuery.isLoading ? (
            <LoadingRows />
          ) : cyclesQuery.isError ? (
            <ErrorNote what="operational cycles" error={cyclesQuery.error} />
          ) : orderedCycles.length === 0 ? (
            <EmptyNote>No cycles yet. Launch one to see it tracked here.</EmptyNote>
          ) : (
            <div className="space-y-2">
              {orderedCycles.map((cycle) => (
                <CycleCard key={cycle.id} cycle={cycle} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="missions-heading">
          <SectionHeading
            icon={Rocket}
            title="Missions"
            count={missions.length}
            action={
              missions.length > 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  {liveMissions} live · {missions.length - liveMissions} idle
                </span>
              ) : undefined
            }
          />
          <span id="missions-heading" className="sr-only">
            Missions
          </span>

          {missionsQuery.isLoading ? (
            <LoadingRows rows={2} />
          ) : missionsQuery.isError ? (
            <ErrorNote what="missions" error={missionsQuery.error} />
          ) : rankedMissions.length === 0 ? (
            <EmptyNote>No missions yet.</EmptyNote>
          ) : (
            <div className="space-y-2">
              {rankedMissions.slice(0, MISSION_PREVIEW_LIMIT).map((mission) => (
                <MissionRow key={mission.id} mission={mission} />
              ))}
              {rankedMissions.length > MISSION_PREVIEW_LIMIT && (
                <p className="px-1 pt-0.5 text-[11px] text-muted-foreground" data-testid="mission-overflow">
                  + {rankedMissions.length - MISSION_PREVIEW_LIMIT} more, most recently active shown first
                </p>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="workstreams-heading">
          <SectionHeading
            icon={GitBranch}
            title="Workstreams"
            count={workstreams.length}
            action={
              failedWorkstreams > 0 ? (
                <span className="text-[11px] text-amber-300">{failedWorkstreams} failed</span>
              ) : undefined
            }
          />
          <span id="workstreams-heading" className="sr-only">
            Workstreams
          </span>

          {workstreamsQuery.isLoading ? (
            <LoadingRows rows={2} />
          ) : workstreamsQuery.isError ? (
            <ErrorNote what="workstreams" error={workstreamsQuery.error} />
          ) : workstreams.length === 0 ? (
            <EmptyNote>No active workstreams. They appear as mission runs progress.</EmptyNote>
          ) : (
            <div className="space-y-2">
              {workstreams.map((w) => (
                <WorkstreamRow key={w.id} workstream={w} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="feeds-heading">
          <SectionHeading icon={RadioTower} title="Signal feeds" count={feeds.length} />
          <span id="feeds-heading" className="sr-only">
            Signal feeds
          </span>

          {feedsQuery.isLoading ? (
            <LoadingRows rows={2} />
          ) : feedsQuery.isError ? (
            <ErrorNote what="signal feeds" error={feedsQuery.error} />
          ) : feeds.length === 0 ? (
            <EmptyNote>
              No signal feeds configured. Add one from Signal Intelligence to start ingesting.
            </EmptyNote>
          ) : (
            <div className="space-y-2">
              {feeds.map((feed) => (
                <FeedRow key={feed.id} feed={feed} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  icon: React.ElementType;
  label: string;
  value: number | null;
  hint?: string;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            tone === 'warn' && 'text-amber-300',
            tone === 'ok' && 'text-emerald-300'
          )}
        />
        {label}
      </div>
      {value === null ? (
        <Skeleton className="mt-1 h-7 w-10" />
      ) : (
        <div
          className={cn(
            'mt-0.5 text-2xl font-semibold tabular-nums',
            tone === 'warn' ? 'text-amber-300' : 'text-foreground'
          )}
        >
          {value}
        </div>
      )}
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default FeedsCyclesPanel;
