import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import {
  Activity, AlertTriangle, Bot, Check, CheckCircle2, ChevronDown, ChevronRight,
  CircleDollarSign, Clock3, Code2, Filter, Loader2, Network, Pause,
  Play, RotateCcw, Search, ShieldCheck, XCircle, Zap,
} from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Section } from "@domain-ui/core/ui/components/shared/Section";
import { ApprovalDetailDialog } from "@domain-ui/apps/ui/components/approvals/ApprovalDetailDialog";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { cn } from "@/lib/utils";

interface ActivityEvent {
  id: string | number;
  type: string;
  uiType?: string;
  message: string;
  missionName?: string;
  missionId?: number;
  agentName?: string;
  timestamp: string;
  status?: string;
  details?: { runUuid?: string; stepType?: string; jobName?: string; [key: string]: unknown };
  metadata?: Record<string, any>;
}

interface PendingApproval {
  id: number;
  title?: string;
  description?: string;
  status?: string;
  missionId?: number;
  missionName?: string;
  createdAt: string;
}

type ViewKey = "live" | "attention" | "approval" | "completed" | "failed" | "all";

const EVENT_META: Record<string, { label: string; icon: React.ElementType; tone: string; dot: string }> = {
  mission_started: { label: "Running", icon: Play, tone: "text-emerald-400", dot: "bg-emerald-400" },
  task_completed: { label: "Completed", icon: CheckCircle2, tone: "text-emerald-400", dot: "bg-emerald-400" },
  agent_action: { label: "Running", icon: Zap, tone: "text-blue-400", dot: "bg-blue-400" },
  error: { label: "Failed", icon: XCircle, tone: "text-rose-400", dot: "bg-rose-400" },
  decision: { label: "Decision", icon: ShieldCheck, tone: "text-amber-400", dot: "bg-amber-400" },
  knowledge: { label: "Updated", icon: Network, tone: "text-violet-400", dot: "bg-violet-400" },
  mission_completed: { label: "Completed", icon: CheckCircle2, tone: "text-emerald-400", dot: "bg-emerald-400" },
  budget_alert: { label: "Needs attention", icon: AlertTriangle, tone: "text-orange-400", dot: "bg-orange-400" },
};

const normalizeEvent = (event: ActivityEvent): ActivityEvent => {
  const candidate = EVENT_META[event.type] ? event.type : event.uiType;
  const type = candidate && EVENT_META[candidate] ? candidate : "agent_action";
  return {
    ...event,
    id: event.id ?? `event-${event.timestamp || Date.now()}-${Math.random()}`,
    type,
    message: typeof event.message === "string" && event.message.trim()
      ? event.message
      : "Autonomous operation updated",
  };
};

const getEventProgress = (event: ActivityEvent): number | null => {
  if (event.type === "mission_completed" || event.status === "completed") return 100;
  const raw = event.metadata?.progress;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
};

