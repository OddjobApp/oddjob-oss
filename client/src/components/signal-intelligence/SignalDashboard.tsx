import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@domain-ui/auth/ui/modules/auth/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Activity,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Gauge,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Settings2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Wand2,
  History,
  Server,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseSpatialContext, replaceSpatialContext } from '@/lib/spatial-context';
import { ImpactVisualization } from './spatial/ImpactVisualization';
import { SlideOverPanel } from './spatial/SlideOverPanel';
import { EntityDetailPanel } from './spatial/EntityDetailPanel';
import { EmptyState } from './spatial/EmptyState';
import { ViewSwitcher } from './spatial/ViewSwitcher';
import { WizardProvider } from './spatial/WizardContext';
import { SignalIntelligenceWizard } from './spatial/SignalIntelligenceWizard';
import { WorkflowSummaryCard } from './spatial/WorkflowSummaryCard';
import { WorkflowDetailView } from './spatial/WorkflowDetailView';
import { getWorkflowHistory } from './spatial/WorkflowHistory';
import type { WorkflowOutput } from './spatial/WorkflowHistory';
import { ViewContainer, type ViewPanelConfig } from './spatial/ViewContainer';
import { SignalFeedPanel } from './spatial/SignalFeedPanel';
import { GraphView } from './spatial/GraphView';
import { ScenariosView } from './spatial/ScenariosView';
import { EventStreamView } from './spatial/EventStreamView';
import { SourcesView } from './spatial/SourcesView';
import { EventSourceWizard } from './spatial/EventSourceWizard';
import { EventSourceCatalog } from './spatial/EventSourceCatalog';
import { EventBackboneView } from './spatial/EventBackboneView';
import { SubscriptionsView } from './spatial/SubscriptionsView';
import { SpatialH3MapPanel, OperationalSummaryPanel } from '@/modules/operations/pages/PredictionIntelligenceDashboard';
import { OnboardingOverlay } from './spatial/OnboardingOverlay';
import { StageRail, type StageId, type StageState } from './spatial/StageRail';
import { FreshnessIndicator } from './spatial/FreshnessIndicator';
import { useSseConnection } from './spatial/useSseConnection';
import { useBulkActions } from './spatial/use-bulk-actions';
import type { FilterState, SortOption, ViewId, IntelligenceSignal } from './spatial/utils';
import { toIntelligenceSignal } from './spatial/utils';

export interface SignalDashboardProps {
  organizationId?: number;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
}

interface EventPrimitiveDto { id: string; eventType: string; targetSector: string; jurisdiction: string; severity: string; confidenceScore: number; rawText: string | null; extractionTimestamp: string; }
interface FeedDto { id: number; name: string; sourceType: string; url: string; status: string; enabled: boolean; pollingIntervalSeconds: number; }
interface CycleDto { id: number; name: string; objective: string; status: string; }
interface CyclesResponse { cycles: CycleDto[]; total: number; }
interface SubscriptionDto { id: number; cycleId: number; name: string; deliveryMode: string; enabled: boolean; }
interface CausalLinkDto { id: string; targetEntityType: string; targetEntityId: string; impactConfidence: number; blastRadius: number; }
interface KafkaStatusDto {
  broker: { enabled: boolean; connected: boolean; lastError: string | null };
  outbox: Array<{ status: string; count: number }>;
  inbox: Array<{ status: string; count: number }>;
  recentFailures: Array<{ id: string; eventId: string; topic: string; attempts: number; lastError: string | null; updatedAt: string }>;
  lag: { total: number; topics: Record<string, number> };
  oldestPendingSeconds: number;
}

const PLAYS = [
  { icon: Megaphone, title: 'Launch coordinated response', detail: 'Create a governed cross-functional response cycle', impact: 'Governed', time: 'Now' },
  { icon: CircleDollarSign, title: 'Model operating impact', detail: 'Test the signal against active plans and assumptions', impact: 'Simulation', time: 'On demand' },
  { icon: Users, title: 'Assign accountable cycle', detail: 'Route future matching events into an existing cycle', impact: 'World state', time: 'Continuous' },
  { icon: Sparkles, title: 'Run counterfactual', detail: 'Compare a response with the current modeled state', impact: 'Read only', time: 'On demand' },
];

