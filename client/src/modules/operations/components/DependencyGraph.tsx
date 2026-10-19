import React, { useMemo } from "react";
import type { Blueprint } from "../data/cycle-templates";

export type RunStatus = "completed" | "active" | "running" | "failed" | "waiting_on_human" | "paused" | "pending";

export interface DependencyGraphProps {
    blueprints: Blueprint[];
    /** Map of blueprint name → run status, for execution-state overlay */
    runStatuses?: Record<string, RunStatus>;
}

const NODE_W = 160;
const NODE_H = 60;
const COL_GAP = 48;
const ROW_GAP = 24;
const PAD = 24;

function computeLayout(blueprints: Blueprint[]): { x: number; y: number; bp: Blueprint }[] {
    if (blueprints.length === 0) return [];

    const nameToIdx = new Map(blueprints.map((b, i) => [b.name, i]));
    const depths = new Array(blueprints.length).fill(0);
    const inDeps = blueprints.map(b => [
        ...(b.dependencies ?? []).map(d => d.blueprintName),
        ...(b.dependsOn ?? []),
    ].filter(n => nameToIdx.has(n)));

    // Cap iterations to prevent infinite loop on circular deps
    let changed = true;
    let iters = 0;
    while (changed && iters++ < blueprints.length * 2) {
        changed = false;
        blueprints.forEach((_, i) => {
            inDeps[i].forEach(depName => {
                const di = nameToIdx.get(depName)!;
                if (depths[i] <= depths[di]) { depths[i] = depths[di] + 1; changed = true; }
            });
        });
    }

    const columns: number[][] = [];
    blueprints.forEach((_, i) => {
        const col = depths[i];
        if (!columns[col]) columns[col] = [];
        columns[col].push(i);
    });

    // Calculate vertical centering offsets per column
    const maxNodesInCol = Math.max(...columns.map(c => c.length));
    const totalMaxH = maxNodesInCol * (NODE_H + ROW_GAP) - ROW_GAP;

    const positions = new Array(blueprints.length).fill(null);
    columns.forEach((col, ci) => {
        const colH = col.length * (NODE_H + ROW_GAP) - ROW_GAP;
        const vOffset = (totalMaxH - colH) / 2;
        
        col.forEach((nodeIdx, ri) => {
            positions[nodeIdx] = { 
                x: PAD + ci * (NODE_W + COL_GAP), 
                y: PAD + vOffset + ri * (NODE_H + ROW_GAP) 
            };
        });
    });

    return blueprints.map((bp, i) => ({ x: positions[i].x, y: positions[i].y, bp }));
}

const DEP_LABEL: Record<string, string> = {
    finish_to_start: "FS",
    start_to_start: "SS",
    finish_to_finish: "FF",
    start_to_finish: "SF",
};

// Status → fill / stroke colours (RGBA strings for SVG)
const STATUS_STYLE: Record<RunStatus, { fill: string; stroke: string; pulse?: boolean; glow: string }> = {
    completed:        { fill: "rgba(16,185,129,0.15)",  stroke: "rgba(16,185,129,0.6)", glow: "rgba(16,185,129,0.3)" },
    active:           { fill: "rgba(99,102,241,0.25)", stroke: "rgba(99,102,241,0.8)", pulse: true, glow: "rgba(99,102,241,0.5)" },
    running:          { fill: "rgba(99,102,241,0.25)", stroke: "rgba(99,102,241,0.8)", pulse: true, glow: "rgba(99,102,241,0.5)" },
    failed:           { fill: "rgba(239,68,68,0.15)",  stroke: "rgba(239,68,68,0.6)", glow: "rgba(239,68,68,0.3)" },
    waiting_on_human: { fill: "rgba(245,158,11,0.15)",  stroke: "rgba(245,158,11,0.5)", glow: "rgba(245,158,11,0.3)" },
    paused:           { fill: "rgba(245,158,11,0.12)",  stroke: "rgba(245,158,11,0.4)", glow: "rgba(245,158,11,0.2)" },
    pending:          { fill: "rgba(255,255,255,0.04)", stroke: "rgba(255,255,255,0.12)", glow: "transparent" },
};

const STATUS_LABEL: Partial<Record<RunStatus, string>> = {
    completed: "✓ COMPLETE",
    active:    "● EXECUTING",
    running:   "● EXECUTING",
    failed:    "✕ FAILED",
    waiting_on_human: "⏸ HIL GATE",
    paused:    "⏸ PAUSED",
};

