import { useMemo, useState, type ComponentType } from 'react';
import { Link } from 'wouter';
import {
    Activity,
    AlertCircle,
    Calendar,
    ChevronRight,
    Clock,
    Edit3,
    Layers,
    MousePointerClick,
    PauseCircle,
    Play,
    RefreshCw,
    Search,
    ShieldCheck,
    Trash2,
    Webhook as WebhookIcon,
    Zap,
} from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader } from '@domain-ui/core/ui/components/ui/card';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { Pipeline } from './types.js';
import { useDebounce } from "@domain-ui/core/ui/hooks/useDebounce";
import { cn } from "@/lib/utils";

interface PipelineListProps {
    pipelines: Pipeline[];
    pipelinesLoading: boolean;
    showOrgColumn: boolean;
    orgMap: Record<number, string>;
    onRunPipeline: (id: number) => void;
    onEditPipeline: (pipeline: Pipeline) => void;
    onDeletePipeline: (id: number) => void;
    onRefresh?: () => void;
}

type PipelineFilter = "all" | "active" | "standby" | "manual" | "automated" | "knowledge";

const FILTERS: { id: PipelineFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "standby", label: "Standby" },
    { id: "manual", label: "Manual" },
    { id: "automated", label: "Automated" },
    { id: "knowledge", label: "Knowledge" },
];

function normalizeTrigger(triggerType: string | null | undefined) {
    return String(triggerType || "manual").toLowerCase();
}

function getPipelineState(pipeline: Pipeline) {
    if (!pipeline.isActive) return "standby";
    const trigger = normalizeTrigger(pipeline.triggerType);
    return trigger === "manual" ? "manual" : "automated";
}

function pipelineMatchesFilter(pipeline: Pipeline, filter: PipelineFilter) {
    const state = getPipelineState(pipeline);
    const trigger = normalizeTrigger(pipeline.triggerType);

    switch (filter) {
        case "active":
            return pipeline.isActive;
        case "standby":
            return state === "standby";
        case "manual":
            return trigger === "manual";
        case "automated":
            return pipeline.isActive && trigger !== "manual";
        case "knowledge":
            return !!pipeline.enableKnowledgeGraph || !!pipeline.knowledgeGraphConfig;
        default:
            return true;
    }
}

function getTriggerMeta(pipeline: Pipeline) {
    if (!pipeline.isActive) {
        return {
            label: "Standby",
            icon: PauseCircle,
            badge: "bg-muted/15 text-foreground border-border/20",
            dot: "bg-muted",
            card: "border-foreground/10 bg-foreground/[0.04]",
        };
    }

    switch (normalizeTrigger(pipeline.triggerType)) {
        case "schedule":
            return {
                label: "Scheduled",
                icon: Calendar,
                badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30",
                dot: "bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.45)]",
                card: "border-amber-400/25 bg-amber-500/[0.07]",
            };
        case "webhook":
            return {
                label: "Webhook",
                icon: WebhookIcon,
                badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-400/30",
                dot: "bg-violet-300 shadow-[0_0_16px_rgba(196,181,253,0.45)]",
                card: "border-violet-400/25 bg-violet-500/[0.07]",
            };
        case "event":
            return {
                label: "Event",
                icon: Activity,
                badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/30",
                dot: "bg-blue-400 shadow-[0_0_16px_rgba(96,165,250,0.55)]",
                card: "border-blue-400/25 bg-blue-500/[0.07]",
            };
        default:
            return {
                label: "Manual",
                icon: MousePointerClick,
                badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30",
                dot: "bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.45)]",
                card: "border-emerald-400/20 bg-emerald-500/[0.05]",
            };
    }
}

function safeDateDisplay(date: string | Date | null | undefined) {
    if (!date) return "Unknown";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "Unknown";
    return d.toLocaleDateString();
}

