import React, { useState } from "react";
import { Clock, ArrowUpDown } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { cn } from "@/lib/utils";
import type { RendererProps } from "../registry";

interface TimelineEvent {
    timestamp?: string | number;
    event?: string;
    type?: string;
    note?: string;
    status?: string;
    action?: string;
    [key: string]: unknown;
}

function dotColor(event: TimelineEvent): string {
    const s = (event.status ?? event.type ?? event.event ?? "").toString().toLowerCase();
    if (/success|completed|done|passed/.test(s)) return "bg-emerald-500";
    if (/error|fail|critical/.test(s)) return "bg-red-500";
    if (/warn|pending|waiting/.test(s)) return "bg-amber-500";
    return "bg-primary";
}

function formatTs(ts: string | number | undefined): string {
    if (!ts) return "";
    try {
        const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return String(ts); }
}

export function TimelineEventsRenderer({ label, displayLabel, value }: RendererProps) {
    const [newestFirst, setNewestFirst] = useState(true);
    const events = Array.isArray(value) ? (value as TimelineEvent[]) : [];
    const sorted = newestFirst ? [...events].reverse() : [...events];

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                        {displayLabel || label}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px] h-4 border-amber-400/30 text-amber-400">
                        {events.length} event{events.length !== 1 ? "s" : ""}
                    </Badge>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-amber-400"
                        onClick={() => setNewestFirst(n => !n)}
                        title={newestFirst ? "Showing newest first" : "Showing oldest first"}
                    >
                        <ArrowUpDown className="w-3 h-3" />
                    </Button>
                </div>
            </div>

            <div className="relative max-h-[350px] overflow-y-auto scrollbar-thin scrollbar-thumb-amber-500/20 pl-1">
                <div className="absolute left-3.5 top-0 bottom-0 w-px bg-border/60" />
                <div className="space-y-1">
                    {sorted.map((ev, i) => {
                        const label = ev.event ?? ev.type ?? ev.action ?? "event";
                        const note = typeof ev.note === "string" ? ev.note : undefined;
                        return (
                            <div key={i} className="relative pl-7 py-1.5">
                                <div className={cn("absolute left-2 top-2.5 w-3 h-3 rounded-full border-2 border-background", dotColor(ev))} />
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline" className="text-[8px] h-4 px-1.5 font-mono uppercase border-border/50 text-muted-foreground">
                                        {label}
                                    </Badge>
                                    {ev.status && (
                                        <Badge variant="outline" className="text-[8px] h-4 px-1.5 border-border/30 text-muted-foreground/70">
                                            {String(ev.status)}
                                        </Badge>
                                    )}
                                    <span className="text-[9px] font-mono text-muted-foreground/60 ml-auto">
                                        {formatTs(ev.timestamp)}
                                    </span>
                                </div>
                                {note && (
                                    <p className="text-[11px] text-foreground/70 mt-0.5 leading-snug line-clamp-2">{note}</p>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