// ─── localStorage keys for persistence ────────────────────────────────────────

const SORT_STORAGE_KEY = 'oddjob:spatial:sort';
const FILTER_STORAGE_KEY = 'oddjob:spatial:filter';

const DEFAULT_FILTER: FilterState = {
  kind: 'all',
  query: '',
  severities: new Set<string>(),
  minConfidence: 0,
  timeRange: 'all',
};

const DEFAULT_SORT: SortOption = 'severity';

// ─── localStorage helpers ─────────────────────────────────────────────────────

function loadSort(): SortOption {
  try {
    const stored = localStorage.getItem(SORT_STORAGE_KEY);
    if (stored && ['severity', 'confidence', 'recency', 'blast-radius'].includes(stored)) {
      return stored as SortOption;
    }
  } catch { /* ignore */ }
  return DEFAULT_SORT;
}

function loadFilter(): FilterState {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTER;
    const parsed = JSON.parse(raw);
    return {
      kind: parsed.kind ?? 'all',
      query: parsed.query ?? '',
      severities: new Set<string>(parsed.severities ?? []),
      minConfidence: parsed.minConfidence ?? 0,
      timeRange: parsed.timeRange ?? 'all',
    };
  } catch { /* ignore */ }
  return DEFAULT_FILTER;
}

function persistSort(sort: SortOption): void {
  try { localStorage.setItem(SORT_STORAGE_KEY, sort); } catch { /* ignore */ }
}

function persistFilter(filter: FilterState): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
      kind: filter.kind,
      query: filter.query,
      severities: Array.from(filter.severities),
      minConfidence: filter.minConfidence,
      timeRange: filter.timeRange,
    }));
  } catch { /* ignore */ }
}

/** A stage's secondary action — deliberately quieter than the primary CTA. */
function SecondaryAction({
  onClick,
  icon: Icon,
  children,
  testid,
  dot,
  active,
}: {
  onClick: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
  testid?: string;
  dot?: 'ok' | 'bad' | 'idle';
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      data-active={active || undefined}
      className={cn(
        'inline-flex min-h-[36px] items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-card text-foreground hover:bg-accent',
      )}
    >
      {dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            dot === 'ok' ? 'bg-emerald-400' : dot === 'bad' ? 'bg-red-400' : 'bg-muted-foreground'
          )}
        />
      )}
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

