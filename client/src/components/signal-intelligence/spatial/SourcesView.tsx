import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  Activity,
  Plus,
  Radio,
  RefreshCw,
  Rss,
  Globe,
  Webhook,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ShieldCheck,
  Server,
  Zap,
  Trash2,
  Pause,
  Play,
  Compass,
  Landmark,
  Scale,
  Building2,
  FileText,
  MessageSquare,
  Search,
  Check,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FeedDto {
  id: number;
  organizationId?: number;
  name: string;
  sourceType: string;
  url: string;
  status: string;
  enabled: boolean;
  pollingIntervalSeconds: number;
  consecutiveFailures?: number;
  lastPollAt?: string | null;
  lastSuccessAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SourcesViewProps {
  organizationId?: number;
  wizardMode?: boolean;
  onComplete?: () => void;
}

const SOURCE_TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; color: string; description: string; placeholderUrl: string }
> = {
  rss: {
    label: 'RSS / Atom Feed',
    icon: Rss,
    color: 'text-amber-400 bg-amber-500/10',
    description: 'XML syndication feed for news, updates, and releases',
    placeholderUrl: 'https://news.example.com/rss.xml',
  },
  rest_api: {
    label: 'REST API Endpoint',
    icon: Globe,
    color: 'text-emerald-400 bg-emerald-500/10',
    description: 'HTTP JSON endpoint polling for structured telemetry',
    placeholderUrl: 'https://api.example.com/v1/intelligence/stream',
  },
  webhook: {
    label: 'Webhook Stream',
    icon: Webhook,
    color: 'text-cyan-400 bg-cyan-500/10',
    description: 'Inbound push endpoint for third-party event webhooks',
    placeholderUrl: 'https://oddjob.internal/webhook/spatial-inbox',
  },
  geo_spatial: {
    label: 'Geospatial / H3 Telemetry',
    icon: Compass,
    color: 'text-indigo-400 bg-indigo-500/10',
    description: 'Uber H3 hexagonal position streams and AIS/vessel telemetry',
    placeholderUrl: 'https://api.geospatial.internal/v1/telemetry/stream',
  },
  sec_filing: {
    label: 'SEC Regulatory Filings (EDGAR)',
    icon: Scale,
    color: 'text-purple-400 bg-purple-500/10',
    description: 'U.S. SEC EDGAR corporate 8-K, 10-Q and regulatory filings',
    placeholderUrl: 'https://www.sec.gov/news/pressreleases.rss',
  },
  eu_legislative: {
    label: 'EU Legislative Monitor',
    icon: Landmark,
    color: 'text-blue-400 bg-blue-500/10',
    description: 'European Commission and Parliament regulatory mandates',
    placeholderUrl: 'https://ec.europa.eu/newsroom/repository/rss/287',
  },
  central_bank: {
    label: 'Central Bank Bulletins',
    icon: Building2,
    color: 'text-amber-300 bg-amber-400/10',
    description: 'Interest rates, macro-prudential notices & policy speeches',
    placeholderUrl: 'https://www.federalreserve.gov/feeds/press_all.xml',
  },
  trade_policy: {
    label: 'Trade Policy & Tariffs',
    icon: FileText,
    color: 'text-rose-400 bg-rose-500/10',
    description: 'Tariff changes, embargo notices & import/export controls',
    placeholderUrl: 'https://ustr.gov/about-us/policy-offices/press-office/press-releases/rss.xml',
  },
  reddit: {
    label: 'Social & Community Intelligence',
    icon: MessageSquare,
    color: 'text-orange-400 bg-orange-500/10',
    description: 'Community sentiment and breaking discussion feeds',
    placeholderUrl: 'https://www.reddit.com/r/supplychain/.rss',
  },
  saas_adapter: {
    label: 'Enterprise SaaS Adapter',
    icon: Server,
    color: 'text-primary bg-primary/10',
    description: 'Jira, GitHub, Slack, ServiceNow & Confluence real-time webhooks and events',
    placeholderUrl: 'https://saas.internal/jira',
  },
};

