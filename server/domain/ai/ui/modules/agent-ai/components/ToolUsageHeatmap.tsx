/* eslint-disable */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Loader2, Activity, Info } from "lucide-react";
import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import "../styles/heatmap.css";
import { 
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@domain-ui/core/ui/components/ui/tooltip";

interface HeatmapData {
    toolName: string;
    timeSlot: string;
    count: number;
    // No avgDuration: agent_run_steps stores no per-step duration, so the API
    // stopped returning a field that was always 0. Nothing rendered it.
}

interface ToolUsageHeatmapProps {
    timeRange?: string;
    detailed?: boolean;
}

export function ToolUsageHeatmap({ timeRange = "7d", detailed = false }: ToolUsageHeatmapProps) {
    const [groupBy, setGroupBy] = useState<"hour" | "day">("hour");

    const { data: heatmapData = [], isLoading } = useQuery<HeatmapData[]>({
        queryKey: ['/api/agent/analytics/tool-heatmap', timeRange, groupBy],
        queryFn: async () => {
            const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
            const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            // One groupBy. A stray `&groupBy=${startDate}` used to precede it, and
            // Express parses a repeated key as an array — so the server saw
            // ['<iso date>', 'hour'] and silently bucketed by day instead of hour.
            const res = await apiRequest('GET', `/api/agent/analytics/tool-heatmap?startDate=${startDate}&groupBy=${groupBy}`);
            return res.json();
        }
    });

    const { tools, timeSlots, heatmapMatrix } = useMemo(() => {
        const toolSet = new Set<string>();
        const timeSet = new Set<string>();
        const dataMap = new Map<string, number>();

        heatmapData.forEach(item => {
            toolSet.add(item.toolName);
            timeSet.add(item.timeSlot);
            dataMap.set(`${item.toolName}-${item.timeSlot}`, item.count);
        });

        const tools = Array.from(toolSet).sort();
        const timeSlots = Array.from(timeSet).sort();

        const matrix = tools.map(tool => ({
            tool,
            data: timeSlots.map(slot => ({
                slot,
                count: dataMap.get(`${tool}-${slot}`) || 0
            }))
        }));

        return { tools, timeSlots, heatmapMatrix: matrix };
    }, [heatmapData]);

    const maxCount = useMemo(() => {
        return Math.max(...heatmapData.map(d => d.count), 1);
    }, [heatmapData]);

    const getColorIntensity = (count: number) => {
        if (count === 0) return "rgba(255, 255, 255, 0.02)";
        const intensity = 10 + (count / maxCount) * 80;
        return `hsl(var(--primary) / ${intensity}%)`;
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-80 space-y-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary shadow-glow" />
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary/60 italic animate-pulse">Analyzing Interaction Fabric...</span>
            </div>
        );
    }

    if (heatmapData.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-80 text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-foreground/5 border border-foreground/10 flex items-center justify-center opacity-20">
                    <Activity className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                    <h3 className="text-sm font-black text-foreground/40 uppercase tracking-widest italic">Silent Network Detected</h3>
                    <p className="text-[10px] font-black text-foreground/10 uppercase tracking-[0.3em] italic">NO INTERACTION DATA RECORDED FOR THIS TEMPORAL RANGE</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between pb-4 border-b border-foreground/5">
                <div className="flex items-center gap-4">
                    <div className="px-3.5 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[9px] font-black tracking-[0.2em] uppercase text-foreground/40 italic">
                        Node Map: {tools.length}T × {timeSlots.length}S
                    </div>
                </div>
                <Select value={groupBy} onValueChange={(v) => setGroupBy(v as "hour" | "day")}>
                    <SelectTrigger className="w-[160px] h-10 bg-foreground/[0.03] border-foreground/10 text-[10px] font-black uppercase tracking-widest italic text-foreground/60 focus:ring-0 rounded-xl">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background border-foreground/10">
                        <SelectItem value="hour" className="text-[10px] font-black uppercase italic tracking-widest">Temporal: Hour</SelectItem>
                        <SelectItem value="day" className="text-[10px] font-black uppercase italic tracking-widest">Temporal: Day</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="overflow-x-auto custom-scrollbar pb-6">
                <div className="inline-block min-w-full">
                    <div
                        className="heatmap-grid"
                        style={{
                            '--grid-cols': `200px repeat(${timeSlots.length}, 48px)`
                        } as any}
                    >
                        <div className="contents">
                            {/* Header Row */}
                            <div className="h-16"></div>
                            {timeSlots.map((slot) => (
                                <div
                                    key={slot}
                                    className="text-[9px] font-black text-center text-foreground/20 uppercase tracking-widest transform -rotate-45 origin-bottom-left h-16 flex items-end justify-center italic"
                                >
                                    <span className="truncate max-w-[48px]">
                                        {groupBy === 'hour' ? slot.split(' ')[1] : slot}
                                    </span>
                                </div>
                            ))}
                            {/* Data Rows */}
                            {heatmapMatrix.map(({ tool, data }) => (
                                <div key={tool} className="contents group">
                                    <div
                                        className="h-12 flex items-center pr-6 text-[11px] font-black text-foreground/60 uppercase italic tracking-tighter truncate group-hover:text-primary transition-colors"
                                        title={tool}
                                    >
                                        <div className="w-1 h-4 bg-primary/20 mr-3 rounded-full" />
                                        {tool}
                                    </div>
                                    <TooltipProvider>
                                        {data.map(({ slot, count }) => (
                                            <Tooltip key={`${tool}-${slot}`}>
                                                <TooltipTrigger asChild>
                                                    <motion.div
                                                        whileHover={{ scale: 1.1, zIndex: 20 }}
                                                        className={cn(
                                                            "heatmap-cell group",
                                                            count > 0 ? "border-primary/20 hover:border-primary/50 hover:shadow-glow shadow-primary/20" : "border-foreground/5"
                                                        )}
                                                        style={{
                                                            '--intensity': getColorIntensity(count)
                                                        } as any}
                                                    >
                                                        {detailed && count > 0 && (
                                                            <div className="flex items-center justify-center h-full text-[10px] font-black text-foreground italic">
                                                                {count}
                                                            </div>
                                                        )}
                                                        {count > (maxCount * 0.8) && (
                                                            <div className="absolute inset-0 bg-primary/20 animate-pulse rounded-lg" />
                                                        )}
                                                    </motion.div>
                                                </TooltipTrigger>
                                                <TooltipContent className="bg-background border-foreground/10 p-4 rounded-2xl shadow-2xl">
                                                    <div className="space-y-2">
                                                        <p className="text-[10px] font-black text-primary uppercase tracking-widest italic">{tool}</p>
                                                        <div className="flex items-center justify-between gap-8">
                                                            <span className="text-[9px] font-black text-foreground/40 uppercase tracking-[0.2em] italic">Invocations</span>
                                                            <span className="text-[11px] font-black text-foreground italic">{count}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between gap-8">
                                                            <span className="text-[9px] font-black text-foreground/40 uppercase tracking-[0.2em] italic">Temporal Node</span>
                                                            <span className="text-[9px] font-black text-foreground/60 uppercase italic">{slot}</span>
                                                        </div>
                                                    </div>
                                                </TooltipContent>
                                            </Tooltip>
                                        ))}
                                    </TooltipProvider>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-between px-2 pt-6 border-t border-foreground/5">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black text-foreground/20 uppercase tracking-widest italic">Intensity Spectrum</span>
                        <div className="flex gap-1.5 p-1.5 rounded-xl bg-foreground/[0.02] border border-foreground/5">
                            {[0, 25, 50, 75, 100].map(intensity => (
                                <div
                                    key={intensity}
                                    style={{
                                        '--legend-bg': intensity === 0 ? 'rgba(255,255,255,0.02)' : `hsl(var(--primary) / ${10 + (intensity/100)*80}%)`
                                    } as any}
                                    className="legend-swatch"
                                />
                            ))}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Info className="w-3.5 h-3.5 text-foreground/10" />
                    <span className="text-[8px] font-bold text-foreground/10 uppercase tracking-[0.2em] italic">HOVER OVER NODES FOR DETAILED METRIC BREAKDOWN</span>
                </div>
            </div>
        </div>
    );
}
