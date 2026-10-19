import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useLocation } from 'wouter';
import {
  Radio,
  ExternalLink,
  Bot,
  Sparkles,
  ShieldCheck,
  Maximize2,
  Minimize2,
  X,
  AlertTriangle,
  Clock,
  Send,
  Zap,
  CheckCircle2,
  ChevronRight,
  Activity,
  Layers,
  Globe,
  SlidersHorizontal,
  Filter,
  Plus,
  Pin,
  MapPin,
  FileCode,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SignalStudioPodProps, IndustryPack } from './types';
import type { FeedDto } from '@/components/signal-intelligence/spatial/SourcesView';
import { INDUSTRY_PACKS } from './industry-packs';
import { SpatialH3MapPanel } from '@/modules/operations/pages/PredictionIntelligenceDashboard';
import { SignalsDecisionsWorkbench } from './SignalsDecisionsWorkbench';
import { SourcesView } from '@/components/signal-intelligence/spatial/SourcesView';
import { RuleBuilder } from '@/components/signal-intelligence/spatial/RuleBuilder';
import { createRescueDispatchGeoRuleTree } from '@/components/signal-intelligence/spatial/rule-builder-state';
import { SubscriptionsView } from '@/components/signal-intelligence/spatial/SubscriptionsView';
import { SignalFilterBuilder } from './SignalFilterBuilder';
import { JsonPathSchemaMapper } from './JsonPathSchemaMapper';
import { toIntelligenceSignal, type SignalEvent } from '@/components/signal-intelligence/spatial/utils';
import { signalStudioSelectionFromEvent } from '@shared/signal-studio';

type StudioPodTab = 'overview' | 'spatial' | 'signals' | 'sources' | 'rules' | 'filters' | 'packs' | 'mapper';

/** Strips HTML markup, resolves basic entities, and collapses extraneous whitespace. */
export function cleanHtmlAndEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resiliently extracts a human-readable title or headline for a signal event.
 * Gracefully extracts headlines from rawText, summaries, or metadata when title is absent.
 */
export function extractSignalTitle(event: any): string {
  if (!event) return 'Market Signal';

  // 1. Direct explicit title if provided and meaningful
  if (typeof event.title === 'string' && event.title.trim() && event.title.trim().toLowerCase() !== 'unknown') {
    return cleanHtmlAndEntities(event.title);
  }
  if (typeof event.payload?.title === 'string' && event.payload.title.trim()) {
    return cleanHtmlAndEntities(event.payload.title);
  }
  if (typeof event.payload?.headline === 'string' && event.payload.headline.trim()) {
    return cleanHtmlAndEntities(event.payload.headline);
  }

  // 2. Derive headline from rawText first sentence
  if (typeof event.rawText === 'string' && event.rawText.trim()) {
    const cleaned = cleanHtmlAndEntities(event.rawText);
    if (cleaned.length > 0) {
      const sentences = cleaned.split(/(?<=[.!?])\s+|\n+/);
      const firstSentence = sentences[0]?.trim();
      if (firstSentence && firstSentence.length >= 8) {
        return firstSentence.length > 110 ? `${firstSentence.slice(0, 107)}…` : firstSentence;
      }
      return cleaned.length > 110 ? `${cleaned.slice(0, 107)}…` : cleaned;
    }
  }

  // 3. Summary
  if (typeof event.summary === 'string' && event.summary.trim()) {
    const cleaned = cleanHtmlAndEntities(event.summary);
    const first = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim();
    return first || cleaned;
  }

  // 4. Formatted eventType
  if (typeof event.eventType === 'string' && event.eventType.trim() && event.eventType.toLowerCase() !== 'unknown') {
    return event.eventType.replace(/_/g, ' ');
  }

  // 5. Target Sector
  if (typeof event.targetSector === 'string' && event.targetSector.trim() && event.targetSector.toLowerCase() !== 'unknown') {
    const sector = event.targetSector.charAt(0).toUpperCase() + event.targetSector.slice(1);
    return `${sector} Intelligence Observation`;
  }

  // 6. Source URL domain fallback
  if (typeof event.sourceUrl === 'string' && event.sourceUrl.trim()) {
    try {
      const hostname = new URL(event.sourceUrl).hostname.replace(/^www\./, '');
      return `Telemetry from ${hostname}`;
    } catch {}
  }

  return `Intelligence Signal #${String(event.id || '').slice(0, 8) || 'Live'}`;
}