export default function PipelineList({
    pipelines,
    pipelinesLoading,
    showOrgColumn,
    orgMap,
    onRunPipeline,
    onEditPipeline,
    onDeletePipeline,
    onRefresh,
}: PipelineListProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<PipelineFilter>("all");
    const debouncedSearchQuery = useDebounce(searchQuery, 300);

    const filteredPipelines = useMemo(() => {
        const q = debouncedSearchQuery.toLowerCase();
        return pipelines.filter(pipeline => {
            const searchable = [
                pipeline.name,
                pipeline.description || "",
                pipeline.triggerType,
                pipeline.createdBy,
                pipeline.organizationId ? orgMap[pipeline.organizationId] : "",
            ].join(" ").toLowerCase();

            return searchable.includes(q) && pipelineMatchesFilter(pipeline, filter);
        });
    }, [debouncedSearchQuery, filter, orgMap, pipelines]);

    const laneGroups = useMemo(() => ({
        automated: filteredPipelines.filter(pipeline => getPipelineState(pipeline) === "automated"),
        manual: filteredPipelines.filter(pipeline => getPipelineState(pipeline) === "manual"),
        standby: filteredPipelines.filter(pipeline => getPipelineState(pipeline) === "standby"),
    }), [filteredPipelines]);

    if (pipelinesLoading) {
        return (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="space-y-4 rounded-3xl border border-foreground/10 bg-foreground/[0.03] p-5">
                        <Skeleton className="h-6 w-36 rounded-lg bg-foreground/10" />
                        {[...Array(2)].map((_, j) => (
                            <Skeleton key={j} className="h-56 rounded-2xl bg-foreground/10" />
                        ))}
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-2xl border border-foreground/10 bg-background/20 p-3 backdrop-blur-xl xl:flex-row xl:items-center xl:justify-between">
                <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search pipelines by name, trigger, owner, or description..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-10 rounded-xl border-foreground/10 bg-foreground/[0.04] pl-10 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/40"
                        data-testid="input-search-pipelines"
                    />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {FILTERS.map(item => {
                        const count = item.id === "all"
                            ? pipelines.length
                            : pipelines.filter(pipeline => pipelineMatchesFilter(pipeline, item.id)).length;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setFilter(item.id)}
                                className={cn(
                                    "whitespace-nowrap rounded-xl border px-4 py-2 text-[10px] font-black uppercase transition-all",
                                    filter === item.id
                                        ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                                        : "border-foreground/10 bg-foreground/[0.03] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
                                )}
                            >
                                {item.label} <span className="opacity-60">{count}</span>
                            </button>
                        );
                    })}
                    {onRefresh && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onRefresh}
                            className="h-9 rounded-xl border-foreground/10 bg-foreground/[0.03] px-3 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
                        >
                            <RefreshCw className="mr-2 h-3.5 w-3.5" />
                            Sync
                        </Button>
                    )}
                </div>
            </div>

            {filteredPipelines.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-foreground/15 bg-foreground/[0.03] py-20 text-center">
                    <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl border border-foreground/10 bg-background/20">
                        {searchQuery ? <AlertCircle className="h-10 w-10 text-muted-foreground" /> : <Zap className="h-10 w-10 text-muted-foreground" />}
                    </div>
                    <h3 className="text-xl font-black text-foreground">
                        {searchQuery ? "No pipeline signals found" : "No pipelines deployed"}
                    </h3>
                    <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                        {searchQuery
                            ? "Adjust search or filters to widen the command surface."
                            : "Create a pipeline to orchestrate reusable automation steps."
                        }
                    </p>
                </div>
            ) : filter !== "all" ? (
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
                    {filteredPipelines.map(pipeline => (
                        <PipelineCard
                            key={pipeline.id}
                            pipeline={pipeline}
                            showOrgColumn={showOrgColumn}
                            orgMap={orgMap}
                            onRunPipeline={onRunPipeline}
                            onEditPipeline={onEditPipeline}
                            onDeletePipeline={onDeletePipeline}
                        />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
                    <PipelineLane
                        label="Automated"
                        count={laneGroups.automated.length}
                        pipelines={laneGroups.automated}
                        accent="blue"
                        showOrgColumn={showOrgColumn}
                        orgMap={orgMap}
                        onRunPipeline={onRunPipeline}
                        onEditPipeline={onEditPipeline}
                        onDeletePipeline={onDeletePipeline}
                    />
                    <PipelineLane
                        label="Manual Launch"
                        count={laneGroups.manual.length}
                        pipelines={laneGroups.manual}
                        accent="emerald"
                        showOrgColumn={showOrgColumn}
                        orgMap={orgMap}
                        onRunPipeline={onRunPipeline}
                        onEditPipeline={onEditPipeline}
                        onDeletePipeline={onDeletePipeline}
                    />
                    <PipelineLane
                        label="Standby"
                        count={laneGroups.standby.length}
                        pipelines={laneGroups.standby}
                        accent="amber"
                        showOrgColumn={showOrgColumn}
                        orgMap={orgMap}
                        onRunPipeline={onRunPipeline}
                        onEditPipeline={onEditPipeline}
                        onDeletePipeline={onDeletePipeline}
                    />
                </div>
            )}
        </div>
    );
}