const POLLING_INTERVALS = [
  { label: 'Every 1 minute (60s)', value: 60 },
  { label: 'Every 5 minutes (300s)', value: 300 },
  { label: 'Every 15 minutes (900s - recommended)', value: 900 },
  { label: 'Every 30 minutes (1800s)', value: 1800 },
  { label: 'Every 1 hour (3600s)', value: 3600 },
  { label: 'Every 6 hours (21600s)', value: 21600 },
  { label: 'Every 24 hours (86400s)', value: 86400 },
];

const PRESET_FEEDS = [
  {
    name: 'TechCrunch Technology RSS',
    type: 'rss',
    url: 'https://techcrunch.com/feed/',
    types: ['Technology Shift', 'Competitor Action'],
  },
  {
    name: 'Jira Issues & Escalations',
    type: 'saas_adapter',
    url: 'https://saas.internal/jira',
    types: ['Operational Disruption', 'Enterprise Operations'],
  },
  {
    name: 'GitHub PRs & Security Alerts',
    type: 'saas_adapter',
    url: 'https://saas.internal/github',
    types: ['Security Incident', 'Policy Change'],
  },
  {
    name: 'Slack Triage & PagerDuty Alerts',
    type: 'saas_adapter',
    url: 'https://saas.internal/slack',
    types: ['Operational Disruption', 'Security Incident'],
  },
  {
    name: 'SEC Regulatory Filings Feed',
    type: 'sec_filing',
    url: 'https://www.sec.gov/news/pressreleases.rss',
    types: ['Regulatory Change', 'Market Movement'],
  },
  {
    name: 'Market Watch Intelligence',
    type: 'rss',
    url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',
    types: ['Market Movement'],
  },
  {
    name: 'Federal Reserve Monetary Bulletins',
    type: 'central_bank',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    types: ['Regulatory Change', 'Market Movement'],
  },
  {
    name: 'Geospatial H3 Vessel Tracking API',
    type: 'geo_spatial',
    url: 'https://api.geospatial.internal/v1/telemetry/stream',
    types: ['Supply Chain Disruption', 'Operational Disruption'],
  },
  {
    name: 'Custom REST Endpoint API',
    type: 'rest_api',
    url: 'https://api.example.com/v1/intelligence/stream',
    types: ['Market Movement', 'Operational Disruption'],
  },
];