export function DependencyGraph({ blueprints, runStatuses }: DependencyGraphProps) {
    const validBps = blueprints.filter(b => b.name);
    const layout = useMemo(() => computeLayout(validBps), [validBps]);

    if (validBps.length === 0) return (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground/30 italic uppercase tracking-widest">
            Awaiting logic definition...
        </div>
    );

    const nameToPos = new Map(layout.map(({ x, y, bp }) => [bp.name, { x, y }]));

    const edges: { from: { x: number; y: number }; to: { x: number; y: number }; label: string }[] = [];
    validBps.forEach(bp => {
        const toPos = nameToPos.get(bp.name);
        if (!toPos) return;
        const allDeps = [
            ...(bp.dependencies ?? []).map(d => ({ name: d.blueprintName, label: DEP_LABEL[d.type] ?? "FS" })),
            ...(bp.dependsOn ?? []).map(n => ({ name: n, label: "FS" })),
        ];
        allDeps.forEach(({ name, label }) => {
            const fromPos = nameToPos.get(name);
            if (!fromPos) return;
            edges.push({
                from: { x: fromPos.x + NODE_W, y: fromPos.y + NODE_H / 2 },
                to:   { x: toPos.x, y: toPos.y + NODE_H / 2 },
                label,
            });
        });
    });

    const maxX = Math.max(...layout.map(({ x }) => x + NODE_W)) + PAD;
    const maxY = Math.max(...layout.map(({ y }) => y + NODE_H)) + PAD;
    const hasRunStatuses = runStatuses && Object.keys(runStatuses).length > 0;

    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-1 w-full overflow-auto scrollbar-hide">
                <svg width={maxX} height={Math.max(maxY, 240)} className="block mx-auto min-w-max">
                    <defs>
                        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                        <marker id="dg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                            <path d="M0,0 L8,4 L0,8 Z" fill="#6366f1" fillOpacity="0.8" />
                        </marker>
                        <linearGradient id="edge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.6" />
                        </linearGradient>
                    </defs>

                    {/* Edges */}
                    {edges.map((e, i) => {
                        const mx = (e.from.x + e.to.x) / 2;
                        const d = `M${e.from.x},${e.from.y} C${mx},${e.from.y} ${mx},${e.to.y} ${e.to.x},${e.to.y}`;
                        return (
                            <g key={i}>
                                <path d={d} fill="none" stroke="url(#edge-grad)" strokeWidth="2" markerEnd="url(#dg-arrow)" />
                                <rect x={mx - 10} y={(e.from.y + e.to.y) / 2 - 8} width="20" height="12" rx="4" fill="#0c0c0e" stroke="#6366f1" strokeOpacity="0.2" />
                                <text x={mx} y={(e.from.y + e.to.y) / 2 + 1}
                                    textAnchor="middle" fill="#a5b4fc"
                                    fontSize="7" fontWeight="900" letterSpacing="0.05em">{e.label}</text>
                            </g>
                        );
                    })}

                    {/* Nodes */}
                    {layout.map(({ x, y, bp }) => {
                        const isMilestone = bp.type === "milestone";
                        const runStatus = runStatuses?.[bp.name] as RunStatus | undefined;
                        const style = runStatus
                            ? STATUS_STYLE[runStatus]
                            : isMilestone
                                ? { fill: "rgba(245,158,11,0.12)", stroke: "rgba(245,158,11,0.5)", glow: "rgba(245,158,11,0.2)" }
                                : { fill: "rgba(99,102,241,0.10)", stroke: "rgba(99,102,241,0.4)", glow: "rgba(99,102,241,0.2)" };

                        const typeLabel = runStatus
                            ? (STATUS_LABEL[runStatus] ?? (isMilestone ? "MILESTONE GATE" : "MISSION UNIT"))
                            : (isMilestone ? "MILESTONE GATE" : "MISSION UNIT");

                        const labelColor = runStatus === "completed" ? "#34d399"
                            : runStatus === "failed" ? "#f87171"
                            : runStatus && ["active", "running"].includes(runStatus) ? "#818cf8"
                            : runStatus && ["waiting_on_human", "paused"].includes(runStatus) ? "#fbbf24"
                            : isMilestone ? "#fbbf24" : "#818cf8";

                        const displayName = bp.name.length > 20 ? bp.name.slice(0, 18) + "…" : bp.name;

                        return (
                            <g key={bp.name} transform={`translate(${x},${y})`} className="cursor-default group">
                                <title>{bp.name}{bp.objective ? ` — ${bp.objective}` : ""}</title>
                                
                                {/* Glow Effect */}
                                <rect width={NODE_W} height={NODE_H} rx={8}
                                    fill={style.glow} filter="url(#glow)" opacity="0.3" />
                                
                                {/* Main Body */}
                                <rect width={NODE_W} height={NODE_H} rx={8}
                                    fill="#0c0c0e" stroke={style.stroke} strokeWidth="1.5" />
                                <rect width={NODE_W} height={NODE_H} rx={8}
                                    fill={style.fill} stroke="none" />

                                {/* Pulse for active */}
                                {style.pulse && (
                                    <rect width={NODE_W} height={NODE_H} rx={8}
                                        fill="none" stroke={style.stroke} strokeWidth="2" opacity="0.4">
                                        <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
                                        <animate attributeName="strokeWidth" values="2;6;2" dur="2s" repeatCount="indefinite" />
                                    </rect>
                                )}

                                {/* Content */}
                                <text x={NODE_W / 2} y={NODE_H / 2 - 8} textAnchor="middle"
                                    fill={labelColor} fontSize="7" fontWeight="900" letterSpacing="0.1em" opacity="0.8">
                                    {typeLabel}
                                </text>
                                <text x={NODE_W / 2} y={NODE_H / 2 + 10} textAnchor="middle"
                                    fill="white" fontSize="10" fontWeight="700" letterSpacing="-0.01em">
                                    {displayName}
                                </text>
                                
                                {/* Status Icon/Indicator */}
                                {runStatus === "completed" && (
                                    <circle cx={NODE_W - 12} cy={12} r={3} fill="#10b981" />
                                )}
                            </g>
                        );
                    })}
                </svg>
            </div>

            {/* Footer Legend */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 bg-black/40">
                <div className="flex gap-4">
                    {[
                        { code: "FS", full: "Finish→Start" },
                        { code: "SS", full: "Start→Start" },
                    ].map(({ code, full }) => (
                        <span key={code} className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">
                            <span className="text-primary/60">{code}</span> {full}
                        </span>
                    ))}
                </div>
                {hasRunStatuses && (
                    <div className="flex gap-3">
                        <span className="flex items-center gap-1 text-[8px] font-black text-emerald-500/60 uppercase tracking-widest">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Done
                        </span>
                        <span className="flex items-center gap-1 text-[8px] font-black text-indigo-400/60 uppercase tracking-widest">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" /> Live
                        </span>
                    </div>
                )}
            </div>
        </div>

    );
}