function ExecutionStepper({ event, events }: { event: ActivityEvent; events: ActivityEvent[] }) {
  const runKey = event.details?.runUuid;
  const actualSteps = events
    .filter(candidate => runKey && candidate.details?.runUuid === runKey && candidate.details?.stepType)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-6);
  const isComplete = event.type === "mission_completed" || event.status === "completed";

  if (actualSteps.length === 0) {
    return <div className="mx-4 mb-4 rounded-xl border border-[#243650] bg-background px-5 py-4 text-xs text-muted-foreground md:mx-5">
      <span className="font-semibold text-foreground">Execution telemetry</span>
      <span className="ml-2">No granular run steps were reported for this event.</span>
    </div>;
  }

  return (
    <div className="mx-4 mb-4 rounded-xl border border-[#243650] bg-background px-5 py-5 md:mx-5">
      <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)] lg:items-center">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#D88932]">{isComplete ? "Execution complete" : "Current step"}</p>
          <p className="mt-2 line-clamp-2 text-sm font-semibold text-foreground">{actualSteps[actualSteps.length - 1].message}</p>
          <p className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            {isComplete ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Loader2 className="h-3 w-3 animate-spin" />}
            {isComplete ? "Run completed" : `${actualSteps.length} recorded step${actualSteps.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="grid items-start" style={{ gridTemplateColumns: `repeat(${actualSteps.length}, minmax(0, 1fr))` }}>
          {actualSteps.map((stepEvent, index) => {
            const stepNumber = index + 1;
            const complete = isComplete || index < actualSteps.length - 1 || stepEvent.type === "task_completed";
            const active = !complete && index === actualSteps.length - 1;
            const step = String(stepEvent.details?.stepType || stepEvent.type).replaceAll("_", " ");
            return (
              <div key={step} className="relative flex min-w-0 flex-col items-center text-center">
                {index > 0 && <span className={cn("absolute right-1/2 top-4 h-px w-full", complete ? "bg-emerald-400/70" : "bg-muted")} />}
                <span className={cn(
                  "relative z-10 grid h-8 w-8 place-items-center rounded-full border bg-background text-xs font-semibold",
                  complete && "border-emerald-400 text-emerald-400",
                  active && "border-[#D88932] text-[#F0A44B] ring-4 ring-[#D88932]/10",
                  !complete && !active && "border-border text-muted-foreground",
                )}>{complete ? <Check className="h-4 w-4" /> : stepNumber}</span>
                <span className={cn("mt-2 max-w-20 truncate text-[10px] capitalize", active ? "font-semibold text-foreground" : complete ? "text-foreground" : "text-muted-foreground")} title={step}>{step}</span>
                <span className={cn("mt-0.5 text-[9px]", active ? "text-[#D88932]" : "text-muted-foreground")}>{complete ? "Complete" : active ? "In progress" : "Pending"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SkeletonView() {
  return <div className="min-h-screen bg-background p-6 space-y-5"><Skeleton className="h-20 bg-foreground/5" /><Skeleton className="h-24 bg-foreground/5" /><div className="grid lg:grid-cols-[220px_1fr_300px] gap-4"><Skeleton className="h-[650px] bg-foreground/5" /><Skeleton className="h-[650px] bg-foreground/5" /><Skeleton className="h-[650px] bg-foreground/5" /></div></div>;
}

function ActivityCenterContent() {
  const { selectedOrgId } = useOrgContext();
  const queryClient = useQueryClient();
  const [timeRange, setTimeRange] = useState("24h");
  const [activeView, setActiveView] = useState<ViewKey>("live");
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [missionFilter, setMissionFilter] = useState("all");
  const [feedPaused, setFeedPaused] = useState(false);
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [selectedApproval, setSelectedApproval] = useState<any | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);

  const { data: rawEvents, isLoading, isFetching, refetch } = useQuery<ActivityEvent[]>({
    queryKey: ["/api/missions/activity/global", selectedOrgId, timeRange],
    refetchInterval: feedPaused ? false : 15000,
    enabled: !!selectedOrgId,
  });
  const { data: rawApprovals = [] } = useQuery<PendingApproval[]>({ queryKey: ["/api/approvals"], refetchInterval: feedPaused ? false : 10000, enabled: !!selectedOrgId });
  const { data: rawMissions = [] } = useQuery<any[]>({ queryKey: ["/api/missions", selectedOrgId], enabled: !!selectedOrgId });

  // Step telemetry is returned as type="agent_step" with its visual category
  // in uiType. Normalize both run and step records before any render logic.
  const events = (Array.isArray(rawEvents) ? rawEvents : []).map(normalizeEvent);
  const approvals = (Array.isArray(rawApprovals) ? rawApprovals : []).filter((a: any) => a.status === "pending");
  const missions = Array.isArray(rawMissions) ? rawMissions : [];
  const runKey = (event: ActivityEvent) => event.details?.runUuid || (event.missionId ? `mission-${event.missionId}` : `event-${event.id}`);
  const uniqueRuns = new Map<string, ActivityEvent>();
  events.forEach(event => { const key = runKey(event); if (!uniqueRuns.has(key)) uniqueRuns.set(key, event); });
  const runSnapshots = Array.from(uniqueRuns.values());
  const liveCount = runSnapshots.filter(e => ["active", "running", "in_progress"].includes(e.status || "") || ["mission_started", "agent_action"].includes(e.type)).length;
  const failedCount = runSnapshots.filter(e => e.status === "failed" || e.type === "error").length;
  const completedCount = runSnapshots.filter(e => e.status === "completed" || e.type === "mission_completed").length;
  const attentionCount = runSnapshots.filter(e => e.status === "failed" || e.type === "error" || e.type === "budget_alert").length;

  const agents = useMemo(() => Array.from(new Set(events.map(e => e.agentName).filter(Boolean))) as string[], [events]);
  const filtered = useMemo(() => events.filter(event => {
    const haystack = `${event.message} ${event.missionName || ""} ${event.agentName || ""}`.toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (agentFilter !== "all" && event.agentName !== agentFilter) return false;
    if (missionFilter !== "all" && String(event.missionId) !== missionFilter) return false;
    // The live timeline is the operational stream: it keeps recent outcomes in
    // context instead of hiding completed/failed rows while new work arrives.
    if (activeView === "live" && event.type === "knowledge") return false;
    if (activeView === "attention" && !["error", "budget_alert", "decision"].includes(event.type)) return false;
    if (activeView === "approval" && !(event.type === "decision" || event.metadata?.requiresApproval)) return false;
    if (activeView === "completed" && !["task_completed", "mission_completed"].includes(event.type)) return false;
    if (activeView === "failed" && event.type !== "error") return false;
    return true;
  }), [events, search, agentFilter, missionFilter, activeView]);

  const selected = events.find(e => e.id === selectedId) || filtered[0];
  const safeTime = (timestamp?: string) => {
    if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return "Recently";
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  };

  if (isLoading) return <SkeletonView />;

  const views: { key: ViewKey; label: string; count: number }[] = [
    { key: "live", label: "Live now", count: liveCount }, { key: "attention", label: "Needs attention", count: attentionCount },
    { key: "approval", label: "Awaiting approval", count: approvals.length }, { key: "completed", label: "Completed", count: completedCount },
    { key: "failed", label: "Failed", count: failedCount }, { key: "all", label: "All activity", count: events.length },
  ];

  return (
    <div className="min-h-[calc(100vh-112px)] bg-background text-foreground px-3 md:px-5 py-4 space-y-3">
      <section className="grid grid-cols-2 xl:grid-cols-5 rounded-xl border border-[#1b2b43] bg-background overflow-hidden">
        {[
          ["Live missions", liveCount, Activity, "text-emerald-400"], ["Needs attention", attentionCount, AlertTriangle, "text-amber-400"],
          ["Awaiting approval", approvals.length, ShieldCheck, "text-amber-400"], ["Completed", completedCount, CheckCircle2, "text-emerald-400"], ["Failed", failedCount, XCircle, "text-rose-400"],
        ].map(([label, count, Icon, tone]: any) => <button key={label} className="flex min-h-[86px] items-center gap-4 px-5 py-4 text-left border-r border-b xl:border-b-0 border-[#1b2b43] hover:bg-foreground/[0.025] transition-colors"><span className={cn("grid h-11 w-11 place-items-center rounded-full bg-foreground/5", tone)}><Icon className="h-5 w-5" /></span><span><span className="block text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">{label}</span><strong className="mt-1 block text-2xl leading-none text-foreground tabular-nums">{count}</strong><span className="mt-1 block text-[11px] text-muted-foreground">{label === "Live missions" ? "Running now" : label === "Completed" ? "In selected window" : "Requires review"}</span></span></button>)}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[190px_minmax(0,1fr)_280px] 2xl:grid-cols-[210px_minmax(0,1fr)_300px] gap-3">
        <aside className="rounded-xl border border-[#1b2b43] bg-background p-3 xl:min-h-[670px]">
          <p className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Views</p>
          <nav className="space-y-1">{views.map(v => <button key={v.key} onClick={() => setActiveView(v.key)} className={cn("w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors", activeView === v.key ? "bg-foreground/[0.07] text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]" : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground")}><span>{v.label}</span><span className="text-xs tabular-nums">{v.count}</span></button>)}</nav>
          <div className="mt-5 border-t border-foreground/5 pt-4 px-2"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground mb-3">Saved views</p><button className="text-sm text-muted-foreground hover:text-foreground">My missions</button><button className="block mt-3 text-sm text-muted-foreground hover:text-foreground">Active agents</button></div>
        </aside>

        <main className="min-w-0 rounded-xl border border-[#1b2b43] bg-background overflow-hidden">
          <div className="flex flex-col lg:flex-row gap-2 p-3 border-b border-foreground/10">
            <label className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter missions, agents or events…" className="h-9 w-full rounded-lg border border-foreground/10 bg-background pl-9 pr-3 text-sm outline-none focus:border-primary/60" /></label>
            <select aria-label="Agent filter" value={agentFilter} onChange={e => setAgentFilter(e.target.value)} className="h-9 rounded-lg border border-foreground/10 bg-background px-3 text-xs"><option value="all">All agents</option>{agents.map(a => <option key={a} value={a}>{a}</option>)}</select>
            <select aria-label="Mission filter" value={missionFilter} onChange={e => setMissionFilter(e.target.value)} className="h-9 rounded-lg border border-foreground/10 bg-background px-3 text-xs"><option value="all">All mission types</option>{missions.map((m:any) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}</select>
            <select aria-label="Time range" value={timeRange} onChange={e => setTimeRange(e.target.value)} className="h-9 rounded-lg border border-foreground/10 bg-background px-3 text-xs"><option value="1h">Past hour</option><option value="24h">Past 24 hours</option><option value="7d">Past 7 days</option></select>
            <button onClick={() => { if (feedPaused) setFeedPaused(false); }} className="flex h-9 items-center gap-2 px-2 text-xs text-foreground"><span className={cn("h-2 w-2 rounded-full", feedPaused ? "bg-muted" : "bg-emerald-400")} />{feedPaused ? "Paused" : "Live"}</button>
            <Button variant="outline" size="sm" onClick={() => setFeedPaused(p => !p)} className="border-foreground/10 bg-background">{feedPaused ? <Play className="h-3.5 w-3.5 mr-2" /> : <Pause className="h-3.5 w-3.5 mr-2" />}{feedPaused ? "Resume" : "Pause feed"}</Button>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh timeline" className="px-2 text-muted-foreground hover:text-foreground"><RotateCcw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /></Button>
          </div>
          <div className="hidden md:grid grid-cols-[82px_1.25fr_.85fr_1.5fr_100px_110px_30px] gap-3 px-5 py-3 border-b border-foreground/5 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><span>Time</span><span>Mission</span><span>Agent</span><span>Event</span><span>Progress</span><span>Status</span><span /></div>
          <ScrollArea className="h-[610px]">
            {filtered.length === 0 ? <div className="grid place-items-center h-72 text-center"><div><Filter className="h-8 w-8 mx-auto text-muted-foreground mb-3" /><p className="text-sm text-foreground">No activity matches this view</p><button onClick={() => { setSearch(""); setActiveView("all"); }} className="mt-2 text-xs text-primary">Clear filters</button></div></div> : filtered.map((event, index) => {
              const meta = EVENT_META[event.type] || EVENT_META.agent_action; const Icon = meta.icon; const expanded = expandedId === event.id || (expandedId === null && index === 0); const progress = getEventProgress(event);
              return <div key={event.id} className={cn("border-b border-foreground/5", selected?.id === event.id && "bg-blue-500/[0.07]")}>
                <button onClick={() => { setSelectedId(event.id); setExpandedId(expanded ? null : event.id); }} className="w-full text-left grid md:grid-cols-[82px_1.25fr_.85fr_1.5fr_100px_110px_30px] gap-2 md:gap-3 items-center px-4 md:px-5 py-3.5 hover:bg-foreground/[0.025]">
                  <span className="text-xs tabular-nums text-muted-foreground"><span className={cn("inline-block h-2 w-2 rounded-full mr-2", meta.dot)} />{event.timestamp && !Number.isNaN(new Date(event.timestamp).getTime()) ? new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Now"}</span>
                  <span className="min-w-0"><strong className="block text-sm text-foreground truncate">{event.missionName || "Autonomous operation"}</strong><small className="text-[11px] text-muted-foreground">RUN-{String(event.missionId || event.id).padStart(7, "0")}</small></span>
                  <span className="text-xs text-foreground truncate"><Bot className="inline h-3.5 w-3.5 mr-1.5 text-muted-foreground" />{event.agentName || "Mission agent"}</span>
                  <span className="min-w-0"><span className="block text-sm truncate text-foreground">{event.message}</span><small className="text-[11px] text-muted-foreground">{event.type.replaceAll("_", " ")}</small></span>
                  <span>{progress === null ? <small className="text-[10px] text-muted-foreground">Not reported</small> : <><span className="block h-1.5 rounded-full bg-foreground/10 overflow-hidden"><span className={cn("block h-full rounded-full", meta.dot)} style={{ width: `${progress}%` }} /></span><small className="text-[10px] text-muted-foreground">{progress}%</small></>}</span>
                  <span className={cn("text-[10px] font-semibold uppercase tracking-wide", meta.tone)}><Icon className="inline h-3.5 w-3.5 mr-1.5" />{meta.label}</span>
                  {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
                {expanded && <ExecutionStepper event={event} events={events} />}
              </div>;
            })}
          </ScrollArea>
        </main>

        <aside className="rounded-xl border border-[#1b2b43] bg-background overflow-hidden xl:min-h-[670px]">
          <div className="p-4 border-b border-foreground/10"><p className="text-[10px] uppercase tracking-[.16em] text-muted-foreground">Mission inspector</p></div>
          {selected ? <div>
            <div className="p-4 border-b border-foreground/5"><div className="flex justify-between gap-3"><div><h2 className="font-semibold text-foreground">{selected.missionName || "Autonomous operation"}</h2><p className="mt-1 text-[11px] text-muted-foreground">RUN-{String(selected.missionId || selected.id).padStart(7, "0")}</p></div><Badge variant="outline" className={cn("h-5 border-foreground/10", (EVENT_META[selected.type] || EVENT_META.agent_action).tone)}>{(EVENT_META[selected.type] || EVENT_META.agent_action).label}</Badge></div></div>
            <div className="p-4 border-b border-foreground/5 space-y-3 text-xs"><p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-4">Overview</p><div className="flex justify-between"><span className="text-muted-foreground">Agent</span><span>{selected.agentName || selected.details?.jobName || "Not reported"}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Started</span><span>{safeTime(selected.timestamp)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Mission</span><span className="truncate max-w-[150px]">{selected.missionName || "System operation"}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Run status</span><span className="capitalize text-foreground">{selected.status?.replaceAll("_", " ") || (EVENT_META[selected.type] || EVENT_META.agent_action).label}</span></div></div>
            <div className="p-4 border-b border-foreground/5"><p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Latest output</p><div className="rounded-lg bg-background/25 border border-foreground/5 p-3 text-xs leading-relaxed text-foreground">{selected.message}</div></div>
            <div className="p-4 space-y-2">{selected.missionId && <Link href={`/operations/missions/${selected.missionId}`}><Button className="w-full bg-[#CD7F32] hover:bg-[#b66f2b] text-foreground">Open run details</Button></Link>}{selected.metadata?.requiresApproval && <Button variant="outline" className="w-full border-amber-500/30 text-amber-400" onClick={() => { const approval = approvals.find((a:any) => a.missionId === selected.missionId); if (approval) { setSelectedApproval(approval); setApprovalOpen(true); } }}>Review approval</Button>}</div>
          </div> : <div className="grid place-items-center h-64 text-center px-6"><div><Activity className="h-7 w-7 mx-auto text-muted-foreground mb-3" /><p className="text-sm text-muted-foreground">Select an event to inspect its run</p></div></div>}
        </aside>
      </div>
      <ApprovalDetailDialog approval={selectedApproval} open={approvalOpen} onOpenChange={setApprovalOpen} onDecision={() => queryClient.invalidateQueries({ queryKey: ["/api/approvals"] })} />
    </div>
  );
}

export default function ActivityCenter() { return <Section fallback={<SkeletonView />}><ActivityCenterContent /></Section>; }