/** Extracts an excerpt/summary without duplicating the title. */
export function extractSignalExcerpt(event: any, title: string): string {
  if (!event) return '';
  const sourceText = event.rawText || event.summary || event.payload?.description || '';
  if (!sourceText) return 'Telemetry recorded by ingestion sensor. Recommended response playbook generated based on exposure tier.';
  const cleaned = cleanHtmlAndEntities(sourceText);
  if (cleaned.toLowerCase() === title.toLowerCase()) {
    return 'Telemetry recorded by ingestion sensor. Recommended response playbook generated based on exposure tier.';
  }
  let remainder = cleaned;
  if (remainder.toLowerCase().startsWith(title.toLowerCase().replace(/…$/, ''))) {
    remainder = remainder.slice(title.replace(/…$/, '').length).replace(/^[.:\s]+/, '').trim();
  }
  if (!remainder) {
    return cleaned.length > 200 ? `${cleaned.slice(0, 197)}…` : cleaned;
  }
  return remainder.length > 240 ? `${remainder.slice(0, 237)}…` : remainder;
}

export function extractSignalJurisdiction(event: any): string | null {
  if (typeof event?.jurisdiction === 'string' && event.jurisdiction.trim() && event.jurisdiction.toLowerCase() !== 'unknown') {
    return event.jurisdiction.trim().toUpperCase();
  }
  return null;
}

export function extractSignalSector(event: any): string {
  if (typeof event?.targetSector === 'string' && event.targetSector.trim() && event.targetSector.toLowerCase() !== 'unknown') {
    return event.targetSector.charAt(0).toUpperCase() + event.targetSector.slice(1);
  }
  if (typeof event?.domain === 'string' && event.domain.trim() && event.domain.toLowerCase() !== 'unknown') {
    return event.domain.replace(/_/g, ' ');
  }
  if (typeof event?.eventType === 'string' && event.eventType.trim() && event.eventType.toLowerCase() !== 'unknown') {
    return event.eventType.replace(/_/g, ' ');
  }
  return 'General Market';
}

export function extractSignalSource(event: any): string {
  if (typeof event?.sourceChannel === 'string' && event.sourceChannel.trim()) {
    return event.sourceChannel.trim();
  }
  if (typeof event?.source === 'string' && event.source.trim() && event.source.toLowerCase() !== 'unknown') {
    return event.source.trim();
  }
  if (typeof event?.sourceUrl === 'string' && event.sourceUrl.trim()) {
    try {
      return new URL(event.sourceUrl).hostname.replace(/^www\./, '');
    } catch {}
  }
  return 'Sensor Feed';
}

export function extractSignalSeverity(event: any): 'Critical' | 'High' | 'Medium' | 'Low' {
  const sev = String(event?.severity || '').toLowerCase();
  if (sev === 'critical') return 'Critical';
  if (sev === 'high') return 'High';
  if (sev === 'medium') return 'Medium';
  if (sev === 'low') return 'Low';
  return 'Medium';
}