function PipelineLane({
    label,
    count,
    pipelines,
    accent,
    showOrgColumn,
    orgMap,
    onRunPipeline,
    onEditPipeline,
    onDeletePipeline,
}: {
    label: string;
    count: number;
    pipelines: Pipeline[];
    accent: "blue" | "emerald" | "amber";
    showOrgColumn: boolean;
    orgMap: Record<number, string>;
    onRunPipeline: (id: number) => void;
    onEditPipeline: (pipeline: Pipeline) => void;
    onDeletePipeline: (id: number) => void;
}) {
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
                    <h3 className="text-[10px] font-black uppercase text-foreground">{label}</h3>
                </div>
                <Badge variant="outline" className="h-6 border-foreground/10 bg-background/20 px-2 text-[9px] font-black uppercase text-foreground">
                    {count}
                </Badge>
            </div>

            <div className="flex flex-1 flex-col gap-4">
                {pipelines.length === 0 ? (
                    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-foreground/10 text-muted-foreground">
                        <Layers className="h-6 w-6" />
                        <span className="text-[9px] font-black uppercase">Quiet Lane</span>
                    </div>
                ) : (
                    pipelines.map(pipeline => (
                        <PipelineCard
                            key={pipeline.id}
                            pipeline={pipeline}
                            showOrgColumn={showOrgColumn}
                            orgMap={orgMap}
                            onRunPipeline={onRunPipeline}
                            onEditPipeline={onEditPipeline}
                            onDeletePipeline={onDeletePipeline}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

function PipelineCard({
    pipeline,
    showOrgColumn,
    orgMap,
    onRunPipeline,
    onEditPipeline,
    onDeletePipeline,
}: {
    pipeline: Pipeline;
    showOrgColumn: boolean;
    orgMap: Record<number, string>;
    onRunPipeline: (id: number) => void;
    onEditPipeline: (pipeline: Pipeline) => void;
    onDeletePipeline: (id: number) => void;
}) {
    const meta = getTriggerMeta(pipeline);
    const MetaIcon = meta.icon;
    const stepCount = pipeline.steps?.length || 0;
    const progressPct = stepCount > 0 ? Math.min(100, Math.max(10, stepCount * 18)) : 6;
    const description = pipeline.description || "Ready for orchestration once jobs, triggers, and context are attached.";
    const orgLabel = pipeline.organizationId ? orgMap[pipeline.organizationId] || `Org ${pipeline.organizationId}` : "Global";

    return (
        <Card
            className={cn(
                "group relative overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-foreground/[0.08] hover:shadow-2xl hover:shadow-black/20",
                meta.card
            )}
            data-testid={`row-pipeline-${pipeline.id}`}
        >
            <div className="absolute inset-x-0 top-0 h-1 bg-foreground/10">
                <style>{`#pipeline-progress-${pipeline.id} { width: ${progressPct}%; }`}</style>
                <div id={`pipeline-progress-${pipeline.id}`} className={cn("h-full transition-all", meta.dot)} />
            </div>

            <CardHeader className="space-y-3 pb-3 pt-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                        <Badge variant="outline" className={cn("h-6 border text-[8px] font-black uppercase", meta.badge)}>
                            {meta.label}
                        </Badge>
                        {(pipeline.enableKnowledgeGraph || pipeline.knowledgeGraphConfig) && (
                            <Badge variant="outline" className="h-6 border-cyan-400/25 bg-cyan-500/10 text-[8px] font-black uppercase text-cyan-700 dark:text-cyan-300">
                                KG
                            </Badge>
                        )}
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-foreground/10 bg-background/20 text-foreground">
                        <MetaIcon className="h-4 w-4" />
                    </div>
                </div>

                <div>
                    <Link
                        href={`/operations/workstreams/${pipeline.id}`}
                        className="line-clamp-1 text-lg font-black text-foreground transition-colors group-hover:text-primary"
                        data-testid={`link-pipeline-${pipeline.id}`}
                    >
                        {pipeline.name}
                    </Link>
                    <CardDescription className="mt-2 line-clamp-2 min-h-[2.5rem] text-xs font-medium leading-relaxed text-muted-foreground">
                        {description}
                    </CardDescription>
                </div>
            </CardHeader>

            <CardContent className="space-y-4 pb-5">
                <div className="grid grid-cols-2 gap-2">
                    <MetricPill icon={Layers} label={`${stepCount} steps`} />
                    <MetricPill icon={Clock} label={safeDateDisplay(pipeline.createdAt)} />
                    <MetricPill icon={Zap} label={normalizeTrigger(pipeline.triggerType)} />
                    <MetricPill icon={ShieldCheck} label={showOrgColumn ? orgLabel : pipeline.createdBy || "System"} />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/10 pt-3">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Pipeline {pipeline.id}
                    </div>

                    <div className="flex flex-wrap items-center gap-2" data-testid={`button-actions-${pipeline.id}`}>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg border-foreground/10 bg-foreground/[0.03] px-3 text-[9px] font-black uppercase text-foreground hover:bg-primary hover:text-primary-foreground"
                            onClick={() => onRunPipeline(pipeline.id)}
                        >
                            <Play className="mr-1 h-3 w-3" />
                            Run
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg border-foreground/10 bg-foreground/[0.03] px-3 text-[9px] font-black uppercase text-foreground hover:bg-foreground/[0.1]"
                            onClick={() => onEditPipeline(pipeline)}
                            data-testid={`button-edit-${pipeline.id}`}
                        >
                            <Edit3 className="mr-1 h-3 w-3" />
                            Edit
                        </Button>
                        <Link href={`/operations/workstreams/${pipeline.id}`}>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg border-foreground/10 bg-foreground/[0.03] px-3 text-[9px] font-black uppercase text-foreground hover:bg-foreground/[0.1]"
                            >
                                Open
                                <ChevronRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                            </Button>
                        </Link>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg border-red-400/20 bg-red-500/10 px-3 text-[9px] font-black uppercase text-red-700 dark:text-red-300 hover:bg-red-500/20 hover:text-red-700 dark:text-red-200"
                            onClick={() => onDeletePipeline(pipeline.id)}
                        >
                            <Trash2 className="mr-1 h-3 w-3" />
                            Delete
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function MetricPill({ icon: Icon, label }: { icon: ComponentType<{ className?: string }>; label: string }) {
    return (
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-foreground/10 bg-background/20 px-2.5 py-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[9px] font-black uppercase text-foreground">{label}</span>
        </div>
    );
}
