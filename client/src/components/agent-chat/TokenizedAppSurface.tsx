import React, { useState, useEffect } from 'react';
import {
  LayoutTemplate,
  ExternalLink,
  Maximize2,
  Minimize2,
  Search,
  Sparkles,
  Gavel,
  FileText,
  Database,
  CheckCircle2,
  Clock,
  ArrowRight,
  Send,
  ListTodo,
  ShieldAlert,
  Network,
  RefreshCw,
  Plus,
  Code2,
  Kanban,
  Terminal,
  Activity,
  GitPullRequest,
  MapPin,
  Flame,
  LineChart,
  Bug,
  AlertCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SignalStudioPod } from '@/modules/signal-studio/SignalStudioPod';

interface AppLaunchData {
  title: string;
  blueprint?: string;
  href?: string;
  appId?: number | string;
}

interface TokenizedAppSurfaceProps {
  app: AppLaunchData;
  href: string;
  onOpenExternal?: () => void;
}

// ─── Module Definitions for Workbenches ───────────────────────────────────────

const RESEARCH_MODULES = [
  { id: 'ingestion', label: 'Ingestion Hub', icon: Search, accent: 'text-blue-400', badge: 'Sources' },
  { id: 'decision', label: 'Decision Panel', icon: Gavel, accent: 'text-violet-400', badge: 'HIL Gates' },
  { id: 'draft', label: 'Draft Sandbox', icon: FileText, accent: 'text-foreground/85', badge: 'RFC Review' },
  { id: 'memory', label: 'Memory Library', icon: Database, accent: 'text-teal-400', badge: 'Graph' },
  { id: 'backlog', label: 'Backlog Provisioner', icon: ListTodo, accent: 'text-amber-400', badge: 'Actions' },
];

const SDLC_MODULES = [
  { id: 'spec', label: 'Requirements & Spec', icon: FileText, accent: 'text-blue-400', badge: 'Architecture' },
  { id: 'sprint', label: 'Sprint Kanban', icon: Kanban, accent: 'text-emerald-400', badge: 'Active Iteration' },
  { id: 'codegen', label: 'Code Planner', icon: Code2, accent: 'text-purple-400', badge: 'Multi-File' },
  { id: 'testing', label: 'Self-Healing Tests', icon: Terminal, accent: 'text-amber-400', badge: 'Automated' },
  { id: 'pipeline', label: 'PR & Release Pipeline', icon: GitPullRequest, accent: 'text-rose-400', badge: 'Deployment' },
];

const OPS_MODULES = [
  { id: 'telemetry', label: 'Telemetry Engine', icon: Activity, accent: 'text-cyan-400', badge: 'Realtime Logs' },
  { id: 'spatial', label: 'Spatial Analytics (H3)', icon: MapPin, accent: 'text-emerald-400', badge: 'Geospatial Grid' },
  { id: 'triage', label: 'Alert Triage', icon: Flame, accent: 'text-rose-400', badge: 'Incidents' },
  { id: 'capacity', label: 'Capacity Planner', icon: LineChart, accent: 'text-amber-400', badge: 'Infrastructure' },
];

const TICKETING_MODULES = [
  { id: 'bug-form', label: 'Submit Bug Report', icon: Bug, accent: 'text-rose-400', badge: 'Form Engine' },
  { id: 'tickets', label: 'Workstream Tickets', icon: ListTodo, accent: 'text-amber-400', badge: 'Active' },
  { id: 'hil-gates', label: 'HIL Governance', icon: Gavel, accent: 'text-purple-400', badge: 'Approval' },
];

