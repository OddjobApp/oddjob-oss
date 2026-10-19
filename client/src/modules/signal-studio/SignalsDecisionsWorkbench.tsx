import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  Activity,
  AlertTriangle,
  Bot,
  Building2,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Compass,
  CornerDownRight,
  ExternalLink,
  FileText,
  Filter,
  Globe,
  Layers,
  MapPin,
  Maximize2,
  Megaphone,
  Monitor,
  Radio,
  Search,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import {
  ImpactVisualization,
  type CausalLinkDto,
} from '@/components/signal-intelligence/spatial/ImpactVisualization';
import { EntityDetailPanel } from '@/components/signal-intelligence/spatial/EntityDetailPanel';
import {
  toIntelligenceSignal,
  sortSignals,
  type IntelligenceSignal,
  type SignalEvent,
  type SortOption,
} from '@/components/signal-intelligence/spatial/utils';

export interface SignalsDecisionsWorkbenchProps {
  signals?: any[];
  selectedSignalId: string | null;
  onSelectSignal: (id: string) => void;
  onDiscussInCrew?: (customPrompt?: string) => void;
  onLaunchInitiative?: (signal: any) => void;
  isLaunchingInitiative?: boolean;
  onNavigateToTab?: (tab: 'spatial' | 'rules' | 'sources' | 'packs') => void;
  organizationId?: number;
  className?: string;
}