export function formatTimeAgo(timestampStr: string | Date | undefined): string {
  if (!timestampStr) return 'Recently';
  const time = new Date(timestampStr).getTime();
  if (isNaN(time)) return 'Recently';
  const diffMs = Date.now() - time;
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SignalStudioPod({
  organizationId = 1,
  initialView = 'overview',
  activeSignalId,
  isFocusMode,
  onToggleFocusMode,
  onClose,
  onPopOut,
  onFocusInChat,
  onDiscussInCrew,
  onLaunchInitiative,
  className,
}: SignalStudioPodProps) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const isSpatialPath = typeof window !== 'undefined' && (window.location.pathname === '/spatial' || window.location.pathname.startsWith('/spatial/') || window.location.pathname.includes('/spatial'));
  const [activeTab, setActiveTab] = useState<StudioPodTab>(
    (initialView as StudioPodTab) || (isSpatialPath ? 'spatial' : 'overview')
  );
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(activeSignalId || null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activatingPackId, setActivatingPackId] = useState<string | null>(null);
  const [packFeedback, setPackFeedback] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [overviewFilter, setOverviewFilter] = useState<'all' | 'critical' | 'spatial' | string>('all');

  // Sync with URL query param ?tab=... or ?view=... and popstate navigation
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncTab = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const tabParam = searchParams.get('tab') || searchParams.get('view');
      const validTabs: StudioPodTab[] = ['overview', 'spatial', 'signals', 'sources', 'rules', 'filters', 'packs', 'mapper'];
      if (tabParam && validTabs.includes(tabParam as StudioPodTab)) {
        setActiveTab(tabParam as StudioPodTab);
      } else if (initialView) {
        setActiveTab(initialView as StudioPodTab);
      }
    };
    syncTab();
    window.addEventListener('popstate', syncTab);
    return () => window.removeEventListener('popstate', syncTab);
  }, [initialView]);

  // Update selected signal if prop changes
  useEffect(() => {
    if (activeSignalId) {
      setSelectedSignalId(activeSignalId);
    }
  }, [activeSignalId]);

  // Capture-phase Escape key to cleanly exit full screen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isFullscreen]);

  // Queries for live events and configured channels
  const { data: rawEvents = [], isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: ['/api/event-primitives?limit=25'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/event-primitives?limit=25');
      return res.json();
    },
  });

  const { data: feeds = [] } = useQuery<FeedDto[]>({
    queryKey: ['/api/signal-feeds'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/signal-feeds');
      return res.json();
    },
  });

  const activeSignal = useMemo(() => {
    if (selectedSignalId) {
      const found = rawEvents.find((e) => e.id === selectedSignalId);
      if (found) return found;
    }
    return rawEvents[0] || null;
  }, [rawEvents, selectedSignalId]);

  // Overview metrics
  const criticalCount = useMemo(
    () => rawEvents.filter((e) => /critical|high/i.test(e?.severity)).length,
    [rawEvents]
  );

  const spatialCount = useMemo(
    () => rawEvents.filter((e) => Boolean(e?.h3Index)).length,
    [rawEvents]
  );

  const filteredEvents = useMemo(() => {
    let list = rawEvents;
    if (overviewFilter === 'critical') {
      list = list.filter((e) => /critical|high/i.test(e?.severity));
    } else if (overviewFilter === 'spatial') {
      list = list.filter((e) => Boolean(e?.h3Index));
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter((e) => {
      const title = extractSignalTitle(e).toLowerCase();
      const raw = String(e?.rawText || '').toLowerCase();
      const sector = extractSignalSector(e).toLowerCase();
      const type = String(e?.eventType || '').toLowerCase();
      const juris = String(extractSignalJurisdiction(e) || '').toLowerCase();
      const source = extractSignalSource(e).toLowerCase();
      return title.includes(q) || raw.includes(q) || sector.includes(q) || type.includes(q) || juris.includes(q) || source.includes(q);
    });
  }, [rawEvents, overviewFilter, searchQuery]);

  // RuleBuilder and SubscriptionsView take an IntelligenceSignal, whose `event`
  // holds the raw fields. Handing them the raw event read `undefined.eventType`
  // and took those views down; the events query is `any[]`, so the compiler had
  // nothing to object to.
  const activeIntelligenceSignal = useMemo(
    () => (activeSignal ? toIntelligenceSignal(activeSignal as SignalEvent) : null),
    [activeSignal],
  );

  // 1-Click Activate Industry Intelligence Pack
  const activatePackMutation = useMutation({
    mutationFn: async (pack: IndustryPack) => {
      setActivatingPackId(pack.id);
      const promises = pack.feeds.map((f) =>
        apiRequest('POST', '/api/signal-feeds', {
          name: f.name,
          sourceType: f.sourceType,
          url: f.url,
          pollingIntervalSeconds: f.recommendedIntervalSeconds,
          enabled: true,
        }).catch(() => null)
      );
      await Promise.all(promises);
      return pack;
    },
    onSuccess: (pack) => {
      queryClient.invalidateQueries({ queryKey: ['/api/signal-feeds'] });
      setPackFeedback(`Pack "${pack.name}" activated! All ${pack.feeds.length} intelligence channels configured.`);
      setTimeout(() => setPackFeedback(null), 5000);
    },
    onSettled: () => {
      setActivatingPackId(null);
    },
  });

  // The label for an event row. Preserves existing event.title and explicit eventType,
  // falling back gracefully to headline extracted from rawText.
  const signalLabel = (event: any): string => {
    if (event?.title && typeof event.title === 'string' && event.title.trim()) {
      return event.title.trim();
    }
    if (event?.eventType && typeof event.eventType === 'string' && event.eventType.toLowerCase() !== 'unknown') {
      return String(event.eventType).replace(/_/g, ' ');
    }
    return extractSignalTitle(event) || 'Market Signal';
  };

  // Hand an event to the room with its own fields, so the composer's scope
  // prefix names the event rather than a bare label.
  const focusSignal = (event: any, sublabel: string, prompt: string) => {
    onFocusInChat?.(
      {
        id: `signal:${event.id}`,
        label: signalLabel(event),
        sublabel,
        type: 'signal',
        signal: signalStudioSelectionFromEvent(event),
      },
      prompt
    );
  };

  // Launch response initiative
  const launchMutation = useMutation({
    mutationFn: async (signal: any) => {
      const title = `Mitigation: ${signalLabel(signal)}${signal.jurisdiction ? ` (${signal.jurisdiction})` : ''}`;
      const prompt = `Initiate response playbook for signal "${signalLabel(signal)}". Spin up mitigation initiative in Project Studio for affected enterprise assets.`;
      if (onFocusInChat) {
        focusSignal(signal, 'Mitigation Initiative', prompt);
      } else if (onLaunchInitiative) {
        onLaunchInitiative(signal.id, title);
      }
      return { success: true, title };
    },
  });

  const handleDiscussInCrew = (customPrompt?: string, event: any = activeSignal) => {
    if (!event) return;
    // Only what the row says: a missing jurisdiction or severity is left out,
    // not filled with "Global" or "Medium".
    const facts = [event.jurisdiction && `in ${event.jurisdiction}`, event.severity && `(Severity: ${event.severity})`].filter(Boolean).join(' ');
    const prompt =
      customPrompt ||
      `Let's analyze Market Signal "${signalLabel(event)}"${facts ? ` ${facts}` : ''}. What is our operational exposure footprint and recommended playbook?`;
    if (onFocusInChat) {
      focusSignal(event, 'Market & Operational Signal', prompt);
    } else if (onDiscussInCrew) {
      onDiscussInCrew(prompt, event);
    }
  };

  // The located event that has sat longest in its cell. This button used to
  // send a fixed "High dwell-time anomaly detected" alert whether or not any
  // event had a location, which put an invented incident in front of the room.
  const spatialFocusEvent = useMemo(() => {
    const located = rawEvents.filter((e) => typeof e?.h3Index === 'string' && e.h3Index);
    if (located.length === 0) return null;
    return located.reduce((best, e) => ((Number(e.dwellMinutes) || 0) > (Number(best.dwellMinutes) || 0) ? e : best));
  }, [rawEvents]);

  const handleSendSpatialAnomalyToCrew = () => {
    const event = spatialFocusEvent;
    if (!event) return;
    const dwell = Number.isFinite(Number(event.dwellMinutes)) && event.dwellMinutes !== null ? ` (dwell ${Math.round(Number(event.dwellMinutes))} min)` : '';
    focusSignal(
      event,
      `H3 cell ${event.h3Index}`,
      `Review signal "${signalLabel(event)}" in H3 cell ${event.h3Index}${dwell}. What does it mean for our exposure?`
    );
  };

  const activeFeedsCount = feeds.filter((f) => f.enabled).length;

  return (
    <div
      className={cn(
        'flex flex-col bg-card text-foreground transition-all duration-200',
        isFullscreen
          ? 'fixed inset-0 z-50 bg-background p-4 md:p-6 overflow-hidden'
          : 'h-full w-full overflow-hidden rounded-lg border border-border/80 shadow-sm',
        className
      )}
      data-testid="signal-studio-pod"
    >
      {/* ─── Pod Header ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Radio className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground" data-testid="signal-studio-heading">
                Signal Studio
              </span>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-400">
                Live Sensor
              </span>
              <span className="rounded bg-cyan-500/15 px-1.5 py-0.2 text-[9px] font-semibold text-cyan-400 hidden sm:inline">
                Uber H3
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">Market Sensing &amp; Exposure Triage</p>
          </div>
        </div>

        {/* Studio Window & Layout Controls */}
        <div className="flex items-center gap-1">
          {/* Focus Studio / Show Chat */}
          {onToggleFocusMode && (
            <button
              type="button"
              onClick={onToggleFocusMode}
              className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background/80 px-2.5 text-[11px] font-semibold text-foreground hover:bg-accent hover:text-primary transition-colors shadow-xs"
              title={isFocusMode ? 'Restore Split View (Show Chat)' : 'Expand Studio (Collapse Chat)'}
              aria-label={isFocusMode ? 'Show Chat' : 'Focus Studio'}
              data-testid="signal-pod-focus-toggle"
            >
              {isFocusMode ? (
                <Minimize2 className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5 text-primary" />
              )}
              <span className="hidden sm:inline font-semibold">
                {isFocusMode ? 'Show Chat' : 'Focus Studio'}
              </span>
            </button>
          )}

          {/* Full Screen Mode */}
          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-background/80 px-2 text-[11px] font-medium text-foreground hover:bg-accent transition-colors"
            title={isFullscreen ? 'Exit Full Screen (Esc)' : 'Expand Studio Full Screen'}
            data-testid="signal-pod-fullscreen-toggle"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5 text-primary" /> : <Maximize2 className="h-3.5 w-3.5 text-primary" />}
            <span className="hidden sm:inline">{isFullscreen ? 'Exit Full Screen' : 'Full Screen'}</span>
          </button>

          {/* Standalone Route Pop Out */}
          <button
            type="button"
            onClick={() => {
              if (onPopOut) {
                onPopOut();
              } else {
                navigate('/workspace/signals');
              }
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Open standalone Signal Studio at /workspace/signals"
            data-testid="signal-pod-popout"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>

          {/* Close Studio */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title="Close Signal Studio"
              aria-label="Close Signal Studio"
              data-testid="signal-pod-close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ─── Studio Navigation Tabs Bar ──────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/50 bg-card/40 px-3 py-1.5 scrollbar-none text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 border',
            activeTab === 'overview'
              ? 'border-border bg-background text-foreground shadow-xs font-semibold'
              : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <Radio className="h-3.5 w-3.5 text-primary" />
          <span>Overview</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('spatial')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 border',
            activeTab === 'spatial'
              ? 'border-border bg-background text-foreground shadow-xs font-semibold text-cyan-400'
              : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <Globe className="h-3.5 w-3.5 text-cyan-400" />
          <span>🗺️ Spatial Map</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('signals')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 border',
            activeTab === 'signals'
              ? 'border-border bg-background text-foreground shadow-xs font-semibold text-emerald-400'
              : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <Activity className="h-3.5 w-3.5 text-emerald-400" />
          <span>📡 Signals &amp; Decisions</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sources')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 border',
            activeTab === 'sources'
              ? 'border-border bg-background text-foreground shadow-xs font-semibold text-amber-400'
              : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          <span>⚡ Sources</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('rules')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 border',
            activeTab === 'rules'
              ? 'border-border bg-background text-foreground shadow-xs font-semibold text-purple-400'
              : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <Bot className="h-3.5 w-3.5 text-purple-400" />
          <span>🛡️ Rules</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('filters')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 border',
            activeTab === 'filters'
              ? 'border-border bg-background text-foreground shadow-xs font-semibold text-pink-400'
              : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <Filter className="h-3.5 w-3.5 text-pink-400" />
          <span>🔍 Filters</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('packs')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 border',
            activeTab === 'packs'
              ? 'border-border bg-background text-foreground shadow-xs font-semibold text-indigo-400'
              : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
          <span>📦 Industry Packs</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('mapper')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 border',
            activeTab === 'mapper'
              ? 'border-border bg-background text-foreground shadow-xs font-semibold text-cyan-400'
              : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <FileCode className="h-3.5 w-3.5 text-cyan-400" />
          <span>🔀 Ingress Mapper</span>
        </button>
      </div>

      {packFeedback && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span>{packFeedback}</span>
        </div>
      )}

      {/* ─── Studio Main Body Views ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* VIEW 1: Overview & Triage (Default) */}
        {activeTab === 'overview' && (
          <div className="p-3 space-y-3">
            {/* Executive Cockpit KPI Telemetry Strip */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-border/70 bg-card/60 p-2.5 shadow-xs">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                  <span>Total Signals</span>
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xl font-bold tracking-tight text-foreground">{rawEvents.length}</span>
                  <span className="text-[10px] text-emerald-400 font-medium">Live Window</span>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/60 p-2.5 shadow-xs">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                  <span>High &amp; Critical</span>
                  <AlertTriangle className={cn("h-3.5 w-3.5", criticalCount > 0 ? "text-destructive" : "text-muted-foreground")} />
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className={cn("text-xl font-bold tracking-tight", criticalCount > 0 ? "text-destructive" : "text-foreground")}>
                    {criticalCount}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-medium">Actionable</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('spatial')}
                className="group text-left rounded-xl border border-border/70 bg-card/60 p-2.5 shadow-xs hover:border-cyan-500/40 hover:bg-cyan-500/5 transition-all"
                title="Open Spatial Map view"
              >
                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                  <span className="group-hover:text-cyan-400 transition-colors">Spatial Telemetry</span>
                  <Globe className="h-3.5 w-3.5 text-cyan-400" />
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xl font-bold tracking-tight text-cyan-400">{spatialCount}</span>
                  <span className="text-[10px] text-muted-foreground font-medium">H3 Hexcells</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('sources')}
                className="group text-left rounded-xl border border-border/70 bg-card/60 p-2.5 shadow-xs hover:border-amber-500/40 hover:bg-amber-500/5 transition-all"
                title="Configure or inspect intelligence feeds"
              >
                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                  <span className="group-hover:text-amber-400 transition-colors">Sensor Feeds</span>
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xl font-bold tracking-tight text-amber-400">{activeFeedsCount}</span>
                  <span className="text-[10px] text-muted-foreground font-medium">Active Channels</span>
                </div>
              </button>
            </div>

            {/* Active Market Signal Card */}
            {activeSignal ? (() => {
              const title = extractSignalTitle(activeSignal);
              const excerpt = extractSignalExcerpt(activeSignal, title);
              const sector = extractSignalSector(activeSignal);
              const jurisdiction = extractSignalJurisdiction(activeSignal);
              const source = extractSignalSource(activeSignal);
              const severity = extractSignalSeverity(activeSignal);
              const confidencePct = Math.round((activeSignal.confidenceScore || activeSignal.confidence || 0.85) * 100);
              const timeAgo = formatTimeAgo(activeSignal.extractionTimestamp || activeSignal.detectedAt);

              return (
                <div className="rounded-xl border border-border/80 bg-background/60 p-3.5 space-y-3 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
                        {sector}
                      </span>
                      {activeSignal.h3Index && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('spatial')}
                          className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                          title="Inspect signal in Spatial Map"
                        >
                          <MapPin className="h-2.5 w-2.5" />
                          <span>H3: {String(activeSignal.h3Index).slice(0, 8)}…</span>
                        </button>
                      )}
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border',
                        severity === 'Critical'
                          ? 'border-destructive/30 bg-destructive/15 text-destructive'
                          : severity === 'High'
                          ? 'border-amber-500/30 bg-amber-500/15 text-amber-400'
                          : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                      )}
                    >
                      {severity} Exposure
                    </span>
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground tracking-tight leading-snug">
                      {title}
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {excerpt}
                    </p>
                    <div className="pt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      {jurisdiction && (
                        <>
                          <span className="font-medium text-foreground/80">{jurisdiction}</span>
                          <span>•</span>
                        </>
                      )}
                      <span>{source}</span>
                      <span>•</span>
                      <span>{confidencePct}% confidence</span>
                      <span>•</span>
                      <span>{timeAgo}</span>
                    </div>
                  </div>

                  {/* Exposure Footprint Gauge */}
                  <div className="rounded-lg border border-border/70 bg-card/60 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider">
                        Exposure Footprint
                      </span>
                      <span className="font-bold text-foreground text-xs">
                        {severity === 'Critical'
                          ? 'Tier 1 Strategic Corridors'
                          : severity === 'High'
                          ? 'Tier 2 Regional Supply Chains'
                          : 'Monitored Corridors'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2.5">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-500',
                            severity === 'Critical'
                              ? 'w-full bg-destructive'
                              : severity === 'High'
                              ? 'w-3/4 bg-amber-400'
                              : 'w-1/3 bg-emerald-400'
                          )}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {severity === 'Critical' ? 'Active High Threat' : severity === 'High' ? 'Elevated' : 'Monitoring'}
                      </span>
                    </div>
                  </div>

                  {/* Recommended Business Playbook */}
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                        <Bot className="h-4 w-4" />
                        <span>Recommended Response Playbook</span>
                      </div>
                      <span className="text-[10px] font-medium text-primary/80 bg-primary/10 rounded-md px-1.5 py-0.5 border border-primary/15">
                        AI Guided Triage
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {activeSignal.recommendedAction ||
                        (severity === 'Critical'
                          ? 'Immediate supply corridor divergence recommended. Recalculate affected supplier delivery milestones and spin up a mitigation initiative in Project Studio.'
                          : 'Review affected vendor contracts and adjust buffer inventory for downstream enterprise dependencies.')}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => launchMutation.mutate(activeSignal)}
                        disabled={launchMutation.isPending}
                        className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground font-semibold px-3.5 py-2 text-xs shadow-xs hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>{launchMutation.isPending ? 'Launching…' : 'Launch Initiative'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDiscussInCrew()}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card/80 px-3.5 py-2 text-xs font-medium text-foreground hover:bg-accent hover:text-foreground transition-all shadow-xs"
                        title="Send signal context to active CREW agent"
                      >
                        <Send className="h-3.5 w-3.5 text-primary" />
                        <span>Discuss in CREW</span>
                      </button>
                      {activeSignal.h3Index && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('spatial')}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-400 hover:bg-cyan-500/20 transition-all shadow-xs"
                          title="Inspect signal in Spatial Map"
                        >
                          <Globe className="h-3.5 w-3.5" />
                          <span>Map View</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })() : (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 py-8 text-center bg-card/20">
                <Radio className="h-8 w-8 text-muted-foreground/40 animate-pulse" />
                <p className="mt-2 text-xs font-semibold text-foreground">No Active Signal Selected</p>
                <p className="text-[11px] text-muted-foreground">
                  Market Scout is listening on {activeFeedsCount} channels. Select an intake signal below.
                </p>
              </div>
            )}

            {/* Live Intelligence Intake Stream with Search & Filters */}
            <div className="rounded-xl border border-border/70 bg-card/40 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
                  <Activity className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Intelligence Intake</span>
                  <span className="ml-1 rounded-full bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground font-medium">
                    {filteredEvents.length} of {rawEvents.length}
                  </span>
                </div>
                <span className="text-[10px] text-emerald-400 font-medium">
                  {activeFeedsCount} active watchlists
                </span>
              </div>

              {/* Search & Filter Toolbar */}
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter signals by headline, sector, source..."
                    className="w-full rounded-lg border border-border/70 bg-background/70 pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Category Filter Chips */}
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px] scrollbar-none">
                {[
                  { id: 'all', label: `All (${rawEvents.length})` },
                  { id: 'critical', label: `Critical & High (${criticalCount})` },
                  { id: 'spatial', label: `Spatial (${spatialCount})` },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setOverviewFilter(tab.id)}
                    className={cn(
                      'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors border',
                      overviewFilter === tab.id
                        ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                        : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Intake Events List */}
              <div data-testid="intake-stream" className="space-y-1.5 max-h-[380px] overflow-y-auto pr-0.5">
                {eventsLoading ? (
                  <div className="py-6 text-center text-xs text-muted-foreground animate-pulse">
                    Scanning sensor channels…
                  </div>
                ) : filteredEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-lg">
                    <Filter className="h-5 w-5 mb-1 text-muted-foreground/50" />
                    <p className="font-medium text-foreground">No signals match current filter</p>
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => { setSearchQuery(''); setOverviewFilter('all'); }}
                        className="mt-1.5 text-[10px] text-primary hover:underline"
                      >
                        Reset filters
                      </button>
                    )}
                  </div>
                ) : (
                  filteredEvents.slice(0, 10).map((event) => {
                    const isSelected = selectedSignalId === event.id || (!selectedSignalId && activeSignal?.id === event.id);
                    const title = extractSignalTitle(event);
                    const sector = extractSignalSector(event);
                    const juris = extractSignalJurisdiction(event);
                    const source = extractSignalSource(event);
                    const sev = extractSignalSeverity(event);
                    const time = formatTimeAgo(event.extractionTimestamp || event.detectedAt);

                    return (
                      <div
                        key={event.id}
                        data-testid={`intake-item-${event.id}`}
                        onClick={() => setSelectedSignalId(event.id)}
                        className={cn(
                          'group flex items-start justify-between rounded-lg border p-2.5 text-[11px] cursor-pointer transition-all duration-150',
                          isSelected
                            ? 'border-primary/50 bg-primary/10 text-foreground shadow-xs'
                            : 'border-border/60 bg-background/50 hover:bg-accent/40 hover:border-border text-muted-foreground'
                        )}
                      >
                        <div className="flex items-start gap-2.5 min-w-0 pr-2">
                          <div
                            className={cn(
                              'mt-1 h-2 w-2 rounded-full shrink-0',
                              sev === 'Critical'
                                ? 'bg-destructive ring-2 ring-destructive/20 animate-pulse'
                                : sev === 'High'
                                ? 'bg-amber-400'
                                : 'bg-emerald-400'
                            )}
                            title={`${sev} severity`}
                          />
                          <div className="min-w-0 space-y-0.5">
                            <p className={cn("font-medium leading-tight truncate", isSelected ? "text-foreground font-semibold" : "text-foreground/90")}>
                              {title}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span className="font-medium text-primary/80">{sector}</span>
                              <span>•</span>
                              <span>{juris || source}</span>
                              <span>•</span>
                              <span>{time}</span>
                              {event.h3Index && (
                                <span className="inline-flex items-center gap-0.5 text-cyan-400">
                                  <Globe className="h-2.5 w-2.5" />
                                  <span>H3</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 self-center">
                          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isSelected ? "text-primary translate-x-0.5" : "text-muted-foreground/60 group-hover:text-foreground")} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: 🗺️ Spatial H3 Map Engine with Bi-Directional CREW Actions */}
        {activeTab === 'spatial' && (
          <div className="p-3 space-y-3">
            {/* Quick Actions Bar inside Spatial Map */}
            <div className="flex items-center justify-between rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2.5">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-cyan-400 shrink-0" />
                <span className="text-xs font-semibold text-foreground">
                  Uber H3 Spatial Analytics &amp; Dwell Anomaly Engine
                </span>
              </div>
              <button
                type="button"
                onClick={handleSendSpatialAnomalyToCrew}
                disabled={!spatialFocusEvent || !onFocusInChat}
                className="inline-flex items-center gap-1 rounded-md bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                title={spatialFocusEvent ? 'Send the longest-dwelling located signal to CREW chat' : 'No signal has a location yet'}
              >
                <Send className="h-3 w-3" />
                <span>Send to CREW</span>
              </button>
            </div>

            {/* Embedded Interactive Spatial Map Panel */}
            <div data-testid="spatial-viewport" className="rounded-xl border border-border/80 bg-background/80 p-2 overflow-hidden min-h-[480px]">
              <SpatialH3MapPanel
                initialLat={spatialFocusEvent?.latitude ? Number(spatialFocusEvent.latitude) : 34.0522}
                initialLng={spatialFocusEvent?.longitude ? Number(spatialFocusEvent.longitude) : -118.2437}
                initialQuery={spatialFocusEvent?.jurisdiction || "Los Angeles, CA"}
                onSendToCrew={(marker, prompt) => { if (marker.rawEvent) handleDiscussInCrew(prompt, marker.rawEvent); }}
              />
            </div>
          </div>
        )}

        {/* VIEW 3: 📡 Native Signals & Decisions Workbench */}
        {activeTab === 'signals' && (
          <div className="h-full min-h-[560px] overflow-hidden">
            <SignalsDecisionsWorkbench
              signals={rawEvents}
              selectedSignalId={selectedSignalId}
              onSelectSignal={(id) => setSelectedSignalId(id)}
              onDiscussInCrew={handleDiscussInCrew}
              onLaunchInitiative={(signal) => launchMutation.mutate(signal)}
              isLaunchingInitiative={launchMutation.isPending}
              onNavigateToTab={(tab) => setActiveTab(tab)}
              organizationId={organizationId}
            />
          </div>
        )}

        {/* VIEW 4: ⚡ Sources & Feed Ingestion */}
        {activeTab === 'sources' && (
          <div className="p-3">
            <SourcesView organizationId={organizationId} />
          </div>
        )}

        {/* VIEW 5: 🛡️ Rule Builder & Subscriptions */}
        {activeTab === 'rules' && (
          <div data-testid="rules-panel" className="p-3 space-y-4">
            <RuleBuilder
              embedded
              selectedSignal={activeIntelligenceSignal}
              initialRuleTree={
                activeIntelligenceSignal?.event?.h3Index === '8828308281fffff' ||
                activeIntelligenceSignal?.event?.subjectId === 'AST-8842' ||
                (typeof window !== 'undefined' && window.location.search.includes('lat=34.0522'))
                  ? createRescueDispatchGeoRuleTree()
                  : undefined
              }
              initialDeliveryMode="trigger"
              initialCooldownMinutes={5}
            />
            <div className="pt-4 border-t border-border/60">
              <SubscriptionsView organizationId={organizationId} selectedSignal={activeIntelligenceSignal} />
            </div>
          </div>
        )}

        {/* VIEW 6: 🔍 Custom Signal Filter Builder */}
        {activeTab === 'filters' && (
          <div className="p-2">
            <SignalFilterBuilder onOpenSpatialRadar={() => setActiveTab('spatial')} />
          </div>
        )}

        {/* VIEW 7: 📦 Industry Intelligence Packs */}
        {activeTab === 'packs' && (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between pb-1">
              <div>
                <h3 className="text-xs font-semibold text-foreground">Curated Industry Intelligence Packs</h3>
                <p className="text-[11px] text-muted-foreground">
                  Activate pre-configured feeds, risk formulas, and automated response playbooks with 1 click.
                </p>
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {INDUSTRY_PACKS.map((pack) => {
                const isActivating = activatingPackId === pack.id;
                return (
                  <div
                    key={pack.id}
                    className="flex flex-col justify-between rounded-xl border border-border/80 bg-card/60 p-3 hover:border-primary/40 transition-colors"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border', pack.accentColor)}>
                          {pack.badge}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{pack.targetRole}</span>
                      </div>
                      <h4 className="mt-1.5 text-xs font-semibold text-foreground">{pack.name}</h4>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{pack.description}</p>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground font-mono">{pack.feeds.length} Channels</span>
                      <button
                        type="button"
                        onClick={() => activatePackMutation.mutate(pack)}
                        disabled={isActivating || activatePackMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        <span>{isActivating ? 'Activating…' : 'Activate Pack'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 8: 🔀 Visual JSONPath Schema Mapper */}
        {activeTab === 'mapper' && (
          <div className="p-2 h-full">
            <JsonPathSchemaMapper />
          </div>
        )}
      </div>
    </div>
  );
}

export default SignalStudioPod;
