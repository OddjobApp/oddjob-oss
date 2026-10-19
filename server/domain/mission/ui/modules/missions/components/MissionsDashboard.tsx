import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    ChevronRight,
    Clock,
    DollarSign,
    Flag,
    Network,
    Plus,
    Search,
    Shield,
    Target,
    Users,
    Zap,
} from "lucide-react";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Link, useSearch } from "wouter";
import { TemplateGalleryDialog } from "./TemplateGalleryDialog";
import { cn } from "@/lib/utils";
import { missionRunPath } from "@/lib/paths";
import { formatDistanceToNow } from "date-fns";
import { Virtuoso } from "react-virtuoso";
import { usePrefetch } from "@domain-ui/core/ui/hooks/use-prefetch";
import { ExecutionExplorer, type ExecutionGroup } from "@/components/execution/ExecutionExplorer";

type StatusFilter = "all" | "active" | "completed" | "failed" | "scheduled";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "completed", label: "Completed" },
    { id: "failed", label: "Failed" },
    { id: "scheduled", label: "Scheduled" },
];

function formatCurrency(value: unknown) {
    const amount = typeof value === "number" ? value : parseFloat(String(value || "0"));
    return amount.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

const safeDateDisplay = (date: string | Date | null | undefined) => {
    if (!date) return "Never";
    const d = new Date(date);
    return isNaN(d.getTime()) ? "Unknown" : formatDistanceToNow(d, { addSuffix: false });
};

function getActiveRuns(mission: any) {
    return parseInt(String(mission?.activeRuns || "0"), 10) || 0;
}

function getMissionState(mission: any) {
    const activeRuns = getActiveRuns(mission);
    if (activeRuns > 0) return "active";
    if (mission?.lastRunStatus === "failed") return "failed";
    if (mission?.isScheduled) return "scheduled";
    if (mission?.status === "completed" || mission?.status === "archived") return "completed";
    return "ready";
}

function getStateMeta(mission: any) {
    const state = getMissionState(mission);
    switch (state) {
        case "active":
            return {
                label: "Active",
                badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/30",
                dot: "bg-blue-400 shadow-[0_0_16px_rgba(96,165,250,0.55)]",
                card: "border-blue-400/25 bg-blue-500/[0.07]",
                icon: Activity,
            };
        case "failed":
            return {
                label: "Needs attention",
                badge: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-400/30",
                dot: "bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.45)]",
                card: "border-red-400/25 bg-red-500/[0.07]",
                icon: AlertTriangle,
            };
        case "scheduled":
            return {
                label: "Scheduled",
                badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30",
                dot: "bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.45)]",
                card: "border-amber-400/25 bg-amber-500/[0.07]",
                icon: Clock,
            };
        case "completed":
            return {
                label: "Completed",
                badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30",
                dot: "bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.45)]",
                card: "border-emerald-400/20 bg-emerald-500/[0.05]",
                icon: CheckCircle2,
            };
        default:
            return {
                label: "Ready",
                badge: "bg-muted/15 text-foreground border-border/20",
                dot: "bg-muted",
                card: "border-foreground/10 bg-foreground/[0.04]",
                icon: Target,
            };
    }
}

export default function MissionsDashboard() {
    const { selectedOrgId } = useOrgContext();
    const searchString = useSearch();
    const [searchQuery, setSearchQuery] = React.useState(() => {
        const params = new URLSearchParams(searchString);
        return params.get("q") || "";
    });
    const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");

    React.useEffect(() => {
        const params = new URLSearchParams(searchString);
        setSearchQuery(params.get("q") || "");
    }, [searchString]);

    const { data: rawMissions, isLoading } = useQuery<any[]>({
        queryKey: ["/api/missions", selectedOrgId],
        enabled: !!selectedOrgId,
        refetchOnWindowFocus: true,
        staleTime: 5000,
    });

    const missions = Array.isArray(rawMissions) ? rawMissions : [];

    const stats = React.useMemo(() => {
        const active = missions.filter(m => getActiveRuns(m) > 0);
        const failed = missions.filter(m => m.lastRunStatus === "failed");
        const successCount = missions.filter(m => m.status === "completed" || m.status === "archived").length;
        const totalCost = missions.reduce((acc, m) => acc + parseFloat(m.totalCost || "0"), 0);
        const totalTasks = missions.reduce((acc, m) => acc + (m.totalTasks || 0), 0);
        const lastRun = missions.reduce((latest, m) => {
            const mDate = m.lastRunAt ? new Date(m.lastRunAt) : null;
            if (!mDate || isNaN(mDate.getTime())) return latest;
            return !latest || mDate > latest ? mDate : latest;
        }, null as Date | null);

        return {
            activeMissions: active.length,
            failedMissions: failed.length,
            totalMissions: missions.length,
            totalTasks,
            totalCost,
            successRate: missions.length > 0 ? Math.round((successCount / missions.length) * 100) : 0,
            lastRun,
        };
    }, [missions]);

    const filtered = React.useMemo(() => {
        let result = missions;
        if (statusFilter !== "all") {
            result = result.filter(m => getMissionState(m) === statusFilter);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(m =>
                m.name?.toLowerCase().includes(q) ||
                m.objective?.toLowerCase().includes(q) ||
                m.goal?.toLowerCase().includes(q)
            );
        }
        return result;
    }, [missions, statusFilter, searchQuery]);

    const activeMissions = filtered.filter(m => getMissionState(m) === "active" || getMissionState(m) === "ready");
    const completedMissions = filtered.filter(m => getMissionState(m) === "completed");
    const scheduledMissions = filtered.filter(m => getMissionState(m) === "scheduled" || getMissionState(m) === "failed");

    const summaryCards = [
        {
            label: "Live missions",
            value: String(stats.activeMissions),
            helper: stats.failedMissions > 0 ? `${stats.failedMissions} need attention` : "No active incidents",
            icon: Activity,
            tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        },
        {
            label: "Success signal",
            value: `${stats.successRate}%`,
            helper: `${stats.totalMissions} total missions tracked`,
            icon: CheckCircle2,
            tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        },
        {
            label: "Deployment spend",
            value: formatCurrency(stats.totalCost),
            helper: `${stats.totalTasks} tasks across the fleet`,
            icon: DollarSign,
            tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        },
        {
            label: "Last movement",
            value: stats.lastRun ? safeDateDisplay(stats.lastRun) : "None",
            helper: stats.lastRun ? "since latest mission run" : "No mission runs yet",
            icon: Flag,
            tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
        },
    ];

    const missionExplorerGroups: ExecutionGroup[] = React.useMemo(() => {
        return missions.map((mission, index) => {
            const state = getMissionState(mission);
            const activeRuns = getActiveRuns(mission);
            const status =
                state === "active" ? "running" :
                state === "failed" ? "failed" :
                state === "completed" ? "completed" :
                state === "scheduled" ? "waiting" : "pending";

            return {
                id: `mission-${mission.id || index}`,
                title: mission.name || mission.title || `Mission #${mission.id || index + 1}`,
                subtitle: mission.objective || mission.goal || mission.description || "Mission ready for execution",
                category: activeRuns > 0 ? "live mission" : mission.isScheduled ? "scheduled mission" : "mission",
                status,
                startedAt: mission.lastRunAt || mission.updatedAt || mission.createdAt,
                completedAt: state === "completed" ? mission.updatedAt || mission.lastRunAt : undefined,
                progress: status === "completed" ? 100 : status === "running" ? 50 : status === "failed" ? 100 : 0,
                count: mission.totalRuns || mission.runCount || activeRuns || 1,
                childCount: activeRuns || undefined,
                isCritical: status === "failed" || activeRuns > 0,
                metadata: {
                    missionId: mission.id,
                    status: mission.status,
                    lastRunStatus: mission.lastRunStatus,
                    activeRuns,
                    totalRuns: mission.totalRuns,
                    totalTasks: mission.totalTasks,
                    totalCost: mission.totalCost,
                    isScheduled: mission.isScheduled,
                },
                events: [
                    {
                        id: `mission-${mission.id || index}-state`,
                        timestamp: mission.lastRunAt || mission.updatedAt || mission.createdAt,
                        type: `mission.${state}`,
                        title: `${mission.name || mission.title || `Mission #${mission.id || index + 1}`} is ${state}`,
                        description: mission.lastRunStatus ? `Last run: ${mission.lastRunStatus}` : mission.objective || mission.goal,
                        status,
                        metadata: mission,
                    },
                ],
            } satisfies ExecutionGroup;
        }).sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());
    }, [missions]);

    return (
        <div className="relative min-h-screen overflow-hidden bg-background px-4 pb-20 pt-4 text-foreground md:px-6">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/15 via-sky-500/5 to-transparent" />

            <div className="relative z-10 mx-auto flex w-full max-w-[2000px] flex-col gap-5">
                <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_16px_rgba(var(--primary),0.65)]" />
                            <span className="text-[10px] font-black uppercase tracking-[0.28em] text-primary">Strategic Command</span>
                        </div>
                        <div>
                            <h1 className="text-4xl font-black uppercase italic leading-none tracking-tighter text-foreground md:text-6xl">
                                Missions
                            </h1>
                            <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                                Portfolio-level command for live work, queued operations, risk, spend, and mission outcomes.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <Link href="/operations/runs">
                            <Button
                                variant="outline"
                                className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase tracking-widest text-foreground hover:bg-foreground/[0.08]"
                            >
                                <Zap className="mr-2 h-4 w-4 text-blue-700 dark:text-blue-300" />
                                Live Feed
                            </Button>
                        </Link>
                        <TemplateGalleryDialog />
                        <Link href="/operations/missions/new">
                            <Button className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase tracking-widest text-background shadow-lg shadow-foreground/5 hover:bg-muted">
                                <Plus className="mr-2 h-4 w-4" />
                                New Mission
                            </Button>
                        </Link>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {summaryCards.map(card => (
                        <div key={card.label} className="rounded-2xl border border-foreground/10 bg-foreground/[0.04] p-4 backdrop-blur-xl">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-muted-foreground">{card.label}</p>
                                    <p className="mt-2 text-2xl font-black tracking-tight text-foreground">{card.value}</p>
                                </div>
                                <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl border", card.tone)}>
                                    <card.icon className="h-5 w-5" />
                                </div>
                            </div>
                            <p className="mt-3 text-sm text-muted-foreground">{card.helper}</p>
                        </div>
                    ))}
                </div>

                <ExecutionExplorer
                    title="Mission Portfolio Explorer"
                    description="Grouped mission state across live runs, scheduled work, failures, and completed outcomes."
                    status={stats.failedMissions > 0 ? "warning" : stats.activeMissions > 0 ? "running" : "pending"}
                    groups={missionExplorerGroups}
                    relationships={[
                        ...missions.filter(m => getActiveRuns(m) > 0).map(m => ({
                            id: `active-mission-${m.id}`,
                            label: "Live mission",
                            value: m.name || m.title || `Mission #${m.id}`,
                            type: "execution" as const,
                            href: m.lastRunId ? missionRunPath(m.id, m.lastRunId) : `/operations/missions/${m.id}`,
                            status: "running",
                        })),
                        ...missions.filter(m => m.lastRunStatus === "failed").map(m => ({
                            id: `failed-mission-${m.id}`,
                            label: "Needs attention",
                            value: m.name || m.title || `Mission #${m.id}`,
                            type: "execution" as const,
                            href: m.lastRunId ? missionRunPath(m.id, m.lastRunId) : `/operations/missions/${m.id}`,
                            status: "failed",
                        })),
                    ]}
                    metadata={[
                        { label: "Total Missions", value: stats.totalMissions },
                        { label: "Live Missions", value: stats.activeMissions },
                        { label: "Needs Attention", value: stats.failedMissions },
                        { label: "Success Signal", value: `${stats.successRate}%` },
                        { label: "Tasks", value: stats.totalTasks },
                        { label: "Spend", value: formatCurrency(stats.totalCost) },
                        { label: "Last Movement", value: stats.lastRun ? safeDateDisplay(stats.lastRun) : "None" },
                    ]}
                    lastUpdatedAt={stats.lastRun}
                    isLive={stats.activeMissions > 0}
                    defaultView="compact"
                    className="border-foreground/10 bg-foreground/[0.04] text-foreground"
                />

                <div className="flex flex-col gap-3 rounded-2xl border border-foreground/10 bg-background/20 p-3 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            className="h-10 rounded-xl border-foreground/10 bg-foreground/[0.04] pl-10 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/40"
                            placeholder="Search missions by name or objective..."
                            value={searchQuery}
                            onChange={event => setSearchQuery(event.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                        {STATUS_FILTERS.map(filter => {
                            const count = filter.id === "all"
                                ? missions.length
                                : missions.filter(m => getMissionState(m) === filter.id).length;
                            return (
                                <button
                                    key={filter.id}
                                    onClick={() => setStatusFilter(filter.id)}
                                    className={cn(
                                        "whitespace-nowrap rounded-xl border px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                                        statusFilter === filter.id
                                            ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                                            : "border-foreground/10 bg-foreground/[0.03] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
                                    )}
                                >
                                    {filter.label} <span className="opacity-60">{count}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {isLoading ? (
                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="space-y-4 rounded-3xl border border-foreground/10 bg-foreground/[0.03] p-5">
                                <Skeleton className="h-6 w-36 rounded-lg bg-foreground/10" />
                                {[...Array(2)].map((_, j) => (
                                    <Skeleton key={j} className="h-52 rounded-2xl bg-foreground/10" />
                                ))}
                            </div>
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-foreground/15 bg-foreground/[0.03] py-20 text-center">
                        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl border border-foreground/10 bg-background/20">
                            <Network className="h-10 w-10 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-black tracking-tight text-foreground">No mission signals found</h3>
                        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                            Adjust filters or launch a new mission to populate the command surface.
                        </p>
                    </div>
                ) : statusFilter !== "all" ? (
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
                        {filtered.map(mission => <MissionCard key={mission.id} mission={mission} />)}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
                        <KanbanLane
                            label="In Flight"
                            count={activeMissions.length}
                            missions={activeMissions}
                            accent="blue"
                        />
                        <KanbanLane
                            label="Validated"
                            count={completedMissions.length}
                            missions={completedMissions}
                            accent="emerald"
                        />
                        <KanbanLane
                            label="Watchlist"
                            count={scheduledMissions.length}
                            missions={scheduledMissions}
                            accent="amber"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

function KanbanLane({ label, count, missions, accent }: {
    label: string;
    count: number;
    missions: any[];
    accent: "blue" | "emerald" | "amber";
}) {
    const prefetch = usePrefetch();
    const accentClasses = {
        blue: "bg-blue-400 text-blue-700 dark:text-blue-300 border-blue-400/20",
        emerald: "bg-emerald-300 text-emerald-700 dark:text-emerald-300 border-emerald-400/20",
        amber: "bg-amber-300 text-amber-700 dark:text-amber-300 border-amber-400/20",
    }[accent];

    return (
        <div className="flex min-h-[420px] flex-col rounded-3xl border border-foreground/10 bg-foreground/[0.035] p-4 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between px-1">
                <div className="flex items-center gap-2.5">
                    <div className={cn("h-2 w-2 rounded-full shadow-[0_0_14px_currentColor]", accentClasses)} />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.26em] text-foreground">{label}</h3>
                </div>
                <Badge variant="outline" className="h-6 border-foreground/10 bg-background/20 px-2 text-[9px] font-black uppercase tracking-widest text-foreground">
                    {count}
                </Badge>
            </div>

            <div className="flex-1">
                {missions.length === 0 ? (
                    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-foreground/10 text-muted-foreground">
                        <Activity className="h-6 w-6" />
                        <span className="text-[9px] font-black uppercase tracking-[0.24em]">Quiet Sector</span>
                    </div>
                ) : (
                    <Virtuoso
                        useWindowScroll
                        data={missions}
                        totalCount={missions.length}
                        itemContent={(_index, mission) => (
                            <div className="pb-4" onMouseEnter={() => prefetch(`/api/missions/${mission.id}`)}>
                                <MissionCard mission={mission} />
                            </div>
                        )}
                        style={{ height: "auto" }}
                    />
                )}
            </div>
        </div>
    );
}

function MissionCard({ mission }: { mission: any }) {
    const stateMeta = getStateMeta(mission);
    const StateIcon = stateMeta.icon;
    const activeRuns = getActiveRuns(mission);
    const totalTasks = mission?.totalTasks ?? 0;
    const completedTasks = mission?.completedTasks ?? 0;
    const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : activeRuns > 0 ? 12 : 0;
    const objective = mission?.objective || mission?.goal || "Operational parameters established via system override.";
    const spend = parseFloat(mission?.totalCost || "0");

    return (
        <Link href={`/operations/missions/${mission.id}`}>
            <Card className={cn(
                "group relative cursor-pointer overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-foreground/[0.08] hover:shadow-2xl hover:shadow-black/20",
                stateMeta.card
            )}>
                <div className="absolute inset-x-0 top-0 h-1 bg-foreground/10">
                    <div
                        className={cn("h-full transition-all", stateMeta.dot)}
                        style={{ width: `${Math.max(progressPct, activeRuns > 0 ? 18 : 6)}%` }}
                    />
                </div>

                <CardHeader className="space-y-3 pb-3 pt-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className={cn("h-2 w-2 rounded-full", stateMeta.dot)} />
                            <Badge variant="outline" className={cn("h-6 border text-[8px] font-black uppercase tracking-widest", stateMeta.badge)}>
                                {stateMeta.label}
                            </Badge>
                        </div>
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-foreground/10 bg-background/20 text-foreground">
                            <StateIcon className="h-4 w-4" />
                        </div>
                    </div>

                    <div>
                        <CardTitle className="line-clamp-1 text-lg font-black tracking-tight text-foreground transition-colors group-hover:text-primary">
                            {mission?.name ?? "Unnamed Mission"}
                        </CardTitle>
                        <CardDescription className="mt-2 line-clamp-2 min-h-[2.5rem] text-xs font-medium leading-relaxed text-muted-foreground">
                            {objective}
                        </CardDescription>
                    </div>
                </CardHeader>

                <CardContent className="space-y-4 pb-5">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                            <span>Progress</span>
                            <span className="tabular-nums text-foreground">{progressPct}%</span>
                        </div>
                        <Progress value={progressPct} className="h-1.5 bg-background/30" indicatorClassName="bg-primary shadow-[0_0_10px_rgba(var(--primary),0.45)]" />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <MetricPill icon={Users} label={`${mission.memberCount || 0} Units`} />
                        <MetricPill icon={Clock} label={safeDateDisplay(mission?.lastRunAt)} />
                        <MetricPill icon={Network} label={`${totalTasks} Tasks`} />
                        <MetricPill icon={DollarSign} label={formatCurrency(spend)} />
                    </div>

                    <div className="flex items-center justify-between border-t border-foreground/10 pt-3">
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            <Shield className="h-3.5 w-3.5" />
                            Mission {mission.id}
                        </div>
                        <Button variant="outline" size="sm" className="h-8 rounded-lg border-foreground/10 bg-foreground/[0.03] px-3 text-[9px] font-black uppercase tracking-widest text-foreground hover:bg-primary hover:text-primary-foreground">
                            Open
                            <ChevronRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

function MetricPill({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
    return (
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-foreground/10 bg-background/20 px-2.5 py-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[9px] font-black uppercase tracking-widest text-foreground">{label}</span>
        </div>
    );
}