export function SignalsDecisionsWorkbench({
  signals: propSignals,
  selectedSignalId,
  onSelectSignal,
  onDiscussInCrew,
  onLaunchInitiative,
  isLaunchingInitiative,
  onNavigateToTab,
  organizationId = 1,
  className,
}: SignalsDecisionsWorkbenchProps) {
  const { toast } = useToast();
  // Query signals if not provided as props
  const { data: rawEvents = [], isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: ['/api/event-primitives?limit=100'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/event-primitives?limit=100');
      return res.json();
    },
    enabled: !propSignals || propSignals.length === 0,
  });

  // Real signals only. Five invented Orange County "grounded signals" — named
  // homeowners, APNs, recorder and court case numbers — used to be merged into
  // every list here.
  const effectiveRawSignals = propSignals && propSignals.length > 0 ? propSignals : rawEvents;

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('severity');
  const [activePane, setActivePane] = useState<'feed' | 'brief'>('feed');
  const [selectedEntity, setSelectedEntity] = useState<{ entityType: string; entityId: string } | null>(null);

  // Convert raw signals to typed IntelligenceSignal
  const intelligenceSignals = useMemo<IntelligenceSignal[]>(() => {
    return effectiveRawSignals.map((s) => {
      if (s.event && s.title && s.kind) {
        return s as IntelligenceSignal;
      }
      const mapped = toIntelligenceSignal(s as SignalEvent);
      if (s.title) {
        return { ...mapped, title: s.title };
      }
      return mapped;
    });
  }, [effectiveRawSignals]);

  // Filtered and sorted signals
  const filteredSignals = useMemo(() => {
    const filtered = intelligenceSignals.filter((signal) => {
      // Severity filter
      if (severityFilter !== 'all') {
        if (signal.event.severity?.toLowerCase() !== severityFilter.toLowerCase()) {
          return false;
        }
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = signal.title?.toLowerCase().includes(q);
        const sectorMatch = signal.event.targetSector?.toLowerCase().includes(q);
        const jurisdictionMatch = signal.event.jurisdiction?.toLowerCase().includes(q);
        const rawMatch = signal.event.rawText?.toLowerCase().includes(q);
        const eventTypeMatch = signal.event.eventType?.toLowerCase().includes(q);
        if (!titleMatch && !sectorMatch && !jurisdictionMatch && !rawMatch && !eventTypeMatch) {
          return false;
        }
      }
      return true;
    });

    return sortSignals(filtered, sortBy);
  }, [intelligenceSignals, severityFilter, searchQuery, sortBy]);

  // Active selected signal
  const activeSignal = useMemo(() => {
    if (selectedSignalId) {
      const found = intelligenceSignals.find((s) => s.id === selectedSignalId);
      if (found) return found;
    }
    return filteredSignals[0] || intelligenceSignals[0] || null;
  }, [intelligenceSignals, filteredSignals, selectedSignalId]);

  // Query causal graph links for active signal
  const {
    data: causalLinks = [],
    isLoading: causalLoading,
    error: causalError,
    refetch: refetchCausal,
  } = useQuery<CausalLinkDto[]>({
    queryKey: [`/api/causal-graph/links/${activeSignal?.id ?? 'none'}`],
    enabled: Boolean(activeSignal?.id),
    retry: 1,
    refetchOnMount: 'always',
  });

  const criticalCount = useMemo(
    () => intelligenceSignals.filter((s) => /critical/i.test(s.event.severity)).length,
    [intelligenceSignals]
  );
  const highCount = useMemo(
    () => intelligenceSignals.filter((s) => /high/i.test(s.event.severity)).length,
    [intelligenceSignals]
  );

  const handleSelect = (id: string) => {
    onSelectSignal(id);
    setSelectedEntity(null);
    setActivePane('brief');
  };

  const handleDiscuss = () => {
    if (!activeSignal || !onDiscussInCrew) return;
    const prompt = `Let's analyze Market Signal "${activeSignal.title}" (${activeSignal.event.jurisdiction}, Severity: ${activeSignal.event.severity}). What is our immediate operational exposure and recommended response playbook?`;
    onDiscussInCrew(prompt);
  };

  const handleLaunch = () => {
    if (!activeSignal || !onLaunchInitiative) return;
    onLaunchInitiative(activeSignal.event);
  };

  return (
    <div
      className={cn(
        'flex h-full min-h-[560px] flex-col overflow-hidden bg-card text-foreground',
        className
      )}
      data-testid="signals-decisions-workbench"
    >
      {/* ─── Compact Screen Pane Switcher ─── */}
      <div className="flex items-center justify-between border-b border-border/70 bg-card/60 px-3 py-1.5 md:hidden">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActivePane('feed')}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
              activePane === 'feed'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            Signals ({filteredSignals.length})
          </button>
          <button
            type="button"
            onClick={() => setActivePane('brief')}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
              activePane === 'brief'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            Decision Brief
          </button>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {criticalCount} Critical • {highCount} High
        </span>
      </div>

      {/* ─── Main Two-Column Workbench Layout ─── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ─── Left Column: Signal Feed ─── */}
        <aside
          className={cn(
            'flex flex-col border-r border-border/70 bg-card/40 md:w-80 lg:w-96 shrink-0 transition-all',
            activePane === 'brief' ? 'hidden md:flex' : 'w-full flex'
          )}
          aria-label="Signal Intelligence Feed"
        >
          {/* Feed Controls */}
          <div className="border-b border-border/60 p-2.5 space-y-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by sector, region, title…"
                className="w-full rounded-md border border-border/80 bg-background/80 py-1 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
                data-testid="signal-search-input"
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

            {/* Severity Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none text-[11px]">
              {(['all', 'critical', 'high', 'medium', 'low'] as const).map((sev) => {
                const isActive = severityFilter === sev;
                return (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverityFilter(sev)}
                    className={cn(
                      'rounded-md px-2 py-0.5 font-medium capitalize transition-colors shrink-0 border',
                      isActive
                        ? sev === 'critical'
                          ? 'border-destructive/50 bg-destructive/15 text-destructive font-semibold'
                          : sev === 'high'
                          ? 'border-amber-500/50 bg-amber-500/15 text-amber-400 font-semibold'
                          : 'border-border bg-background text-foreground font-semibold shadow-xs'
                        : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                  >
                    {sev}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Feed Counter Bar */}
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-1 text-[10px] text-muted-foreground bg-muted/20">
            <span>
              {filteredSignals.length} of {intelligenceSignals.length} signals
            </span>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Sensor Live</span>
            </div>
          </div>

          {/* Signals List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/40">
            {eventsLoading && filteredSignals.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <Activity className="h-6 w-6 animate-spin text-primary mb-2" />
                <p className="text-xs">Streaming real-time signals…</p>
              </div>
            ) : filteredSignals.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <ShieldAlert className="h-6 w-6 text-muted-foreground/60 mb-2" />
                <p className="text-xs font-medium text-foreground">No matching signals</p>
                <p className="text-[11px] mt-0.5">Try clearing filters or search terms.</p>
              </div>
            ) : (
              filteredSignals.map((signal) => {
                const isSelected = activeSignal?.id === signal.id;
                const isCritical = /critical/i.test(signal.event.severity);
                const isHigh = /high/i.test(signal.event.severity);

                return (
                  <button
                    key={signal.id}
                    type="button"
                    onClick={() => handleSelect(signal.id)}
                    className={cn(
                      'w-full text-left p-3 transition-colors relative focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      isSelected
                        ? 'bg-primary/10 border-l-2 border-primary text-foreground'
                        : 'hover:bg-muted/40 text-muted-foreground hover:text-foreground'
                    )}
                    data-testid={`signal-item-${signal.id}`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider',
                          isCritical
                            ? 'bg-destructive/15 text-destructive border border-destructive/30'
                            : isHigh
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                            : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        )}
                      >
                        {signal.event.severity}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {signal.age}
                      </span>
                    </div>

                    <h4 className="mt-1.5 text-xs font-semibold text-foreground line-clamp-2 leading-snug">
                      {signal.title}
                    </h4>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="rounded bg-muted/60 px-1.5 py-0.5 font-medium">
                        {signal.event.jurisdiction || 'Global'}
                      </span>
                      <span>•</span>
                      <span className="truncate max-w-[120px]">
                        {signal.event.targetSector}
                      </span>
                      <span>•</span>
                      <span className="font-mono text-primary font-medium">
                        {signal.score ?? 85}% conf
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ─── Right Column: Selected Signal Decision Brief & Causal DAG ─── */}
        <main
          className={cn(
            'flex-1 flex flex-col min-w-0 overflow-y-auto bg-background/50',
            activePane === 'feed' ? 'hidden md:flex' : 'flex'
          )}
          aria-label="Signal Decision Brief"
        >
          {activeSignal ? (
            <div className="p-3.5 md:p-4 space-y-4 max-w-4xl">
              {/* Back to feed on compact screens */}
              <div className="md:hidden pb-1">
                <button
                  type="button"
                  onClick={() => setActivePane('feed')}
                  className="inline-flex items-center gap-1 text-xs text-primary font-medium"
                >
                  <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                  <span>Back to signal feed</span>
                </button>
              </div>

              {/* Signal Executive Header */}
              <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-3 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                        /critical/i.test(activeSignal.event.severity)
                          ? 'bg-destructive/15 text-destructive border border-destructive/30'
                          : /high/i.test(activeSignal.event.severity)
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      )}
                    >
                      {activeSignal.event.severity} Exposure
                    </span>
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {activeSignal.event.eventType?.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                    <span>ID: {activeSignal.id}</span>
                    <span>•</span>
                    <span>{activeSignal.age}</span>
                  </div>
                </div>

                <div>
                  <h2 className="text-sm md:text-base font-bold text-foreground leading-snug">
                    {activeSignal.title}
                  </h2>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                    {activeSignal.event.rawText ||
                      `Detected market primitive affecting ${activeSignal.event.targetSector} across ${activeSignal.event.jurisdiction}. Exposure is currently evaluated by active telemetry rules.`}
                  </p>
                </div>

                {/* Key Metric Facts */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/50 text-xs">
                  <div className="rounded-lg bg-card/70 border border-border/60 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Jurisdiction</span>
                    <p className="font-semibold text-foreground truncate">{activeSignal.event.jurisdiction || 'Global'}</p>
                  </div>
                  <div className="rounded-lg bg-card/70 border border-border/60 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Target Sector</span>
                    <p className="font-semibold text-foreground truncate">{activeSignal.event.targetSector || 'General'}</p>
                  </div>
                  <div className="rounded-lg bg-card/70 border border-border/60 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Confidence</span>
                    <p className="font-semibold text-primary font-mono">{activeSignal.score ?? 85}%</p>
                  </div>
                  <div className="rounded-lg bg-card/70 border border-border/60 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Affected Nodes</span>
                    <p className="font-semibold text-foreground font-mono">{causalLinks.length} mapped</p>
                  </div>
                </div>
              </div>

              {/* Modeled Causal DAG & Blast Radius */}
              <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <div>
                      <h3 className="text-xs font-semibold text-foreground">
                        Causal Graph &amp; Entity Blast Radius
                      </h3>
                      <p className="text-[10px] text-muted-foreground">
                        Modeled enterprise dependencies, suppliers, and infrastructure assets connected to this signal.
                      </p>
                    </div>
                  </div>
                  {causalLinks.length > 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {causalLinks.length} entities connected
                    </span>
                  )}
                </div>

                <div className="rounded-lg border border-border/60 bg-background/80 p-2 overflow-hidden flex items-center justify-center min-h-[220px]">
                  <ImpactVisualization
                    signalId={activeSignal.id}
                    causalLinks={causalLinks}
                    isLoading={causalLoading}
                    error={causalError as Error | null}
                    severity={activeSignal.event.severity}
                    onNodeClick={(entityType, entityId) => setSelectedEntity({ entityType, entityId })}
                    onRetry={() => refetchCausal()}
                  />
                </div>

                {/* Selected Node Drilldown */}
                {selectedEntity && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary">
                        Asset Detail: {selectedEntity.entityType} ({selectedEntity.entityId})
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedEntity(null)}
                        className="text-muted-foreground hover:text-foreground text-xs"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <EntityDetailPanel
                      entityType={selectedEntity.entityType}
                      entityId={selectedEntity.entityId}
                      causalLinks={causalLinks}
                    />
                  </div>
                )}
              </div>

              {/* 1-Click Executive Decision Plays */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  <div>
                    <h3 className="text-xs font-semibold text-primary">
                      Executive Decision Plays &amp; Agency Action
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Take direct action across CREW rooms, active workflows, and automated monitoring rules.
                    </p>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {/* Computer Studio Public Record Verification */}
                  <button
                    type="button"
                    onClick={() => {
                      const prompt = `Launch Computer Studio to look up Orange County public records (ttc.ocgov.com tax rolls and ocrecorder.com lien records) for parcel "${activeSignal.title}".`;
                      if (onDiscussInCrew) {
                        onDiscussInCrew(prompt);
                      } else {
                        toast({
                          title: 'Computer Studio Verification',
                          description: "Open this signal in a CREW room to run this — nothing has been started."
                        });
                      }
                    }}
                    className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-card p-3 text-left hover:border-amber-500 hover:bg-accent transition-colors shadow-xs group"
                    data-testid="decision-computer-studio-verify"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-400 group-hover:bg-amber-500 group-hover:text-amber-950 transition-colors">
                      <Monitor className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-foreground group-hover:text-amber-400 transition-colors">
                        Verify Public Records (Computer Studio)
                      </h4>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                        Ask a CREW agent to look this parcel up on the OC Treasurer-Tax Collector and Clerk-Recorder sites.
                      </p>
                    </div>
                  </button>

                  {/* Scribe Studio Distress Dossier */}
                  <button
                    type="button"
                    onClick={() => {
                      const prompt = `Mount Scribe Studio to author a 3-page comprehensive Residential Underwriting & Owner Outreach Memo for "${activeSignal.title}", including APN, encumbrance stack, estimated market value, and equity preservation strategy.`;
                      if (onDiscussInCrew) {
                        onDiscussInCrew(prompt);
                      } else {
                        toast({
                          title: 'Scribe Studio Dossier',
                          description: "Open this signal in a CREW room to run this — nothing has been started."
                        });
                      }
                    }}
                    className="flex items-start gap-2.5 rounded-lg border border-blue-500/40 bg-card p-3 text-left hover:border-blue-500 hover:bg-accent transition-colors shadow-xs group"
                    data-testid="decision-scribe-studio-dossier"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-400 group-hover:bg-blue-500 group-hover:text-foreground transition-colors">
                      <FileText className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-foreground group-hover:text-blue-400 transition-colors">
                        Compile Underwriting &amp; Outreach Memo (Scribe Studio)
                      </h4>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                        Author an executive underwriting memo detailing residential parcel specs, encumbrances, discount to market, and owner workout proposal.
                      </p>
                    </div>
                  </button>

                  {/* Form Studio Note Acquisition Review */}
                  <button
                    type="button"
                    onClick={() => {
                      const prompt = `Trigger Form Studio for Acquisitions Director authorization on "${activeSignal.title}".`;
                      if (onDiscussInCrew) {
                        onDiscussInCrew(prompt);
                      } else {
                        toast({
                          title: 'Form Studio Approval',
                          description: "Open this signal in a CREW room to run this — nothing has been started."
                        });
                      }
                    }}
                    className="flex items-start gap-2.5 rounded-lg border border-emerald-500/40 bg-card p-3 text-left hover:border-emerald-500 hover:bg-accent transition-colors shadow-xs group"
                    data-testid="decision-form-studio-review"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-foreground transition-colors">
                      <CheckSquare className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-foreground group-hover:text-emerald-400 transition-colors">
                        Authorize Acquisition / Short Sale (Form Studio)
                      </h4>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                        Submit an Acquisitions Director sign-off form to approve opening bid limits for trustee auction or direct note purchase.
                      </p>
                    </div>
                  </button>

                  {/* Discuss in CREW */}
                  <button
                    type="button"
                    onClick={handleDiscuss}
                    className="flex items-start gap-2.5 rounded-lg border border-border/80 bg-card p-3 text-left hover:border-primary/50 hover:bg-accent transition-colors shadow-xs group"
                    data-testid="decision-discuss-crew"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <Send className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                        Discuss in CREW Room
                      </h4>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                        Post this signal and modeled exposure footprint to the active CREW meeting for multi-agent deliberation.
                      </p>
                    </div>
                  </button>

                  {/* Launch Mitigation Initiative */}
                  <button
                    type="button"
                    onClick={handleLaunch}
                    disabled={isLaunchingInitiative}
                    className="flex items-start gap-2.5 rounded-lg border border-border/80 bg-card p-3 text-left hover:border-primary/50 hover:bg-accent transition-colors shadow-xs group disabled:opacity-50"
                    data-testid="decision-launch-initiative"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-foreground transition-colors">
                      <Megaphone className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-foreground group-hover:text-emerald-400 transition-colors">
                        Launch Mitigation Initiative
                      </h4>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                        Spin up a response playbook in Project Studio to adjust milestone deadlines and reroute supply corridors.
                      </p>
                    </div>
                  </button>

                  {/* Create Auto-Rule */}
                  {onNavigateToTab && (
                    <button
                      type="button"
                      onClick={() => onNavigateToTab('rules')}
                      className="flex items-start gap-2.5 rounded-lg border border-border/80 bg-card p-3 text-left hover:border-purple-500/50 hover:bg-accent transition-colors shadow-xs group"
                      data-testid="decision-create-rule"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-purple-500/10 text-purple-400 group-hover:bg-purple-500 group-hover:text-foreground transition-colors">
                        <Shield className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-foreground group-hover:text-purple-400 transition-colors">
                          Create Automated Rule
                        </h4>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                          Configure an automated trigger in Rule Builder to alert or dispatch agents when similar conditions recur.
                        </p>
                      </div>
                    </button>
                  )}

                  {/* Inspect on Spatial Map */}
                  {onNavigateToTab && (
                    <button
                      type="button"
                      onClick={() => onNavigateToTab('spatial')}
                      className="flex items-start gap-2.5 rounded-lg border border-border/80 bg-card p-3 text-left hover:border-cyan-500/50 hover:bg-accent transition-colors shadow-xs group"
                      data-testid="decision-inspect-spatial"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500 group-hover:text-foreground transition-colors">
                        <Globe className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-foreground group-hover:text-cyan-400 transition-colors">
                          Inspect on Spatial Map
                        </h4>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                          Locate affected geographic coordinates and inspect Uber H3 hexagonal dwell anomalies.
                        </p>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 p-8 text-center text-muted-foreground">
              <Activity className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <h3 className="text-sm font-semibold text-foreground">Select a Signal to View Decisions</h3>
              <p className="mt-1 text-xs max-w-sm">
                Choose an incoming signal from the feed on the left to inspect modeled causal impact, affected asset networks, and launch response initiatives.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default SignalsDecisionsWorkbench;