export function TokenizedAppSurface({ app, href, onOpenExternal }: TokenizedAppSurfaceProps) {
  const titleLower = app.title.toLowerCase();
  const bpLower = (app.blueprint || '').toLowerCase();

  const isSignalOrSpatial =
    bpLower.includes('signal') ||
    bpLower.includes('spatial') ||
    titleLower.includes('signal') ||
    titleLower.includes('spatial') ||
    Boolean(href && /(?:signal|spatial)/i.test(href));

  if (isSignalOrSpatial) {
    const isSpatialRequested = titleLower.includes('spatial') || bpLower.includes('spatial');
    return (
      <div
        className="mt-3 overflow-hidden rounded-2xl border border-border/60 bg-card/90 shadow-lg"
        data-testid="tokenized-app-surface"
      >
        <SignalStudioPod
          initialView={isSpatialRequested ? 'spatial' : 'overview'}
          onPopOut={onOpenExternal}
        />
      </div>
    );
  }

  const isTicketing =
    bpLower.includes('ticket') ||
    bpLower.includes('form') ||
    titleLower.includes('ticket') ||
    titleLower.includes('bug') ||
    titleLower.includes('issue');

  const isSdlc =
    !isTicketing &&
    (bpLower.includes('sdlc') || titleLower.includes('sdlc') || titleLower.includes('code'));

  const isOps =
    !isTicketing &&
    !isSdlc &&
    (bpLower.includes('ops') || titleLower.includes('ops') || titleLower.includes('fleet'));

  const hasLiveUrl = Boolean(href && href.trim().length > 0);
  const liveTab = hasLiveUrl
    ? [{ id: 'live-app', label: 'Live App', icon: LayoutTemplate, accent: 'text-primary', badge: 'Interactive' }]
    : [];

  const baseModules = isTicketing
    ? TICKETING_MODULES
    : isSdlc
    ? SDLC_MODULES
    : isOps
    ? OPS_MODULES
    : RESEARCH_MODULES;

  const modules = [...liveTab, ...baseModules];

  const [activeTab, setActiveTab] = useState(modules[0]?.id || 'live-app');
  const [iframeKey, setIframeKey] = useState(0);

  const getEmbeddedUrl = (path: string) => {
    if (!path) return path;
    const separator = path.includes('?') ? '&' : '?';
    if (path.includes('embedded=true')) return path;
    return `${path}${separator}embedded=true`;
  };

  // Generic Form State
  const [inputText, setInputText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [items, setItems] = useState<Array<{ id: string; title: string; subtitle: string; tag: string }>>([]);

  // Bug Form Engine State
  const [bugTitle, setBugTitle] = useState('');
  const [bugWorkstream, setBugWorkstream] = useState('Frontend UI & Breakpoints');
  const [bugSeverity, setBugSeverity] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('High');
  const [bugDetails, setBugDetails] = useState('');
  const [submittedTickets, setSubmittedTickets] = useState([
    {
      id: 'BUG-101',
      title: 'Sidebar layout obscured by portaled header',
      workstream: 'Frontend UI',
      severity: 'High',
      status: 'RESOLVED',
      timestamp: 'Just now',
    },
    {
      id: 'BUG-102',
      title: 'Hat menu tray overlapping header bar',
      workstream: 'Layout Shell',
      severity: 'Medium',
      status: 'RESOLVED',
      timestamp: '2 mins ago',
    },
  ]);
  const [formSuccessMessage, setFormSuccessMessage] = useState<string | null>(null);

  const handleBugFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bugTitle.trim()) return;
    setIsBusy(true);

    setTimeout(() => {
      const newTicket = {
        id: `BUG-${Math.floor(100 + Math.random() * 900)}`,
        title: bugTitle.trim(),
        workstream: bugWorkstream,
        severity: bugSeverity,
        status: 'OPEN',
        timestamp: 'Just now',
      };
      setSubmittedTickets((prev) => [newTicket, ...prev]);
      setFormSuccessMessage(`Bug ticket ${newTicket.id} submitted successfully to ${bugWorkstream} workstream!`);
      setBugTitle('');
      setBugDetails('');
      setIsBusy(false);
    }, 600);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    setIsBusy(true);
    setTimeout(() => {
      setItems((prev) => [
        {
          id: Math.random().toString(36).substring(2, 8),
          title: inputText.trim(),
          subtitle: 'Created by Copilot',
          tag: isSdlc ? 'In Review' : isOps ? 'Active Stream' : 'Active Ingestion',
        },
        ...prev,
      ]);
      setInputText('');
      setIsBusy(false);
    }, 500);
  };

  const [isFullscreen, setIsFullscreen] = useState(false);

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

  return (
    <div
      className={cn(
        "mt-3 overflow-hidden rounded-2xl border border-border/60 bg-card/90 shadow-lg transition-all",
        isFullscreen && "fixed inset-0 z-50 mt-0 rounded-none border-0 p-6 overflow-y-auto bg-background"
      )}
      data-testid="tokenized-app-surface"
    >
      {/* ── Surface Header Bar ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/40 px-3.5 py-2 text-xs">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">
            {isTicketing ? <Bug className="h-3.5 w-3.5 text-rose-400" /> : <LayoutTemplate className="h-3.5 w-3.5" />}
          </div>
          <span className="font-semibold text-xs text-foreground tracking-tight">{app.title}</span>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
            Native Tokenized Surface
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {hasLiveUrl && (
            <button
              type="button"
              onClick={() => setIframeKey((k) => k + 1)}
              className="flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
              title="Reload Embedded App"
              data-testid="tokenized-surface-refresh"
            >
              <RefreshCw className="h-3 w-3 text-muted-foreground" />
              <span>Reload</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent hover:border-primary/50"
            title={isFullscreen ? "Exit Full Screen (Esc)" : "Expand Surface Full Screen"}
            data-testid="tokenized-surface-fullscreen"
          >
            {isFullscreen ? <Minimize2 className="h-3 w-3 text-primary" /> : <Maximize2 className="h-3 w-3 text-primary" />}
            <span>{isFullscreen ? 'Exit Full Screen' : 'Full Screen'}</span>
          </button>

          {onOpenExternal && (
            <button
              type="button"
              onClick={onOpenExternal}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Open standalone surface in new window"
              data-testid="tokenized-surface-open-external"
            >
              <ExternalLink className="h-3 w-3" />
              <span>Open Studio</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Top Module Navigation Tabs ────────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/40 bg-card/60 px-3 py-1.5 scrollbar-none">
        {modules.map((mod) => {
          const Icon = mod.icon;
          const isActive = activeTab === mod.id;
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => setActiveTab(mod.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all shrink-0 border ${
                isActive
                  ? 'border-border bg-accent text-foreground shadow-sm font-semibold'
                  : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${mod.accent}`} />
              <span>{mod.label}</span>
              {isActive && (
                <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.2 text-[9px] font-semibold text-primary">
                  {mod.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Module Surface Body ───────────────────────────────────────────────── */}
      <div className="p-4 bg-background/50 min-h-[380px]">
        {/* Live Interactive Embedded App View */}
        {activeTab === 'live-app' && hasLiveUrl && (
          <div
            className="relative w-full h-[520px] rounded-xl overflow-hidden border border-border/60 bg-card shadow-inner"
            data-testid="tokenized-live-iframe"
          >
            <iframe
              key={iframeKey}
              src={getEmbeddedUrl(href)}
              title={app.title}
              className="w-full h-full border-none"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
            />
          </div>
        )}

        {/* Ticketing & Form Engine Workstream Views */}
        {isTicketing && (
          <>
            {activeTab === 'bug-form' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Bug className="h-4 w-4 text-rose-400" />
                      <h3 className="font-semibold text-sm text-foreground">Form Engine — Submit Bug Workstream</h3>
                    </div>
                    <span className="rounded bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-rose-400 border border-rose-500/20">
                      HIL Form Active
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Submit bug reports, reproduction steps, and workstream targets directly into the HIL pipeline.
                  </p>
                </div>

                {formSuccessMessage && (
                  <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{formSuccessMessage}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormSuccessMessage(null)}
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                <form onSubmit={handleBugFormSubmit} className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">Issue Summary / Title</label>
                    <input
                      type="text"
                      value={bugTitle}
                      onChange={(e) => setBugTitle(e.target.value)}
                      placeholder="e.g., Form engine workstream submission error or breakpoint overflow..."
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground">Target Workstream</label>
                      <select
                        value={bugWorkstream}
                        onChange={(e) => setBugWorkstream(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      >
                        <option value="Frontend UI & Breakpoints">Frontend UI & Breakpoints</option>
                        <option value="Form Engine & HIL">Form Engine & HIL</option>
                        <option value="Agent Swarm & Crew Room">Agent Swarm & Crew Room</option>
                        <option value="Database & Schema">Database & Schema</option>
                        <option value="Telemetry & Spatial Engine">Telemetry & Spatial Engine</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground">Severity Level</label>
                      <div className="flex gap-1.5 pt-0.5">
                        {(['Low', 'Medium', 'High', 'Critical'] as const).map((sev) => (
                          <button
                            key={sev}
                            type="button"
                            onClick={() => setBugSeverity(sev)}
                            className={`flex-1 rounded-lg py-1 text-xs font-semibold border transition-all ${
                              bugSeverity === sev
                                ? sev === 'Critical'
                                  ? 'border-red-500 bg-red-500/20 text-red-300'
                                  : sev === 'High'
                                  ? 'border-rose-500 bg-rose-500/20 text-rose-300'
                                  : sev === 'Medium'
                                  ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                                  : 'border-blue-500 bg-blue-500/20 text-blue-300'
                                : 'border-border/50 bg-background/50 text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            {sev}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">Reproduction Steps & Log Trace</label>
                    <textarea
                      rows={3}
                      value={bugDetails}
                      onChange={(e) => setBugDetails(e.target.value)}
                      placeholder="Describe steps to reproduce the issue..."
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      type="submit"
                      disabled={isBusy || !bugTitle.trim()}
                      className="h-8 bg-rose-600 hover:bg-rose-700 text-white text-xs px-4"
                    >
                      {isBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                      Submit Bug Workstream Ticket
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {activeTab === 'tickets' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-card p-4">
                  <h4 className="font-semibold text-xs text-foreground flex items-center gap-1.5 mb-3">
                    <ListTodo className="h-4 w-4 text-amber-400" />
                    Submitted Workstream Tickets ({submittedTickets.length})
                  </h4>
                  <div className="space-y-2">
                    {submittedTickets.map((t) => (
                      <div key={t.id} className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3.5 py-2.5 text-xs">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-foreground">{t.id}</span>
                            <span className="font-medium text-foreground">{t.title}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{t.workstream} • Submitted {t.timestamp}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${
                            t.status === 'RESOLVED'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}>
                            {t.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'hil-gates' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Gavel className="h-4 w-4 text-purple-400" />
                    <h3 className="font-semibold text-sm text-foreground">HIL Governance & Workstream Approval Gates</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Automated approval gates for bug triage, priority escalation, and production hotfixes.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {/* Research / Default Views */}
        {!isTicketing && !isSdlc && !isOps && (
          <>
            {activeTab === 'ingestion' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-blue-400" />
                    <h3 className="font-semibold text-sm text-foreground">Start Autonomous Ingestion & Research</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    Enter a domain, topic, or source URL to ingest raw literature, build comparison matrices, and extract structured findings.
                  </p>
                  <form onSubmit={handleSubmit} className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Enter research topic or paste URL..."
                        className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <Button type="submit" size="sm" disabled={isBusy || !inputText.trim()} className="text-xs h-8">
                      {isBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                      Start Research
                    </Button>
                  </form>
                </div>

                <div className="rounded-xl border border-border/60 bg-card p-4">
                  <h4 className="font-medium text-xs text-foreground flex items-center gap-1.5 mb-3">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    Active Ingestion Runs ({items.length})
                  </h4>
                  {items.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground border border-dashed border-border/50 rounded-lg">
                      No research runs active. Enter a topic above to launch autonomous ingestion.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-xs">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                            <span className="font-medium text-foreground">{item.title}</span>
                          </div>
                          <span className="rounded bg-blue-500/10 px-2 py-0.5 font-medium text-blue-400">{item.tag}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'decision' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Gavel className="h-4 w-4 text-violet-400" />
                      <h3 className="font-semibold text-sm text-foreground">Decision Control Panel</h3>
                    </div>
                    <span className="rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-violet-300 border border-violet-500/20">
                      HIL Governance Active
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Render dynamic Human-In-The-Loop approval gates, track SLA countdowns, and inspect audit logs.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'draft' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-foreground/70" />
                      <h3 className="font-semibold text-sm text-foreground">Draft & Review Sandbox</h3>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs">
                      <Plus className="h-3 w-3 mr-1" /> New Artifact
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'memory' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="h-4 w-4 text-teal-400" />
                    <h3 className="font-semibold text-sm text-foreground">Shared Knowledge Memory Library</h3>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'backlog' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ListTodo className="h-4 w-4 text-amber-400" />
                      <h3 className="font-semibold text-sm text-foreground">Action & Backlog Provisioner</h3>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* SDLC Workbench Views */}
        {isSdlc && (
          <div className="space-y-4">
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-purple-400" />
                  <h3 className="font-semibold text-sm text-foreground">SDLC Lifecycle Workbench</h3>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Ops Workbench Views */}
        {isOps && (
          <div className="space-y-4">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-cyan-400" />
                  <h3 className="font-semibold text-sm text-foreground">Operations & Telemetry Engine</h3>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
