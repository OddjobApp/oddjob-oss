/**
 * MissionWaveProgress
 *
 * Live display of rolling-wave mission state:
 *  - Current phase with animated step indicator
 *  - Assembled crew with role/model badges
 *  - Real-time trace feed via SSE (mission.phase_changed, mission.trace events)
 */

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEventStream } from "@domain-ui/core/ui/hooks/use-event-stream";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import {
    Brain,
    Cpu,
    Star,
    Loader2,
    CheckCircle2,
    Clock,
    AlertCircle,
    Zap,
    PauseCircle,
    Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type WavePhase = 'PLANNING' | 'EXECUTING' | 'CRITIQUING' | 'WAITING_FOR_ORDERS' | 'REFLECTING' | 'PAUSED';

interface CrewMember {
    role: string;
    model: string;
    description: string;
}

interface TraceEntry {
    type: string;
    event: string;
    note?: string;
    error?: string;
    tool?: string;
    score?: number;
    timestamp?: string;
    receivedAt: number;
}

// ─── Phase metadata ───────────────────────────────────────────────────────────

const PHASE_META: Record<WavePhase, { label: string; icon: React.ElementType; color: string; pulse: boolean }> = {
    PLANNING:           { label: "Strategy",          icon: Brain,        color: "text-violet-400",  pulse: true  },
    EXECUTING:          { label: "Execution",         icon: Zap,          color: "text-emerald-400", pulse: true  },
    CRITIQUING:         { label: "Verification",      icon: Eye,          color: "text-amber-400",   pulse: true  },
    WAITING_FOR_ORDERS: { label: "Awaiting Input",    icon: PauseCircle,  color: "text-blue-400",    pulse: false },
    REFLECTING:         { label: "Reflecting",        icon: Loader2,      color: "text-muted-foreground",   pulse: true  },
    PAUSED:             { label: "Paused",            icon: PauseCircle,  color: "text-muted-foreground", pulse: false },
};

const PHASE_ORDER: WavePhase[] = ['PLANNING', 'EXECUTING', 'CRITIQUING', 'REFLECTING'];

const CREW_ICONS: Record<string, React.ElementType> = {
    "Strategist Lead":     Brain,
    "Technical Developer": Cpu,
    "Vibe Critic":         Star,
};

// ─── Trace row ────────────────────────────────────────────────────────────────

function TraceRow({ entry }: { entry: TraceEntry }) {
    const isError = entry.type === "error";
    const isSystem = entry.type === "system";

    return (
        <div className={cn(
            "flex gap-2 text-[11px] leading-relaxed py-0.5 px-1 rounded",
            isError && "text-red-400",
            isSystem && "text-muted-foreground",
            !isError && !isSystem && "text-foreground/80",
        )}>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50 mt-0.5 w-[60px]">
                {entry.timestamp
                    ? formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })
                    : formatDistanceToNow(new Date(entry.receivedAt), { addSuffix: true })}
            </span>
            <span className={cn("shrink-0 uppercase text-[9px] font-bold tracking-wider mt-0.5 w-[70px]",
                entry.type === "strategist" && "text-violet-400",
                entry.type === "critic" && "text-amber-400",
                entry.type === "system" && "text-muted-foreground",
                entry.type === "error" && "text-red-400",
            )}>
                {entry.event?.replace(/_/g, ' ')}
            </span>
            <span className="flex-1 break-words">
                {entry.error ?? entry.note}
                {entry.score !== undefined && (
                    <span className="ml-1 text-muted-foreground">score={entry.score}</span>
                )}
            </span>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface MissionWaveProgressProps {
    missionRunId: number;
    organizationId?: number;
}

export function MissionWaveProgress({ missionRunId, organizationId }: MissionWaveProgressProps) {
    const [phase, setPhase] = useState<WavePhase>('PLANNING');
    const [crew, setCrew] = useState<CrewMember[]>([]);
    const [traces, setTraces] = useState<TraceEntry[]>([]);
    const [waveCount, setWaveCount] = useState(1);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Fetch initial run state
    const { data: run } = useQuery<any>({
        queryKey: [`/api/mission-runs/${missionRunId}`],
        refetchInterval: false,
    });

    useEffect(() => {
        if (!run) return;
        const ctx = run.missionContext as any;
        if (ctx?.phase) setPhase(ctx.phase as WavePhase);
        if (ctx?.current_wave) setWaveCount(ctx.current_wave);
        if (ctx?.crew) setCrew(ctx.crew);
        // Seed initial traces from dynamicTrace
        if (Array.isArray(run.dynamicTrace) && run.dynamicTrace.length > 0) {
            const seeded = run.dynamicTrace.slice(-50).map((t: any) => ({ ...t, receivedAt: Date.now() }));
            setTraces(seeded);
        }
    }, [run]);

    // Subscribe to live SSE events for this mission run
    const { events } = useEventStream({
        eventType: 'mission.*',
        organizationId,
    });

    useEffect(() => {
        for (const event of events) {
            const payload = event.payload as any;
            if (!payload || payload.missionRunId !== missionRunId) continue;

            if (event.eventType === 'mission.phase_changed') {
                setPhase(payload.phase as WavePhase);
                if (payload.phase === 'PLANNING') {
                    setWaveCount(w => w + 1);
                }
            }

            if (event.eventType === 'mission.trace') {
                const entry: TraceEntry = { ...payload.traceEntry, receivedAt: Date.now() };
                setTraces(prev => [...prev.slice(-199), entry]);
            }

            if (event.eventType === 'mission.crew_assembled' && payload.crew) {
                setCrew(payload.crew);
            }
        }
    }, [events, missionRunId]);

    // Auto-scroll trace feed
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [traces]);

    const phaseMeta = PHASE_META[phase] ?? PHASE_META.PAUSED;
    const PhaseIcon = phaseMeta.icon;
    const currentPhaseIndex = PHASE_ORDER.indexOf(phase);

    return (
        <div className="space-y-4">
            {/* Phase indicator */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        Wave {waveCount} — Current Phase
                    </CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                    {/* Step track */}
                    <div className="flex items-center gap-1 mb-4">
                        {PHASE_ORDER.map((p, i) => {
                            const meta = PHASE_META[p];
                            const Icon = meta.icon;
                            const isDone = currentPhaseIndex > i;
                            const isActive = currentPhaseIndex === i;
                            return (
                                <div key={p} className="flex items-center gap-1 flex-1 last:flex-none">
                                    <div className={cn(
                                        "flex items-center justify-center w-7 h-7 rounded-full border text-[11px] transition-all",
                                        isDone && "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
                                        isActive && `bg-primary/10 border-primary/40 ${meta.color}`,
                                        !isDone && !isActive && "border-border/40 text-muted-foreground/30",
                                    )}>
                                        {isDone
                                            ? <CheckCircle2 className="w-3.5 h-3.5" />
                                            : isActive && meta.pulse
                                                ? <Icon className="w-3.5 h-3.5 animate-pulse" />
                                                : <Icon className="w-3.5 h-3.5" />
                                        }
                                    </div>
                                    {i < PHASE_ORDER.length - 1 && (
                                        <div className={cn(
                                            "flex-1 h-px",
                                            isDone ? "bg-emerald-500/30" : "bg-border/30"
                                        )} />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Active phase label */}
                    <div className="flex items-center gap-2">
                        <PhaseIcon className={cn("w-4 h-4", phaseMeta.color, phaseMeta.pulse && "animate-pulse")} />
                        <span className={cn("text-sm font-semibold", phaseMeta.color)}>{phaseMeta.label}</span>
                        {phase === 'WAITING_FOR_ORDERS' && (
                            <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 animate-pulse">
                                Awaiting your input
                            </Badge>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Crew */}
            {crew.length > 0 && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                            Crew
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        <div className="flex flex-wrap gap-2">
                            {crew.map((member) => {
                                const Icon = CREW_ICONS[member.role] ?? Brain;
                                return (
                                    <div
                                        key={member.role}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/40 border border-border/50"
                                        title={member.description}
                                    >
                                        <Icon className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-semibold">{member.role}</span>
                                            <span className="text-[10px] text-muted-foreground font-mono">{member.model}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Live trace feed */}
            <Card className="bg-background border-foreground/10">
                <CardHeader className="py-2 px-4 border-b border-foreground/5">
                    <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                        <Zap className="w-3 h-3 text-emerald-500" />
                        Live Trace
                        {traces.length > 0 && (
                            <span className="ml-auto text-[10px] font-mono text-muted-foreground/50">
                                {traces.length} entries
                            </span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <ScrollArea className="h-64">
                        <div ref={scrollRef} className="p-3 space-y-0.5 font-mono">
                            {traces.length === 0 ? (
                                <div className="flex items-center justify-center h-20 text-muted-foreground/30 text-[11px] gap-2">
                                    <Clock className="w-3 h-3" />
                                    <span>Waiting for first wave...</span>
                                </div>
                            ) : (
                                traces.map((t, i) => <TraceRow key={i} entry={t} />)
                            )}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
