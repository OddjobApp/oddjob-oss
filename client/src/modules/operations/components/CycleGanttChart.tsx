/**
 * CycleGanttChart — time-based Gantt chart with CPM scheduling and drag-to-reschedule.
 *
 * Interactions:
 *   • Drag bar body        → move phase start (sets scheduledStart on blueprint)
 *   • Drag bar right edge  → resize duration (updates estimatedDays)
 *   • Drag milestone ◇     → move milestone gate
 *   • "Clear schedule" btn → removes all scheduledStart overrides
 *   • Zoom in/out          → change pixels-per-day
 *   • Horizontal scroll    → pan the timeline
 */

import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Save, Undo2, Info, CalendarClock, GripVertical, Activity, AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { computeGanttLayout, fmtAxisDate, checkDependencyViolations, addUnits, unitsBetween, type GanttTask } from "../utils/gantt-cpm";
import type { Blueprint, Dependency, TimeUnit } from "../data/cycle-templates";

// ── Layout constants ──────────────────────────────────────────────────────────

const NAME_COL   = 176;
const ROW_H      = 42;
const BAR_H      = 22;
const BAR_Y      = (ROW_H - BAR_H) / 2;
const HEADER_H   = 52;
const RESIZE_HIT = 8;  // px — right-edge drag hit area
const MIN_DAY_W  = 4;
const MAX_DAY_W  = 160;
const DEFAULT_W  = 28;

// ── Colours ───────────────────────────────────────────────────────────────────

