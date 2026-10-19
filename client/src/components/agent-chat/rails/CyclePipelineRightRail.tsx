import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
    CheckCircle2,
    Boxes,
    Layers,
    Workflow,
    Database,
    FolderGit2,
    Palette,
    ChevronRight,
    ChevronLeft,
    Clock,
    Activity,
    ShieldAlert,
    ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface CyclePipelineStep {
    id: string;
    label: string;
    description: string;
    status: 'completed' | 'active' | 'pending';
    stageNumber: number;
}

export interface CyclePipelineRightRailProps {
    turns?: any[];
    activeTopic?: string | null;
    cycleFleetData?: any;
    className?: string;
    defaultCollapsed?: boolean;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}

export const CyclePipelineRightRail: React.FC<CyclePipelineRightRailProps> = ({
    turns = [],
    activeTopic,
    cycleFleetData,
    className,
    defaultCollapsed = false,
    isCollapsed: controlledCollapsed,
    onToggleCollapse,
}) => {
    const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
    const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;
    const toggleCollapse = onToggleCollapse ?? (() => setInternalCollapsed((prev) => !prev));

    // Dynamic steps with state derived from room context
    const steps: CyclePipelineStep[] = useMemo(() => [
        {
            id: 'ingest',
            stageNumber: 1,
            label: '1. Ingest',
            description: 'Topic intake & blueprint seed loaded',
            status: 'completed',
        },
        {
            id: 'triage',
            stageNumber: 2,
            label: '2. Triage & Deliberation',
            description: activeTopic ? `Topic: ${activeTopic}` : 'Squad active in room deliberation',
            status: 'active',
        },
        {
            id: 'dispatch',
            stageNumber: 3,
            label: '3. Squad Dispatch',
            description: 'Sub-agents allocated for parallel synthesis',
            status: 'pending',
        },
        {
            id: 'handshake',
            stageNumber: 4,
            label: '4. Telemetry Handshake',
            description: 'Final GQE gate & attestation verification',
            status: 'pending',
        },
    ], [activeTopic]);

    // Assembly state derived from turns if available
    const assemblyLayers = useMemo(() => {
        let hasCustomUi = false;
        let hasPipeline = false;
        let hasDataset = false;
        let hasProject = false;

        for (const turn of turns) {
            const artifacts = turn.artifacts ?? [];
            for (const art of artifacts) {
                const p = art.payload ?? {};
                if (art.tool === 'mount_app_studio' || p.type === 'app_studio_pod' || p.component === 'AppStudioPod') {
                    hasCustomUi = true;
                    hasPipeline = true;
                }
                if (p.module === 'FullStackAssemblyPod' || p.component === 'FullStackAssemblyPod') {
                    hasCustomUi = true;
                    hasPipeline = true;
                    hasDataset = true;
                    hasProject = true;
                }
            }
        }

        return [
            {
                id: 'ui',
                name: '1. UI / View Component',
                detail: hasCustomUi ? 'Archetype Configured' : 'Archetype Selected',
                status: hasCustomUi ? 'ready' : 'in_progress',
                icon: <Palette className="h-3.5 w-3.5 text-amber-400" />,
            },
            {
                id: 'pipeline',
                name: '2. Pipeline / Logic DAG',
                detail: hasPipeline ? 'DAG Dispatch Wired' : 'Awaiting Assembly',
                status: hasPipeline ? 'ready' : 'pending',
                icon: <Workflow className="h-3.5 w-3.5 text-purple-400" />,
            },
            {
                id: 'dataset',
                name: '3. Dataset Schema',
                detail: hasDataset ? 'Schema Bindings Set' : 'Auto-Gen Schema',
                status: hasDataset ? 'ready' : 'pending',
                icon: <Database className="h-3.5 w-3.5 text-emerald-400" />,
            },
            {
                id: 'project',
                name: '4. Project Scope',
                detail: hasProject ? 'Workspace Scoped' : 'Organization Default',
                status: hasProject ? 'ready' : 'pending',
                icon: <FolderGit2 className="h-3.5 w-3.5 text-blue-400" />,
            },
        ];
    }, [turns]);

    const completedLayersCount = assemblyLayers.filter(l => l.status === 'ready').length;

    if (isCollapsed) {
        return (
            <div
                className={cn(
                    'flex flex-col items-center py-3 border border-border/70 bg-card/85 backdrop-blur-md rounded-lg w-12 shrink-0 transition-all select-none shadow-sm',
                    className,
                )}
                data-testid="cycle-pipeline-right-rail-collapsed"
            >
                <Button
                    size="icon"
                    variant="ghost"
                    onClick={toggleCollapse}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md"
                    title="Expand Cycle Pipeline & Assembly Rail"
                    data-testid="expand-cycle-pipeline-rail-btn"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>

                <div className="h-px w-6 bg-border/60 my-2" />

                <div className="flex flex-col items-center gap-2 my-auto py-2">
                    <button
                        type="button"
                        onClick={toggleCollapse}
                        className="group relative flex h-8 w-8 items-center justify-center rounded-lg border border-border/40 bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-all shadow-xs"
                        title="Expand Cycle Pipeline & Assembly Rail"
                        aria-label="Expand Cycle Pipeline & Assembly Rail"
                    >
                        <Workflow className="h-4 w-4 text-cyan-400" />
                        <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2" aria-hidden="true">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400/60 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
                        </span>
                    </button>
                </div>

                <div className="mt-auto flex flex-col items-center gap-1.5 pb-1">
                    <Layers className="h-4 w-4 text-primary" />
                    <span className="text-[9px] font-mono text-muted-foreground">
                        {completedLayersCount}/4
                    </span>
                </div>
            </div>
        );
    }

    return (
        <aside
            className={cn(
                'flex flex-col border border-border/70 bg-card/85 backdrop-blur-md rounded-lg w-72 lg:w-80 shrink-0 h-full overflow-hidden transition-all select-none shadow-sm',
                className,
            )}
            data-testid="cycle-pipeline-right-rail"
        >
            {/* ── Rail Header ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/60 bg-muted/20">
                <div className="flex items-center gap-2 min-w-0">
                    <Activity className="h-4 w-4 text-cyan-400 shrink-0" />
                    <span className="text-xs font-semibold text-foreground truncate">Cycle Pipeline</span>
                    <Badge variant="outline" className="h-4.5 px-1.5 text-[9px] font-mono border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 shrink-0">
                        Stage 2/4
                    </Badge>
                </div>
                <Button
                    size="icon"
                    variant="ghost"
                    onClick={toggleCollapse}
                    className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md shrink-0"
                    title="Collapse Right Rail"
                    data-testid="collapse-cycle-pipeline-rail-btn"
                >
                    <ChevronRight className="h-3.5 w-3.5" />
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {/* ── Vertical DAG Progression ────────────────────────────── */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between pb-1 text-[11px] text-muted-foreground font-medium uppercase tracking-wider font-mono">
                        <span>Workflow Stages</span>
                        <span className="text-[10px] text-cyan-400">Live Cycle</span>
                    </div>

                    <div className="space-y-1 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-border/60">
                        {steps.map((step) => {
                            const isCompleted = step.status === 'completed';
                            const isActive = step.status === 'active';

                            return (
                                <div
                                    key={step.id}
                                    className={cn(
                                        'relative flex items-start gap-2.5 p-2 rounded-md transition-colors border',
                                        isCompleted
                                            ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                                            : isActive
                                            ? 'bg-cyan-500/10 border-cyan-500/30 ring-1 ring-cyan-400/20 text-cyan-200'
                                            : 'bg-muted/10 border-border/40 text-muted-foreground',
                                    )}
                                    data-testid={`cycle-stage-${step.id}`}
                                >
                                    <div className="mt-0.5 shrink-0 z-10">
                                        {isCompleted ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                        ) : isActive ? (
                                            <span className="flex h-4 w-4 items-center justify-center">
                                                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                                            </span>
                                        ) : (
                                            <span className="flex h-4 w-4 items-center justify-center">
                                                <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />
                                            </span>
                                        )}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between">
                                            <span className={cn('text-xs font-semibold', isActive ? 'text-foreground' : '')}>
                                                {step.label}
                                            </span>
                                            {isActive && (
                                                <span className="text-[9px] font-mono text-cyan-400 uppercase tracking-wider animate-pulse">
                                                    Active
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-muted-foreground/85 leading-snug line-clamp-2 mt-0.5">
                                            {step.description}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ── Modular Assembly Stack ─────────────────────────────── */}
                <div className="pt-2 border-t border-border/50 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium uppercase tracking-wider font-mono">
                        <div className="flex items-center gap-1.5">
                            <Boxes className="h-3.5 w-3.5 text-primary" />
                            <span>Assembly Stack</span>
                        </div>
                        <Badge variant="outline" className="text-[9px] font-mono h-4 px-1 border-primary/30 text-primary">
                            {completedLayersCount}/4 Ready
                        </Badge>
                    </div>

                    <div className="grid grid-cols-1 gap-1.5">
                        {assemblyLayers.map((layer) => (
                            <div
                                key={layer.id}
                                className={cn(
                                    'flex items-center justify-between p-2 rounded-md border text-xs transition-colors',
                                    layer.status === 'ready'
                                        ? 'bg-muted/30 border-border/70 text-foreground'
                                        : 'bg-muted/10 border-border/40 text-muted-foreground',
                                )}
                                data-testid={`assembly-layer-${layer.id}`}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    {layer.icon}
                                    <div className="min-w-0">
                                        <div className="font-medium text-[11px] truncate">{layer.name}</div>
                                        <div className="text-[10px] text-muted-foreground font-mono truncate">{layer.detail}</div>
                                    </div>
                                </div>

                                <Badge
                                    variant="outline"
                                    className={cn(
                                        'text-[9px] h-4 px-1 font-mono uppercase shrink-0',
                                        layer.status === 'ready'
                                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                            : 'border-border/60 text-muted-foreground',
                                    )}
                                >
                                    {layer.status === 'ready' ? 'Ready' : 'Pending'}
                                </Badge>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Operational Telemetry Card ─────────────────────────── */}
                {cycleFleetData?.cycleSlug && (
                    <div className="p-2.5 rounded-md border border-cyan-500/20 bg-cyan-500/5 text-xs space-y-1">
                        <div className="flex items-center justify-between text-cyan-400 font-mono text-[10px] font-bold uppercase">
                            <span>Cycle Fleet</span>
                            <span>{cycleFleetData.cycleSlug}</span>
                        </div>
                        <div className="text-foreground text-[11px] font-semibold">
                            {cycleFleetData.cycleName || 'Autonomous Operational Cycle'}
                        </div>
                        {cycleFleetData.apps?.length > 0 && (
                            <div className="text-muted-foreground text-[10px] flex items-center justify-between pt-1">
                                <span>Deployed Apps:</span>
                                <span className="font-mono text-cyan-300 font-semibold">{cycleFleetData.apps.length}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </aside>
    );
};

export default CyclePipelineRightRail;