/** One glanceable number. Replaces a full-width tile that mostly read zero. */
function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger';
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          // Only colour a number that is actually saying something; a zero
          // risk count in red reads as an alert when it is the opposite.
          value === 0 ? 'text-muted-foreground' : tone === 'danger' ? 'text-red-400' : tone === 'success' ? 'text-emerald-400' : 'text-foreground'
        )}
      >
        {value}
      </span>
      <span>{label}</span>
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SignalDashboardInner({
  organizationId: propOrganizationId,
  isFullScreen: propFullScreen,
  onToggleFullScreen,
}: SignalDashboardProps) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const organizationId = propOrganizationId ?? user?.defaultOrgId ?? 1;
  const initialContext = useMemo(() => parseSpatialContext(window.location.search), []);
  const queryClient = useQueryClient();

  const [internalFullScreen, setInternalFullScreen] = useState(false);
  const isFullScreenEffective = propFullScreen ?? internalFullScreen;
  const toggleFullScreen = onToggleFullScreen ?? (() => setInternalFullScreen((v) => !v));

  useEffect(() => {
    // Only listen for Escape if managing internal full screen directly
    if (onToggleFullScreen || !internalFullScreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setInternalFullScreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [internalFullScreen, onToggleFullScreen]);

  // ─── Data queries ─────────────────────────────────────────────────────────
  const { data: events = [], isLoading: eventsLoading } = useQuery<EventPrimitiveDto[]>({ queryKey: ['/api/event-primitives?limit=100'] });
  const { data: feeds = [] } = useQuery<FeedDto[]>({ queryKey: ['/api/signal-feeds'] });
  const { data: cyclesData } = useQuery<CyclesResponse>({ queryKey: ['/api/cycles?limit=100'] });
  const { data: subscriptions = [] } = useQuery<SubscriptionDto[]>({ queryKey: ['/api/cycle-signal-subscriptions'] });
  const { data: ruleSuites = [] } = useQuery<Array<{ enabled: boolean; enabledRuleCount: number }>>({ queryKey: ['/api/rule-suites'] });
  const { data: kafkaStatus } = useQuery<KafkaStatusDto>({
    queryKey: ['/api/spatial/kafka/status'],
    refetchInterval: 15_000,
  });

  // ─── Derived signals ──────────────────────────────────────────────────────
  const signals = useMemo<IntelligenceSignal[]>(() => events.map((event) => toIntelligenceSignal(event)), [events]);
  const activeRuleCount = subscriptions.filter((subscription) => subscription.enabled).length
    + ruleSuites.filter((suite) => suite.enabled).reduce((sum, suite) => sum + suite.enabledRuleCount, 0);

  // ─── Top-level state ──────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ViewId>((initialContext.view as ViewId) ?? 'signals');
  const [isBusinessMode, setIsBusinessMode] = useState(true);
  /**
   * The Detect → Decide → Act spine. `activeView` still drives the secondary
   * surfaces (sources, backbone) and the URL, so deep links keep working; the
   * stage is what the operator actually navigates.
   */
  const [stage, setStage] = useState<StageId>('detect');
  const [selectedId, setSelectedId] = useState<string | null>(initialContext.signalId ?? null);
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortOption>(loadSort);
  const [filter, setFilter] = useState<FilterState>(loadFilter);
  const [slideOver, setSlideOver] = useState<{ entityType: string; entityId: string } | null>(null);
  const [dialog, setDialog] = useState<'sources' | 'wizard' | 'catalog' | 'scenario' | 'subscribe' | 'kafka' | null>(
    initialContext.scenarioId ? 'scenario' : null,
  );
  const [feedDrawerOpen, setFeedDrawerOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowOutput | null>(null);
  const slideOverTriggerRef = useRef<HTMLElement>(null);

  // ─── SSE Connection ───────────────────────────────────────────────────────
  const sse = useSseConnection();

  // ─── Bulk Actions ─────────────────────────────────────────────────────────
  const bulkActions = useBulkActions({
    onSuccess: () => setMultiSelect(new Set()),
  });

  // ─── Derived selected signal & causal links ───────────────────────────────
  const selected = selectedId ? signals.find((signal) => signal.id === selectedId) ?? null : null;
  const { data: causalLinks = [], isLoading: causalLinksLoading, isFetching: causalLinksFetching, error: causalLinksError, refetch: refetchCausalLinks } = useQuery<CausalLinkDto[]>({
    queryKey: [`/api/causal-graph/links/${selected?.id ?? 'none'}`],
    enabled: Boolean(selected),
    retry: (failureCount, error) => {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      return (error?.name === 'AbortError' || message.includes('aborted')) && failureCount < 2;
    },
    refetchOnMount: 'always',
  });

  // ─── Sync activeView to URL ───────────────────────────────────────────────
  useEffect(() => {
    replaceSpatialContext({
      ...initialContext,
      signalId: selected?.id,
      view: activeView,
    });
  }, [initialContext, selected, activeView]);

  // ─── Persist sort/filter to localStorage ──────────────────────────────────
  const handleSortChange = useCallback((newSort: SortOption) => {
    setSortBy(newSort);
    persistSort(newSort);
  }, []);

  const handleFilterChange = useCallback((newFilter: FilterState) => {
    setFilter(newFilter);
    persistFilter(newFilter);
  }, []);

  // ─── View change handler ──────────────────────────────────────────────────
  const handleViewChange = useCallback((view: ViewId) => {
    setActiveView(view);
  }, []);

  // ─── Multi-select handler ─────────────────────────────────────────────────
  const handleMultiSelectToggle = useCallback((id: string) => {
    setMultiSelect((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  // ─── Bulk action handler ──────────────────────────────────────────────────
  const handleBulkAction = useCallback((action: 'dismiss' | 'escalate' | 'snooze', ids: string[]) => {
    if (action === 'dismiss') bulkActions.dismiss(ids);
    else if (action === 'escalate') bulkActions.escalate(ids);
    else bulkActions.snooze(ids, '1h');
  }, [bulkActions]);

  const handleBulkSnooze = useCallback((ids: string[], duration: '15m' | '1h' | '4h' | '24h') => {
    bulkActions.snooze(ids, duration);
  }, [bulkActions]);

  // ─── Launch cycle mutation ────────────────────────────────────────────────
  const launchCycle = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Select a signal first');
      const response = await apiRequest('POST', '/api/cycles/launch', {
        name: `Response: ${selected.title.slice(0, 70)}`,
        description: `Governed response cycle created from intelligence signal ${selected.id}`,
        objective: `Assess and respond to: ${selected.title}`,
        priority: selected.kind === 'threat' ? 2 : 5,
        requiresApproval: 1,
        metadata: { source: 'signal-intelligence', eventPrimitiveId: selected.id },
        blueprints: [{ name: 'Signal impact assessment', objective: `Validate impact, options, and response for ${selected.title}`, type: 'mission', config: { reasoningProtocol: 'json_manifest' } }],
      });
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/cycles?limit=100'] }),
  });

  // ─── View panels config ───────────────────────────────────────────────────
  /**
   * Selecting a signal is the act of moving from "what arrived" to "what it
   * means", so the spine follows rather than making the operator click twice.
   * Only advances forward: someone who has stepped back to Detect on purpose
   * should not be yanked to Decide by a stale selection.
   */
  useEffect(() => {
    if (selectedId && stage === 'detect') setStage('decide');
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stageStates: Record<StageId, StageState> = useMemo(() => {
    const sourceCount = feeds.filter((f) => f.enabled).length;
    return {
      detect: {
        hint: signals.length
          ? `${signals.length} signal${signals.length === 1 ? '' : 's'}`
          : sourceCount
            ? 'No signals yet'
            : 'No sources connected',
        blocked: signals.length === 0,
      },
      decide: {
        hint: selected ? selected.title.slice(0, 28) : 'Select a signal',
        blocked: !selected,
      },
      act: {
        hint: selected
          ? `${activeRuleCount} rule${activeRuleCount === 1 ? '' : 's'} active`
          : 'Needs a signal',
        blocked: !selected,
      },
    };
  }, [signals.length, feeds, selected, activeRuleCount]);

  const viewPanels: ViewPanelConfig[] = useMemo(() => [
    {
      id: 'signals' as ViewId,
      content: selected ? (
        <div className="min-w-0 space-y-3" data-onboarding="impact-visualization">
          <div className="rounded-xl border border-border bg-card/35 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={cn('rounded-full px-2 py-1 text-[10px] font-semibold uppercase', selected.kind === 'opportunity' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400')}>{selected.kind}</span>
                  <span className="text-xs text-muted-foreground">Score {selected.score}</span>
                </div>
                <h2 className="mt-2 text-lg font-semibold">{selected.title}</h2>
                <p className="text-xs text-muted-foreground">{selected.subtitle} · Updated {selected.age}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Fact label="Business impact" value={selected.impact} />
              {selected.confidence && <Fact label="Confidence" value={selected.confidence} />}
              <Fact label="Affected entities" value={String(causalLinks.length)} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/35 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Impact Visualization</h3>
                <p className="text-xs text-muted-foreground">Data-driven causal relationships and affected entities</p>
              </div>
            </div>
            <div className="mt-4">
              <ImpactVisualization
                signalId={selected.id}
                causalLinks={causalLinks}
                isLoading={causalLinksLoading || causalLinksFetching}
                error={causalLinksError as Error | null}
                severity={selected.event.severity}
                onNodeClick={(entityType, entityId) => {
                  setSlideOver({ entityType, entityId });
                }}
                onRetry={() => { void refetchCausalLinks(); }}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/35 p-4">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div>
                <h3 className="text-sm font-semibold">Decision brief</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">This normalized event is available to Oddjob's causal graph, world-model bridge, governance policies, and subscribed cycles.</p>
                <div className="mt-3 space-y-2 text-xs">
                  <Evidence text={`${Math.round(selected.event.confidenceScore * 100)}% extraction confidence`} />
                  <Evidence text={`${causalLinks.length} causal graph link${causalLinks.length === 1 ? '' : 's'} identified`} />
                  <Evidence text={`${subscriptions.length} cycle subscription rule${subscriptions.length === 1 ? '' : 's'} configured`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Fact label="Severity" value={selected.event.severity} />
                <Fact label="Domain" value={selected.event.targetSector} />
                <Fact label="Scope" value={selected.event.jurisdiction} />
                <Fact label="Entities impacted" value={String(causalLinks.length)} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {['Signal Analysis', 'Business Operations', 'Risk & Compliance', 'Decision Support'].map((tag) => (
                <span key={tag} className="rounded-full border border-border bg-background/50 px-2.5 py-1 text-[10px] text-muted-foreground">{tag}</span>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setActiveView('subscriptions');
                  setDialog('subscribe');
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Bot className="h-3.5 w-3.5" /> Create Auto-Rule from Signal
              </button>
              <button
                onClick={() => launchCycle.mutate()}
                disabled={launchCycle.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" /> {launchCycle.isPending ? 'Launching...' : 'Launch Response Cycle'}
              </button>
            </div>
          </div>
        </div>
      ) : signals.length ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-border bg-card/20 px-6 text-center" data-testid="signal-selection-prompt">
          <div className="max-w-sm">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Radar className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-base font-semibold">Choose a signal to investigate</h2>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Select an item from the feed to see its impact, evidence, affected entities, and available response paths.
            </p>
          </div>
        </div>
      ) : (
        <EmptyState onConfigureSource={() => setActiveView('sources')} onInjectScenario={() => setDialog('scenario')} />
      ),
    },
    {
      id: 'sources' as ViewId,
      content: <SourcesView organizationId={organizationId} />,
    },
    {
      id: 'wizard' as ViewId,
      content: <EventSourceWizard organizationId={organizationId} onComplete={() => setActiveView('sources')} onCancel={() => setActiveView('sources')} />,
    },
    {
      id: 'catalog' as ViewId,
      content: <EventSourceCatalog organizationId={organizationId} onSubscribe={(eventType, sourceType) => setActiveView('wizard')} />,
    },
    {
      id: 'backbone' as ViewId,
      content: <EventBackboneView organizationId={organizationId} />,
    },
    {
      id: 'subscriptions' as ViewId,
      content: <SubscriptionsView organizationId={organizationId} selectedSignal={selected} />,
    },
  ], [selected, selectedId, signals.length, organizationId, causalLinks, causalLinksLoading, causalLinksError, subscriptions]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <section
      className={cn(
        "bg-background transition-all duration-200",
        isFullScreenEffective && !onToggleFullScreen
          ? "fixed inset-0 z-50 overflow-x-hidden overflow-y-auto p-4 md:p-6"
          : "h-full overflow-x-hidden overflow-y-auto"
      )}
      aria-label="Business Intelligence"
      data-testid="signal-dashboard-panel"
    >
      <OnboardingOverlay onComplete={() => {}} onSkip={() => {}} />

      <div className="w-full space-y-4 px-2 py-3 sm:px-3 lg:px-4">
        {/* ─── Header ──────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-4 border-b border-border/70 pb-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className={cn(
              "mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]",
              sse.sseStatus === 'live' ? 'text-emerald-400' : sse.sseStatus === 'reconnecting' ? 'text-amber-400' : 'text-muted-foreground',
            )}>
              <span className={cn("h-2 w-2 rounded-full", sse.sseStatus === 'live' ? 'bg-emerald-400' : sse.sseStatus === 'reconnecting' ? 'bg-amber-400' : 'bg-muted-foreground')} />
              Realtime Stream · {sse.sseStatus === 'live' ? 'Live' : sse.sseStatus === 'reconnecting' ? 'Reconnecting' : 'Standby (Polling Active)'}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="signal-studio-heading">Signal Studio</h1>
            <p className="mt-1 text-sm text-muted-foreground">Market intelligence, modeled impact, and recommended action across the enterprise.</p>
          </div>
          {/* Only what is global lives up here now: freshness, the density
              preference, and the one primary action. Everything else moved
              beneath the stage it belongs to. */}
          <div className="flex flex-wrap items-center gap-2">
            <FreshnessIndicator
              lastFetchTime={sse.lastFetchTime}
              sseStatus={sse.sseStatus}
              lastEventTime={sse.lastEventTime}
              onReconnect={sse.onReconnect}
              onRefresh={sse.onRefresh}
              isRefreshing={sse.isRefreshing}
            />
            {/* Was a "Business View / Technical Mode" pair competing with the
                view tabs for attention. It only ever swapped label wording, so
                it is a density preference, not navigation. */}
            <button
              type="button"
              onClick={() => setIsBusinessMode((v) => !v)}
              aria-pressed={!isBusinessMode}
              data-testid="density-toggle"
              title="Switch between business and technical wording"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {isBusinessMode ? 'Business wording' : 'Technical wording'}
            </button>
            <button
              type="button"
              onClick={toggleFullScreen}
              aria-pressed={isFullScreenEffective}
              data-testid="signal-dashboard-fullscreen-toggle"
              title={isFullScreenEffective ? "Exit Full Screen (Esc)" : "Full Screen Focus"}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isFullScreenEffective ? <Minimize2 className="h-3.5 w-3.5 text-primary" /> : <Maximize2 className="h-3.5 w-3.5 text-primary" />}
              <span>{isFullScreenEffective ? 'Exit Full Screen' : 'Full Screen'}</span>
            </button>
            <button
              onClick={() => navigate('/signal-intelligence/wizard')}
              data-testid="start-wizard"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Wand2 className="h-4 w-4" /> Start Wizard
            </button>
          </div>
        </header>

        {/* ─── Context banner ────────────────────────────────────────── */}
        {(initialContext.entityRefs[0] || initialContext.scenarioId) && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs" role="status">
            <span className="font-semibold text-primary">Opened from workspace context</span>
            {initialContext.entityRefs[0] && (
              <span className="rounded-full border border-border bg-background/60 px-2 py-1">
                {initialContext.entityRefs[0].type}: {initialContext.entityRefs[0].id}
              </span>
            )}
            {initialContext.scenarioId && (
              <span className="rounded-full border border-border bg-background/60 px-2 py-1">
                Scenario: {initialContext.scenarioId}
              </span>
            )}
          </div>
        )}

        {/* ─── The spine ─────────────────────────────────────────────── */}
        <div data-onboarding="view-switcher">
          <StageRail
            activeStage={stage}
            onStageChange={(next) => {
              setStage(next);
              // The stage owns the main column. Detect and Decide are both the
              // 'signals' view — they differ by whether a signal is selected —
              // while Act is the rules surface. Secondary actions can still
              // push a different view within a stage without losing the stage.
              setActiveView(next === 'act' ? 'subscriptions' : 'signals');
            }}
            states={stageStates}
          />
        </div>

        {/* ─── Stage-scoped secondary actions ────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2" data-testid="stage-actions">
          {stage === 'detect' && (
            <>
              <SecondaryAction
                onClick={() => setActiveView('signals')}
                icon={Radar}
                active={activeView === 'signals'}
                testid="action-signal-feed"
              >
                {isBusinessMode ? 'Signal feed' : 'Live alerts'}
              </SecondaryAction>
              <SecondaryAction
                onClick={() => setActiveView('sources')}
                icon={Server}
                active={activeView === 'sources'}
                testid="action-sources"
              >
                {isBusinessMode ? 'Sources' : 'Signal sources'}
              </SecondaryAction>
              <SecondaryAction
                onClick={() => setActiveView('wizard')}
                icon={Sparkles}
                active={activeView === 'wizard'}
                testid="action-add-source"
              >
                {isBusinessMode ? 'Add source' : 'Source wizard'}
              </SecondaryAction>
              <SecondaryAction
                onClick={() => setActiveView('catalog')}
                icon={Settings2}
                active={activeView === 'catalog'}
                testid="action-catalog"
              >
                {isBusinessMode ? 'Event catalog' : 'Configure sources'}
              </SecondaryAction>
              <SecondaryAction
                onClick={() => { setActiveView('backbone'); }}
                icon={Activity}
                active={activeView === 'backbone'}
                testid="action-backbone"
                dot={kafkaStatus?.broker.connected ? 'ok' : kafkaStatus?.broker.enabled ? 'bad' : 'idle'}
              >
                {isBusinessMode ? 'Data stream' : 'Event backbone'}
              </SecondaryAction>
            </>
          )}
          {stage === 'decide' && (
            <SecondaryAction onClick={() => setDialog('scenario')} icon={Gauge} testid="action-scenario">
              Run counterfactual
            </SecondaryAction>
          )}
          {stage === 'act' && (
            <>
              <SecondaryAction
                onClick={() => setActiveView('subscriptions')}
                icon={Bot}
                active={activeView === 'subscriptions'}
                testid="action-rules"
              >
                {isBusinessMode ? 'Auto-rules' : 'Subscribe cycle'}
              </SecondaryAction>
              <SecondaryAction
                onClick={() => { window.location.href = '/signal-intelligence/workflows'; }}
                icon={History}
                testid="action-history"
              >
                Workflow history
              </SecondaryAction>
            </>
          )}

          {/* The five KPI tiles that led the page were four zeroes and a two.
              Demoted to one line: still glanceable, no longer the headline. */}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <StatChip label={isBusinessMode ? 'Opportunities' : 'Opps'} value={signals.filter((i) => i.kind === 'opportunity').length} tone="success" />
            <StatChip label={isBusinessMode ? 'Risks' : 'Material risks'} value={signals.filter((i) => i.kind === 'threat').length} tone="danger" />
            <StatChip label="Sources" value={feeds.filter((i) => i.enabled).length} />
            <StatChip label="Rules" value={activeRuleCount} />
            <StatChip label="Cycles" value={cyclesData?.total ?? 0} />
          </div>
        </div>

        {/* ─── Main content grid ─────────────────────────────────────── */}
        {activeView === 'signals' ? (
          <div className="relative grid min-h-[590px] grid-cols-1 gap-3 xl:grid-cols-[280px_minmax(420px,1fr)_290px]">
            {/* Signal Feed Drawer Toggle — visible only at lg breakpoint */}
            <button
              type="button"
              onClick={() => setFeedDrawerOpen((v) => !v)}
              className="absolute left-0 top-0 z-10 hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-br-lg border-b border-r border-border bg-card lg:flex xl:hidden"
              aria-label={feedDrawerOpen ? 'Close signal feed' : 'Open signal feed'}
              aria-expanded={feedDrawerOpen}
              data-testid="feed-drawer-toggle"
            >
              {feedDrawerOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>

            {/* Drawer backdrop */}
            {feedDrawerOpen && (
              <div
                className="fixed inset-0 z-10 hidden bg-black/20 lg:block xl:hidden"
                onClick={() => setFeedDrawerOpen(false)}
                aria-hidden="true"
                data-testid="feed-drawer-backdrop"
              />
            )}

            {/* ─── Signal Feed Panel ─────────────────────────────────────── */}
            <div
              className={cn(
                'lg:absolute lg:inset-y-0 lg:left-0 lg:z-20 lg:h-full lg:w-[260px] lg:shadow-lg lg:transition-transform lg:duration-200',
                feedDrawerOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full',
                'xl:static xl:z-auto xl:h-auto xl:w-auto xl:translate-x-0 xl:shadow-none xl:transition-none',
              )}
              data-onboarding="signal-feed"
            >
              <SignalFeedPanel
                signals={signals}
                selectedId={selectedId}
                multiSelect={multiSelect}
                sortBy={sortBy}
                filter={filter}
                isLoading={eventsLoading}
                isBulkActionPending={bulkActions.isPending}
                onSelect={setSelectedId}
                onMultiSelectToggle={handleMultiSelectToggle}
                onSortChange={handleSortChange}
                onFilterChange={handleFilterChange}
                onBulkAction={handleBulkAction}
                onBulkSnooze={handleBulkSnooze}
              />
            </div>

            {/* ─── Main View Content (via ViewContainer) ─────────────────── */}
            <main id={`stage-panel-${stage}`} className="min-w-0" aria-label="Signal detail">
              <ViewContainer activeView={activeView} panels={viewPanels} />
            </main>

            {/* ─── Actions Panel ─────────────────────────────────────────── */}
            <aside className="rounded-xl border border-border bg-card/35 p-3" aria-label="Recommended Actions" data-testid="actions-panel" data-onboarding="recommended-actions">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Recommended Actions</h2>
                  <p className="text-xs text-muted-foreground">Ranked by expected outcome</p>
                </div>
                <Bot className="h-4 w-4 text-primary" />
              </div>
              {!selected && (
                <div
                  className="mt-3 rounded-lg border border-dashed border-border p-4 text-center"
                  data-testid="actions-empty"
                >
                  <p className="text-xs font-medium text-foreground">Nothing to act on yet</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {signals.length
                      ? 'Pick a signal from the feed to see the plays available for it.'
                      : 'Connect a source and ingest a signal — recommended plays appear once there is something to respond to.'}
                  </p>
                  {!signals.length && (
                    <button
                      type="button"
                      onClick={() => { setStage('detect'); setActiveView('sources'); }}
                      className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-accent"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Add a source
                    </button>
                  )}
                </div>
              )}

              <div className={cn('mt-3 space-y-2', !selected && 'hidden')}>
                {PLAYS.map(({ icon: Icon, title, detail, impact, time }, index) => (
                  <button
                    key={title}
                    disabled={!selected}
                    onClick={() => {
                      if (index === 0) {
                        launchCycle.mutate();
                      } else if (index === 1 || index === 3) {
                        setDialog('scenario');
                      } else if (index === 2) {
                        setActiveView('subscriptions');
                      }
                    }}
                    className={cn('min-h-[44px] w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 disabled:opacity-50', index === 0 ? 'border-primary/50 bg-primary/5' : 'border-border')}
                  >
                    <div className="flex gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent"><Icon className="h-4 w-4" /></span>
                      <span>
                        <span className="block text-xs font-semibold">{title}</span>
                        <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{detail}</span>
                      </span>
                    </div>
                    <div className="mt-3 flex justify-between border-t border-border/60 pt-2 text-[10px]">
                      <span><b className="text-foreground">{impact}</b> impact</span>
                      <span>{time}</span>
                    </div>
                  </button>
                ))}
              </div>
              {launchCycle.isSuccess && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Response created as a governed Oddjob Cycle!</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveView('subscriptions')}
                    className="font-semibold underline hover:text-foreground"
                  >
                    View Lineage →
                  </button>
                </div>
              )}
              {launchCycle.isError && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <span>{launchCycle.error.message}</span>
                  <button
                    type="button"
                    onClick={() => setDialog('scenario')}
                    className="font-semibold underline hover:text-foreground"
                  >
                    Open Simulator →
                  </button>
                </div>
              )}
            </aside>
          </div>
        ) : (
          <main id={`stage-panel-${stage}`} className="min-w-0 w-full" aria-label="Spatial View">
            <ViewContainer activeView={activeView} panels={viewPanels} />
          </main>
        )}
      </div>

      {/* ─── Slide-over panel for entity detail ──────────────────────── */}
      <SlideOverPanel
        open={slideOver !== null}
        onClose={() => setSlideOver(null)}
        title={slideOver ? `${slideOver.entityType}: ${slideOver.entityId}` : ''}
        description="Linked events ordered by impact confidence"
        triggerRef={slideOverTriggerRef}
      >
        {slideOver && (
          <EntityDetailPanel
            entityType={slideOver.entityType}
            entityId={slideOver.entityId}
            causalLinks={causalLinks}
          />
        )}
      </SlideOverPanel>

      {/* ─── Signal Intelligence Wizard ──────────────────────────────── */}
      {wizardOpen && (
        <SignalIntelligenceWizard
          onClose={() => setWizardOpen(false)}
          onComplete={() => setWizardOpen(false)}
        />
      )}

      {/* ─── Workflow Detail View ───────────────────────────────────── */}
      {selectedWorkflow && (
        <WorkflowDetailView
          workflow={selectedWorkflow}
          onClose={() => setSelectedWorkflow(null)}
        />
      )}
    </section>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

function Metric({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: React.ElementType; tone: 'success' | 'danger' | 'warning' | 'info' }) {
  const colors = { success: 'text-emerald-400 bg-emerald-500/10', danger: 'text-red-400 bg-red-500/10', warning: 'text-amber-400 bg-amber-500/10', info: 'text-cyan-400 bg-cyan-500/10' };
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-card/45 p-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value}</p>
        <p className={cn('mt-0.5 text-[10px]', colors[tone].split(' ')[0])}>{note}</p>
      </div>
      <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', colors[tone])}>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/35 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Evidence({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      <span>{text}</span>
    </div>
  );
}

export function SignalDashboard(props: SignalDashboardProps) {
  return (
    <WizardProvider>
      <SignalDashboardInner {...props} />
    </WizardProvider>
  );
}

export default SignalDashboard;