const C = {
    critical:       "#f59e0b",
    criticalStroke: "#d97706",
    normal:         "#6366f1",
    normalStroke:   "#4f46e5",
    manual:         "#22d3ee",     // cyan — manually placed bar
    manualStroke:   "#0891b2",
    milestone:      "#fbbf24",
    float:          "rgba(255,255,255,0.05)",
    actual:         "rgba(52,211,153,0.30)",
    actualStroke:   "rgba(52,211,153,0.65)",
    connector:      "rgba(148,163,184,0.50)",
    today:          "#ef4444",
    axis:           "#94a3b8",
    grid:           "rgba(255,255,255,0.04)",
    gridMonth:      "rgba(255,255,255,0.09)",
    rowAlt:         "rgba(255,255,255,0.015)",
    rowHover:       "rgba(99,102,241,0.07)",
    dragOver:       "rgba(99,102,241,0.12)",
    nameText:       "#e2e8f0",
    header:         "rgba(0,0,0,0.40)",
    handle:         "rgba(255,255,255,0.35)",
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActualRun {
    name: string;
    status: string;
    startedAt?: string;
    finishedAt?: string;
}

export interface CycleGanttChartProps {
    blueprints: Blueprint[];
    startDate?: Date;
    runs?: ActualRun[];
    mini?: boolean;
    className?: string;
    /** Called when user finishes dragging — provides the updated blueprint array */
    onChange?: (blueprints: Blueprint[]) => void;
    /** Active time unit */
    timeUnit?: TimeUnit;
    excludeWeekends?: boolean;
}

type DragType = "move" | "resize" | "reorder";

interface DragState {
    type: DragType;
    taskName: string;
    startClientX: number;
    startClientY: number;
    /** earlyStart (move) or duration (resize) at drag start */
    originalValue: number;
    originalIndex?: number;
    initialBlueprints?: Blueprint[];
    /** minimum allowed start unit offset (dep constraint) */
    minDay: number;
    currentDelta: number;
}

// ── Connector routing ─────────────────────────────────────────────────────────

function depLabel(type: Dependency["type"]) {
    return { finish_to_start: "FS", start_to_start: "SS", finish_to_finish: "FF", start_to_finish: "SF" }[type] ?? "FS";
}

interface Edge { sx: number; sy: number; tx: number; ty: number; type: Dependency["type"]; critical: boolean }

function buildEdges(tasks: GanttTask[], dayW: number, domainStart = 0): Edge[] {
    const byName = new Map(tasks.map(t => [t.name, t]));
    const edges: Edge[] = [];

    for (const task of tasks) {
        const allDeps = [
            ...(task.blueprint.dependencies ?? []).map(d => ({ predName: d.blueprintName, type: d.type })),
            ...(task.blueprint.dependsOn ?? []).map(n => ({ predName: n, type: "finish_to_start" as Dependency["type"] })),
        ];
        for (const { predName, type } of allDeps) {
            const pred = byName.get(predName);
            if (!pred) continue;
            const isFS_SS = type === "finish_to_start" || type === "finish_to_finish";
            const sx = NAME_COL + ((isFS_SS ? pred.earlyFinish : pred.earlyStart) - domainStart) * dayW;
            const tx = NAME_COL + ((type === "finish_to_finish" || type === "start_to_finish" ? task.earlyFinish : task.earlyStart) - domainStart) * dayW;
            edges.push({
                sx, tx,
                sy: HEADER_H + pred.rowIndex * ROW_H + ROW_H / 2,
                ty: HEADER_H + task.rowIndex * ROW_H + ROW_H / 2,
                type,
                critical: pred.isCritical && task.isCritical,
            });
        }
    }
    return edges;
}

function ConnectorPath({ sx, sy, tx, ty, type, critical }: Edge) {
    const mid = (sx + tx) / 2;
    const d = sy === ty ? `M${sx},${sy} L${tx},${ty}` : `M${sx},${sy} H${mid} V${ty} H${tx}`;
    const colour = critical ? C.criticalStroke : C.connector;
    const dashed = type === "start_to_start" || type === "finish_to_finish" ? "3,2" : undefined;
    return (
        <g>
            <path className="gantt-connector" d={d} fill="none" stroke={colour} strokeWidth="1.3"
                strokeDasharray={dashed} markerEnd={`url(#gc-arrow-${critical ? "crit" : "norm"})`} />
            <text x={(sx + tx) / 2} y={Math.min(sy, ty) - 3} textAnchor="middle"
                fill={colour} fontSize="7.5" fontWeight="700">{depLabel(type)}</text>
        </g>
    );
}

function formatAxisLabel(val: number, date: Date, unit: TimeUnit): string {
    const displayVal = Math.abs(val) >= 100 ? Math.round(val) : Math.round(val * 10) / 10;
    if (unit === "ms") return `+${displayVal}ms`;
    if (unit === "s") {
        const m = Math.floor(val / 60);
        const s = Math.floor(val % 60);
        return `+${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    if (unit === "m") {
        const h = Math.floor(val / 60);
        const m = Math.floor(val % 60);
        return `+${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
    if (unit === "h") {
        return `+${val}h`;
    }
    if (unit === "w") {
        return `Wk ${val}`;
    }
    if (unit === "M") {
        return `Mo ${val}`;
    }
    return fmtAxisDate(date);
}

function formatUnitLabel(value: number, unit: TimeUnit): string {
    const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded}${unit}`;
}

function formatTimestamp(value?: string): string {
    if (!value) return "Pending";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function buildAxisTicks(domainStart: number, domainEnd: number, unitW: number, start: Date, unit: TimeUnit, excludeWeekends?: boolean) {
    const total = Math.max(1, domainEnd - domainStart);
    const targetCount = Math.max(4, Math.min(16, Math.floor(560 / Math.max(unitW, 1))));
    const interval = Math.max(1, Math.round(total / targetCount));
    const first = Math.floor(domainStart / interval) * interval;
    const ticks: { day: number; label: string; isMonth: boolean }[] = [];
    for (let u = first; u <= domainEnd + interval; u += interval) {
        if (u < domainStart - interval) continue;
        const date = addUnits(start, u, unit, excludeWeekends);
        const isMonth = unit === "d" ? date.getDate() <= interval : (u === 0 || u % (interval * 5) === 0);
        ticks.push({ day: u, label: formatAxisLabel(u, date, unit), isMonth });
    }
    return ticks;
}

type HistoryTone = "scheduled" | "running" | "completed" | "failed" | "waiting";
type ExplorerView = "compact" | "timeline" | "full";

interface TimelineHistoryEvent {
    id: string;
    taskName: string;
    type: string;
    label: string;
    detail: string;
    offset: number;
    timestamp?: string;
    tone: HistoryTone;
}

const MAX_VISIBLE_UNITS: Partial<Record<TimeUnit, number>> = {
    ms: 5_000,
    s: 900,
    m: 720,
    h: 168,
};

const EVENT_TONE: Record<HistoryTone, { fill: string; stroke: string }> = {
    scheduled: { fill: "rgba(99,102,241,0.85)", stroke: "#a5b4fc" },
    running: { fill: "rgba(34,211,238,0.85)", stroke: "#67e8f9" },
    completed: { fill: "rgba(52,211,153,0.85)", stroke: "#86efac" },
    failed: { fill: "rgba(239,68,68,0.90)", stroke: "#fecaca" },
    waiting: { fill: "rgba(148,163,184,0.75)", stroke: "#cbd5e1" },
};

function buildTaskHistoryEvents(task: GanttTask, actual: ActualRun | undefined, cycleStart: Date, unit: TimeUnit, nowOffset: number, excludeWeekends?: boolean): TimelineHistoryEvent[] {
    const events: TimelineHistoryEvent[] = [
        {
            id: `${task.name}-scheduled`,
            taskName: task.name,
            type: "ActivityTaskScheduled",
            label: "Scheduled",
            detail: `Planned at +${formatUnitLabel(task.earlyStart, unit)}`,
            offset: task.earlyStart,
            tone: "scheduled",
        },
    ];

    if (actual?.startedAt) {
        const startedOffset = unitsBetween(cycleStart, new Date(actual.startedAt), unit, excludeWeekends);
        events.push({
            id: `${task.name}-started`,
            taskName: task.name,
            type: "ActivityTaskStarted",
            label: "Started",
            detail: formatTimestamp(actual.startedAt),
            offset: startedOffset,
            timestamp: actual.startedAt,
            tone: "running",
        });
    } else {
        events.push({
            id: `${task.name}-waiting`,
            taskName: task.name,
            type: "PendingActivityTask",
            label: "Waiting",
            detail: "No run has started",
            offset: Math.max(task.earlyStart, Math.min(task.earlyFinish, nowOffset)),
            tone: "waiting",
        });
    }

    if (actual?.finishedAt) {
        const finishedOffset = unitsBetween(cycleStart, new Date(actual.finishedAt), unit, excludeWeekends);
        const failed = actual.status === "failed";
        events.push({
            id: `${task.name}-${failed ? "failed" : "completed"}`,
            taskName: task.name,
            type: failed ? "ActivityTaskFailed" : "ActivityTaskCompleted",
            label: failed ? "Failed" : "Completed",
            detail: formatTimestamp(actual.finishedAt),
            offset: finishedOffset,
            timestamp: actual.finishedAt,
            tone: failed ? "failed" : "completed",
        });
    } else if (actual?.startedAt) {
        events.push({
            id: `${task.name}-open`,
            taskName: task.name,
            type: "PendingActivityTask",
            label: "Open",
            detail: actual.status || "running",
            offset: nowOffset,
            tone: "running",
        });
    }

    return events.sort((a, b) => a.offset - b.offset);
}

// ── Main component ────────────────────────────────────────────────────────────

export function CycleGanttChart({
    blueprints, startDate, runs = [], mini = false, className, onChange, timeUnit, excludeWeekends,
}: CycleGanttChartProps) {
    const { toast } = useToast();
    const [dayW, setDayW] = useState(mini ? 16 : DEFAULT_W);
    const [hoveredRow, setHoveredRow] = useState<number | null>(null);
    const [hoveredTask, setHoveredTask] = useState<GanttTask | null>(null);
    const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);
    const [explorerView, setExplorerView] = useState<ExplorerView>("timeline");
    const [eventFilter, setEventFilter] = useState<HistoryTone | "all">("all");

    const activeUnit = useMemo(() => {
        return timeUnit ?? blueprints[0]?.timeUnit ?? "d";
    }, [timeUnit, blueprints]);

    const isSubDay = ["ms", "s", "m", "h"].includes(activeUnit);
    const transitionSec = activeUnit === "ms" ? 0.05 : activeUnit === "s" ? 1 : activeUnit === "m" ? 5 : 30;

    // Pending blueprints — local working copy during and after drag
    const pendingRef = useRef<Blueprint[]>(blueprints);
    const [pending, _setPending] = useState<Blueprint[]>(blueprints);
    const setPending = (bp: Blueprint[]) => { pendingRef.current = bp; _setPending(bp); };

    // Sync from parent when blueprints prop changes (e.g. after save)
    useEffect(() => {
        if (!dragRef.current) {
            setPending(blueprints);
        }
    }, [blueprints]);

    const [isDragging, setIsDragging] = useState(false);
    const [dragTooltip, setDragTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
    const [hasUnsaved, setHasUnsaved] = useState(false);

    const dragRef = useRef<DragState | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const cycleStart = useMemo(() => startDate ?? new Date(), [startDate]);
    
    // Manage dynamic playhead offset (re-rendered on sub-day updates)
    const [currentOffset, setCurrentOffset] = useState(() => {
        return unitsBetween(cycleStart, new Date(), activeUnit, excludeWeekends);
    });

    useEffect(() => {
        setCurrentOffset(unitsBetween(cycleStart, new Date(), activeUnit, excludeWeekends));

        const isSubDay = ["ms", "s", "m", "h"].includes(activeUnit);
        if (!isSubDay) return;

        const intervalMs = activeUnit === "ms" ? 50 : activeUnit === "s" ? 1000 : activeUnit === "m" ? 5000 : 30000;
        const timer = setInterval(() => {
            setCurrentOffset(unitsBetween(cycleStart, new Date(), activeUnit, excludeWeekends));
        }, intervalMs);

        return () => clearInterval(timer);
    }, [cycleStart, activeUnit]);

    // Compute average runtime in ms per blueprint name from the historical runs
    const computedAvgRuntimes = useMemo(() => {
        const sumMap = new Map<string, number>();
        const countMap = new Map<string, number>();

        runs.forEach(r => {
            if (r.startedAt && r.finishedAt) {
                const start = new Date(r.startedAt).getTime();
                const finish = new Date(r.finishedAt).getTime();
                if (!isNaN(start) && !isNaN(finish) && finish > start) {
                    const dur = finish - start;
                    sumMap.set(r.name, (sumMap.get(r.name) ?? 0) + dur);
                    countMap.set(r.name, (countMap.get(r.name) ?? 0) + 1);
                }
            }
        });

        const averages = new Map<string, number>();
        sumMap.forEach((total, name) => {
            const count = countMap.get(name) ?? 1;
            averages.set(name, total / count);
        });
        return averages;
    }, [runs]);

    // Enrich blueprints with computed avgRuntime if they don't already have one
    const blueprintsWithTelemetry = useMemo(() => {
        return pending.map(bp => {
            const avg = computedAvgRuntimes.get(bp.name);
            return {
                ...bp,
                avgRuntime: bp.avgRuntime ?? avg,
            };
        });
    }, [pending, computedAvgRuntimes]);

    const actualByName = useMemo(() => {
        const m = new Map<string, ActualRun>();
        runs.forEach(r => m.set(r.name, r));
        return m;
    }, [runs]);

    const tasks = useMemo(() => computeGanttLayout(blueprintsWithTelemetry, activeUnit), [blueprintsWithTelemetry, activeUnit]);
    const scheduleEnd = useMemo(
        () => Math.max(...tasks.map(t => t.earlyFinish), 1),
        [tasks],
    );
    const actualEnd = useMemo(() => {
        let max = 0;
        runs.forEach(r => {
            if (!r.startedAt) return;
            const start = unitsBetween(cycleStart, new Date(r.startedAt), activeUnit, excludeWeekends);
            const finish = r.finishedAt ? unitsBetween(cycleStart, new Date(r.finishedAt), activeUnit, excludeWeekends) : currentOffset;
            max = Math.max(max, start, finish);
        });
        return max;
    }, [runs, cycleStart, activeUnit, currentOffset, excludeWeekends]);
    const domain = useMemo(() => {
        const naturalEnd = Math.max(scheduleEnd, actualEnd, currentOffset + 1, 7);
        const maxVisible = MAX_VISIBLE_UNITS[activeUnit];
        if (!maxVisible || naturalEnd <= maxVisible) {
            return { start: 0, end: naturalEnd, isWindowed: false };
        }

        const focus = Math.max(0, currentOffset);
        const start = Math.max(0, focus - maxVisible * 0.72);
        return { start, end: start + maxVisible, isWindowed: true };
    }, [scheduleEnd, actualEnd, currentOffset, activeUnit]);
    const visibleUnits = Math.max(1, domain.end - domain.start);
    const totalUnits = Math.max(scheduleEnd, actualEnd, currentOffset + 1, 7);
    const axisTicks = useMemo(() => buildAxisTicks(domain.start, domain.end, dayW, cycleStart, activeUnit, excludeWeekends), [domain.start, domain.end, dayW, cycleStart, activeUnit, excludeWeekends]);
    const edges = useMemo(() => mini ? [] : buildEdges(tasks, dayW, domain.start), [tasks, dayW, mini, domain.start]);
    const xForUnit = useCallback((value: number) => NAME_COL + (value - domain.start) * dayW, [domain.start, dayW]);
    const isOffsetVisible = useCallback((value: number) => value >= domain.start && value <= domain.end, [domain.start, domain.end]);
    const inspectedTask = useMemo(
        () => (selectedTaskName ? tasks.find(t => t.name === selectedTaskName) : null) ?? hoveredTask,
        [selectedTaskName, tasks, hoveredTask],
    );
    const inspectedEvents = useMemo(
        () => inspectedTask ? buildTaskHistoryEvents(inspectedTask, actualByName.get(inspectedTask.name), cycleStart, activeUnit, currentOffset, excludeWeekends) : [],
        [inspectedTask, actualByName, cycleStart, activeUnit, currentOffset, excludeWeekends],
    );
    const allHistoryEvents = useMemo(
        () => tasks.flatMap(task => buildTaskHistoryEvents(task, actualByName.get(task.name), cycleStart, activeUnit, currentOffset, excludeWeekends)),
        [tasks, actualByName, cycleStart, activeUnit, currentOffset, excludeWeekends],
    );
    const visibleHistoryEvents = useMemo(
        () => allHistoryEvents.filter(event => eventFilter === "all" || event.tone === eventFilter),
        [allHistoryEvents, eventFilter],
    );
    const compactGroups = useMemo(() => {
        const groups = new Map<HistoryTone, { tone: HistoryTone; events: TimelineHistoryEvent[]; taskNames: Set<string> }>();
        visibleHistoryEvents.forEach(event => {
            const existing = groups.get(event.tone) ?? { tone: event.tone, events: [], taskNames: new Set<string>() };
            existing.events.push(event);
            existing.taskNames.add(event.taskName);
            groups.set(event.tone, existing);
        });
        const order: HistoryTone[] = ["failed", "running", "waiting", "completed", "scheduled"];
        return order.map(tone => groups.get(tone)).filter(Boolean) as Array<{ tone: HistoryTone; events: TimelineHistoryEvent[]; taskNames: Set<string> }>;
    }, [visibleHistoryEvents]);
    const filteredInspectedEvents = useMemo(
        () => inspectedEvents.filter(event => eventFilter === "all" || event.tone === eventFilter),
        [inspectedEvents, eventFilter],
    );

    const svgW = NAME_COL + visibleUnits * dayW + 40;
    const svgH = HEADER_H + tasks.length * ROW_H + 24;

    // ── Drag helpers ─────────────────────────────────────────────────────────

    const getSvgX = useCallback((clientX: number): number => {
        const rect = svgRef.current?.getBoundingClientRect();
        return rect ? clientX - rect.left : clientX;
    }, []);

    const startDrag = useCallback((
        e: React.MouseEvent,
        task: GanttTask,
        type: DragType,
    ) => {
        e.preventDefault();
        e.stopPropagation();

        dragRef.current = {
            type,
            taskName: task.name,
            startClientX: e.clientX,
            startClientY: e.clientY,
            originalValue: type === "move" ? task.earlyStart : task.duration,
            originalIndex: pendingRef.current.findIndex(b => b.name === task.name),
            initialBlueprints: [...pendingRef.current],
            minDay: task.depMinStart,
            currentDelta: 0,
        };
        setIsDragging(true);

        const onMove = (me: MouseEvent) => {
            const d = dragRef.current;
            if (!d) return;

            if (d.type === "reorder") {
                const deltaY = me.clientY - d.startClientY;
                const deltaRows = Math.round(deltaY / ROW_H);
                if (deltaRows === d.currentDelta) return;
                d.currentDelta = deltaRows;

                const newIndex = Math.max(0, Math.min(d.initialBlueprints!.length - 1, d.originalIndex! + deltaRows));
                
                const newArr = [...d.initialBlueprints!];
                const [moved] = newArr.splice(d.originalIndex!, 1);
                newArr.splice(newIndex, 0, moved);
                
                setPending(newArr);

                const svgX = getSvgX(me.clientX);
                const rect = svgRef.current?.getBoundingClientRect();
                const svgY = rect ? (me.clientY - rect.top) - 28 : (HEADER_H - 28);
                setDragTooltip({ x: svgX, y: svgY, text: `Priority: #${newIndex + 1}` });
                return;
            }

            const deltaX = me.clientX - d.startClientX;
            const deltaUnits = Math.round(deltaX / dayW);
            if (deltaUnits === d.currentDelta) return;
            d.currentDelta = deltaUnits;

            setPending(pendingRef.current.map(bp => {
                if (bp.name !== d.taskName) return bp;
                if (d.type === "move") {
                    const newStart = Math.max(d.minDay, d.originalValue + deltaUnits);
                    return { ...bp, scheduledStart: newStart };
                } else {
                    const newDur = Math.max(0, d.originalValue + deltaUnits);
                    return { 
                        ...bp, 
                        estimatedDuration: newDur, 
                        estimatedDays: newDur,
                    };
                }
            }));

            // Compute SVG coords for tooltip
            const svgX = getSvgX(me.clientX);
            const taskRow = tasks.find(t => t.name === d.taskName);
            if (taskRow) {
                const svgY = HEADER_H + taskRow.rowIndex * ROW_H - 28;
                const computedStartVal = Math.max(d.minDay, d.originalValue + deltaUnits);
                const label = d.type === "move"
                    ? `Start: offset ${computedStartVal.toFixed(0)} (${formatAxisLabel(computedStartVal, addUnits(cycleStart, computedStartVal, activeUnit, excludeWeekends), activeUnit)})`
                    : `Duration: ${Math.max(0, d.originalValue + deltaUnits)}${activeUnit}`;
                setDragTooltip({ x: svgX, y: svgY, text: label });
            }
        };

        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            
            if (dragRef.current?.type === "reorder") {
                const violations = checkDependencyViolations(pendingRef.current);
                const myViolations = violations.filter(v => v.includes(`"${dragRef.current!.taskName}"`));
                if (myViolations.length > 0) {
                    toast({
                        title: "Dependency Constraint",
                        description: myViolations[0] + " (Visual order may be constrained by CPM)",
                        variant: "destructive",
                    });
                }
            }
            
            dragRef.current = null;
            setIsDragging(false);
            setDragTooltip(null);
            setHasUnsaved(true);
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    }, [dayW, cycleStart, tasks, getSvgX, toast, activeUnit]);

    const handleSave = () => {
        onChange?.(pendingRef.current);
        setHasUnsaved(false);
    };

    const handleClearSchedule = () => {
        const cleared = pendingRef.current.map(bp => {
            const { scheduledStart: _, ...rest } = bp;
            return rest as Blueprint;
        });
        setPending(cleared);
        setHasUnsaved(true);
    };

    const handleReset = () => {
        setPending(blueprints);
        setHasUnsaved(false);
    };

    const zoom = (dir: 1 | -1) => setDayW(w => Math.min(MAX_DAY_W, Math.max(MIN_DAY_W, w + dir * (w < 20 ? 2 : w < 50 ? 4 : 8))));

    /** Zoom to fit all tasks in the visible container width */
    const zoomToFit = () => {
        const container = svgRef.current?.parentElement;
        if (!container) return;
        const availableW = container.clientWidth - NAME_COL - 40;
        const optimalW = Math.max(MIN_DAY_W, Math.min(MAX_DAY_W, Math.floor(availableW / Math.max(totalUnits, 1))));
        setDayW(optimalW);
    };

    /** Ctrl+Wheel zoom — zooms centered on the mouse X position within the timeline */
    const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const step = dayW < 20 ? 2 : dayW < 50 ? 4 : 8;
        setDayW(w => Math.min(MAX_DAY_W, Math.max(MIN_DAY_W, w + delta * step)));
    }, [dayW]);

    if (tasks.length === 0) return (
        <div className={`flex items-center justify-center h-24 text-xs text-muted-foreground/50 italic ${className}`}>
            Add blueprints with estimated durations to enable Gantt scheduling.
        </div>
    );

    const hasAnyDurations = pending.some(b => b.estimatedDuration !== undefined || b.estimatedDays !== undefined || b.avgRuntime !== undefined);
    const hasManual = pending.some(b => b.scheduledStart !== undefined);

    return (
        <div className={`space-y-2 ${className}`}>

            {/* ── Toolbar ──────────────────────────────────────────────────── */}
            {!mini && (
                <div className="flex items-center gap-2 px-0.5 flex-wrap">
                    <div className="flex items-center gap-1 bg-black/30 rounded-full p-0.5 border border-white/10">
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => zoom(-1)} title="Zoom out (−)">
                            <ZoomOut className="w-3.5 h-3.5" />
                        </Button>
                        <input
                            type="range"
                            min={MIN_DAY_W}
                            max={MAX_DAY_W}
                            value={dayW}
                            onChange={(e) => setDayW(Number(e.target.value))}
                            className="w-24 h-5 accent-primary cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
                            title={`${dayW}px per ${activeUnit}`}
                        />
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => zoom(1)} title="Zoom in (+)">
                            <ZoomIn className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={zoomToFit} title="Zoom to fit all tasks">
                            <RotateCcw className="w-3 h-3" />
                        </Button>
                    </div>
                    <span className="text-[9px] text-muted-foreground/50">{dayW}px/{activeUnit} · Ctrl+Scroll to zoom</span>

                    <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/30 p-0.5">
                        {(["compact", "timeline", "full"] as ExplorerView[]).map(view => (
                            <Button
                                key={view}
                                type="button"
                                variant={explorerView === view ? "secondary" : "ghost"}
                                size="sm"
                                className="h-7 rounded-full px-3 text-[10px] font-black uppercase tracking-widest"
                                onClick={() => setExplorerView(view)}
                                title={`${view[0].toUpperCase()}${view.slice(1)} workflow exploration view`}
                            >
                                {view}
                            </Button>
                        ))}
                    </div>

                    <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/30 p-0.5">
                        {(["all", "failed", "running", "waiting", "completed", "scheduled"] as Array<HistoryTone | "all">).map(filter => (
                            <Button
                                key={filter}
                                type="button"
                                variant={eventFilter === filter ? "secondary" : "ghost"}
                                size="sm"
                                className="h-7 rounded-full px-2.5 text-[9px] font-black uppercase tracking-widest"
                                onClick={() => setEventFilter(filter)}
                                title={`Show ${filter === "all" ? "all events" : `${filter} events`}`}
                            >
                                {filter}
                            </Button>
                        ))}
                    </div>

                    {hasManual && onChange && (
                        <Button variant="ghost" size="sm"
                            className="h-7 rounded-full text-[10px] border border-white/10 text-muted-foreground hover:text-foreground"
                            onClick={handleClearSchedule} title="Remove all manual start overrides">
                            <CalendarClock className="w-3 h-3 mr-1.5" /> Clear Schedule
                        </Button>
                    )}

                    {hasUnsaved && onChange && (
                        <>
                            <Button size="sm" onClick={handleSave}
                                className="h-7 rounded-full text-[10px] bg-primary hover:bg-primary/90 shadow-md shadow-primary/20">
                                <Save className="w-3 h-3 mr-1.5" /> Save Schedule
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleReset}
                                className="h-7 rounded-full text-[10px] border border-white/10">
                                <Undo2 className="w-3 h-3 mr-1.5" /> Discard
                            </Button>
                        </>
                    )}

                    {/* Legend */}
                    <div className="ml-auto flex items-center gap-3 text-[9px] text-muted-foreground/60 flex-wrap">
                        <span><span className="inline-block w-3 h-2 rounded-sm mr-1 bg-indigo-500" />Mission</span>
                        <span><span className="inline-block w-3 h-2 rounded-sm mr-1 bg-amber-500" />Critical</span>
                        <span><span className="inline-block w-3 h-2 rounded-sm mr-1 bg-cyan-400" />Manual</span>
                        <span><span className="inline-block w-3 h-2 rounded-sm mr-1 border bg-emerald-400/30 border-emerald-400/65" />Actual</span>
                        <span><span className="inline-block w-2.5 h-2.5 rotate-45 mr-1 bg-amber-400" />Milestone</span>
                        <span><span className="inline-block w-px h-3 mr-1 bg-red-500" />Playhead</span>
                        {!hasAnyDurations && (
                            <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30 bg-amber-500/10 h-5">
                                Set durations in blueprints to enable time-based layout
                            </Badge>
                        )}
                    </div>
                </div>
            )}

            {!mini && explorerView === "compact" && (
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-primary">Compact Event Groups</div>
                            <p className="text-[10px] text-muted-foreground">Grouped mission events in execution order without clock-time scaling.</p>
                        </div>
                        <Badge variant="outline" className="h-5 border-white/10 bg-foreground/5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                            {visibleHistoryEvents.length} events
                        </Badge>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                        {compactGroups.map(group => {
                            const tone = EVENT_TONE[group.tone];
                            const Icon = group.tone === "failed" ? AlertTriangle : group.tone === "completed" ? CheckCircle2 : group.tone === "running" ? Activity : Clock3;
                            const firstTask = Array.from(group.taskNames)[0];
                            return (
                                <button
                                    key={group.tone}
                                    type="button"
                                    onClick={() => firstTask && setSelectedTaskName(firstTask)}
                                    className="min-h-[92px] rounded-lg border border-white/10 bg-foreground/[0.025] p-3 text-left transition hover:border-primary/40 hover:bg-foreground/[0.045]"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border" style={{ borderColor: tone.stroke, color: tone.stroke, backgroundColor: tone.fill }}>
                                            <Icon className="h-3.5 w-3.5" />
                                        </span>
                                        <span className="text-lg font-black text-foreground">{group.events.length}</span>
                                    </div>
                                    <div className="mt-2 text-[10px] font-black uppercase tracking-widest text-foreground">{group.tone}</div>
                                    <div className="mt-1 text-[10px] text-muted-foreground">{group.taskNames.size} mission{group.taskNames.size === 1 ? "" : "s"}</div>
                                </button>
                            );
                        })}
                        {compactGroups.length === 0 && (
                            <div className="rounded-lg border border-white/10 bg-foreground/[0.025] px-3 py-4 text-xs text-muted-foreground">
                                No events match this filter.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Chart ────────────────────────────────────────────────────── */}
            <div className={`w-full overflow-x-auto rounded-xl border bg-black/25 ${explorerView === "compact" ? "max-h-[360px]" : ""} ${isDragging ? "border-primary/30 cursor-grabbing" : "border-white/5 cursor-default"}`}
                onWheel={handleWheel}
            >
                <svg ref={svgRef} width={svgW} height={svgH}
                    className="block select-none min-w-max">
                    <defs>
                        <marker id="gc-arrow-norm" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                            <path d="M0,0 L6,3 L0,6 Z" fill={C.connector} />
                        </marker>
                        <marker id="gc-arrow-crit" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                            <path d="M0,0 L6,3 L0,6 Z" fill={C.criticalStroke} />
                        </marker>
                        <pattern id="gc-barber-pole" width="20" height="20" patternUnits="userSpaceOnUse">
                            <path d="M 0,20 L 20,0 M -5,5 L 5,-5 M 15,25 L 25,15" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="4.5" />
                            <animateTransform attributeName="patternTransform" type="translate" from="0,0" to="20,0" dur="1.2s" repeatCount="indefinite" />
                        </pattern>
                        <filter id="gc-glow-critical" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="2.2" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                        <filter id="gc-glow-failed" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="2" result="blur">
                                <animate attributeName="stdDeviation" values="1.2;3;1.2" dur="2s" repeatCount="indefinite" />
                            </feGaussianBlur>
                            <feComponentTransfer in="blur" result="glow">
                                <feFuncR type="linear" slope="2.5" />
                                <feFuncG type="linear" slope="0" />
                                <feFuncB type="linear" slope="0" />
                            </feComponentTransfer>
                            <feMerge>
                                <feMergeNode in="glow" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    <style>{`
                        .gantt-bar {
                            transition: x 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
                                        y 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
                                        width 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
                                        transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
                        }
                        .gantt-bar-dragging {
                            transition: none !important;
                        }
                        .gantt-connector {
                            transition: d 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
                        }
                        .gantt-grid-line {
                            transition: x1 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
                                        x2 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
                        }
                        .gantt-tick-text {
                            transition: x 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
                        }
                        .gantt-bar:hover {
                            filter: brightness(1.15) saturate(1.05);
                            stroke-width: 1.5px;
                            cursor: grab;
                        }
                        .gantt-milestone-diamond {
                            transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
                                        fill 0.2s ease;
                            transform-origin: 0px 0px;
                        }
                        .gantt-milestone-diamond:hover {
                            transform: scale(1.22) rotate(45deg);
                            cursor: grab;
                        }
                    `}</style>

                    {/* Grid */}
                    {axisTicks.map(({ day, isMonth }) => (
                        <line key={day}
                            className="gantt-grid-line"
                            x1={xForUnit(day)} y1={HEADER_H}
                            x2={xForUnit(day)} y2={svgH}
                            stroke={isMonth ? C.gridMonth : C.grid}
                            strokeWidth={isMonth ? 0.8 : 0.5} />
                    ))}

                    {/* Row backgrounds */}
                    {tasks.map((t, i) => (
                        <rect key={t.name}
                            x={0} y={HEADER_H + i * ROW_H} width={svgW} height={ROW_H}
                            fill={isDragging && dragRef.current?.taskName === t.name ? C.dragOver :
                                  selectedTaskName === t.name ? "rgba(99,102,241,0.11)" :
                                  hoveredRow === i ? C.rowHover :
                                  i % 2 === 1 ? C.rowAlt : "none"} />
                    ))}

                    {/* Name column divider */}
                    <line x1={NAME_COL} y1={0} x2={NAME_COL} y2={svgH}
                        stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

                    {/* Header */}
                    <rect x={0} y={0} width={svgW} height={HEADER_H} fill={C.header} />
                    <text x={NAME_COL / 2} y={HEADER_H / 2 + 4}
                        textAnchor="middle" fill={C.axis} fontSize="9" fontWeight="700">PHASE</text>
                    {axisTicks.map(({ day, label, isMonth }) => (
                        <text key={day}
                            className="gantt-tick-text"
                            x={xForUnit(day) + 3} y={HEADER_H - (isMonth ? 6 : 11)}
                            fill={isMonth ? "#cbd5e1" : C.axis}
                            fontSize={isMonth ? 9 : 8} fontWeight={isMonth ? "700" : "400"}>
                            {label}
                        </text>
                    ))}
                    <line x1={0} y1={HEADER_H} x2={svgW} y2={HEADER_H} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

                    {/* Edges */}
                    {edges.map((e, i) => <ConnectorPath key={i} {...e} />)}

                    {/* Tasks */}
                    {tasks.map((task, i) => {
                        const y0 = HEADER_H + i * ROW_H;
                        const isManual = task.isManuallyScheduled;
                        const barColour = isManual ? C.manual : task.isCritical ? C.critical : C.normal;
                        const strokeColour = isManual ? C.manualStroke : task.isCritical ? C.criticalStroke : C.normalStroke;
                        const visibleStart = Math.max(task.earlyStart, domain.start);
                        const visibleEnd = Math.min(task.earlyFinish, domain.end);
                        const barVisible = task.isMilestone ? isOffsetVisible(task.earlyStart) : visibleEnd >= visibleStart;
                        const barX = xForUnit(task.isMilestone ? task.earlyStart : visibleStart);
                        const barW = Math.max((visibleEnd - visibleStart) * dayW, task.isMilestone ? 0 : 3);
                        const actual = actualByName.get(task.name);
                        const isDraggingThis = isDragging && dragRef.current?.taskName === task.name;

                        let actualX: number | null = null, actualW = 0;
                        if (actual?.startedAt) {
                            const aS = unitsBetween(cycleStart, new Date(actual.startedAt), activeUnit, excludeWeekends);
                            const aE = actual.finishedAt ? unitsBetween(cycleStart, new Date(actual.finishedAt), activeUnit, excludeWeekends) : currentOffset;
                            const visibleActualStart = Math.max(aS, domain.start);
                            const visibleActualEnd = Math.min(aE, domain.end);
                            if (visibleActualEnd >= visibleActualStart) {
                                actualX = xForUnit(visibleActualStart);
                                actualW = Math.max((visibleActualEnd - visibleActualStart) * dayW, 2);
                            }
                        }

                        const hasFloat = task.totalFloat > 0.1;
                        const visibleFloatStart = Math.max(task.lateStart, domain.start);
                        const visibleFloatEnd = Math.min(task.lateFinish, domain.end);
                        const floatVisible = visibleFloatEnd >= visibleFloatStart;
                        const floatX = xForUnit(visibleFloatStart);
                        const floatW = (visibleFloatEnd - visibleFloatStart) * dayW;
                        const historyEvents = buildTaskHistoryEvents(task, actual, cycleStart, activeUnit, currentOffset)
                            .filter(event => (eventFilter === "all" || event.tone === eventFilter) && isOffsetVisible(event.offset));

                        const canDrag = !!onChange && !mini;

                        return (
                            <g key={task.name}
                                onMouseEnter={() => {
                                    setHoveredRow(i);
                                    if (!isDragging) setHoveredTask(task);
                                }}
                                onMouseLeave={() => {
                                    setHoveredRow(null);
                                    setHoveredTask(null);
                                }}>

                                {/* Reorder handle */}
                                {canDrag && (
                                    <g className="cursor-ns-resize" transform={`translate(4, ${y0 + ROW_H / 2 - 8})`}
                                       onMouseDown={e => startDrag(e, task, "reorder")}>
                                        <title>Drag to reorder priority</title>
                                        <rect x={-4} y={-4} width={16} height={24} fill="transparent" />
                                        <path d="M2,4 v8 M6,4 v8" stroke={C.handle} strokeWidth="1.5" strokeLinecap="round" />
                                    </g>
                                )}

                                {/* Name */}
                                <text x={canDrag ? 18 : 8} y={y0 + ROW_H / 2 + 4}
                                    fill={isManual ? C.manual : task.isCritical ? "#fcd34d" : task.isMilestone ? C.milestone : C.nameText}
                                    fontSize={mini ? 9 : 10} fontWeight={task.isCritical || isManual ? "700" : "500"}
                                    className="cursor-pointer"
                                    onClick={() => setSelectedTaskName(task.name)}>
                                    {task.name.length > (mini ? 14 : 18) ? task.name.slice(0, mini ? 13 : 17) + "…" : task.name}
                                    <title>{task.name}{task.blueprint.objective ? ` — ${task.blueprint.objective}` : ""}</title>
                                </text>

                                {/* Manual indicator pin */}
                                {isManual && !mini && (
                                    <circle cx={NAME_COL - 6} cy={y0 + ROW_H / 2}
                                        r={3} fill={C.manual} fillOpacity="0.8" />
                                )}

                                {task.isMilestone ? (
                                    /* ── Milestone diamond ─────────────────── */
                                    barVisible && <g transform={`translate(${barX},${y0 + ROW_H / 2})`}
                                        className={`gantt-bar ${isDraggingThis ? "gantt-bar-dragging" : ""} ${canDrag ? "cursor-grab" : "cursor-default"}`}
                                        onMouseDown={canDrag ? e => startDrag(e, task, "move") : undefined}>
                                        <title>{task.name}{task.isCritical ? " ★ CRITICAL" : ` (float: ${task.totalFloat.toFixed(1)}${activeUnit})`}</title>
                                        <rect x={-9} y={-9} width={18} height={18} transform="rotate(45)"
                                            className="gantt-milestone-diamond"
                                            fill={C.milestone} stroke="#d97706" strokeWidth="1.5" />
                                        {barVisible && task.isCritical && (
                                            <rect x={-10} y={-10} width={20} height={20} transform="rotate(45)"
                                                fill="none" stroke={C.criticalStroke} strokeWidth="1" opacity="0">
                                                <animate attributeName="opacity" values="0;0.5;0" dur="2.5s" repeatCount="indefinite" />
                                            </rect>
                                        )}
                                    </g>
                                ) : (barVisible || actualX !== null) ? (
                                    <>
                                        {/* Float ghost */}
                                        {!mini && hasFloat && floatVisible && (
                                            <rect x={floatX} y={y0 + BAR_Y + 3} width={floatW} height={BAR_H - 6}
                                                rx={3} fill={C.float} stroke="rgba(255,255,255,0.07)"
                                                strokeWidth="0.5" strokeDasharray="3,2" className="gantt-bar">
                                                <title>Float: {task.totalFloat.toFixed(1)}{activeUnit} slack window</title>
                                            </rect>
                                        )}

                                        {/* Main bar — draggable body */}
                                        <rect x={barX} y={y0 + BAR_Y} width={barW} height={BAR_H} rx={4}
                                            display={barVisible ? undefined : "none"}
                                            fill={barColour} fillOpacity={isDraggingThis ? "0.95" : "0.82"}
                                            stroke={strokeColour} strokeWidth="1"
                                            className={`gantt-bar ${isDraggingThis ? "gantt-bar-dragging" : ""} ${canDrag ? (isDraggingThis ? "cursor-grabbing" : "cursor-grab") : "cursor-default"}`}
                                            onMouseDown={canDrag ? e => {
                                                // Only start move drag if not near right edge
                                                const svgX = getSvgX(e.clientX);
                                                const rightEdge = barX + barW;
                                                if (svgX >= rightEdge - RESIZE_HIT) return; // let resize handle take it
                                                startDrag(e, task, "move");
                                            } : undefined}>
                                            <title>
                                                {task.name}: offset {task.earlyStart.toFixed(1)} → {task.earlyFinish.toFixed(1)} ({task.duration}{activeUnit})
                                                {task.isCritical ? " ★ CRITICAL" : ` (float: ${task.totalFloat.toFixed(1)}${activeUnit})`}
                                                {isManual ? " 📌 Manually placed" : ""}
                                                {canDrag ? "\nDrag to move • drag right edge to resize" : ""}
                                            </title>
                                        </rect>

                                        {/* Critical pulse */}
                                        {barVisible && task.isCritical && (
                                            <rect x={barX} y={y0 + BAR_Y} width={barW} height={BAR_H} rx={4}
                                                fill="none" stroke={C.criticalStroke} strokeWidth="1.5" opacity="0" className="gantt-bar">
                                                <animate attributeName="opacity" values="0;0.4;0" dur="2.5s" repeatCount="indefinite" />
                                            </rect>
                                        )}

                                        {/* Duration label */}
                                        {barVisible && barW > 30 && (
                                            <text x={barX + barW / 2} y={y0 + BAR_Y + BAR_H / 2 + 4}
                                                textAnchor="middle" fill="white" fontSize="9" fontWeight="700" fillOpacity="0.92"
                                                className={`gantt-bar ${isDraggingThis ? "gantt-bar-dragging" : ""} pointer-events-none`}>
                                                {task.duration}{activeUnit}
                                            </text>
                                        )}

                                        {/* Actual overlay */}
                                        {actualX !== null && actual && (
                                            <g className="pointer-events-none">
                                                <rect x={actualX} y={y0 + BAR_Y + 5} width={actualW} height={BAR_H - 10}
                                                    rx={3} fill={actual.status === "failed" ? "rgba(239, 68, 68, 0.25)" : C.actual} 
                                                    stroke={actual.status === "failed" ? "#ef4444" : C.actualStroke} strokeWidth="1"
                                                    filter={actual.status === "failed" ? "url(#gc-glow-failed)" : undefined}>
                                                    <title>Actual: {actual.startedAt?.slice(0, 19)} → {actual.finishedAt?.slice(0, 19) ?? "ongoing"} ({actual.status})</title>
                                                </rect>
                                                {(actual.status === "active" || actual.status === "running") && (
                                                    <rect x={actualX} y={y0 + BAR_Y + 5} width={actualW} height={BAR_H - 10}
                                                        rx={3} fill="url(#gc-barber-pole)" opacity="0.85" />
                                                )}
                                            </g>
                                        )}

                                        {/* Resize handle — right edge */}
                                        {barVisible && canDrag && barW > 10 && (
                                            <g className="cursor-ew-resize"
                                                onMouseDown={e => { e.stopPropagation(); startDrag(e, task, "resize"); }}>
                                                <rect x={barX + barW - RESIZE_HIT} y={y0 + BAR_Y}
                                                    width={RESIZE_HIT + 2} height={BAR_H}
                                                    fill="transparent" />
                                                {/* Visible grip */}
                                                <line x1={barX + barW - 3} y1={y0 + BAR_Y + 5}
                                                    x2={barX + barW - 3} y2={y0 + BAR_Y + BAR_H - 5}
                                                    stroke={C.handle} strokeWidth="1.5" strokeLinecap="round" />
                                                <line x1={barX + barW - 6} y1={y0 + BAR_Y + 5}
                                                    x2={barX + barW - 6} y2={y0 + BAR_Y + BAR_H - 5}
                                                    stroke={C.handle} strokeWidth="1" strokeLinecap="round" strokeOpacity="0.5" />
                                            </g>
                                        )}
                                    </>
                                ) : (
                                    null
                                )}

                                {!mini && historyEvents.map(event => {
                                    const tone = EVENT_TONE[event.tone];
                                    return (
                                        <g key={event.id} transform={`translate(${xForUnit(event.offset)}, ${y0 + ROW_H - 8})`}
                                            className="cursor-pointer"
                                            onClick={() => setSelectedTaskName(task.name)}>
                                            <circle r={4.5} fill={tone.fill} stroke={tone.stroke} strokeWidth="1.2" />
                                            <circle r={1.6} fill="rgba(255,255,255,0.9)" />
                                            <title>{event.type}: {event.detail}</title>
                                        </g>
                                    );
                                })}

                                {/* Row divider */}
                                <line x1={0} y1={y0 + ROW_H} x2={svgW} y2={y0 + ROW_H}
                                    stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                            </g>
                        );
                    })}

                    {/* Today / Playhead marker */}
                    {currentOffset >= 0 && isOffsetVisible(currentOffset) && (
                        <g 
                            className="pointer-events-none" 
                            transform={`translate(${xForUnit(currentOffset)}, 0)`}
                            style={{
                                transition: isDragging ? 'none' : `transform ${transitionSec}s linear`
                            }}
                        >
                            <line x1={0} y1={HEADER_H} x2={0} y2={svgH}
                                stroke={C.today} strokeWidth="3" opacity="0.18" />
                            <line x1={0} y1={HEADER_H} x2={0} y2={svgH}
                                stroke={C.today} strokeWidth="1.5" strokeDasharray="3,3" opacity="0.85" />
                            {isSubDay && (
                                <circle cx={0} cy={HEADER_H} r={4} fill={C.today}>
                                    <animate attributeName="r" values="4;10;4" dur="2s" repeatCount="indefinite" />
                                    <animate attributeName="opacity" values="1;0;1" dur="2s" repeatCount="indefinite" />
                                </circle>
                            )}
                            <rect x={-18} y={HEADER_H - 15}
                                width={36} height={14} rx={3} fill={C.today} fillOpacity="0.95"
                                filter="drop-shadow(0 0 2px rgba(239, 68, 68, 0.4))" />
                            <text x={0} y={HEADER_H - 4}
                                textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
                                {activeUnit === "d" ? "TODAY" : "NOW"}
                            </text>
                        </g>
                    )}

                    {/* Hovered task tooltip */}
                    {hoveredTask && !isDragging && (
                        <g className="pointer-events-none">
                            <g transform={`translate(${xForUnit(hoveredTask.earlyStart) + (hoveredTask.duration * dayW) / 2}, ${HEADER_H + hoveredTask.rowIndex * ROW_H - 32})`}>
                                <rect x={-70} y={-24} width={140} height={48} rx={6}
                                    fill="rgba(8, 8, 12, 0.95)" stroke="rgba(99,102,241,0.5)" strokeWidth="1"
                                    filter="drop-shadow(0 4px 6px rgba(0,0,0,0.5))" />
                                <text x={0} y={-12} textAnchor="middle" fill="#e2e8f0" fontSize="9.5" fontWeight="800">
                                    {hoveredTask.name.length > 18 ? hoveredTask.name.substring(0, 16) + "..." : hoveredTask.name}
                                </text>
                                <text x={0} y={2} textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="500">
                                    Duration: {hoveredTask.duration}{activeUnit} • Offset: +{hoveredTask.earlyStart.toFixed(0)}
                                </text>
                                <text x={0} y={14} textAnchor="middle" 
                                    fill={hoveredTask.isCritical ? "#f59e0b" : "#6366f1"} fontSize="8" fontWeight="700">
                                    {hoveredTask.isCritical ? "★ CRITICAL PATH" : `Slack: ${hoveredTask.totalFloat.toFixed(1)}${activeUnit}`}
                                </text>
                                <polygon points="-4,24 4,24 0,28" fill="rgba(8, 8, 12, 0.95)" stroke="rgba(99,102,241,0.5)" strokeWidth="0.5" />
                            </g>
                        </g>
                    )}

                    {/* Drag tooltip */}
                    {dragTooltip && (
                        <g className="pointer-events-none">
                            <rect x={dragTooltip.x - 60} y={dragTooltip.y - 2}
                                width={120} height={18} rx={4}
                                fill="rgba(0,0,0,0.85)" stroke="rgba(99,102,241,0.6)" strokeWidth="1" />
                            <text x={dragTooltip.x} y={dragTooltip.y + 12}
                                textAnchor="middle" fill="#c7d2fe" fontSize="9" fontWeight="700">
                                {dragTooltip.text}
                            </text>
                        </g>
                    )}
                </svg>
            </div>

            {!mini && inspectedTask && (
                <div className="border-y border-white/5 bg-black/20 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Activity className="w-3.5 h-3.5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Event Group Details</span>
                        <Badge variant="outline" className="h-5 border-primary/20 bg-primary/10 text-[9px] text-primary">
                            {inspectedTask.name}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground/60">
                            +{formatUnitLabel(inspectedTask.earlyStart, activeUnit)} to +{formatUnitLabel(inspectedTask.earlyFinish, activeUnit)}
                        </span>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        {filteredInspectedEvents.map(event => {
                            const tone = EVENT_TONE[event.tone];
                            const Icon = event.tone === "failed" ? AlertTriangle : event.tone === "completed" ? CheckCircle2 : event.tone === "running" ? Activity : Clock3;
                            return (
                                <div key={event.id} className="min-w-0 rounded-md border border-white/5 bg-foreground/[0.025] px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border" style={{ borderColor: tone.stroke, color: tone.stroke, backgroundColor: tone.fill }}>
                                            <Icon className="h-3 w-3" />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-[10px] font-black uppercase tracking-widest text-foreground">{event.type}</p>
                                            <p className="truncate text-[10px] text-muted-foreground">{event.detail}</p>
                                        </div>
                                        <span className="text-[9px] font-bold text-muted-foreground/60">+{formatUnitLabel(event.offset, activeUnit)}</span>
                                    </div>
                                </div>
                            );
                        })}
                        {filteredInspectedEvents.length === 0 && (
                            <div className="rounded-md border border-white/5 bg-foreground/[0.025] px-3 py-2 text-xs text-muted-foreground">
                                No selected mission events match this filter.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {!mini && explorerView === "full" && (
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-primary">Full History</div>
                            <p className="text-[10px] text-muted-foreground">Low-level mission events with owning mission, offset, and current classification.</p>
                        </div>
                        <Badge variant="outline" className="h-5 border-white/10 bg-foreground/5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                            {visibleHistoryEvents.length} rows
                        </Badge>
                    </div>
                    <div className="max-h-72 overflow-auto rounded-lg border border-white/5">
                        {visibleHistoryEvents
                            .slice()
                            .sort((a, b) => a.offset - b.offset || a.taskName.localeCompare(b.taskName))
                            .map(event => {
                                const tone = EVENT_TONE[event.tone];
                                const Icon = event.tone === "failed" ? AlertTriangle : event.tone === "completed" ? CheckCircle2 : event.tone === "running" ? Activity : Clock3;
                                const selected = selectedTaskName === event.taskName;
                                return (
                                    <button
                                        key={event.id}
                                        type="button"
                                        onClick={() => setSelectedTaskName(event.taskName)}
                                        className={`flex w-full items-center gap-3 border-b border-white/5 px-3 py-2 text-left last:border-b-0 hover:bg-foreground/[0.04] ${selected ? "bg-primary/10" : "bg-transparent"}`}
                                    >
                                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: tone.stroke, color: tone.stroke, backgroundColor: tone.fill }}>
                                            <Icon className="h-3.5 w-3.5" />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="truncate text-[11px] font-black uppercase tracking-widest text-foreground">{event.type}</span>
                                                <span className="text-[9px] text-muted-foreground">+{formatUnitLabel(event.offset, activeUnit)}</span>
                                            </div>
                                            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{event.taskName} - {event.detail}</div>
                                        </div>
                                        <Badge variant="outline" className="h-5 border-white/10 bg-foreground/5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                                            {event.tone}
                                        </Badge>
                                    </button>
                                );
                            })}
                        {visibleHistoryEvents.length === 0 && (
                            <div className="px-3 py-4 text-xs text-muted-foreground">
                                No history rows match this filter.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Stats */}
            {!mini && tasks.length > 0 && (
                <div className="flex flex-wrap gap-4 px-1 text-[10px] text-muted-foreground">
                    <span><span className="font-bold text-foreground">{totalUnits.toFixed(0)}</span> total {activeUnit === "d" ? "days" : activeUnit === "s" ? "seconds" : activeUnit === "m" ? "minutes" : activeUnit === "ms" ? "ms" : activeUnit === "h" ? "hours" : activeUnit === "w" ? "weeks" : "months"}</span>
                    {domain.isWindowed && (
                        <span><span className="font-bold text-primary">{formatUnitLabel(domain.start, activeUnit)}</span> live window start</span>
                    )}
                    <span><span className="font-bold text-amber-400">{tasks.filter(t => t.isCritical).length}</span> critical</span>
                    <span><span className="font-bold">{tasks.filter(t => t.totalFloat > 0).length}</span> have float</span>
                    {tasks.filter(t => t.isManuallyScheduled).length > 0 && (
                        <span><span className="font-bold text-cyan-400">{tasks.filter(t => t.isManuallyScheduled).length}</span> manually placed</span>
                    )}
                    {runs.length > 0 && (
                        <span><span className="font-bold text-emerald-400">{runs.filter(r => r.status === "completed").length}</span>/{runs.length} runs complete</span>
                    )}
                    {onChange && !hasUnsaved && (
                        <span className="ml-auto text-muted-foreground/40 flex items-center gap-1">
                            <Info className="w-3 h-3" /> Drag bars to reschedule · drag right edge to resize
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