function formatTimeAgo(dateString?: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (isNaN(seconds) || seconds < 0) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SourcesView({ organizationId, wizardMode = false, onComplete }: SourcesViewProps) {
  const queryClient = useQueryClient();
  const [newSource, setNewSource] = useState({
    name: '',
    sourceType: 'rss',
    url: '',
    pollingIntervalSeconds: 900,
    signalTypes: [] as string[],
  });
  const [searchFilter, setSearchFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [isFormOpen, setIsFormOpen] = useState(true);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [pollingFeedId, setPollingFeedId] = useState<number | null>(null);

  const { data: feeds = [], isLoading } = useQuery<FeedDto[]>({
    queryKey: ['/api/signal-feeds'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/signal-feeds');
      return response.json();
    },
  });

  const { data: events = [] } = useQuery<Array<{ id: string; sourceUrl: string; extractionTimestamp: string }>>({
    queryKey: ['/api/event-primitives?limit=100'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/event-primitives?limit=100');
      return response.json();
    },
  });

  const createSource = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/signal-feeds', {
        name: newSource.name.trim(),
        sourceType: newSource.sourceType,
        url: newSource.url.trim(),
        pollingIntervalSeconds: Number(newSource.pollingIntervalSeconds),
        enabled: true,
      });
      return response.json();
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['/api/signal-feeds'] });
      setNewSource({
        name: '',
        sourceType: 'rss',
        url: '',
        pollingIntervalSeconds: 900,
        signalTypes: [],
      });
      setFeedbackBanner({
        type: 'success',
        message: `Signal feed "${created.name}" connected and scheduled for automated polling.`,
      });
      if (wizardMode && onComplete) {
        onComplete();
      }
    },
    onError: (err: Error) => {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Failed to connect signal source.',
      });
    },
  });

  const pollSource = useMutation({
    mutationFn: async (id: number) => {
      setPollingFeedId(id);
      const response = await apiRequest('POST', `/api/signal-feeds/${id}/poll`);
      return { id, result: await response.json() };
    },
    onSuccess: ({ result }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/event-primitives?limit=100'] });
      queryClient.invalidateQueries({ queryKey: ['/api/state-transitions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/signal-feeds'] });
      const entries = result?.entries ?? 0;
      const eventCount = result?.events ?? 0;
      setFeedbackBanner({
        type: 'success',
        message: `Poll completed: ${entries} entries retrieved, ${eventCount} normalized signals ingested.`,
      });
    },
    onError: (err: Error) => {
      setFeedbackBanner({
        type: 'error',
        message: `Polling failed: ${err.message || 'Network or parse error'}`,
      });
    },
    onSettled: () => {
      setPollingFeedId(null);
    },
  });

  const toggleSource = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const response = await apiRequest('PATCH', `/api/signal-feeds/${id}`, { enabled });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/signal-feeds'] });
      setFeedbackBanner({
        type: 'success',
        message: `Feed "${data.name}" ${data.enabled ? 'activated' : 'paused'}.`,
      });
    },
    onError: (err: Error) => {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Failed to toggle feed state.',
      });
    },
  });

  const deleteSource = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('DELETE', `/api/signal-feeds/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/signal-feeds'] });
      setConfirmDeleteId(null);
      setFeedbackBanner({
        type: 'success',
        message: 'Signal feed has been disabled and removed from active schedule.',
      });
    },
    onError: (err: Error) => {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Failed to disable feed.',
      });
    },
  });

  const activeFeedsCount = feeds.filter((f) => f.enabled).length;
  const rssFeedsCount = feeds.filter((f) => f.sourceType === 'rss').length;
  const apiFeedsCount = feeds.filter(
    (f) =>
      f.sourceType === 'rest_api' ||
      f.sourceType === 'webhook' ||
      f.sourceType === 'geo_spatial' ||
      f.sourceType === 'saas_adapter' ||
      f.sourceType === 'api',
  ).length;

  const healthyFeedsCount = feeds.filter(
    (f) => f.enabled && f.status !== 'degraded' && (!f.consecutiveFailures || f.consecutiveFailures === 0),
  ).length;
  const healthPercentage = activeFeedsCount > 0 ? Math.round((healthyFeedsCount / activeFeedsCount) * 100) : 100;

  const getSourceIcon = (type: string) => {
    const config = SOURCE_TYPE_CONFIG[type.toLowerCase()];
    if (config) {
      const Icon = config.icon;
      return <Icon className={cn('h-4 w-4', config.color.split(' ')[0])} />;
    }
    return <Globe className="h-4 w-4 text-emerald-400" />;
  };

  const getFeedEventCount = (feedUrl: string) => {
    if (!events.length || !feedUrl) return 0;
    return events.filter((e) => e.sourceUrl && (e.sourceUrl.includes(feedUrl) || feedUrl.includes(e.sourceUrl))).length;
  };

  const duplicateUrls = new Set(
    feeds
      .map((f) => f.url.trim().toLowerCase())
      .filter((url, idx, arr) => arr.indexOf(url) !== idx),
  );

  const existingDuplicateFeed = feeds.find(
    (f) => newSource.url.trim() && f.url.trim().toLowerCase() === newSource.url.trim().toLowerCase(),
  );
  const isDuplicateUrl = Boolean(existingDuplicateFeed);

  const filteredFeeds = feeds.filter((feed) => {
    const matchesSearch =
      !searchFilter ||
      feed.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      feed.url.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesType = typeFilter === 'all' || feed.sourceType === typeFilter;
    return matchesSearch && matchesType;
  });

  const fieldClass =
    'h-10 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring';

  return (
    <div className="space-y-6" data-testid="sources-view-page">
      {/* Metrics Banner */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Configured Feeds</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{feeds.length}</p>
            <p className="mt-0.5 text-[10px] text-emerald-400">{activeFeedsCount} currently active</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <Radio className="h-5 w-5" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">RSS Ingestion</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{rssFeedsCount}</p>
            <p className="mt-0.5 text-[10px] text-amber-400">Automated pollers</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
            <Rss className="h-5 w-5" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">APIs &amp; Spatial</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{apiFeedsCount}</p>
            <p className="mt-0.5 text-[10px] text-cyan-400">Telemetry endpoints</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Zap className="h-5 w-5" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingestion Health</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{healthPercentage}%</p>
            <p className="mt-0.5 text-[10px] text-emerald-400">
              {activeFeedsCount ? `${healthyFeedsCount}/${activeFeedsCount} healthy` : 'Ready to ingest'}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Global Feedback Banner */}
      {feedbackBanner && (
        <div
          className={cn(
            'flex items-center justify-between rounded-xl border p-4 text-xs transition-all',
            feedbackBanner.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-destructive/30 bg-destructive/10 text-destructive',
          )}
        >
          <div className="flex items-center gap-2">
            {feedbackBanner.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
            )}
            <span>{feedbackBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-[10px] underline hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Add Source Section */}
      <div className="rounded-xl border border-border/80 bg-card/40 p-5">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">Add Intelligence Signal Source</h2>
              {!isFormOpen && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  Collapsed
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Connect external RSS feeds, API endpoints, or Webhook streams to ingest normalized event primitives into the world model.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFormOpen((prev) => !prev)}
              aria-expanded={isFormOpen}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-border bg-background/80 px-3 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            >
              {isFormOpen ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  <span>Collapse Form</span>
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 text-primary" />
                  <span>+ New Source</span>
                </>
              )}
            </button>
            <Server className="h-5 w-5 text-primary" />
          </div>
        </div>

        {isFormOpen ? (
          <div className="mt-4">
            {/* Quick Sample Feeds (Pre-fill) */}
            <div className="mb-5 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-primary">💡 Quick Pre-fill Sample Feeds</p>
                <span className="text-[10px] text-muted-foreground">Click any feed to auto-fill form</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {PRESET_FEEDS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => {
                      setIsFormOpen(true);
                      setNewSource({
                        name: preset.name,
                        sourceType: preset.type,
                        url: preset.url,
                        pollingIntervalSeconds: 900,
                        signalTypes: preset.types,
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-background/80 px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    <Zap className="h-3 w-3 text-amber-400" />
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-12">
              <div className="space-y-1.5 md:col-span-4">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Feed Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={newSource.name}
                  onChange={(e) => setNewSource((s) => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. Industry Regulations Feed"
                  className={fieldClass}
                />
              </div>

              <div className="space-y-1.5 md:col-span-4">
                <label className="text-[11px] font-medium text-muted-foreground">Source Type</label>
                <select
                  value={newSource.sourceType}
                  onChange={(e) => {
                    const newType = e.target.value;
                    setNewSource((s) => ({
                      ...s,
                      sourceType: newType,
                      url: s.url ? s.url : (SOURCE_TYPE_CONFIG[newType]?.placeholderUrl || ''),
                    }));
                  }}
                  className={fieldClass}
                >
                  {Object.entries(SOURCE_TYPE_CONFIG).map(([typeKey, cfg]) => (
                    <option key={typeKey} value={typeKey}>
                      {cfg.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 md:col-span-4">
                <label className="text-[11px] font-medium text-muted-foreground">Polling Schedule</label>
                <select
                  value={newSource.pollingIntervalSeconds}
                  onChange={(e) => setNewSource((s) => ({ ...s, pollingIntervalSeconds: Number(e.target.value) }))}
                  className={fieldClass}
                >
                  {POLLING_INTERVALS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 md:col-span-12">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Source URL / Ingestion Endpoint <span className="text-destructive">*</span>
                </label>
                <input
                  type="url"
                  value={newSource.url}
                  onChange={(e) => setNewSource((s) => ({ ...s, url: e.target.value }))}
                  placeholder={SOURCE_TYPE_CONFIG[newSource.sourceType]?.placeholderUrl || 'https://news.example.com/rss.xml'}
                  className={fieldClass}
                />
                <p className="text-[10px] text-muted-foreground">
                  {SOURCE_TYPE_CONFIG[newSource.sourceType]?.description}
                </p>
                {newSource.sourceType === 'saas_adapter' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Select Platform:</span>
                    {[
                      { label: 'Jira', url: 'https://saas.internal/jira', name: 'Jira Service Desk & Issues' },
                      { label: 'GitHub', url: 'https://saas.internal/github', name: 'GitHub CI & Security Alerts' },
                      { label: 'Slack', url: 'https://saas.internal/slack', name: 'Slack Triage & Incident Feed' },
                      { label: 'ServiceNow', url: 'https://saas.internal/servicenow', name: 'ServiceNow Incidents & Changes' },
                      { label: 'Confluence', url: 'https://saas.internal/confluence', name: 'Confluence Knowledge & Specs' },
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          setNewSource((s) => ({
                            ...s,
                            name: s.name || item.name,
                            url: item.url,
                          }));
                        }}
                        className={cn(
                          'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                          newSource.url.toLowerCase().includes(item.label.toLowerCase())
                            ? 'border-primary bg-primary/20 text-primary'
                            : 'border-border bg-card/60 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
                {isDuplicateUrl && (
                  <div className="mt-1 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span>
                      A configured feed with this URL already exists (<strong>{existingDuplicateFeed?.name}</strong>). Adding it again may ingest duplicate events.
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Expected Signal Types (Optional)</label>
              <div className="flex flex-wrap gap-2">
                {[
                  'Regulatory Change',
                  'Market Movement',
                  'Competitor Action',
                  'Technology Shift',
                  'Supply Chain Disruption',
                  'Operational Disruption',
                ].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setNewSource((s) => ({
                        ...s,
                        signalTypes: s.signalTypes.includes(type)
                          ? s.signalTypes.filter((t) => t !== type)
                          : [...s.signalTypes, type],
                      }));
                    }}
                    className={cn(
                      'rounded-full border px-3 py-1 text-[10px] font-medium transition-colors',
                      newSource.signalTypes.includes(type)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-accent text-foreground',
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Polling schedule: {POLLING_INTERVALS.find((p) => p.value === newSource.pollingIntervalSeconds)?.label}</span>
              </div>
              <div className="flex items-center gap-3">
                {(!newSource.name || !newSource.url) && (
                  <span className="text-[11px] text-amber-400/90 italic">
                    * Please type a Feed Name &amp; URL above (or click a sample feed) to enable
                  </span>
                )}
                <button
                  onClick={() => createSource.mutate()}
                  disabled={!newSource.name || !newSource.url || createSource.isPending}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  {createSource.isPending ? 'Connecting Source…' : 'Add Source'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>Form is collapsed. Click &quot;+ New Source&quot; to configure an external RSS, API, or Webhook pipeline.</span>
            <button
              type="button"
              onClick={() => setIsFormOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Expand Form</span>
            </button>
          </div>
        )}
      </div>

      {/* Signal Feeds List */}
      <div className="rounded-xl border border-border/80 bg-card/40 p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Active Intelligence Signal Feeds</h2>
            <p className="text-xs text-muted-foreground">
              Configured sources feeding live business intelligence into Decision Intelligence.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {duplicateUrls.size > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                <AlertCircle className="h-3 w-3 text-amber-400" />
                <span>{duplicateUrls.size} duplicate detected</span>
              </span>
            )}
            {!isFormOpen && (
              <button
                type="button"
                onClick={() => setIsFormOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Source</span>
              </button>
            )}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter feeds…"
                className="h-8 w-44 rounded-lg border border-border bg-background/70 pl-8 pr-3 text-xs outline-none focus:border-primary"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 rounded-lg border border-border bg-background/70 px-2 text-xs outline-none focus:border-primary"
            >
              <option value="all">All Types</option>
              {Object.entries(SOURCE_TYPE_CONFIG).map(([k, cfg]) => (
                <option key={k} value={k}>
                  {cfg.label}
                </option>
              ))}
            </select>
            <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-foreground">
              {filteredFeeds.length} of {feeds.length}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin text-primary" /> Loading signal sources...
          </div>
        ) : filteredFeeds.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
            <Radio className="h-10 w-10 text-muted-foreground/50" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">No Signal Feeds Matching Criteria</h3>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {feeds.length === 0
                ? 'Add your first RSS feed or API endpoint above to begin streaming automated signals.'
                : 'Try adjusting your search query or type filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-accent/40 text-muted-foreground">
                <tr>
                  <th className="p-3 font-semibold">Source Name</th>
                  <th className="p-3 font-semibold">Type</th>
                  <th className="p-3 font-semibold">URL / Endpoint</th>
                  <th className="p-3 font-semibold">Signals Ingested</th>
                  <th className="p-3 font-semibold">Schedule</th>
                  <th className="p-3 font-semibold">Last Polled</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredFeeds.map((feed) => {
                  const signalCount = getFeedEventCount(feed.url);
                  const isPollingThis = pollingFeedId === feed.id;
                  const isConfirmingDelete = confirmDeleteId === feed.id;

                  return (
                    <tr key={feed.id} className="transition-colors hover:bg-accent/20">
                      <td className="p-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {getSourceIcon(feed.sourceType)}
                          <span className="font-semibold">{feed.name}</span>
                          {duplicateUrls.has(feed.url.trim().toLowerCase()) && (
                            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
                              Duplicate URL
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                          {feed.sourceType}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-muted-foreground">
                        <a
                          href={feed.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                        >
                          <span className="max-w-[240px] truncate">{feed.url}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </td>
                      <td className="p-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          <Activity className="h-3 w-3" />
                          {signalCount}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        Every {Math.max(1, Math.round(feed.pollingIntervalSeconds / 60))}m
                      </td>
                      <td className="p-3 text-muted-foreground">
                        <span title={feed.lastPollAt ? new Date(feed.lastPollAt).toLocaleString() : undefined}>
                          {formatTimeAgo(feed.lastPollAt)}
                        </span>
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => toggleSource.mutate({ id: feed.id, enabled: !feed.enabled })}
                          disabled={toggleSource.isPending}
                          title={feed.enabled ? 'Click to pause feed' : 'Click to resume feed'}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-opacity hover:opacity-80',
                            feed.enabled
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              feed.enabled ? 'bg-emerald-400' : 'bg-muted-foreground',
                            )}
                          />
                          {feed.enabled ? 'Active' : 'Paused'}
                        </button>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => deleteSource.mutate(feed.id)}
                                disabled={deleteSource.isPending}
                                className="rounded bg-destructive px-2 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/90"
                              >
                                {deleteSource.isPending ? 'Removing…' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => pollSource.mutate(feed.id)}
                                disabled={pollSource.isPending || !feed.enabled}
                                title={feed.enabled ? 'Poll immediately' : 'Resume feed to poll'}
                                className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                              >
                                <RefreshCw className={cn('h-3 w-3', isPollingThis && 'animate-spin text-primary')} />
                                <span>{isPollingThis ? 'Polling…' : 'Poll Now'}</span>
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(feed.id)}
                                title="Disable and remove feed"
                                className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default SourcesView;
